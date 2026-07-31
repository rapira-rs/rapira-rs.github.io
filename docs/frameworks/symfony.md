---
title: Symfony
description: How to run a Symfony application on Rapira in worker mode — the worker script, the services resetter between requests, and how .env values reach the container.
---

# Symfony

Symfony's structure fits a resident worker: a kernel you boot, a `Request` you hand it, a `Response` it hands back. Under Rapira the kernel boots once when the worker starts, and every request after that is a `handle()` call on a container that is already warm. Almost nothing in the application changes — what changes is the twenty lines that replace `public/index.php`. This page covers that file, the reset between requests, and how `.env` values reach the container.

::: info Verified with
- **PHP 8.5.8** — NTS, embed SAPI
- **Rapira 0.6.0**
- **Symfony 7.4** (`symfony/framework-bundle` v7.4.15) — full battery in `dev` and in `prod`
- **Symfony 8.1** (`symfony/framework-bundle` v8.1.2) — full battery in `dev`

Both apps are a plain `symfony/skeleton` running under a single worker process, and both ran the **same `worker.php`** — byte for byte, no per-version branch. The battery covers routing, a 404, query strings, generated URLs, form posts, JSON bodies, sessions across requests, a file upload, an uncaught exception, and 200 sequential requests in a row.
:::

## Behavior in worker mode

The kernel boots at the top of the script, outside the loop, and stays resident for the life of the worker process: the autoloader, the compiled container, the router, the event dispatcher and every connection your bundles opened are built once instead of once per request. That is what [SAPI Worker mode](/docs/worker) provides; see [Execution modes](/docs/execution-modes) for more information.

Per request the handler does four things and then cleans up:

1. `Request::createFromGlobals()` — Rapira refills `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` and `$_FILES` for each request before calling your handler, so Symfony's normal constructor reads exactly what it reads under php-fpm.
2. `$kernel->handle($request)` — routing, controller, response, unchanged.
3. `$response->send()` — the output becomes the HTTP response ([HTTP](/docs/http) covers how it is framed on the way out).
4. `$kernel->terminate($request, $response)` — the post-response listeners run, same as always.

Then the handler resets the stateful services through the container's `services_resetter` — the same reset Symfony runs between Messenger messages, and it is what a long-lived kernel uses to drop per-request accumulation.

Sessions run as native PHP sessions, exactly as under php-fpm: `session_start()` per request, the cookie goes out with the response, and the data is read back on the next one. Isolation between clients was verified: a second client with a fresh cookie jar gets its own session.

One kernel lives in one worker process, and workers are separate OS processes — nothing is shared between them in userland. See [Process model](/docs/process-model) for how many there are and how they are supervised.

## Prerequisites

You need [Rapira installed](/docs/installation) and a Symfony application — a fresh `composer create-project symfony/skeleton my-app` or the one you already have. Nothing about the application has to be prepared specially; the worker script goes next to `composer.json` and everything else stays where it is. You also need an ordinary PHP CLI on the machine for Composer and `bin/console` — Rapira ships PHP as a library (`libphp`), not as a `php` command, so those steps run on your system PHP, which Rapira neither uses nor touches.

Two extensions matter, because the skeleton hard-requires them in `composer.json` (`ext-ctype`, `ext-iconv`) *and* `replace`s the corresponding polyfills — so they have to be real extensions, not PHP shims. Both PHP builds need them: the system CLI too, or `composer create-project` and `composer install` fail their platform check before Rapira is ever involved. The PHP bundled in every Rapira release has both: `ctype` and `iconv` are in the build's configure line, and the full extension list is on the [Installation](/docs/installation) page. If you compile Rapira against a PHP of your own instead, keep both enabled — [Build from source](/docs/build-from-source) shows where that list is set.

The worker file below also uses `symfony/dotenv`, which the skeleton ships. If your deployment sets real environment variables and has no `.env` at all, drop that line and the component with it. The worker does not go through `symfony/runtime` — it bootstraps `.env` and constructs the kernel itself — but keep the package installed, because `bin/console` and `public/index.php` still use it.

## The worker script

Put this at the project root as `worker.php`. It is the file that was verified, verbatim, on both majors:

