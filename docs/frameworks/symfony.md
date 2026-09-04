---
title: Symfony
description: Running Symfony in Worker mode with a worker script, service resets between requests, and .env values in the container.
---

# Symfony

Symfony supports a persistent worker. The application initializes a kernel, passes it a `Request`, and receives a `Response`.
Rapira initializes the kernel once for each worker. Each request then calls `handle()` on the initialized container.

The application code does not change. A worker script replaces `public/index.php`.
This page describes that file, request state resets, and `.env` values.

::: info Verified with
- **PHP 8.5.8**: NTS, embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4** (`symfony/framework-bundle` v7.4.15), tested in `dev` and `prod`
- **Symfony 8.1** (`symfony/framework-bundle` v8.1.2), tested in `dev`

Both base applications used the `symfony/skeleton` package and one worker. Both used the **same `worker.php`** without version conditions.
Tests covered routing, errors, requests, sessions, uploads, and 200 sequential requests.
:::

## Behavior in Worker mode

The kernel initializes outside the loop and remains until the worker script restarts. The autoloader, container, router, event dispatcher, and connections initialize once. See [Worker mode](/docs/worker) and [Execution modes](/docs/execution-modes) for more information.

Per request the handler does four things and then cleans up:

1. `Request::createFromGlobals()` reads superglobals that Rapira fills for the current request.
2. `$kernel->handle($request)` runs routing and the controller. It returns the response.
3. `$response->send()` writes the HTTP response. See [HTTP](/docs/http) for transmission details.
4. `$kernel->terminate($request, $response)` runs post-response listeners.

The handler then uses `services_resetter` to reset stateful services. Symfony also uses `services_resetter` between Messenger messages.

Sessions use the native PHP session functions. Each request calls `session_start()`, and the response contains the session cookie.
The next request reads the stored session. Tests confirmed that separate clients receive separate sessions.

Each worker process has one kernel. Workers do not share application objects.
See [Process model](/docs/process-model) for worker counts and supervision.

## Prerequisites

Install [Rapira](/docs/intro/installation). Create or select a Symfony application. Put the worker script next to `composer.json`.

Install a PHP CLI for Composer and `bin/console`. Rapira supplies PHP as a library, not as a `php` command.
Composer and `bin/console` use the system PHP CLI. Rapira does not use or change this CLI.

The base application requires the `ctype` and `iconv` extensions. It also replaces their PHP polyfills, so both must be native extensions.
The system PHP CLI also needs them for Composer platform checks. Each Rapira release includes both extensions.

See [Installation](/docs/intro/installation) for the complete extension list.
Enable both extensions when you compile PHP. See [Build from source](/docs/intro/build-from-source).

The worker also uses the `symfony/dotenv` component from the base application. Remove the Dotenv call if the deployment environment provides all environment variables. Then remove the component if no other entry point uses it. The worker reads `.env` and creates the kernel without `symfony/runtime`. Keep `symfony/runtime` because `bin/console` and `public/index.php` use it.

## The worker script

Save this file as `worker.php` in the project root. Tests used it with both Symfony versions:

```php
<?php

declare(strict_types=1);

use App\Kernel;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

require __DIR__ . '/vendor/autoload.php';

// public/index.php uses symfony/runtime for this operation.
// The worker performs it once before the request loop.
(new Dotenv())->bootEnv(__DIR__ . '/.env');

$kernel = new Kernel($_SERVER['APP_ENV'], (bool) $_SERVER['APP_DEBUG']);
$kernel->boot();
$container = $kernel->getContainer();

$handler = static function () use ($kernel, $container): void {
    $request = Request::createFromGlobals();

    try {
        $response = $kernel->handle($request);
        $response->send();
        $kernel->terminate($request, $response);
    } finally {
        // Symfony uses the same reset between Messenger messages.
        // Each service with the kernel.reset tag removes request state.
        // The finally block also resets state when send() or terminate() throws.
        if ($container->has('services_resetter')) {
            $container->get('services_resetter')->reset();
        }
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Most operations use standard Symfony initialization. Four parts are specific to this worker:

**`(new Dotenv())->bootEnv(...)`.** The standard `public/index.php` delegates this operation to `symfony/runtime`. The worker reads `.env` once before it creates the kernel. Rapira keeps these `$_ENV` values across requests.

**The kernel initializes before the loop.** `new Kernel(...)`, `boot()`, and `getContainer()` run during worker initialization. The kernel reads `$_SERVER['APP_ENV']` during worker initialization. Each request uses the same container.

**`$container->has('services_resetter')` before `get()`.** The `services_resetter` identifier is public in both supported versions.
Its implementation class uses different namespaces in versions 7.4 and 8.1. The service identifier avoids a version condition.
The `has()` check prevents an error when a container does not define the service.

**The loop and `gc_collect_cycles()`.** `\Rapira\handle_request()` waits for a request, runs the handler, and returns `true`.
It returns `false` during worker shutdown and ends the loop. The script collects cycles between requests.
See [Worker mode](/docs/worker) for the complete contract.

If the resetter is insufficient, use `$container->reset()` or `$kernel->reboot(null)`. The first option removes each created service.
The second option removes the container and creates a new one.

After `$kernel->reboot(null)`, get the new container with `$kernel->getContainer()`. The handler must not use the previous container.
Both options remove cached application state. Use them to find a memory leak, not as the default configuration.

## `$_ENV` and the process environment

Rapira keeps `$_ENV` until the worker script restarts. It does not rebuild this superglobal for each request. Values that `bootEnv()` loads before the loop remain available during later requests. This behavior also applies with `variables_order = "GPCS"` and `auto_globals_jit = On`.

For example, add `usePutenv()` if application code must read Dotenv values with `getenv()`:

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` writes Dotenv values into the process environment. Symfony `%env(...)%` can read these `$_ENV` values without this call. Rapira runs one NTS PHP interpreter in each process. PHP does not call `putenv()` from concurrent threads.

