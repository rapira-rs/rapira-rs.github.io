---
title: Symfony
description: Run a Symfony application on Rapira's SAPI Worker rung — a kernel booted once, the services resetter between requests, and the $_ENV trap that only shows up in prod.
---

# Symfony

Symfony's structure already fits a resident worker: a kernel you boot, a `Request` you hand it, a `Response` it hands back. Under Rapira the kernel boots once when the worker starts, and every request after that is a `handle()` call on a container that is already warm. Almost nothing in the application changes — what changes is the twenty lines that replace `public/index.php`, and this page is the exact file that was verified, plus the two details that make it work: the reset between requests, and how `.env` values reach the container.

::: info Verified with
- **PHP 8.5.8** — NTS, embed SAPI
- **Rapira 0.6.0**
- **Symfony 7.4** (`symfony/framework-bundle` v7.4.15) — full battery in `dev` and in `prod`
- **Symfony 8.1** (`symfony/framework-bundle` v8.1.2) — full battery in `dev`

Both apps are a plain `symfony/skeleton` running under a single worker process, and both ran the **same `worker.php`** — byte for byte, no per-version branch. The battery covers routing, a 404, query strings, generated URLs, form posts, JSON bodies, sessions across requests, a file upload, an uncaught exception, and 200 sequential requests in a row.
:::

## What you get

The kernel boots at the top of the script, outside the loop, and stays resident for the life of the worker process: the autoloader, the compiled container, the router, the event dispatcher and every connection your bundles opened are built once instead of once per request. That is the entire trade of the [SAPI Worker](/docs/worker) rung, and [Execution modes](/docs/execution-modes) explains where it sits on the ladder.

Per request the handler does four things and then cleans up:

1. `Request::createFromGlobals()` — Rapira refills `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` and `$_FILES` for each request before calling your handler, so Symfony's normal constructor reads exactly what it reads under php-fpm.
2. `$kernel->handle($request)` — routing, controller, response, unchanged.
3. `$response->send()` — the output becomes the HTTP response ([HTTP](/docs/http) covers how it is framed on the way out).
4. `$kernel->terminate($request, $response)` — the post-response listeners run, same as always.

Then the handler resets the stateful services through the container's `services_resetter`. This is not something Rapira invents: it is the same reset Symfony itself runs between Messenger messages, and it is what a long-lived kernel has always used to drop per-request accumulation.

One kernel lives in one worker process, and workers are separate OS processes — nothing is shared between them in userland. See [Process model](/docs/process-model) for how many there are and how they are supervised.

## Before you start

You need [Rapira installed](/docs/installation) and a Symfony application — a fresh `composer create-project symfony/skeleton my-app` or the one you already have. Nothing about the application has to be prepared specially; the worker script goes next to `composer.json` and everything else stays where it is. You also need an ordinary PHP CLI on the machine for Composer and `bin/console` — Rapira ships PHP as a library (`libphp`), not as a `php` command, so those steps run on your system PHP, which Rapira neither uses nor touches.

Two extensions matter, because the skeleton hard-requires them in `composer.json` (`ext-ctype`, `ext-iconv`) *and* `replace`s the corresponding polyfills — so they have to be real extensions, not PHP shims. That lands on both PHPs: the system CLI needs them too, or `composer create-project` and `composer install` fail their platform check before Rapira is ever involved. The PHP bundled in every Rapira release has both: `ctype` and `iconv` are in the build's configure line, and the full extension list is on the [Installation](/docs/installation) page. If you compile Rapira against a PHP of your own instead, keep both enabled — [Build from source](/docs/build-from-source) shows where that list is set.

The worker file below also uses `symfony/dotenv`, which the skeleton ships. If your deployment sets real environment variables and has no `.env` at all, drop that line and the component with it.

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

Most of it is ordinary Symfony bootstrapping. The lines worth explaining are these:

**`(new Dotenv())->usePutenv()->bootEnv(...)`.** In a normal app you never write this, because `public/index.php` delegates it to `symfony/runtime`. Here the worker owns the bootstrap, so it loads `.env` itself — once, before the kernel exists. `usePutenv()` is not cosmetic and not optional: without it the app breaks in `prod` in a way that `dev` hides completely. That is the next section, and it is the most important thing on this page.

**The kernel is built and booted before the loop.** `new Kernel(...)`, `boot()` and `getContainer()` all run at worker startup, so `$_SERVER['APP_ENV']` is read while Dotenv's values are still in place, and the container is warm before the first request ever arrives. Everything inside the `while` loop then works against that one container.

