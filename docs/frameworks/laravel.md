---
title: Laravel
description: Running Laravel on Rapira in Classic mode, and the current state of Worker mode support.
---

# Laravel

Rapira runs Laravel in Classic mode with the stock `public/index.php` entry script. Rapira executes it from scratch for every request, as php-fpm does. The application needs no changes. Worker mode for Laravel is under development — see [Worker mode](#worker-mode) below for the current state.

::: info Verified with
- **PHP 8.5.8** — NTS, embed SAPI
- **Rapira 0.8.0**
- **laravel/laravel** skeleton with **laravel/framework v13.23.0**

The tests used a `laravel/laravel` skeleton in Classic mode with one worker process and some additional routes. They covered routing, sessions, uploads, JSON and form bodies, cached configuration and routes, error responses, and 50 sequential requests.
:::

## Prerequisites

You need Rapira installed — see [Installation](/docs/intro/installation) — and a Laravel application you can already run. You also need an ordinary PHP CLI on the machine for Composer and `artisan` — Rapira ships PHP as a library (`libphp`), not as a `php` command, so those steps run on your system PHP, which Rapira neither uses nor touches.

Check the database extensions before the first boot: a fresh `laravel/laravel` skeleton defaults to an SQLite database and to database-backed session, cache and queue drivers, which means it needs `pdo_sqlite`. The PHP bundled with the Rapira releases has it — PDO, `pdo_sqlite` and `sqlite3` are all in the release build's extension set, listed on the [Installation](/docs/intro/installation) page. If you run Rapira against a PHP you compiled yourself, make sure those extensions are in your configure line ([Build from source](/docs/intro/build-from-source) covers it), or point Laravel at the file and sync drivers instead — `SESSION_DRIVER=file`, `CACHE_STORE=file`, `QUEUE_CONNECTION=sync`. That is the combination this page's verification ran with.

## Running it

Classic mode is opt-in, so the command names it:

::: code-group

```bash [CLI]
rapira serve --mode classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
mode = "classic"
processes = 4

[http]
listen = "127.0.0.1:8000"
```

:::

With a config file the command is `rapira serve --config rapira.toml`, and a relative `entrypoint` resolves against the config file's own directory. Every key and its default is on the [Configuration](/docs/configuration) page.

Rapira executes the entry script from scratch for every request. Therefore, the framework has the same lifecycle as it has under php-fpm. It has no resident application state to reset between requests. OPcache remains warm. PHP starts once in the master, before the master forks a worker. Therefore, all workers share the same compiled-script cache for the application code and the `vendor/` tree. See [Classic mode](/docs/classic) for more information.

For production, build the framework's caches first; both were verified in Classic mode, with the same checks passing plain and cached:

```bash
php artisan config:cache
php artisan route:cache
```

## Routing and URLs

Rapira does not map URLs onto PHP scripts. Every request runs the entry script, and `$_SERVER['REQUEST_URI']` contains the path for Laravel to route. The [static file middleware](/docs/static-files) answers requests that match files. Every other request runs the entry script. Tests covered routing, Laravel's 404 page for unmatched paths, and `url()` generation. Generated URLs are clean absolute URLs without `index.php`. They require no `$_SERVER` overrides or route and URL configuration changes.

The skeleton's built-in `/up` health route answers `200`, so it works as the target for a load balancer or container health check. Rapira serves the skeleton's assets with the [static file middleware](/docs/static-files). Enable it with both halves: list `"static"` in `http.middleware`, and set `root` in `[http.static]` to the application's `public/` directory. Rapira refuses to boot when one half is present without the other. A CDN or a reverse proxy in front can still serve the assets instead. Rapira's listener speaks plain HTTP and leaves `$_SERVER['HTTPS']` empty regardless of `X-Forwarded-Proto`. When the proxy terminates TLS, configure Laravel's [trusted proxies](https://laravel.com/docs/requests#configuring-trusted-proxies). Without that configuration, `url()` generates `http://` links.

## Sessions, CSRF and forms

Sessions were verified with the file driver: the session cookie goes out, comes back on the next request, and each client gets its own session. CSRF needs no configuration — the token lives in the session, and every request gets the same fresh-process semantics php-fpm gives it. Form posts, JSON request bodies and file uploads were all verified through the same setup. When a route throws, Laravel's exception handler renders its usual `500` and the next request is unaffected.

## Worker mode

Worker mode for Laravel is under development and not yet supported — run Laravel in Classic mode. There is no date for Worker mode support yet.

The reason is the framework's lifecycle. Laravel's container is not designed to survive a second request without help: bindings get resolved, singletons capture the current request, and the framework's statics fill up as the request runs, so all of it has to be unwound before the next request arrives. That unwinding is what [Octane](https://laravel.com/docs/octane) (`laravel/octane`), Laravel's own package for long-running servers, implements. Octane runs only on servers it has a driver for, and Rapira has no Octane driver yet.

The mode itself is not the blocker: [Symfony](/docs/frameworks/symfony) and [Yii3](/docs/frameworks/yii3) keep their applications resident in the same [Worker](/docs/worker) mode. What is missing is the Laravel-specific state handling between requests.

You can write your own worker script for Laravel, but keeping the application resident means rebuilding Octane's state handling by hand: the state to unwind is spread across the container, resolved singletons, the request/session/auth stack and the framework's own statics, and a missed one shows up as a stale request object or one user's session visible to the next.