In production, set environment variables through systemd, the container runtime, or the orchestrator. Use `.env` only for development.

## Starting Rapira

Start Rapira:

```bash
rapira serve --mode worker worker.php
```

`--mode worker` selects Worker mode. `127.0.0.1:8000` is the default listen address. `rapira serve` remains in the foreground.

Open another terminal. Send a request:

```bash
curl -i http://127.0.0.1:8000/
```

Press `Ctrl-C` in the first terminal to stop Rapira.

The entry script is `worker.php`, so `$_SERVER['SCRIPT_NAME']` is `/worker.php`. Symfony does not find this value at the start of the URI.
It then sets the base URL to `""`. `getPathInfo()` returns the request path, and routing operates correctly.
`generateUrl()` creates paths without a `/worker.php` prefix. You do not need `$_SERVER` overrides or `Request::setTrustedProxies()` for this behavior.

## Production

Set `APP_ENV=prod`. Install without development dependencies.
Create the cache before the server starts. Tests confirmed that `php bin/console cache:warmup` initializes the application correctly.
It also compiles the container before the first request:

```bash
composer install --no-dev --optimize-autoloader
APP_ENV=prod php bin/console cache:warmup
```

Check `DEFAULT_URI` during configuration. The base application sets `router.default_uri` to `%env(DEFAULT_URI)%` in each environment.
The default is `http://localhost`. Console commands and email code use this value to create URLs outside an HTTP request.
Set it to the application origin.

Use this minimal `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` replaces a worker after the specified request count. It limits the effect of a memory leak but does not correct it. `request_terminate_timeout_secs` limits the elapsed time of one request. Start the server with `APP_ENV=prod rapira serve --config rapira.toml`. A relative `entrypoint` uses the configuration file directory as its base. See [Configuration](/docs/configuration) for all settings.

## What resets between requests

`services_resetter` calls `reset()` on each service with the `kernel.reset` tag. Installed bundles determine which services have the tag. Examples include buffered log handlers and debug data collectors. Those services register the tag themselves.

It does not reset application static properties, global values, library registries, or persistent `ini_set()` changes.
This state remains in each persistent worker. Reset it in application code.
See [Frameworks](/docs/frameworks/) for the state lifetime table.

Tests with the resetter found stable process memory during 200 sequential requests in `dev` and `prod`. If memory increases, application code or a bundle can keep request state.

## Work after the response

Call [`rapira_finish_request()`](/docs/http) between `$response->send()` and `$kernel->terminate()` to send the response before post-response listeners run.
The worker continues to run `terminate()` until the handler returns. This can reduce client wait time but does not add concurrency.

## Development

`rapira serve` runs in the foreground and initializes the application once. Thus, **replace the worker to load changed PHP code**. Restart the server after each edit during development. Alternatively, use [Classic mode](/docs/classic). Classic mode reads the entry script for each request:

```bash
rapira serve --mode classic public/index.php
```

The same application initializes for each request in Classic mode. Thus, saved changes take effect immediately.

In production, `SIGUSR2` replaces workers and lets current requests finish. It closes idle keep-alive connections. With `opcache.validate_timestamps = 0`, the master keeps old opcodes during worker replacement. Use a complete restart in this configuration. See [process model](/docs/process-model) and [running in production](/docs/deployment) for more information.

Symfony handles an uncaught application exception and returns its own `500` response. `dev` shows the exception page, while `prod` shows a general error page.
The same worker processes the next request. The final reset removes changed service state after the exception.

The configured Symfony logger controls exception output. The base application does not include a logger. Rapira logs PHP errors that Symfony does not handle. See [Logging](/docs/logging) for level configuration.
