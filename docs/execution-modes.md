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

The mode names are the values of `pool.mode` in the configuration file, and the cases of the `Rapira\Mode` enum in PHP. The modes are listed in order of how much control PHP has over the request lifecycle. Classic discards everything the script created at the end of each request. Worker and Dispatcher keep one booted application alive for many requests, so they place more requirements on the code.

## Classic <Badge type="tip" text="shipped" />

The entry script runs from scratch on every request, exactly as it would under php-fpm: superglobals are filled in, the front controller boots, the response goes out, everything is torn down. Nothing the script created is carried over, so application state cannot leak from one request into the next. The same exceptions as php-fpm apply: persistent connections and extension-level state live in the worker process, not in the request.

An existing application runs as it is, because Rapira takes php-fpm's place with no changes to your code. PHP is embedded in the server process, so there is no FastCGI hop between the HTTP front and the interpreter.

See [Classic mode](/docs/classic) for more information.

## Worker <Badge type="tip" text="shipped" />

Worker mode has the same shape as Classic: you still read the superglobals, and you still `echo` your response. The difference is that the worker is not torn down at the end of a request. A resident script boots everything once, then loops: the server refills `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` and the rest for each new request, runs your handler, and hands you the next one. Anything created outside the loop stays warm: the autoloader, the DI container, the configuration, the database connections.

The boot runs once per worker instead of once per request, and for a modern application that boot is often the most expensive part of the request. The process no longer starts clean on every request, so whatever your application leaves in static properties, singletons or global state is still there on the next one. Rapira can recycle a worker after a set number of requests, so a slow leak in your application or one of its dependencies does not become an outage while you track it down.

See [Worker mode](/docs/worker) for the worker script and its loop, [Configuration](/docs/configuration) for the recycling limit, and [HTTP](/docs/http) for how requests and responses are handled.

## Dispatcher <Badge type="tip" text="shipped" />

Dispatcher mode inverts the call direction: the worker script asks Rapira for the next unit of work through an API call, instead of waiting to be called. `Rapira\get_dispatcher()` returns the dispatcher the pool serves. `receive(int $timeout = -1)` waits for the next unit of work, and the timeout is in microseconds. The default `-1` waits without a limit, and a timeout that elapses raises `Rapira\Exception\TimeoutException`. `tryReceive()` returns the next unit of work or `null`, and it never waits. Over the HTTP plugin the unit of work is a `Rapira\Http\Exchange`. Its `getRequest()` returns a `Rapira\Http\Request` object that carries the method, the target, the headers, the body and the peer addresses, and its `writeHead()`, `writeBody()` and `sendFile()` write the response.

The request is a value you can pass to a function, wrap, or hand to a middleware stack. The superglobals are not filled in this mode. An application that reads `$_GET` or `$_SERVER` directly needs Worker mode, or an adapter that copies the request object into the shape the application expects. The mode comes from `pool.mode` or from `--mode`, not from the application code.

The number of units of work in flight is the script's choice. A plain loop handles one unit at a time: it calls `receive()`, answers the request, and calls `receive()` again. The same API also lets a script hold more than one unit at once. Such a script starts a [Fiber](https://www.php.net/manual/en/language.fibers.php) per request. It polls with `tryReceive()` while fibers are in flight, and it parks the loop on `receive()` when no fiber is left. This keeps several requests in flight in one interpreter. Concurrency here is cooperative: another request makes progress only when the running code suspends its fiber, so a library that is not fiber-safe keeps the script on one unit of work at a time.

::: info
Dispatcher mode is the default `pool.mode`. A dedicated guide for it is not written yet. Currently the PHP-side API is documented in the IDE stub files, [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) for the `Dispatcher` and `Work` interfaces and [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_http.stub.php) for the HTTP types, with two runnable scripts in [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples): `dispatcher-sync.php` and `dispatcher-async.php`.
:::

## Reading the mode at runtime

`Rapira\get_mode()` returns the mode the host launched the process in, as a case of the `Rapira\Mode` enum. `Mode` is a pure enum with three cases: `Classic`, `Worker` and `Dispatcher`. The case is the `pool.mode` the process started with, and it stays the same for the life of the process. Enum cases are single objects, so `===` compares them. The function takes no arguments and never throws, which makes it safe to call at the top of an entry script that serves under more than one mode.

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
The host reads `pool.mode` at startup and fixes the mode before it starts the interpreter, so the first request and the last request of a worker report the same case. Changing the mode means restarting the server.
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

Switching to Worker or Dispatcher costs work on the PHP side, because both need a resident entry script that Classic does not. Switching back does not: set `mode = "classic"` in the config file or pass `--mode classic`, point Rapira at your ordinary front controller, and you get the same server, the same binary and the same [process model](/docs/process-model) underneath. See [Configuration](/docs/configuration) and the [CLI reference](/docs/cli) for more details.

::: tip
Start on Classic if you are replacing php-fpm and want everything working first. Switch to Worker once you know your application boots cleanly and holds no state that it should not keep between requests.
:::
