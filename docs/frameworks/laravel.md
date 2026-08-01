---
title: Laravel
description: Running Laravel on Rapira in classic mode, and the current state of worker-mode support.
---

# Laravel

Rapira runs Laravel in classic mode: the stock `public/index.php` front controller, executed from scratch for every request, the way php-fpm runs it. The application needs no changes. Worker mode for Laravel is under development — see [Worker mode](#worker-mode) below for the current state.

::: info Verified with
- **PHP 8.5.8** — NTS, embed SAPI
- **Rapira 0.6.0**
- **laravel/laravel** skeleton with **laravel/framework v13.23.0**

Everything on this page was run against a `laravel/laravel` skeleton with a handful of test routes added, in classic mode with a single worker process: routing, sessions, uploads, JSON and form bodies, cached config and routes, error responses, and 50 sequential requests.
:::

## Prerequisites

You need Rapira installed — see [Installation](/docs/installation) — and a Laravel application you can already run. You also need an ordinary PHP CLI on the machine for Composer and `artisan` — Rapira ships PHP as a library (`libphp`), not as a `php` command, so those steps run on your system PHP, which Rapira neither uses nor touches.

Check the database extensions before the first boot: a fresh `laravel/laravel` skeleton defaults to an SQLite database and to database-backed session, cache and queue drivers, which means it needs `pdo_sqlite`. The PHP bundled with the Rapira releases has it — PDO, `pdo_sqlite` and `sqlite3` are all in the release build's extension set, listed on the [Installation](/docs/installation) page. If you run Rapira against a PHP you compiled yourself, make sure those extensions are in your configure line ([Build from source](/docs/build-from-source) covers it), or point Laravel at the file and sync drivers instead — `SESSION_DRIVER=file`, `CACHE_STORE=file`, `QUEUE_CONNECTION=sync`. That is the combination this page's verification ran with.

## Running it

Classic mode is opt-in, so the command names it:

::: code-group

```bash [CLI]
rapira serve --classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
classic = true
processes = 4

[http]
listen = "127.0.0.1:8000"
```

:::

With a config file the command is `rapira serve --config rapira.toml`, and a relative `entrypoint` resolves against the config file's own directory. Every key and its default is on the [Configuration](/docs/configuration) page.

Rapira executes the front controller from scratch for every request, so the framework's lifecycle is exactly what it is under php-fpm: no resident state, nothing to reset between requests. What does stay warm is OPcache — PHP starts once in the master, before any worker is forked, so every worker shares the same compiled-script cache for your code and your `vendor/` tree. See [classic mode](/docs/classic) for the mechanics.

For production, build the framework's caches first; both were verified in classic mode, with the same checks passing plain and cached:

```bash
php artisan config:cache
php artisan route:cache
```

## Routing and URLs

Rapira does not map URLs onto files: every request runs the front controller, and `$_SERVER['REQUEST_URI']` carries the path for Laravel to route. Routing, Laravel's own 404 page for unmatched paths, and `url()` generation were all verified — generated URLs are clean absolute URLs with no `index.php` in them, with no `$_SERVER` overrides and no route or URL configuration changes.

The skeleton's built-in `/up` health route answers `200`, so it works as the target for a load balancer or container health check. Static assets need something in front of Rapira — a CDN, or the reverse proxy the [deployment](/docs/deployment) page sets up. Rapira's listener speaks plain HTTP and leaves `$_SERVER['HTTPS']` empty regardless of `X-Forwarded-Proto`, so when that proxy terminates TLS, configure Laravel's [trusted proxies](https://laravel.com/docs/requests#configuring-trusted-proxies) — otherwise `url()` generates `http://` links.

## Sessions, CSRF and forms

Sessions were verified with the file driver: the session cookie goes out, comes back on the next request, and each client gets its own session. CSRF needs no configuration — the token lives in the session, and every request gets the same fresh-process semantics php-fpm gives it. Form posts, JSON request bodies and file uploads were all verified through the same setup. When a route throws, Laravel's exception handler renders its usual `500` and the next request is unaffected.

## Worker mode

Worker mode for Laravel is under development and not yet supported — run Laravel in classic mode. There is no date for worker support yet.

The reason is the framework's lifecycle. Laravel's container is not designed to survive a second request without help: bindings get resolved, singletons capture the current request, and the framework's statics fill up as the request runs, so all of it has to be unwound before the next request arrives. That unwinding is what [Octane](https://laravel.com/docs/octane) (`laravel/octane`), Laravel's own package for long-running servers, implements. Octane runs only on servers it has a driver for, and Rapira has no Octane driver yet.

The mode itself is not the blocker: [Symfony](/docs/frameworks/symfony) and [Yii3](/docs/frameworks/yii3) keep their applications resident in the same [SAPI Worker](/docs/worker) mode. What is missing is the Laravel-specific state handling between requests.

You can write your own worker script for Laravel, but keeping the application resident means rebuilding Octane's state handling by hand: the state to unwind is spread across the container, resolved singletons, the request/session/auth stack and the framework's own statics, and a missed one shows up as a stale request object or one user's session visible to the next.
