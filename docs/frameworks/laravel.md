---
title: Laravel
description: Running Laravel on Rapira — a fresh application per request inside a resident worker, the memory behaviour that comes with it, and the honest state of Octane support.
---

# Laravel

Rapira runs Laravel, and it runs it by building a **fresh application on every request inside a PHP process that stays resident across requests**. That is a deliberately modest claim, and it is worth stating up front rather than burying it: the worker stays resident, the framework does not.

::: info Verified with
- **PHP 8.5.8** — NTS, embed SAPI
- **Rapira 0.6.0**
- **laravel/laravel** skeleton with **laravel/framework v13.23.0**

Everything on this page was run against a `laravel/laravel` skeleton with a handful of test routes added, under a single worker: routing, sessions, uploads, JSON and form bodies, cached config and routes, error responses, and a few hundred sequential requests through several worker recycles.
:::

## Why the application is rebuilt every request

Laravel's container is not designed to survive a second request without help. Bindings get resolved, singletons capture the current request, the framework's own statics fill up as the request runs — and something has to unwind all of it before the next one arrives. That something has a name: **Octane**. Rapira has no Octane driver today, so this guide does not pretend to be one. What it gives you is the pattern that was actually verified to work: boot the framework inside the handler, answer the request, throw the application away.

You still come out ahead of php-fpm, just not by as much as a resident container would give you:

- **No FastCGI hop.** PHP is embedded in the Rapira process and the server calls the interpreter directly — no socket, no protocol, and no second daemon to hand the request to; the worker that answers is the process holding the interpreter.
- **The process is long-lived.** Your worker script runs once. The Composer autoloader and its classmap are registered once, at startup, not re-registered for every request the way a front controller does it.
- **OPcache is warm and shared.** PHP starts once in the master, before any worker is forked, so every worker inherits the same compiled-script cache — your code and your `vendor/` tree. The `config:cache` / `route:cache` files are compiled once too, so re-executing them per request costs no re-parse. Both artisan cache commands were verified to work under this pattern.

