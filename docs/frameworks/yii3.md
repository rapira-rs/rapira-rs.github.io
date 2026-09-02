---
title: Yii3
description: Running Yii3 in Worker mode with a resident HttpApplicationRunner, StateResetter, or a new runner for each request.
---

# Yii3

Yii3 supports persistent processes. Its dependency injection container provides `StateResetter`, and the runner provides public access to the container.
A worker can initialize the application once and reset request state after each response.
The official [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner) runner uses the same design.
This page describes a persistent worker, a per-request alternative, and integration test results.

::: info Verified with
- **PHP 8.5.8**: NTS, embed SAPI
- **Rapira 0.8.0**
- **yiisoft/app** template 1.4, with **yii-runner-http 3.2.1** (router-fastroute 4.x)

Tests ran both worker scripts with this software. They covered routing, URLs, request bodies, sessions, uploads, errors, and 200 sequential requests.
:::

## Yii3 and Worker mode

A resident worker needs two pieces of public API.

`ApplicationRunner::getContainer()` returns the application container. The worker does not need a subclass or access to private state.
`Yiisoft\Di\StateResetter` is a service in that container. Components register callbacks that reset their request state.
One `reset()` call runs these callbacks.

An application service that contains request state must also register a callback.
Add a `'reset' => function (): void { … }` key to its dependency injection definition.
`yiisoft/session` and `yiisoft/router` use the same method. The closure can reset private state without creating a new object.
See the [frameworks overview](/docs/frameworks/) and [Worker mode](/docs/worker) for state lifetime information.

The persistent design has three steps. Create the runner once. Run it for each request. Reset the container after each request.

## Prerequisites

- Rapira installed. See [Installation](/docs/intro/installation).
- A Yii3 application: either a fresh [`yiisoft/app`](https://github.com/yiisoft/app) project or one you already have.

The worker script is the only new PHP file. Put it in the project root next to `composer.json`.
The runner uses the project root as its `rootPath`.
Install a PHP CLI for Composer. Rapira supplies PHP as a library, not as a `php` command.
Composer uses the system PHP CLI. Rapira does not use or change this CLI.

## The resident worker

This is the recommended design. Save it as `worker.php` in the project root:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Di\StateResetter;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/vendor/autoload.php';
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

**`src/bootstrap.php` initializes the template.** It loads the Composer autoloader, reads `.env` when present, and calls `Environment::prepare()`.
The standard `public/index.php` performs the same operations before it uses the runner.
The explicit `vendor/autoload.php` line is not required because `src/bootstrap.php` also loads it. `require_once` prevents a second load.

**The worker creates the runner once with arguments from `public/index.php`.**
It passes `rootPath`, `debug`, `checkEvents`, and `environment` from `App\Environment`. Therefore, it initializes the same application.
The template also passes `temporaryErrorHandler` with a `StreamTarget` logger. It loads `c3.php` when you enable `APP_C3`.
The tested worker omits both parts.
The temporary handler logs errors during configuration and container creation.
Without it, `HttpApplicationRunner::createTemporaryErrorHandler()` creates an `ErrorHandler` with a `NullLogger`.
Pass the template handler to log container creation failures.

**`getContainer()` is public API.** It returns the application container that the runner uses for each request.
The handler gets `StateResetter` from this container.

**Per request: `run()`, then `reset()`.** The entry script also calls `run()`. Then, `reset()` runs the registered reset callbacks in the container. These callbacks restore stateful services before the next request arrives.

**`run()` repeats its complete sequence on each call.** It registers the error handler, calls `runBootstrap()`, calls `checkEvents()`, and handles the request.
Tests confirmed this repeated sequence during 200 calls.
The event check runs only when its flag is true. The template gets this flag from `Environment::appDebug()`.

**A persistent runner reads the current request.** `run()` does not store a request during runner creation.
Each call gets `RequestFactory` and creates a PSR-7 `ServerRequest`.
It uses the superglobals and `php://input`. Rapira fills these values before each loop iteration.
See [Worker mode](/docs/worker) for this contract.

**Memory use remained stable.** Tests found no significant process memory increase during 200 sequential requests.
The application initializes once, and each request runs one reset.

## A new runner for each request

Create the runner *inside* the handler to avoid persistent container state. Application objects then belong to one request:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/vendor/autoload.php';
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

Each request creates a new container, so the worker does not reset container state.
However, static properties, globals, and initialization state remain in the worker. Application code must reset this state.
Tests also confirmed this design.

The container initializes for each request. This adds initialization time and creates objects that PHP must later release.
Memory can increase until PHP releases several old containers together. This cyclic pattern is not necessarily a memory leak.
Set `pool.max_requests` to replace workers periodically.
See the [frameworks overview](/docs/frameworks/) for this memory pattern. See [Configuration](/docs/configuration) for the setting.

The autoloader and template bootstrap remain resident. The request loop also remains in the worker script. Therefore, this design is still a worker that discards its application between requests. It is not [Classic mode](/docs/classic).

Use the persistent runner by default. It follows the framework design, had stable memory use in tests, and requires one reset call.
Use a per-request runner when initialization order or request setup prevents a complete `StateResetter` callback.
Changing between these designs requires changes only to the worker script.

## Running it

```bash
rapira serve --mode worker worker.php
```

`--mode worker` selects Worker mode. See [CLI](/docs/cli) for the remaining flags.

For production, put it in a `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
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

## Test results

Tests applied the same checks to both designs with the `yiisoft/app` template. The results follow.

**Routing operates without `$_SERVER` overrides.** Rapira sets `SCRIPT_NAME` to `/worker.php`, which is the entry script name.
FastRoute matched nested paths with query strings. The root path returned the template home page.
An unknown path returned the framework `404` response. Tests did not change `SCRIPT_NAME`, `REQUEST_URI`, or `DOCUMENT_ROOT`.

**Generated URLs do not include the worker file name.** `UrlGeneratorInterface::generate()` returned ordinary application paths.

**Yii3 isolates each client session.** One client retained its counter between requests.
A second client received a new session. This also applied to the persistent container design.

**The application receives form data, JSON bodies, and uploads.** `$_POST` contained form fields, and `php://input` contained the JSON body.
The temporary upload file was readable during the request. The PSR-7 `ServerRequest` contained all these values.

**An action exception returns `500`, and the worker continues.** `ErrorCatcher` creates the error response and logs the exception.
The same worker processes the next request normally. See [Worker mode](/docs/worker) for errors that terminate a worker.

## CSRF

The application template includes `CsrfTokenMiddleware`, and the session contains the token. Tests confirmed token isolation for each client.
The worker loop does not change CSRF processing. Each POST still requires its token.
If Worker mode rejects a POST, first verify that the form contains and sends the token. Do not change the worker script for this error.

## Classic mode alternative

Yii3 also runs with an ordinary entry script:

```bash
rapira serve --mode classic public/index.php
```

This command uses the standard application code without a worker script. Each request has new application state.
See [Classic mode](/docs/classic) for more information.

The worker script is an additional entry point, not a replacement for the standard entry script. Keep `public/index.php` because Classic mode uses it. It is also useful for local work with PHP's built-in server.

The template `public/index.php` contains a `PHP_SAPI === 'cli-server'` condition. It serves static files and changes `SCRIPT_NAME` for the PHP development server.
Rapira does not run this condition because `PHP_SAPI` is `fastcgi` on PHP 8.4 and `rapira` on PHP 8.5.
See [Installation](/docs/intro/installation) for more information. The condition can remain unchanged.
