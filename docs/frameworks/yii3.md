---
title: Yii3
description: Running Yii3 in Worker mode with a resident HttpApplicationRunner, StateResetter, or a new runner for each request.
---

# Yii3

Yii3 supports persistent processes. A worker can initialize the application once and reset request state after each response. The official [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner) runner uses the same design. This page describes a persistent worker, a per-request alternative, and integration test results.

::: info Verified with
- **PHP 8.5.8**: NTS, embed SAPI
- **Rapira 0.8.0**
- **yiisoft/app** template 1.4, with **yii-runner-http 3.2.1** (router-fastroute 4.x)

Tests ran both worker scripts with this software. They covered routing, URLs, request bodies, sessions, uploads, errors, and 200 sequential requests. The examples on this page use the v0.9 configuration format.
:::

## Yii3 and Worker mode

A resident worker uses two items of public API:

- `ApplicationRunner::getContainer()` returns the application container. The worker does not need a subclass or access to private state.
- `Yiisoft\Di\StateResetter` is a service in that container. Components register reset callbacks, and one `reset()` call runs all of them.

An application service that contains request state must also register a callback. Add a `'reset' => function (): void { … }` key to its dependency injection definition. `yiisoft/session` and `yiisoft/router` use the same method. The closure can reset private state and does not create a new object. See the [frameworks overview](/docs/frameworks/) and [Worker mode](/docs/worker) for state lifetime information.

The persistent design has three steps. Create the runner once. Run it for each request. Reset the container after each request.

## Prerequisites