**`$container->has('services_resetter')` before `get()`.** The service id `services_resetter` is public in both 7.4 and 8.1, which is why the same file works on both — the *class* behind it moved namespaces between the majors (`Symfony\Component\DependencyInjection\ServicesResetter` in 7.4, `Symfony\Component\HttpKernel\DependencyInjection\ServicesResetter` in 8.1), and addressing the service by id makes that difference disappear. The `has()` guard costs nothing and keeps the script from fataling on a container that does not define it.

**The loop and `gc_collect_cycles()`.** `handleRequest()` blocks until a request arrives, runs your handler, and returns `true` — or `false` when the server is shutting down, which is what ends the loop. Collecting cycles once per turn keeps that work between requests instead of in the middle of one. [Worker mode](/docs/worker) is the full contract.

If the resetter is not enough — and it usually is — there are two heavier options: `$container->reset()` wipes every service that has been instantiated, and `$kernel->reboot(null)` throws the container away and builds a new one — after which the `$container` the handler captured is stale, so re-fetch it with `$kernel->getContainer()` if you go that route. Both cost you exactly the warm state the worker mode gives you, so use them while you are tracking down a leak, not as a default.

## The `$_ENV` trap

::: warning
With a plain `bootEnv()` — no `usePutenv()` — a Symfony app in `APP_ENV=prod` returns **500 on the very first request**, and on every request after it, with `EnvNotFoundException: Environment variable not found: "DEFAULT_URI"`. Running it in `dev` first tells you nothing, because `dev` does not fail.
:::

The cause is not Symfony and not Rapira, but PHP itself. Under the ini defaults the verification ran with (`variables_order = "GPCS"`, `auto_globals_jit = On`), PHP re-arms the JIT flag for `$_ENV` on **every** request. The first file compiled during that request which mentions `$_ENV` triggers `php_auto_globals_create_env`, and that re-imports the superglobal from the real process environment — wiping everything `Dotenv->bootEnv()` put there at worker bootstrap. In the probe, `$_ENV` went from a populated array to empty in the middle of a request.

Why only `prod`: in `prod` the first request is what lazily compiles the container and service files, so the wipe lands *before* `RequestContext` resolves `%env(DEFAULT_URI)%` — and by then there is nothing left to resolve. In `dev` the debug container resolves env lookups eagerly during `$kernel->boot()`, at bootstrap, and caches the values, so the wipe happens after the answer was already recorded. The bug is there in `dev` too; it simply has no effect there.

The fix is the one line in the script above:

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` makes Dotenv write the values into the *real* process environment as well, which is precisely what the re-import reads back — so the values survive it — and Symfony's `EnvVarProcessor` falls back to `getenv()` anyway. Rapira runs NTS PHP in a pre-fork process model, one interpreter per process, so the usual `putenv()` thread-safety warnings do not apply here.

In production the other answer is just as good and arguably better: set real environment variables (a systemd `Environment=`, your container runtime, your orchestrator) and let `.env` be a development convenience. Either way the values live somewhere the mid-request re-import cannot erase.

This is generic to any resident-worker PHP runtime, not a Rapira quirk — any framework that reads `$_ENV` lazily is exposed to it. The [Frameworks](/docs/frameworks/) page has it alongside the other two resident-process traps — a bootstrap object's destructor and `register_shutdown_function()` both firing once, at the end of the first request.

## Running it

```bash
rapira serve worker.php
curl -i http://127.0.0.1:8000/
```

That is the whole command — worker mode is the default, and `127.0.0.1:8000` is the default listen address. `rapira serve` stays in the foreground and `Ctrl-C` drains it.

One thing that usually needs fixing on other setups and does **not** here: the entry script is `worker.php` rather than `index.php`, so `$_SERVER['SCRIPT_NAME']` is `/worker.php`. Symfony's `Request` looks for that name at the start of the URI, does not find it, and degrades the base URL to `""` — which is exactly right. `getPathInfo()` returns the real path, routing matches, and `generateUrl()` produces clean paths with no `/worker.php` prefix anywhere in them. No `$_SERVER` overrides and no `Request::setTrustedProxies()` workarounds are needed for this.

## Going to production

Set `APP_ENV=prod`, install without dev dependencies, and warm the cache before the server starts — `php bin/console cache:warmup` was verified to boot the app clean, and it is what makes the first request cheap instead of the one that compiles the container:

```bash
composer install --no-dev --optimize-autoloader
APP_ENV=prod php bin/console cache:warmup
```

Check `DEFAULT_URI` while you are there. The skeleton's `config/packages/routing.yaml` sets `router.default_uri` to `%env(DEFAULT_URI)%` in **every** environment, and `.env` ships it as `http://localhost` — fine for a laptop, wrong in production, and it is the value URLs generated outside an HTTP request (console commands, emails) are built from. Point it at your real origin.

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

