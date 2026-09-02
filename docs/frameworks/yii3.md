---
title: Yii3
description: Running a Yii3 application on Rapira in worker mode — the resident HttpApplicationRunner with StateResetter, the per-request runner, and what was verified about routing, sessions, uploads and errors.
---

# Yii3

Yii3 is designed to run in a process that stays alive: its DI container ships a `StateResetter`, the runner exposes its container through public API, and building the application once and resetting the per-request state after each response is the shape the framework already has. The official RoadRunner runner, [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner), is built the same way. This page covers the resident worker script, the per-request alternative, and what was verified about routing, sessions, uploads and error handling.

::: info Verified with
- **PHP 8.5.8** — NTS, embed SAPI
- **Rapira 0.8.0**
- **yiisoft/app** template 1.4, with **yii-runner-http 3.2.1** (router-fastroute 4.x)

Both worker scripts on this page were run against that stack and passed the full battery: routing, generated URLs, form and JSON posts, sessions, uploads, error handling and 200 sequential requests.
:::

## Yii3 and worker mode

A resident worker needs two pieces of public API.

`ApplicationRunner::getContainer()` returns the container the application runs on, so nothing has to be subclassed and no private state has to be reached into. `Yiisoft\Di\StateResetter` is a normal service in that container: components register their own reset callbacks with it, and one `reset()` call puts them back to how they started, which is the framework's own answer to a service that holds request state.

A service of your own that holds request state has to register a callback too: add a `'reset' => function (): void { … }` key to that service's DI definition, the same way `yiisoft/session` and `yiisoft/router` declare theirs. The closure is bound to the instance, so it can restore private state without rebuilding the object. What Rapira itself resets between requests, and what it leaves alone, is documented on the [frameworks overview](/docs/frameworks/) and in [Worker mode](/docs/worker).

The resident pattern is then three steps: build the runner once, run it per request, reset the container's state afterwards.

## Prerequisites

