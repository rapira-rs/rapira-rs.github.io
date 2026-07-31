---
title: Yii3
description: Running a Yii3 application on Rapira's SAPI Worker rung — the resident HttpApplicationRunner with StateResetter, the simpler per-request runner, and what was verified about routing, sessions, uploads and errors.
---

# Yii3

Of the three frameworks documented here, Yii3 is the one that was designed for this. Its DI container ships a first-class `StateResetter`, the runner exposes its container through public API, and "build the application once, reset the per-request state after each response" is not a trick someone invented for a long-running server — it is the shape the framework already has. The official RoadRunner runner, [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner), is built exactly that way, which is a good sign that the pattern below is the intended long-running design rather than a clever misuse of it.

::: info Verified with
- **PHP 8.5.8** — NTS, embed SAPI
- **Rapira 0.6.0**
- **yiisoft/app** template 1.4, with **yii-runner-http 3.2.1** (router-fastroute 4.x)

Both worker scripts on this page were run against that stack and passed the full battery: routing, generated URLs, form and JSON posts, sessions, uploads, error handling and 200 sequential requests.
:::

## Why Yii3 fits the worker rung

Two pieces of public API are all a resident worker needs.

`ApplicationRunner::getContainer()` is public — the runner hands you the very container your application runs on, so you do not have to subclass anything or reach into private state to get at it. And `Yiisoft\Di\StateResetter` is a normal service in that container: components register their own reset callbacks with it, and one `reset()` call puts them back to how they started. That is the framework's own answer to "this object holds request state", and it exists because Yii3 expects to be run in a process that does not die.

So the resident pattern is three lines of glue: build the runner once, run it per request, reset the container's state afterwards.

## Prerequisites