`max_requests` is hygiene rather than a fix: it recycles a worker after that many requests so a slow leak somewhere in your dependency tree can never grow without bound. `request_terminate_timeout_secs` puts a wall-clock ceiling on a single request, because a resident worker would otherwise stay blocked in a hung request indefinitely. Run it with `rapira serve --config rapira.toml`. Every key, and the rest of them, is on the [Configuration](/docs/configuration) page; a relative `entrypoint` resolves against the config file's own directory.

## What resets between requests

`services_resetter` calls `reset()` on every service tagged `kernel.reset`. Which services those are depends on the bundles you have installed — buffered log handlers, debug data collectors and similar per-request accumulators register the tag themselves, and that is why the one call covers so much ground.

What it does not cover is state you keep yourself: static properties, memoized globals, a registry some library fills lazily, an `ini_set()` you never undid. Those survive the request under any resident worker, and resetting them is your job. The [Frameworks](/docs/frameworks/) page has the table of what survives and what does not.

With the resetter in place the verification saw resident memory stay flat across 200 sequential requests, in `dev` and in `prod` alike — the kernel holds a constant working set rather than growing per request. That is what "flat" should look like for you too; if yours grows, something in your own code or a bundle is holding on to requests.

## Work after the response

If you want the client freed before the post-response listeners run, call [`rapira_finish_request()`](/docs/http) between `$response->send()` and `$kernel->terminate($request, $response)` — the response goes out, and `terminate()` keeps running on a worker the client is no longer waiting on. Remember that the worker itself is still busy until your handler returns, so this is a latency tool, not a way to get concurrency.

## The development loop

`rapira serve` runs in the foreground and your application is booted once, so **changed PHP code is not picked up until the workers are replaced**. While you are actively editing, the simplest thing is to stop and start the server, or to run the front controller on the [Classic](/docs/classic) rung instead, where the script is executed from scratch every time and every save is live:

```bash
rapira serve --classic public/index.php
```

That is the same application, one rung down the ladder — it just pays the boot cost per request, which is exactly what you want while iterating and exactly what you do not want in production. For a running production server, a rolling reload (`SIGUSR2` on the master) is how deployed code takes over without dropping connections — unless you run `opcache.validate_timestamps = 0`, where the master's OPcache segment outlives the pool and a deploy needs a full restart instead; see [Process model](/docs/process-model) and [running in production](/docs/deployment).

An uncaught exception never leaves Symfony: the framework answers it with its own `500` — the full exception page in `dev`, a generic error page in `prod` — and the worker keeps serving. Where the trace ends up depends on your logger; a stock skeleton ships none. What does reach Rapira's log on stderr is anything that escapes PHP itself, like the `EnvNotFoundException` above — [Logging](/docs/logging) shows how to turn the level up.

::: question Do I need `symfony/runtime`?
Not for the worker. Its job in a normal app is to bootstrap `.env` and construct the kernel from `public/index.php`, and `worker.php` does both itself, explicitly. Keep the package installed anyway — `bin/console` and `public/index.php` still go through it, and you want both of those working.
:::

::: question Do sessions work?
Yes, as native PHP sessions, exactly as they do under php-fpm: `session_start()` per request, the cookie goes out in the response, the session data is read back on the next one. This was verified in the battery, including that a second client with a fresh cookie jar gets its own session and not somebody else's.
:::

::: question Is it really the same `worker.php` on 7.4 and 8.1?
Byte for byte — the two verified apps ran identical files with no version check anywhere in them. The only cross-major difference that could have shown up, the `ServicesResetter` class moving namespaces, is invisible because the script addresses the service by its public id.
:::

::: question A controller threw an uncaught exception. Did I lose the worker?
No. Symfony's error handling turns it into a `500` response and the same worker process picks up the next request — verified, with the worker's pid unchanged across the failure. A leaked or corrupted service is the thing to worry about after an exception, which is what the reset at the end of the handler is for.
:::
