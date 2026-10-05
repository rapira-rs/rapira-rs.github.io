---
title: Laravel
description: Running Laravel on Rapira in Classic mode, and the current state of Worker mode support.
---

# Laravel

Rapira runs Laravel in Classic mode with the standard `public/index.php` entry script. Each HTTP request runs in a new PHP request, as under php-fpm. The application needs no changes. Rapira does not support Laravel in [Worker mode](#worker-mode) yet.

::: info Verified with
- **PHP 8.5.8**: NTS, embed SAPI
- **Rapira 0.8.0**
- Base application **laravel/laravel** with **laravel/framework v13.23.0**

The tests used a base `laravel/laravel` application in Classic mode with one worker and additional routes. They covered routing, sessions, uploads, request bodies, cached configuration, cached routes, errors, and 50 sequential requests. The examples on this page use the v0.9 configuration format.
:::

## Prerequisites

Install Rapira as described in [Installation](/docs/intro/installation). Rapira supplies PHP as a library, not as a `php` command. Install a PHP CLI for Composer and `artisan`. Rapira does not use or change this CLI.

A new `laravel/laravel` project uses SQLite and database-backed session, cache, and queue drivers, so it requires `pdo_sqlite`. Rapira release builds include `pdo_sqlite`. See [Installation](/docs/intro/installation) for the complete extension list. If you compile PHP, enable the extensions that your drivers need. See [Build from source](/docs/intro/build-from-source).

Alternatively, set `SESSION_DRIVER=file`, `CACHE_STORE=file`, and `QUEUE_CONNECTION=sync`. The tests for this page used these settings.

## Server start

The default mode is `dispatcher`, but Laravel's `public/index.php` has no dispatcher loop. Set `mode = "classic"` in `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
processes = 4
```

Run `rapira serve rapira.toml` to start the server. A relative `entrypoint` uses the configuration file directory as its base. See [Configuration](/docs/configuration) for all keys and defaults.

The application has no persistent state to reset between requests. PHP starts once in the master, before the master creates the workers. Thus, all workers share one OPcache for application and `vendor/` code. On PHP 8.4, OPcache is a separate `opcache.so` that needs a `zend_extension` line in [php.ini](/docs/intro/installation#php-ini). See [Classic mode](/docs/classic) for more information.

Create the framework caches before you start production. Tests confirmed both caches in Classic mode:

```bash
php artisan config:cache
php artisan route:cache
```

## Routing and URLs

Rapira does not map URLs onto PHP scripts. Each request runs `public/index.php`, and Laravel routes the path in `$_SERVER['REQUEST_URI']`. Tests covered routing, the Laravel 404 page, and `url()` generation. Generated URLs are absolute and do not contain `index.php`. They need no `$_SERVER` overrides and no route or URL configuration changes.

To serve assets from `public/`, enable the [static file middleware](/docs/static-files). Add `middleware` to the existing `[http]` table and add the `[http.static]` table. Rapira needs both settings:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

The middleware answers requests that match files under `public/`. All other requests go to Laravel. A CDN or reverse proxy can serve the assets instead.

The built-in `/up` route returns `200`. A load balancer or container can use it for health checks. Rapira can also serve `/livez` and `/readyz` on a separate address. See [Metrics and health checks](/docs/observability).

Rapira accepts only plain HTTP and leaves `$_SERVER['HTTPS']` empty, also when a request has `X-Forwarded-Proto`. When a [proxy terminates TLS](/docs/deployment), configure Laravel [trusted proxies](https://laravel.com/docs/requests#configuring-trusted-proxies). Without this configuration, `url()` generates `http://` links.

## Sessions, CSRF and forms

Tests used the file session driver. Each client received an independent session and sent its session cookie with the next request. CSRF needs no Rapira configuration because the token is in the session.

Tests also covered form data, JSON bodies, and file uploads. `http.max_body_size_mb` limits the request body before PHP runs, and the default is 8 MiB. Rapira returns `413` for a larger body, and Laravel does not receive the request. To accept larger uploads, increase this value. Also increase `post_max_size` and `upload_max_filesize` in php.ini. See [Request bodies](/docs/http#request-bodies).

Laravel returned its normal `500` response for a route exception. The next request ran normally and did not repeat the exception.

## Worker mode

Rapira does not support Laravel in Worker mode yet. Run Laravel in Classic mode.

Laravel keeps request state in the container, in resolved singletons, and in static properties. A worker must reset this state before the next request. [Octane](https://laravel.com/docs/octane) does this reset for the servers that it supports, but Rapira has no Octane driver. [Symfony](/docs/frameworks/symfony) and [Yii3](/docs/frameworks/yii3) applications can run in Worker mode.

::: warning
A custom Laravel worker without a complete state reset can send request, session, or authentication data of one request to a later request. Do not use a custom worker without complete state isolation tests.
:::