```php
<?php

declare(strict_types=1);

use App\Kernel;
use Rapira\Plugin\Http\HttpHandlerConfig;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

use function Rapira\create_plugin_handler;

require __DIR__ . '/vendor/autoload.php';

// public/index.php delegates this to symfony/runtime; here we do it once, up front.
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');

$kernel = new Kernel($_SERVER['APP_ENV'], (bool) $_SERVER['APP_DEBUG']);
$kernel->boot();
$container = $kernel->getContainer();

$http = create_plugin_handler(new HttpHandlerConfig());

$handler = static function () use ($kernel, $container): void {
    $request = Request::createFromGlobals();

    try {
        $response = $kernel->handle($request);
        $response->send();
        $kernel->terminate($request, $response);
    } finally {
        // The same reset Symfony runs between Messenger messages: every service
        // tagged kernel.reset drops the state it accumulated during the request.
        // In finally: handle() turns application exceptions into a response, but a
        // failing send() or a throwing kernel.terminate listener escapes the handler,
        // and the worker keeps serving — the reset has to run on that path too.
        if ($container->has('services_resetter')) {
            $container->get('services_resetter')->reset();
        }
    }
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Most of it is ordinary Symfony bootstrapping. Four lines are specific to this setup:

**`(new Dotenv())->usePutenv()->bootEnv(...)`.** In a normal app you never write this, because `public/index.php` delegates it to `symfony/runtime`. Here the worker owns the bootstrap, so it loads `.env` itself — once, before the kernel exists. `usePutenv()` is required: without it the app returns 500 in `prod`, while `dev` keeps working. See [`$_ENV` and `variables_order`](#env-and-variables-order) for more information.

**The kernel is built and booted before the loop.** `new Kernel(...)`, `boot()` and `getContainer()` all run at worker startup, so `$_SERVER['APP_ENV']` is read while Dotenv's values are still in place, and the container is warm before the first request ever arrives. Everything inside the `while` loop then works against that one container.

**`$container->has('services_resetter')` before `get()`.** The service id `services_resetter` is public in both 7.4 and 8.1, which is why the same file works on both — the *class* behind it moved namespaces between the majors (`Symfony\Component\DependencyInjection\ServicesResetter` in 7.4, `Symfony\Component\HttpKernel\DependencyInjection\ServicesResetter` in 8.1), and addressing the service by id makes that difference disappear. The `has()` guard keeps the script from fataling on a container that does not define it.

**The loop and `gc_collect_cycles()`.** `handleRequest()` blocks until a request arrives, runs your handler, and returns `true` — or `false` when the server is shutting down, which is what ends the loop. Collecting cycles once per turn keeps that work between requests instead of in the middle of one. See [Worker mode](/docs/worker) for the full contract.

If the resetter is not enough, there are two heavier options: `$container->reset()` wipes every service that has been instantiated, and `$kernel->reboot(null)` throws the container away and builds a new one — after which the `$container` the handler captured is stale, so re-fetch it with `$kernel->getContainer()` if you go that route. Both discard the warm state worker mode gives you, so use them while you are tracking down a leak, not as a default.

## `$_ENV` and `variables_order`

::: warning
With a plain `bootEnv()` — no `usePutenv()` — a Symfony app in `APP_ENV=prod` returns **500 on the very first request**, and on every request after it, with `EnvNotFoundException: Environment variable not found: "DEFAULT_URI"`. The same application in `dev` does not fail.
:::

The cause is in PHP. Under the ini defaults the verification ran with (`variables_order = "GPCS"`, `auto_globals_jit = On`), PHP re-arms the JIT flag for `$_ENV` on **every** request. The first file compiled during that request which mentions `$_ENV` triggers `php_auto_globals_create_env`, and that re-imports the superglobal from the real process environment — wiping everything `Dotenv->bootEnv()` put there at worker bootstrap. In the probe, `$_ENV` went from a populated array to empty in the middle of a request.

Why only `prod`: in `prod` the first request is what lazily compiles the container and service files, so the wipe lands *before* `RequestContext` resolves `%env(DEFAULT_URI)%` — and by then there is nothing left to resolve. In `dev` the debug container resolves env lookups eagerly during `$kernel->boot()`, at bootstrap, and caches the values, so the wipe happens after the answer was already recorded. The behavior is the same in `dev`; it simply has no effect there.

The fix is the one line in the script above:

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` makes Dotenv write the values into the *real* process environment as well, which is precisely what the re-import reads back — so the values survive it — and Symfony's `EnvVarProcessor` falls back to `getenv()` anyway. Rapira runs NTS PHP in a pre-fork process model, one interpreter per process, so the usual `putenv()` thread-safety warnings do not apply here.

The other option in production is to set real environment variables (a systemd `Environment=`, your container runtime, your orchestrator) and keep `.env` as a development convenience. Either way the values live somewhere the mid-request re-import cannot erase.