- Rapira installed — see [Installation](/docs/intro/installation).
- A Yii3 application: either a fresh [`yiisoft/app`](https://github.com/yiisoft/app) project or one you already have.

Nothing has to be installed on the PHP side: the worker script below is the only new file in the project, and it sits at the project root next to `composer.json`, because the runner's `rootPath` is the project root. You also need an ordinary PHP CLI on the machine for Composer — Rapira ships PHP as a library (`libphp`), not as a `php` command, so those steps run on your system PHP, which Rapira neither uses nor touches.

## The resident worker

This is the recommended shape. Save it as `worker.php` in the project root:

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
        // The worker keeps serving after an escaped error; the reset has to
        // run on that path too, or state leaks into the next request.
        $container->get(StateResetter::class)->reset();
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Walking through it:

**`src/bootstrap.php` is the template's own bootstrap.** It loads Composer's autoloader, reads `.env` when it is there, and calls `Environment::prepare()`, exactly what `public/index.php` does before it touches the runner. The explicit `vendor/autoload.php` line above it is redundant — `require_once` makes the second call a no-op — and keeps the worker readable as a standalone entry point.

**The runner is constructed once, with the arguments from `public/index.php`.** `rootPath`, `debug`, `checkEvents` and `environment` come from `App\Environment` exactly as the front controller passes them, so the worker boots the same application the web entry point does. The template's `public/index.php` passes one more argument — a `temporaryErrorHandler` wired to a `StreamTarget` logger — and requires `c3.php` when `APP_C3` is on. The verified worker omits both. The temporary handler only covers errors raised while the configuration and container are being built; without one the runner falls back to an `ErrorHandler` with a `NullLogger` (`HttpApplicationRunner::createTemporaryErrorHandler()`), so pass it here too if you want container-build failures logged.

**`getContainer()` is public API**, so the container you capture is the application's container — the one the runner will use for every request. `StateResetter` is resolved from it inside the handler.

**Per request: `run()`, then `reset()`.** `run()` is the same call the front controller makes; `reset()` walks the container's registered reset callbacks and puts the stateful services back to their initial state before the next request arrives.

**`run()` re-executes its whole sequence on every call.** Each call registers the error handler, runs `runBootstrap()`, runs `checkEvents()`, and then handles the request; the runner is re-entrant by design, and that repetition was verified harmless over 200 consecutive calls. The events check only does work when its flag is true, and the template ties that flag to `Environment::appDebug()`, so with debug off it is a no-op on every call.

**A resident runner reads each request fresh.** `run()` does not capture the request at construction time. Every call resolves `RequestFactory` from the container and builds a new PSR-7 `ServerRequest` from `$_SERVER`, `$_GET`, `$_POST`, `$_COOKIE`, `$_FILES` and `php://input`, and Rapira refills those superglobals before each iteration of the loop ([Worker mode](/docs/worker) covers that contract).

**Memory stays flat.** Across 200 sequential requests the worker's resident set did not grow in any meaningful way, because the application is built once and the reset is cheap, so there is no per-request boot to garbage-collect.

## The simpler alternative: a fresh runner per request

To avoid resident state entirely, build the runner *inside* the handler. Everything the application creates then belongs to one request:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$handler = static function (): void {
    // A fresh runner per request; constructor arguments mirror public/index.php.
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

The container is rebuilt every time, so there are fewer moving parts, no reset to get wrong, and no container state carried from one request into the next; `static` properties, globals and whatever the bootstrap set up stay resident under any worker and have to be reset by your own code. This also passed the full battery.

The container boots on every request, which takes the boot time each time and generates a container's worth of garbage. The worker's memory grows as those containers pile up before PHP reclaims them in bulk, the ordinary profile of a per-request boot rather than a leak. Pair this pattern with `pool.max_requests` so a worker is retired and replaced periodically; the [frameworks overview](/docs/frameworks/) explains the memory shapes and [Configuration](/docs/configuration) documents the key.

The autoloader and the template's bootstrap still stay resident and the request loop still lives in the worker script, so this is still a worker, one that discards its application between requests, not [classic mode](/docs/classic).

Use the resident runner unless you have a reason not to: it is the framework's own long-running design, memory stays flat, and the reset is one call. Use the per-request runner if your bootstrap has ordering constraints you would rather not reason about — code that must run before the container is built, or per-request bootstrap work that a `StateResetter` callback cannot undo. Switching from one to the other later changes only the worker script.

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

Every key, with its default and its bounds, is on the [Configuration](/docs/configuration) page; [Deployment](/docs/deployment) has the systemd unit and the reverse proxy in front of it.

## What was verified

Both patterns were run through the same battery against the `yiisoft/app` template. The results:

**Routing works with no `$_SERVER` overrides.** Rapira sets `SCRIPT_NAME` to the entry script's file name — `/worker.php`, not `/index.php` — and FastRoute still matched nested paths with query strings. The root `/` rendered the template's home page, and an unknown path produced the framework's own 404. No overrides of `SCRIPT_NAME`, `REQUEST_URI` or `DOCUMENT_ROOT` were needed anywhere.

**Generated URLs are clean.** `UrlGeneratorInterface::generate()` produced ordinary application paths — the worker script's file name does not leak into them.

**Sessions are per request and properly isolated.** A client with a cookie jar saw its counter go 1, 2 across requests; a fresh client hitting the same endpoint immediately after got a new session starting at 1 again. That holds in the resident pattern too, where the container survives.

**Form posts, JSON bodies and uploads all arrive.** `$_POST` fields, a JSON payload read from `php://input`, and a multipart upload with its temporary file readable during the request — the PSR-7 `ServerRequest` yii-runner-http builds from the superglobals carries all of it.

**A thrown exception is a 500, and the worker keeps serving.** An action that throws is caught by `ErrorCatcher`, which renders the error response as it would anywhere else; the exception is logged, and the very next request is answered normally by the same worker process. An uncaught exception is a per-request failure in Rapira, not a worker-level one — see [Worker mode](/docs/worker) for what does and does not take a worker down.

## CSRF

The app template puts `CsrfTokenMiddleware` in its default middleware chain, and the token lives in the session — the one piece of state the battery did exercise, per request and isolated per client. Nothing in the worker loop touches the token flow, so a POST needs its token here as anywhere else. If posts start coming back rejected after the move to a worker, check the token first; the fix is the usual one (render the token into the form, send it back), not a change to the worker script.

## Classic mode as a fallback

Yii3 also runs as an ordinary front controller:

```bash
rapira serve --mode classic public/index.php
```

Same code, no worker script, fresh state per request. See [Classic mode](/docs/classic) for more information.

The worker script is an additional entry point rather than a replacement for the front controller, so keep `public/index.php`: it is the entry script classic mode runs, and it stays useful for local work with PHP's built-in server.

The template's `public/index.php` contains a `PHP_SAPI === 'cli-server'` branch that serves static files and rewrites `SCRIPT_NAME`. It exists for PHP's built-in development server and never triggers under Rapira, where `PHP_SAPI` is `rapira` (`fastcgi` on PHP 8.4 — see [Installation](/docs/intro/installation)), so it can stay as it is.