- Rapira installed — see [Installation](/docs/installation).
- A Yii3 application: either a fresh [`yiisoft/app`](https://github.com/yiisoft/app) project or one you already have.

Nothing has to be installed on the PHP side. There is no runtime package, no bridge, no adapter — the worker script below is the only new file in the project, and it sits at the project root next to `composer.json`, because the runner's `rootPath` is the project root.

## The resident worker

This is the recommended shape. Save it as `worker.php` in the project root:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Rapira\Plugin\Http\HttpHandlerConfig;
use Yiisoft\Di\StateResetter;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

use function Rapira\create_plugin_handler;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$runner = new HttpApplicationRunner(
    rootPath: __DIR__,
    debug: Environment::appDebug(),
    checkEvents: Environment::appDebug(),
    environment: Environment::appEnv(),
);
$container = $runner->getContainer();

$http = create_plugin_handler(new HttpHandlerConfig());

$handler = static function () use ($runner, $container): void {
    try {
        $runner->run();
    } finally {
        // The worker keeps serving after an escaped error; the reset has to
        // run on that path too, or state leaks into the next request.
        $container->get(StateResetter::class)->reset();
    }
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Walking through it:

**`src/bootstrap.php` is the template's own bootstrap.** It loads Composer's autoloader, reads `.env` when it is there, and calls `Environment::prepare()`, exactly what `public/index.php` does before it touches the runner. The explicit `vendor/autoload.php` line above it is deliberately redundant (`require_once`, so it costs nothing) and keeps the worker readable as a standalone entry point.

**The runner is constructed once, with the arguments from `public/index.php`.** `rootPath`, `debug`, `checkEvents` and `environment` come from `App\Environment` exactly as the front controller passes them, so the worker boots the same application the web entry point does. The template's `public/index.php` passes one more argument — a `temporaryErrorHandler` wired to a `StreamTarget` logger — and requires `c3.php` when `APP_C3` is on. The verified worker omits both. The temporary handler only covers errors raised while the configuration and container are being built; without one the runner falls back to an `ErrorHandler` with a `NullLogger` (`HttpApplicationRunner::createTemporaryErrorHandler()`), so pass it here too if you want container-build failures logged.

**`getContainer()` is public API**, so the container you capture is the application's container — the one the runner will use for every request. `StateResetter` is resolved from it inside the handler.

**Per request: `run()`, then `reset()`.** `run()` is the same call the front controller makes; `reset()` walks the container's registered reset callbacks and puts the stateful services back to their initial state before the next request arrives.

**A resident runner still sees each new request.** That trips people up, so it is worth being explicit: `run()` does not capture the request at construction time. Every call asks the container for `RequestFactory` and builds a fresh PSR-7 `ServerRequest` from `$_SERVER`, `$_GET`, `$_POST`, `$_COOKIE`, `$_FILES` and `php://input` — and Rapira refills those superglobals before each iteration of the loop ([Worker mode](/docs/worker) covers that contract). Resident objects, fresh request, every time.

**Memory stays flat.** Across 200 sequential requests the worker's resident set did not grow in any meaningful way — the application is built once and the reset is cheap, so there is no per-request boot to garbage-collect. That is the practical payoff of this pattern over the next one.

## The simpler alternative: a fresh runner per request

If you would rather not think about resident state at all, build the runner *inside* the handler. Everything the application creates then belongs to one request:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Rapira\Plugin\Http\HttpHandlerConfig;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

use function Rapira\create_plugin_handler;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$http = create_plugin_handler(new HttpHandlerConfig());

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

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Fewer moving parts, no reset to get wrong, and no chance of state leaking from one request into the next — the container is rebuilt every time. This also passed the full battery.

This pattern has a cost, and that is why it comes *second* on the page: you are booting the container on every request, so you pay that boot each time and you generate a container's worth of garbage each time. The worker's memory grows as those containers pile up before PHP reclaims them in bulk, which is the ordinary profile of a per-request boot rather than a leak — but it is a profile worth bounding. Pair this pattern with `pool.max_requests` so a worker is retired and replaced periodically; the [frameworks overview](/docs/frameworks/) explains the memory shapes and [Configuration](/docs/configuration) documents the key.

The autoloader and the template's bootstrap still stay resident and the loop is still yours, so this is still a worker, one that discards its application between requests — not [classic mode](/docs/classic).

## Running it

```bash
rapira serve worker.php
```

That is the whole command — worker mode is the default. See [CLI](/docs/cli) for the remaining flags.

For production, put it in a `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "/srv/app/worker.php"
processes = 8
max_requests = 500
request_terminate_timeout_secs = 30

[log]
level = "info"
format = "json"
```

Every key, with its default and its bounds, is on the [Configuration](/docs/configuration) page; [Deployment](/docs/deployment) has the systemd unit and the reverse proxy in front of it.

## What was verified

Both patterns were run through the same battery against the `yiisoft/app` template. What came out of it:

**Routing works with no `$_SERVER` fiddling.** Rapira sets `SCRIPT_NAME` to the entry script's file name — `/worker.php`, not `/index.php` — and FastRoute still matched nested paths with query strings. The root `/` rendered the template's home page, and an unknown path produced the framework's own 404. No overrides of `SCRIPT_NAME`, `REQUEST_URI` or `DOCUMENT_ROOT` were needed anywhere.

**Generated URLs are clean.** `UrlGeneratorInterface::generate()` produced ordinary application paths — the worker script's file name does not leak into them.

**Sessions are per request and properly isolated.** A client with a cookie jar saw its counter go 1, 2 across requests; a fresh client hitting the same endpoint immediately after got a new session starting at 1 again. That holds in the resident pattern too, where the container survives.

**Form posts, JSON bodies and uploads all arrive.** `$_POST` fields, a JSON payload read from `php://input`, and a multipart upload with its temporary file readable during the request — the PSR-7 `ServerRequest` yii-runner-http builds from the superglobals carries all of it.

**A thrown exception is a 500, and the worker keeps serving.** An action that throws is caught by `ErrorCatcher`, which renders the error response as it would anywhere else; the exception is logged, and the very next request is answered normally by the same worker process. An uncaught exception is a per-request failure in Rapira, not a worker-level one — see [Worker mode](/docs/worker) for what does and does not take a worker down.

## CSRF stays on

The app template puts `CsrfTokenMiddleware` in its default middleware chain, and the token lives in the session — the one piece of state the battery did exercise, per request and isolated per client. Nothing in the worker loop touches the token flow, so a POST needs its token here as anywhere else. If your posts start coming back rejected after the move to a worker, the token is the first thing to check — and the fix is the usual one (render the token into the form, send it back), not a change to the worker script.

## Classic mode as a fallback

If a worker is not what you want right now, Yii3 runs perfectly well as an ordinary front controller:

```bash
rapira serve --classic public/index.php
```

Same code, no worker script, fresh state per request — see [Classic mode](/docs/classic) for what that rung gives you and what it costs.

One curiosity if you read that file: the template's `public/index.php` contains a `PHP_SAPI === 'cli-server'` branch that serves static files and rewrites `SCRIPT_NAME`. It exists for PHP's built-in development server and simply never triggers under Rapira, where `PHP_SAPI` is `rapira` (`fastcgi` on PHP 8.4 — see [Installation](/docs/installation)). Leave it alone; it is inert here.

::: question Which pattern should I pick?
The resident one, unless you have a reason not to. It is the framework's own long-running design, it keeps memory flat, and the reset is one call. Use the per-request runner when your bootstrap has ordering constraints you would rather not reason about — code that must run before the container is built, or per-request bootstrap work that a `StateResetter` callback cannot undo. You can start with it and switch later; only the worker script changes.
:::

::: question Do `checkEvents` and the rest of the bootstrap re-run on every request in the resident pattern?
Yes — `run()` re-executes its internal sequence each call: error handler registration, `runBootstrap()`, `checkEvents()`, then handling the request. It was verified harmless over 200 consecutive calls; the runner is re-entrant by design. The events check in particular only does work when its flag is true, and in the template that flag is `Environment::appDebug()` — with debug off it is a no-op on every call.
:::

::: question Do I still need `public/index.php`?
Keep it. It costs nothing, it is what you fall back to in [classic mode](/docs/classic), and it stays useful for local work with PHP's built-in server. The worker script is an additional entry point, not a replacement for the front controller.
:::

::: question What exactly does `StateResetter::reset()` reset?
Whatever the services in your container registered with it — that is the point of it being a container service rather than a framework hook. Yii3's own stateful components register their reset callbacks; if you write a service that holds request state, register yours too — a `'reset' => function (): void { … }` key in that service's DI definition, the same way `yiisoft/session` and `yiisoft/router` declare theirs; the closure is bound to the instance, so it can restore private state without rebuilding the object. What Rapira itself resets between requests, and what it deliberately leaves alone, is documented on the [frameworks overview](/docs/frameworks/) and in [Worker mode](/docs/worker).
:::