This applies to any resident-worker PHP runtime — any framework that reads `$_ENV` lazily is exposed to it. The [Frameworks](/docs/frameworks/) page covers it alongside the other two resident-process behaviors — a bootstrap object's destructor and `register_shutdown_function()` both firing once, at the end of the first request.

## Running it

```bash
rapira serve worker.php
curl -i http://127.0.0.1:8000/
```

Worker mode is the default, and `127.0.0.1:8000` is the default listen address. `rapira serve` stays in the foreground and `Ctrl-C` drains it.

The entry script is `worker.php` rather than `index.php`, so `$_SERVER['SCRIPT_NAME']` is `/worker.php`. Symfony's `Request` looks for that name at the start of the URI, does not find it, and degrades the base URL to `""`. `getPathInfo()` returns the real path, routing matches, and `generateUrl()` produces clean paths with no `/worker.php` prefix anywhere in them. No `$_SERVER` overrides and no `Request::setTrustedProxies()` workarounds are needed for this.

## Going to production

Set `APP_ENV=prod`, install without dev dependencies, and warm the cache before the server starts. `php bin/console cache:warmup` was verified to boot the app clean, and it moves container compilation out of the first request:

```bash
composer install --no-dev --optimize-autoloader
APP_ENV=prod php bin/console cache:warmup
```

Check `DEFAULT_URI` while you are there. The skeleton's `config/packages/routing.yaml` sets `router.default_uri` to `%env(DEFAULT_URI)%` in **every** environment, and `.env` ships it as `http://localhost`, which is the value URLs generated outside an HTTP request (console commands, emails) are built from. Point it at your real origin.

A small `rapira.toml` to run it:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
processes = 4
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` recycles a worker after that many requests, so a slow leak somewhere in your dependency tree can never grow without bound; it bounds a leak rather than fixing it. `request_terminate_timeout_secs` puts a wall-clock ceiling on a single request, because a resident worker would otherwise stay blocked in a hung request indefinitely. Run it with `rapira serve --config rapira.toml`. Every key, and the rest of them, is on the [Configuration](/docs/configuration) page; a relative `entrypoint` resolves against the config file's own directory.

## What resets between requests

`services_resetter` calls `reset()` on every service tagged `kernel.reset`. Which services those are depends on the bundles you have installed — buffered log handlers, debug data collectors and similar per-request accumulators register the tag themselves, so the single call reaches all of them.

What it does not cover is state you keep yourself: static properties, memoized globals, a registry some library fills lazily, an `ini_set()` you never undid. Those survive the request under any resident worker and have to be reset by your own code. The [Frameworks](/docs/frameworks/) page has the table of what survives and what does not.

With the resetter in place the verification saw resident memory stay flat across 200 sequential requests, in `dev` and in `prod` alike — the kernel holds a constant working set rather than growing per request. If memory grows in your application, something in your own code or in a bundle is holding on to requests.

## Work after the response

If you want the client freed before the post-response listeners run, call [`rapira_finish_request()`](/docs/http) between `$response->send()` and `$kernel->terminate($request, $response)` — the response goes out, and `terminate()` keeps running on a worker the client is no longer waiting on. The worker itself is still busy until your handler returns, so this is a latency tool, not a way to get concurrency.

## The development loop

`rapira serve` runs in the foreground and your application is booted once, so **changed PHP code is not picked up until the workers are replaced**. While you are actively editing, the simplest thing is to stop and start the server, or to run the front controller in [classic mode](/docs/classic) instead, where the script is executed from scratch every time and every save is live:

```bash
rapira serve --classic public/index.php
```

That is the same application in classic mode: it boots on every request, so edits take effect immediately, at the cost of a full boot per request. For a running production server, a rolling reload (`SIGUSR2` on the master) is how deployed code takes over without dropping connections — unless you run `opcache.validate_timestamps = 0`, where the master's OPcache segment outlives the pool and a deploy needs a full restart instead; see [Process model](/docs/process-model) and [running in production](/docs/deployment).

An uncaught exception is handled inside Symfony: the framework answers it with its own `500` — the full exception page in `dev`, a generic error page in `prod` — and the same worker process, its pid unchanged across the failure, picks up the next request. What survives an exception is leaked or corrupted service state, which the reset at the end of the handler drops. Where the trace ends up depends on your logger; a stock skeleton ships none. What does reach Rapira's log on stderr is anything that escapes PHP itself, like the `EnvNotFoundException` above — [Logging](/docs/logging) shows how to turn the level up.