If that trade does not appeal, the [classic mode escape hatch](#the-escape-hatch-classic-mode) at the bottom of this page needs no worker script at all.

## Before you start

You need Rapira installed — see [Installation](/docs/installation) — and a Laravel application you can already run.

One thing to check before the first boot: a fresh `laravel/laravel` skeleton defaults to an SQLite database and to database-backed session, cache and queue drivers, which means it needs `pdo_sqlite`. The PHP bundled with the Rapira releases has it: PDO, `pdo_sqlite` and `sqlite3` are all in the release build's extension set, listed on the [Installation](/docs/installation) page. If you run Rapira against a PHP you compiled yourself, make sure those extensions are in your configure line ([Build from source](/docs/build-from-source) covers it), or take the no-database route instead and point Laravel at the file and sync drivers — `SESSION_DRIVER=file`, `CACHE_STORE=file`, `QUEUE_CONNECTION=sync`. That is the combination this page's verification ran with.

## The worker script

Drop this file in the application root, next to `composer.json` — every path in it is relative to `__DIR__`, so it has to sit where `vendor/`, `bootstrap/` and `storage/` are:

```php
<?php

declare(strict_types=1);

use Illuminate\Http\Request;
use Rapira\Plugin\Http\HttpHandlerConfig;

use function Rapira\create_plugin_handler;

define('LARAVEL_START', microtime(true));

// Resident: the autoloader and opcache-compiled classes stay warm.
require __DIR__ . '/vendor/autoload.php';

$http = create_plugin_handler(new HttpHandlerConfig());

$handler = static function (): void {
    if (file_exists($maintenance = __DIR__ . '/storage/framework/maintenance.php')) {
        require $maintenance;
    }

    // A fresh application per request. `require`, not `require_once`:
    // bootstrap/app.php must run again for every request.
    $app = require __DIR__ . '/bootstrap/app.php';
    $app->handleRequest(Request::capture());
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Read from the top, it is `public/index.php` cut in two — the parts that can be done once above the loop, the parts that cannot inside the handler:

- **`LARAVEL_START`** is defined exactly where the stock front controller defines it, before anything else. A constant is process-wide, so it belongs above the loop — which also means it now marks the *worker's* start, not the request's. Anything that times a request as `microtime(true) - LARAVEL_START` will report worker uptime instead, growing until the worker recycles; use your own per-request timestamp inside the handler.
- **The autoloader is required once**, outside the handler, and that is the resident state this pattern actually keeps. Everything below it is per-request work.
- **The maintenance-mode check lives inside the handler**, because `php artisan down` can be run at any point in the worker's life and the check has to happen per request. The generated `storage/framework/maintenance.php` ends the request with `exit`, and that is safe here: an `exit` inside the handler flushes the response to the client and the worker carries on serving — verified, and the general rule for [worker mode](/docs/worker).
- **`$app = require __DIR__ . '/bootstrap/app.php'`** is the fresh application, rebuilt for this request only.
- **`$app->handleRequest(Request::capture())`** is Laravel's own one-liner: it handles the request, sends the response, and runs `terminate()` — the middleware and terminable callbacks included. It does not exit, so control comes back to the loop.
- **`gc_collect_cycles()` in the loop** is the canonical Rapira loop shape, collecting reference cycles between requests instead of in the middle of one. Keep it — but do not expect it to solve the memory behaviour described in the next section. It does not.

::: warning `require`, not `require_once`
This is the one line you cannot get wrong. `require_once` returns `true` from the second request onwards instead of returning the `Application` instance, and every request after the first one breaks. The stock `public/index.php` uses `require_once` and is right to — it only ever runs once per process. In a worker, `bootstrap/app.php` must run again for every request.
:::

## Memory, and why it sawtooths

Rebuilding the application per request means throwing one away per request, and the memory profile that follows — a sawtooth rather than a leak, and one that `gc_collect_cycles()` cannot flatten — is described in full on the [frameworks overview](/docs/frameworks/). The call stays in this page's loop because it is good hygiene for the rest of your garbage, not because it fixes that.

Two consequences are not optional for Laravel. Give `memory_limit` real headroom, because what has to fit is the peak of the sawtooth and PHP's default is not comfortable for this pattern. And set `pool.max_requests = 100` — recycling is what puts a ceiling on the climb, it was verified seamless across hundreds of sequential requests spanning several recycles, and it is the recommended production setting for Laravel on Rapira rather than an optimisation to consider later.

::: warning Do not call `HandleExceptions::flushState()`
It is the obvious-looking cleanup call, and under Rapira it will take your worker down. `Illuminate\Foundation\Bootstrap\HandleExceptions::flushState()` special-cases PHPUnit's error handler, and with `phpunit` installed — which is every skeleton, it is a default dev dependency — it throws (`PHPUnit\TextUI\Configuration\Registry::get(): … null returned`). Called in the loop body, between requests — where the recipes for other servers put it — the throw escapes the loop, the worker script dies, Rapira flags the worker unhealthy and clients get `503`s. Verified the hard way. Leave it out.
:::

## Running it

Worker mode is what `rapira serve` does by default, so pointing it at the script is the whole command:

::: code-group

```bash [CLI]
rapira serve worker.php
```

```toml [rapira.toml]
[pool]
entrypoint = "worker.php"
processes = 4
max_requests = 100

[http]
listen = "127.0.0.1:8000"
```

:::

With a config file the command is `rapira serve --config rapira.toml`, and a relative `entrypoint` resolves against the config file's own directory. `max_requests` is the key from the section above — every key and its default is on the [Configuration](/docs/configuration) page.

For production, build the framework's caches first. Both were verified under this worker, plain and cached, with the same battery passing either way:

```bash
php artisan config:cache
php artisan route:cache
```

Those files are read on every request, like the rest of the bootstrap — what OPcache saves you is the parse, not the execution. Re-run the commands and reload the pool after a deploy anyway, because the autoloader and the OPcache segment are what a running worker will not re-read; reloading is a signal to the master ([Process model](/docs/process-model)), and the deployment shape around it, along with static files, TLS and what a reverse proxy in front of Rapira is for, lives on the [frameworks overview](/docs/frameworks/).

## Routing and URLs

Rapira runs one entry script for every URL, so under this worker `$_SERVER['SCRIPT_NAME']` is `/worker.php` rather than `/index.php`. Laravel does not care: routing resolves paths correctly, unmatched paths get Laravel's own 404 page, and `url()` generates clean absolute URLs — scheme, host and path, with no `worker.php` anywhere in them. **No `$_SERVER` overrides and no route or URL configuration changes are needed**; that was checked specifically, because it is the first thing that breaks on servers that map URLs onto files.

The skeleton's built-in `/up` health route answers `200` as usual, which makes it the natural target for a load balancer or container health check.

## Sessions, CSRF and forms

Sessions work per request, verified with the file driver: the session cookie goes out, comes back on the next request, and each client gets its own session. The database driver needs the PDO extension question from the prerequisites answered first, but nothing about the driver choice is Rapira-specific.

**Nothing about CSRF is Rapira-specific.** The token lives in the session, and sessions were verified to work per request — so a form that works under php-fpm has no Rapira-shaped reason to stop working. There is nothing to exclude, disable or reconfigure for the worker. (The verification's own smoke routes post without a token and were excluded from CSRF for that reason, so the full token round-trip is reasoned from the session result rather than measured.)

Form posts, JSON request bodies and file uploads were all verified through the same worker. And when a route throws, Laravel's exception handler renders its usual `500` — the failure stays inside the request, and the worker keeps serving the next one.

## The escape hatch: classic mode

If you would rather not maintain a worker script at all, don't:

```bash
rapira serve --classic public/index.php
```

That is the zero-change path. Rapira runs your existing front controller from scratch for every request, php-fpm style, and your application cannot tell the difference. You give up the resident process — the autoloader is registered again for every request, like it is today — and you keep the drop-in replacement plus the shared OPcache. [Classic mode](/docs/classic) is the full story, and [execution modes](/docs/execution-modes) explains where both rungs sit on the ladder.

::: question When will Rapira support Octane?
There is no Octane driver today, and this guide would rather say that plainly than ship a half-working one. Nothing about the rung is the blocker — Symfony and Yii3 keep their application resident on the same SAPI Worker rung Laravel runs on here ([execution modes](/docs/execution-modes) explains what the rungs mean). What Laravel needs is Octane's state-unwinding between requests, and that is a driver someone has to write. Until then, a fresh application per request inside a resident worker is what is actually verified to work, and it is what this page documents.
:::

::: question Why not just keep `$app` resident myself?
Because you would be rebuilding Octane's sandbox by hand. The state that has to be unwound between requests is spread across the container, resolved singletons, the request/session/auth stack and the framework's own statics — Octane exists precisely because collecting all of it is fiddly, and the failure modes when you miss one are subtle: a stale request object, one user's session visible to the next, config mutated by one request and never restored. We do not document a half version of that. The one trap we did chase all the way down is in the memory section above: `HandleExceptions::flushState()` looks like part of the answer and instead kills the worker.
:::

::: question Do I have to tune `memory_limit`?
Give it more headroom than your php-fpm value, yes, and pair it with `pool.max_requests` — the [memory section](#memory-and-why-it-sawtooths) above has both, and the [frameworks overview](/docs/frameworks/) has the mechanism behind them.
:::
