---
title: Execution modes
description: "Rapira's three execution modes: what Classic, Worker and Dispatcher do, how to select one, and how to read the current mode from PHP."
faqLevel: 2
---

# Execution modes

Rapira runs PHP in one of three execution modes. All three ship today.

| Mode | Status | Description |
| --- | --- | --- |
| [Classic](/docs/classic) | Shipped | The entry script runs from scratch on every request, as under php-fpm. |
| [Worker](/docs/worker) | Shipped | A resident script boots once and handles requests in a loop; the superglobals are refilled for each request. |
| Dispatcher | Shipped | The worker pulls each request through an API call and works with the request as a value instead of the superglobals. |

The mode names are the values of `pool.mode` and the cases of the `Rapira\Mode` enum. Classic discards the state that the script creates during a request. Worker and Dispatcher keep one booted application alive for many requests. The application's state and API dependencies determine which modes it can use.

## Classic <Badge type="tip" text="shipped" />

The entry script runs from scratch on every request, exactly as it would under php-fpm: superglobals are filled in, the front controller boots, the response goes out, everything is torn down. Nothing the script created is carried over, so application state cannot leak from one request into the next. The same exceptions as php-fpm apply: persistent connections and extension-level state live in the worker process, not in the request.

An existing application runs as it is, because Rapira takes php-fpm's place with no changes to your code. PHP is embedded in the server process, so there is no FastCGI hop between the HTTP front and the interpreter.

See [Classic mode](/docs/classic) for more information.

## Worker <Badge type="tip" text="shipped" />

Worker mode uses the same request and response interfaces as Classic. You still read the superglobals and use `echo` for the response. The worker is not torn down at the end of a request. A resident script boots once and then enters a loop. For each request, the server refills the superglobals and runs your handler. Objects created outside the loop stay warm, including the container, configuration, and database connections.

The boot runs once per worker instead of once per request, and for a modern application that boot is often the most expensive part of the request. The process no longer starts clean on every request, so whatever your application leaves in static properties, singletons or global state is still there on the next one. Rapira can recycle a worker after a set number of requests, so a slow leak in your application or one of its dependencies does not become an outage while you track it down.

See [Worker mode](/docs/worker) for the worker script and its loop, [Configuration](/docs/configuration) for the recycling limit, and [HTTP](/docs/http) for how requests and responses are handled.

## Dispatcher <Badge type="tip" text="shipped" />

In Dispatcher mode, the worker script requests each unit of work through an API call. `Rapira\get_dispatcher()` returns the dispatcher that the pool serves. `receive(int $timeout = -1)` waits for the next unit, with a timeout in microseconds. The default value, `-1`, waits without a limit. An elapsed timeout raises `Rapira\Exception\TimeoutException`. `tryReceive()` returns the next unit or `null` without waiting. With the HTTP plugin, each unit is a `Rapira\Http\Exchange`. Its `getRequest()` method returns a `Rapira\Http\Request` with the method, target, headers, body, and peer addresses. Its `writeHead()`, `writeBody()`, and `sendFile()` methods write the response.

The request is a value you can pass to a function, wrap, or hand to a middleware stack. The superglobals are not filled in this mode. An application that reads `$_GET` or `$_SERVER` directly needs Worker mode, or an adapter that copies the request object into the shape the application expects. The mode comes from `pool.mode` or from `--mode`, not from the application code.

The script controls how many units of work are in progress. A plain loop handles one unit at a time. It calls `receive()`, answers the request, and then calls `receive()` again. The same API lets a script hold more than one unit. Such a script starts a [Fiber](https://www.php.net/manual/en/language.fibers.php) for each request. It polls with `tryReceive()` while fibers are active. When no fiber remains, the loop waits in `receive()`. This design keeps several requests active in one interpreter. Concurrency is cooperative, so another request progresses only when the running code suspends its fiber. Use one unit at a time when a library is not fiber-safe.

::: info
Dispatcher mode is the default `pool.mode`. A dedicated guide for it is not written yet. The [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) IDE stub documents the `Dispatcher` and `Work` interfaces. The [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_http.stub.php) stub documents the HTTP types. The [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) directory contains two runnable scripts: `dispatcher-sync.php` and `dispatcher-async.php`.
:::

## Reading the mode at runtime

`Rapira\get_mode()` returns the process mode as a case of the `Rapira\Mode` enum. `Mode` is a pure enum with three cases: `Classic`, `Worker` and `Dispatcher`. The case matches the initial `pool.mode` and stays the same for the life of the process. Enum cases are single objects, so `===` compares them. The function takes no arguments and does not throw. You can call it at the top of an entry script that supports more than one mode.

```php
<?php
// entry.php

use Rapira\Mode;

$app = require __DIR__ . '/bootstrap.php';

match (\Rapira\get_mode()) {
    Mode::Classic => $app->handleOnce(),
    Mode::Worker => $app->runWorkerLoop(),
    Mode::Dispatcher => $app->runDispatcherLoop(),
};
```

::: question Why does the mode never change while a process runs?
The host reads `pool.mode` and fixes the mode before it starts the interpreter. Every request in that worker reports the same case. Changing the mode requires a server restart.
:::

## Mode selection

The default `pool.mode` is `dispatcher`. Set the mode explicitly in `rapira.toml`, or with `--mode` on the command line.

```toml
[pool]
entrypoint = "public/index.php"
mode = "classic"                      # "classic" | "worker" | "dispatcher" (the default)
```

```sh
rapira serve --mode classic public/index.php
```

All three modes are open to any application, and what limits the choice is the application's own stack. Global state that cannot survive a second request keeps an application on Classic. Code that reads the superglobals directly keeps an application off Dispatcher until an adapter fills that gap. A framework with a runtime integration makes Worker mode available with almost no work; see [Frameworks](/docs/frameworks/) for the ones with a documented integration.

The mode is set per server instance, not per route, so one instance cannot serve some routes from a worker and the rest from Classic. If part of your application is not worker-safe, run that part behind its own Rapira instance in Classic mode.

Worker and Dispatcher require a resident entry script. Classic does not. To switch to Classic, set `mode = "classic"` or pass `--mode classic`. Then point Rapira at the ordinary front controller. The server, binary, and [process model](/docs/process-model) do not change. See [Configuration](/docs/configuration) and the [CLI reference](/docs/cli) for more information.

::: tip
Start on Classic if you are replacing php-fpm and want everything working first. Switch to Worker once you know your application boots cleanly and holds no state that it should not keep between requests.
:::
