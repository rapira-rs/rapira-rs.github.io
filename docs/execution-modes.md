---
title: Execution modes
description: "Classic, Worker, and Dispatcher behavior, selection, and runtime identification."
faqLevel: 2
---

# Execution modes

Rapira runs PHP in one of three execution modes. All three modes are available.

| Mode | Status | Description |
| --- | --- | --- |
| [Classic](/docs/classic) | Available | The entry script runs in a new PHP request each time, as under php-fpm. |
| [Worker](/docs/worker) | Available | A persistent script handles requests in a loop. Rapira refills the superglobals for each request. |
| Dispatcher | Available | The worker gets each request through an API call and uses a request object instead of the superglobals. |

The mode names are `pool.mode` values and `Rapira\Mode` enum cases. Classic removes application request state after each request. Worker and Dispatcher keep one initialized application for many requests. Application state and API dependencies determine which modes an application can use.

## Classic <Badge type="tip" text="available" />

The entry script runs in a new PHP request each time, as it does under php-fpm. Rapira fills the superglobals and runs the script.
It then sends the response and removes the request state. Persistent connections and extension state are exceptions because they exist in the worker process.

A current application can run without code changes when Rapira replaces php-fpm. Rapira embeds PHP in the server process and does not use FastCGI.

See [Classic mode](/docs/classic) for more information.

## Worker <Badge type="tip" text="available" />

Worker mode uses the same request and response interfaces as Classic. The application reads superglobals and can use `echo` for the response.
The worker remains active after a request. It initializes the script once and then enters a loop.
For each request, Rapira refills the superglobals and runs the handler. Objects outside the loop remain available.

Application initialization runs once per worker instead of once per request. This can reduce request execution time.
However, static properties, singletons, and global state remain for the next request.
Rapira can replace a worker after a specified request count. This replacement limits the effect of a memory leak.

See [Worker mode](/docs/worker) for the worker script and its loop. See [Configuration](/docs/configuration) for the replacement limit.
See [HTTP](/docs/http) for how Rapira handles requests and responses.

## Dispatcher <Badge type="tip" text="available" />

In Dispatcher mode, the worker script requests each work unit through an API call. `Rapira\get_dispatcher()` returns the dispatcher for the pool. `receive(int $timeout = -1)` waits for the next unit. The timeout is in microseconds, and `-1` disables it. An elapsed timeout throws `Rapira\Exception\TimeoutException`. `tryReceive()` immediately returns the next unit or `null`.

With the HTTP plugin, each unit is a `Rapira\Http\Exchange`.
Its `getRequest()` method returns a `Rapira\Http\Request`. The request contains the method, target, headers, body, and peer addresses.
The `writeHead()`, `writeBody()`, and `sendFile()` methods write the response.

The application can pass the request object to functions or middleware. Rapira does not fill the superglobals in this mode.
An application that reads superglobals needs Worker mode. Alternatively, an adapter can copy request data to the required variables.
The `pool.mode` key or `--mode` flag selects the mode.

The script controls the number of active work units. A sequential loop handles one unit at a time. It calls `receive()`, answers the request, and calls `receive()` again.

A concurrent script starts a [Fiber](https://www.php.net/manual/en/language.fibers.php) for each request. It calls `tryReceive()` while fibers are active.
When no fiber is active, the loop waits in `receive()`. This design keeps several requests active in one interpreter.

Concurrency is cooperative. Another request progresses only after the active code suspends its fiber. Process one unit at a time when a library does not support fibers.

::: info
Dispatcher is the default `pool.mode`. A dedicated guide is not available yet.
The [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) IDE stub documents the `Dispatcher` and `Work` interfaces.
The [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_http.stub.php) stub documents the HTTP types.
The [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) directory contains `dispatcher-sync.php` and `dispatcher-async.php`.
:::

## Reading the mode at runtime

`Rapira\get_mode()` returns the process mode as a `Rapira\Mode` enum case. The cases are `Classic`, `Worker`, and `Dispatcher`.
The case matches the initial `pool.mode` for the complete process lifetime. Use `===` to compare enum cases.
The function takes no arguments and does not throw. An entry script can use it to support more than one mode.

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
mode = "classic"                      # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
```

```sh
rapira serve --mode classic public/index.php
```

Rapira makes all three modes available to each application. Application code and dependencies can restrict the selection.
Use Classic when global state cannot remain between requests. Code that reads superglobals cannot use Dispatcher without an adapter.
Some framework integrations provide Worker mode support. See [Frameworks](/docs/frameworks/) for documented integrations.

The mode applies to a complete server instance, not to individual routes. One instance cannot use different modes for different routes.
Run incompatible routes in a separate Classic mode instance.

Worker and Dispatcher require a persistent entry script. Classic does not.
To select Classic, set `mode = "classic"` or pass `--mode classic`. Then specify the ordinary entry script.
The server, binary, and [process model](/docs/process-model) do not change.
See [Configuration](/docs/configuration) and the [CLI reference](/docs/cli) for more information.

::: tip
Start with Classic when you replace php-fpm. Verify that the application operates correctly. Select Worker after you confirm that the application initializes correctly and does not keep request state.
:::
