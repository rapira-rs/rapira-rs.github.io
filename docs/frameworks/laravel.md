---
title: Laravel
description: Running Laravel in Classic, Worker, and Dispatcher modes with the rapira/laravel bridge on top of Laravel Octane.
---

# Laravel

The [`rapira/laravel`](https://github.com/rapira-rs/laravel) package connects Laravel to Rapira. One entry script serves all three [execution modes](/docs/execution-modes). The `mode` key in `rapira.toml` selects the mode. The application code does not change.

In Worker and Dispatcher modes, the application initializes once and stays in memory. The bridge uses the [Laravel Octane](https://laravel.com/docs/octane) worker to reset the application state between requests. Octane is a dependency of the package. You do not run `octane:start` because Rapira replaces the Octane server.

::: info Verified with
- **rapira/laravel 0.1.1**
- **laravel/framework v13.34.0** and **laravel/octane v2.20.0**
- **PHP 8.5**: embed SAPI

The bridge tests send real HTTP requests to a Laravel application in each of the three modes. The tests cover routing, the 404 page, route exceptions, configuration isolation between requests, sessions, cookies, form data, streamed responses, and file downloads.
:::

## Requirements

- PHP 8.4 or later.
- Laravel 11, 12, or 13.
- Rapira 0.9 or later. See [Installation](/docs/intro/installation).

Rapira supplies PHP as a library, not as a `php` command. Install a PHP CLI for Composer and `artisan`. Rapira does not use or change this CLI.

A new `laravel/laravel` project uses SQLite and database-backed session, cache, and queue drivers, so it requires `pdo_sqlite`. Rapira release builds include `pdo_sqlite`. See [Installation](/docs/intro/installation) for the complete extension list. If you compile PHP, enable the extensions that your drivers need. See [Build from source](/docs/intro/build-from-source).

## Installation

Install the package:

```bash
composer require rapira/laravel
```

Laravel discovers the service provider of the package automatically. Publish the entry script and a starter server configuration into the project root:

```bash
php artisan vendor:publish --tag=rapira
```

The command creates two files. `worker.php` is the entry script for all modes:

```php
<?php

declare(strict_types=1);

use Rapira\Laravel\Runner;

require __DIR__ . '/vendor/autoload.php';

(new Runner(__DIR__))->run();
```

The `Runner` argument is the application root, the directory that contains `bootstrap/app.php`. `rapira.toml` configures the server:

```toml
[http]
listen = "127.0.0.1:8000"
middleware = ["static"]

[http.static]
root = "public"

[http.pool]
entrypoint = "worker.php"
# "dispatcher", "worker" or "classic": the same worker.php serves all three.
mode = "dispatcher"
```

Start the server:

```bash
rapira serve rapira.toml
```

The server stays in the foreground, and the application is available at `http://127.0.0.1:8000/`. Press `Ctrl-C` to stop the server.

A relative `entrypoint` uses the configuration file directory as its base. See [Configuration](/docs/configuration) for all keys and defaults.

## Execution modes

`Runner` reads the mode when the worker starts and runs the applicable loop. Change `http.pool.mode` to change the mode. Keep the same `worker.php`.

| Mode | Application lifetime | Request source |
| --- | --- | --- |
| `classic` | One request | Superglobals that Rapira fills |
| `worker` | The worker process | Superglobals that Rapira fills |
| `dispatcher` | The worker process | `Rapira\Http\Exchange` objects |

**Classic mode** runs the same lifecycle as Laravel's `public/index.php`. The bridge loads `bootstrap/app.php`, handles the request, sends the response, and calls `terminate()`. The maintenance mode file `storage/framework/maintenance.php` operates as in `public/index.php`. No state stays after the request. See [Classic mode](/docs/classic).

**Worker mode** keeps one application in each worker process. Rapira fills the superglobals for each request, and the bridge builds the request with `Request::capture()`. The response goes out through `header()` and the output, as in Classic mode. See [Worker mode](/docs/worker).

**Dispatcher mode** keeps one application in each worker process. The bridge receives each request as an exchange from the HTTP [dispatcher](/docs/dispatcher). It builds an `Illuminate\Http\Request` from the exchange and writes the response back into the exchange. This mode is the default.

Each worker handles one request at a time in all modes. Octane resets the application for each request, so two requests cannot share one application at the same time.

### Superglobals in Dispatcher mode

In Dispatcher mode, Rapira does not fill `$_GET`, `$_POST`, `$_COOKIE`, `$_FILES`, or the request values of `$_SERVER`. The bridge also does not fill them. Laravel code that reads the `Request` object does not need these variables. Laravel sessions and cookies also operate through the `Request` and `Response` objects.

Use Worker mode if the application or a package does one of these operations:

- It reads the superglobals directly.
- It sends headers with `header()` or `setcookie()`.
- It uses native PHP sessions (`session_start()`).

The bridge fills the server values of the `Request` object as if `public/index.php` handled the request. `SCRIPT_NAME` is `/index.php`, and `DOCUMENT_ROOT` is the `public/` directory. Header names map to `HTTP_*` keys with the same rules as in Worker mode.

## State between requests

In Worker and Dispatcher modes, the Octane worker initializes the application once. For each request, Octane clones the application into a sandbox. It then runs its listeners, which reset known request state. For example, a configuration change in one request does not appear in the next request. The bridge tests confirm this behavior in both modes.

The Octane configuration controls these listeners. The `warm` key lists services to initialize before the first request. The `flush` key lists services to remove after each request. Octane uses its default configuration if the application has no `config/octane.php`. To change the configuration, publish the file:

```bash
php artisan vendor:publish --tag=octane-config
```

The `server` key and the server-specific settings of this file do not apply to Rapira. Configure the server in `rapira.toml`.

Octane does not reset static properties, global variables, or singletons that keep a reference to the request or the container. Application code and packages must be safe for a persistent worker. See [Dependency injection and Octane](https://laravel.com/docs/octane#dependency-injection-and-octane) in the Laravel documentation. See [Framework integration](/docs/frameworks/) for the state that stays in a worker.

`Octane::concurrently()` runs its tasks one after another. The Octane cache store and `Octane::table()` require Swoole. They are not available on Rapira.

## Routing and URLs

Rapira does not map URLs onto PHP scripts. Each request runs the entry script, and Laravel routes the request path. Generated URLs are absolute and contain neither `worker.php` nor `index.php`. They need no `$_SERVER` overrides and no route or URL configuration changes.

The starter `rapira.toml` enables the [static file middleware](/docs/static-files) for `public/`. The middleware answers requests that match files under `public/`. All other requests go to Laravel. A CDN or reverse proxy can serve the assets instead.

The built-in `/up` route returns `200`. A load balancer or container can use it for health checks. Rapira can also serve `/livez` and `/readyz` on a separate address. See [Metrics and health checks](/docs/observability).

Rapira accepts only plain HTTP, so Laravel sees each request as `http`, also when a request has `X-Forwarded-Proto`. When a [proxy terminates TLS](/docs/deployment), configure Laravel [trusted proxies](https://laravel.com/docs/requests#configuring-trusted-proxies). Without this configuration, `url()` generates `http://` links.

## Sessions, CSRF, and forms

Laravel sessions use the session cookie and the configured session driver. Each client receives an independent session. CSRF needs no Rapira configuration because the token is in the session.

The bridge tests cover form data with nested fields and file uploads. In Dispatcher mode, the bridge parses form bodies for `POST`, `PUT`, `PATCH`, and `DELETE`, as `Request::createFromGlobals()` does.

`http.max_body_size_mb` limits the request body before PHP runs, and the default is 8 MiB. Rapira returns `413` for a larger body, and Laravel does not receive the request. To accept larger uploads, increase this value. Also increase `post_max_size` and `upload_max_filesize` in php.ini. See [Request bodies](/docs/http#request-bodies).

## Responses

The bridge sends all Laravel response types:

- **Buffered responses** go out with their headers and cookies.
- **Streamed responses** (`response()->stream()`) go out in chunks. A callback can call `ob_flush()` or `flush()` to send the current chunk.
- **File responses** (`response()->download()` and `response()->file()`) go out with their headers. In Dispatcher mode, the bridge gives the file path to Rapira, and Rapira reads the file. If Rapira cannot send the file, PHP streams it.

Output that a controller prints with `echo` goes out before the response body.

In Classic and Worker modes, the bridge calls [`rapira_finish_request()`](/docs/http) after the response. The client receives the response before terminable middleware and the Octane cleanup run.

## Errors

Laravel handles a route exception and returns its normal `500` response. The same worker handles the next request.

An exception can escape the Laravel HTTP kernel, for example from a streamed response callback. Octane then reports the exception through the Laravel exception handler. The client receives a plain-text `500` response if the response headers are not sent yet. The response contains the exception details only when `app.debug` is `true`.

After such an exception, the application state can be incorrect. Octane stops the worker, and the bridge ends its loop. Rapira then starts the entry script again, and the new worker initializes the application again.

## Production

Create the framework caches before you start the server:

```bash
php artisan config:cache
php artisan route:cache
```

A worker can increase its memory use over time. Set a worker replacement limit:

```toml
[http.pool]
entrypoint = "worker.php"
mode = "dispatcher"
processes = 4
max_requests = 500
```

`max_requests` replaces a worker after a random request count between this value and 1.5 times this value. It limits the effect of a memory leak but does not correct it. See [Process model](/docs/process-model).

In Worker and Dispatcher modes, the application code stays in memory. After a deployment, send `SIGUSR2` to the master to replace the workers. With `opcache.validate_timestamps = 0`, restart Rapira instead. See [Running in production](/docs/deployment).

## Development

In Worker and Dispatcher modes, each worker initializes the application once. Restart Rapira after each code change to load the new PHP code.

Alternatively, use Classic mode during development. Set `mode = "classic"` in `rapira.toml` and keep `entrypoint = "worker.php"`. Classic mode initializes the application for each request, so saved changes take effect immediately.

::: question Can I run Laravel in Classic mode without the bridge?
Yes. Set `entrypoint = "public/index.php"` and `mode = "classic"`. Each request then runs the standard `public/index.php`, as under php-fpm. Worker and Dispatcher modes require the bridge.
:::