- Install Rapira. See [Installation](/docs/intro/installation).
- Create or select a Yii3 application. You can use a new [`yiisoft/app`](https://github.com/yiisoft/app) project.

The worker script is the only new PHP file. Put it in the project root next to `composer.json`. The runner uses the project root as its `rootPath`.

Install a PHP CLI for Composer. Rapira supplies PHP as a library, not as a `php` command. Rapira does not use or change the system PHP CLI.

## The resident worker

This is the recommended design. Save it as `worker.php` in the project root:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Di\StateResetter;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/src/bootstrap.php';

$runner = new HttpApplicationRunner(
    rootPath: __DIR__,
    debug: Environment::appDebug(),
    checkEvents: Environment::appDebug(),
    environment: Environment::appEnv(),
);
$container = $runner->getContainer();

$handler = static function () use ($runner, $container): void {
    try {
        $runner->run();
    } finally {
        // The worker continues after an error leaves run().
        // Reset state before the next request.
        $container->get(StateResetter::class)->reset();
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

The script contains these operations:

**`src/bootstrap.php` initializes the template.** It loads the Composer autoloader, reads `.env` when present, and calls `Environment::prepare()`. The standard `public/index.php` does the same operations before it uses the runner.

**The worker creates the runner once.** It uses the `rootPath`, `debug`, `checkEvents`, and `environment` arguments from `public/index.php`. Thus, it initializes the same application.

**The handler calls `run()` and then `reset()` for each request.** `run()` handles the request as the entry script does. `reset()` runs the registered reset callbacks before the next request.

**Memory use remained stable.** Tests found no significant process memory increase during 200 sequential requests.

::: question Which template parts does the worker omit?
The template passes `temporaryErrorHandler` with a `StreamTarget` logger. It also loads `c3.php` when you enable `APP_C3`. The tested worker omits both parts. Without the handler, `HttpApplicationRunner::createTemporaryErrorHandler()` creates an `ErrorHandler` with a `NullLogger`. Thus, the runner does not log errors during configuration and container creation. Pass the template handler to log these errors.
:::

::: question Does a persistent runner read the current request?
Yes. `run()` does not keep a request from runner creation. Each call gets `RequestFactory` and creates a PSR-7 `ServerRequest` from the superglobals and `php://input`. Rapira fills these values before each handler call. Each call also registers the error handler, calls `runBootstrap()`, and calls `checkEvents()` when its flag is true. Tests confirmed this sequence during 200 calls. See [Worker mode](/docs/worker) for the request data contract.
:::

## A new runner for each request

Create the runner *inside* the handler to avoid persistent container state. Application objects then belong to one request:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/src/bootstrap.php';

$handler = static function (): void {
    // Create one runner for each request.
    // Use the same arguments as public/index.php.
    $runner = new HttpApplicationRunner(
        rootPath: __DIR__,
        debug: Environment::appDebug(),
        checkEvents: Environment::appDebug(),
        environment: Environment::appEnv(),
    );
    $runner->run();
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Each request creates a new container, so the worker does not reset container state. Static properties, globals, and initialization state remain in the worker. Application code must reset this state. Tests also confirmed this design.

The container initializes for each request. This adds initialization time and creates objects that PHP must later release. Memory can increase until PHP releases several old containers together. This cyclic pattern is not necessarily a memory leak. See [Memory and recycling](/docs/frameworks/#memory-and-recycling).

Set `http.pool.max_requests` to replace workers periodically. See [Configuration](/docs/configuration) for this key.

This design is not [Classic mode](/docs/classic). The autoloader, the template bootstrap, and the request loop stay resident in the worker. Only the application is new for each request.

Use the persistent runner by default. It follows the framework design, requires one reset call, and kept memory use stable in tests. Use a per-request runner when initialization order or request setup prevents a complete `StateResetter` callback. To change between these designs, change only the worker script.

## Starting Rapira

Create `rapira.toml` next to `worker.php`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

```bash
rapira serve rapira.toml
```

`mode = "worker"` selects Worker mode. See [CLI](/docs/cli) for the command.

For production, use a complete `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "/srv/app/worker.php"
mode = "worker"
processes = 8
max_requests = 500
request_terminate_timeout_secs = 30

[log]
level = "info"
format = "json"
```

See [Configuration](/docs/configuration) for each key, default, and limit. See [Deployment](/docs/deployment) for systemd and reverse proxy configuration.

## Static files

The template keeps `favicon.ico`, `robots.txt`, and published asset bundles in `public/`. Rapira sends each request to the entry script unless the [static file middleware](/docs/static-files) answers it. Add the middleware to the `[http]` table in `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"
middleware = ["static"]

[http.static]
root = "public"
```

The default `forbid` list blocks `.php` files, so the middleware does not serve `public/index.php`. A CDN or reverse proxy can serve the assets instead. See [Framework integration](/docs/frameworks/#static-files) for the serving rules.

## Test results

Tests applied the same checks to both designs with the `yiisoft/app` template. The results follow.

**Routing operates without `$_SERVER` overrides.** Rapira sets `SCRIPT_NAME` to `/worker.php`, which is the entry script name. FastRoute matched nested paths with query strings. The root path returned the template home page. An unknown path returned the framework `404` response. Tests did not change `SCRIPT_NAME`, `REQUEST_URI`, or `DOCUMENT_ROOT`.

**Generated URLs do not include the worker file name.** `UrlGeneratorInterface::generate()` returned ordinary application paths.

**Yii3 isolates each client session.** One client kept its counter between requests. A second client received a new session. The persistent container design gave the same result.

**CSRF tokens operate without changes.** The template `CsrfTokenMiddleware` keeps the token in the session, and tests confirmed one token for each client. Each POST still requires its token. If Worker mode rejects a POST, make sure that the form sends the token. Do not change the worker script for this error.

**The application receives form data, JSON bodies, and uploads.** `$_POST` contained form fields, and `php://input` contained the JSON body. The temporary upload file was readable during the request. The PSR-7 `ServerRequest` contained all these values.

**An action exception returns `500`, and the worker continues.** `ErrorCatcher` creates the error response and logs the exception. The same worker processes the next request normally. See [Worker mode](/docs/worker) for errors that stop a worker.

## Classic mode alternative

Yii3 also runs with an ordinary entry script. Change `rapira.toml` to Classic mode:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

This configuration uses the standard application code without a worker script. Each request has new application state. See [Classic mode](/docs/classic) for more information.

Keep `public/index.php` as a second entry script. Classic mode and the PHP built-in server use it.

::: question Must I change the `cli-server` condition in `public/index.php`?
No. This condition serves static files and changes `SCRIPT_NAME` for the PHP built-in server. Rapira does not run it, because `PHP_SAPI` is `fastcgi` on PHP 8.4 and `rapira` on PHP 8.5. See [Installation](/docs/intro/installation) for the SAPI name.
:::
