---
title: Laravel
description: Running Laravel on Rapira in Classic mode, and the current state of Worker mode support.
---

# Laravel

Rapira runs Laravel in Classic mode with the standard `public/index.php` entry script. It starts a new PHP request each time, as php-fpm does.
The application needs no changes. Worker mode for Laravel is under development. See [Worker mode](#worker-mode) for its current state.

::: info Verified with
- **PHP 8.5.8**: NTS, embed SAPI
- **Rapira 0.8.0**
- Base application **laravel/laravel** with **laravel/framework v13.23.0**

Tests used a base `laravel/laravel` application in Classic mode with one worker and additional routes.
They covered routing, sessions, uploads, request bodies, cached configuration, cached routes, errors, and 50 sequential requests.
:::

## Prerequisites

Install Rapira as described in [Installation](/docs/intro/installation). You also need a Laravel application that operates correctly. Install a PHP CLI for Composer and `artisan`. Rapira supplies PHP as a library, not as a `php` command. Composer and `artisan` use the system PHP CLI. Rapira does not use or change this CLI.

Check database extensions before the first server start. A new `laravel/laravel` project uses SQLite and database-backed session, cache, and queue drivers. Thus, it requires `pdo_sqlite`. Rapira release builds include PDO, `pdo_sqlite`, and `sqlite3`. See [Installation](/docs/intro/installation) for the complete extension list.

Enable these extensions when you compile PHP. See [Build from source](/docs/intro/build-from-source) for more information.
Alternatively, use `SESSION_DRIVER=file`, `CACHE_STORE=file`, and `QUEUE_CONNECTION=sync`. Tests for this page used these settings.

## Server start

Select Classic mode explicitly:

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

Run `rapira serve --config rapira.toml` to use the configuration file.
A relative `entrypoint` uses the configuration file directory as its base. See [Configuration](/docs/configuration) for all keys and defaults.

Rapira starts a new PHP request for each HTTP request. Thus, the framework has the same lifecycle as it has under php-fpm. It has no persistent application state to reset. PHP starts once in the master before the master creates workers. OPcache provides a shared compiled script cache for application and `vendor/` code. See [Classic mode](/docs/classic) for more information.

Create the framework caches before you start production. Tests confirmed both caches in Classic mode:

```bash
php artisan config:cache
php artisan route:cache
```

## Routing and URLs

Rapira does not map URLs onto PHP scripts. Every request runs the entry script, and `$_SERVER['REQUEST_URI']` contains the path for Laravel to route. The [static file middleware](/docs/static-files) answers requests that match files. Every other request runs the entry script.

Tests covered routing, Laravel's 404 page for unmatched paths, and `url()` generation. Generated URLs are absolute and do not contain `index.php`. They require no `$_SERVER` overrides or route and URL configuration changes.

The built-in `/up` health route returns `200`. A load balancer or container can use this route for health checks.
Rapira can serve assets with the [static file middleware](/docs/static-files). Add `"static"` to `http.middleware`.
Set `[http.static].root` to the application `public/` directory. Rapira requires both configuration values.
A CDN or reverse proxy can serve the assets instead.

Rapira accepts plain HTTP and leaves `$_SERVER['HTTPS']` empty, independent of `X-Forwarded-Proto`.
When a [proxy terminates TLS](/docs/deployment), configure Laravel [trusted proxies](https://laravel.com/docs/requests#configuring-trusted-proxies). Without this configuration, `url()` generates `http://` links.

## Sessions, CSRF and forms

Tests used the file session driver. Each client received an independent session and sent its session cookie with the next request. CSRF requires no Rapira configuration because the token is in the session. Classic mode uses the same request lifecycle as php-fpm.

Tests also covered form data, JSON bodies, and file uploads. Laravel returned its normal `500` response for a route exception. Laravel processed the next request. It did not repeat the route exception.

## Worker mode

Rapira does not support Laravel in Worker mode yet. Development is in progress. Run Laravel in Classic mode. No release date is available for Worker mode support.

The framework lifecycle requires integration support. Laravel resolves bindings, stores requests in singletons, and changes static state during request processing. Reset this state before the next request. [Octane](https://laravel.com/docs/octane) implements the reset process for supported servers. Rapira does not have an Octane driver yet.

Worker mode can keep [Symfony](/docs/frameworks/symfony) and [Yii3](/docs/frameworks/yii3) applications. Laravel support requires its own state reset process.

Application code must implement the Octane state reset process in a custom Laravel worker. Request state exists in the container, resolved singletons, request services, session services, authentication services, and static properties. An incomplete reset can expose old request or session data to a later request. This also applies to later requests from the same user. Do not use a custom worker without complete state isolation tests.
