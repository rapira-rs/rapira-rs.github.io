---
title: Execution modes
description: "Classic, Worker, and Dispatcher behavior, selection, and runtime identification."
faqLevel: 2
---

# Execution modes

The HTTP pool runs PHP in one of three execution modes. The [gRPC pool](./grpc) uses Dispatcher mode.

| Mode | Description |
| --- | --- |
| [Classic](/docs/classic) | The entry script runs in a new PHP request each time, as under php-fpm. |
| [Worker](/docs/worker) | A persistent script handles requests in a loop. Rapira refills the superglobals for each request. |
| [Dispatcher](/docs/dispatcher) | The worker gets each request through an API call and uses a request object instead of the superglobals. |

The mode names are `http.pool.mode` values and `Rapira\Mode` enum cases. Classic removes application request state after each request. Worker and Dispatcher keep one initialized application for many requests. Application state and API dependencies determine which modes an application can use.

## Classic

The entry script runs in a new PHP request each time, as it does under php-fpm. Rapira fills the superglobals, runs the script, sends the response, and then removes the request state. Persistent connections and extension state remain, because they exist in the worker process.

An existing application can run without code changes when Rapira replaces php-fpm. Rapira embeds PHP in the server process and does not use FastCGI.

See [Classic mode](/docs/classic) for more information.

## Worker

Worker mode uses the same request and response interfaces as Classic. The application reads superglobals and can use `echo` for the response. The worker script initializes the application once and then enters a loop. For each request, Rapira refills the superglobals and runs the handler. Objects that the script creates outside the loop remain available.

Initialization runs once for each worker, not once for each request. This can decrease the request time. However, static properties, singletons, and global state remain for the next request. Set [`http.pool.max_requests`](/docs/configuration) to replace a worker after a number of requests. This limits the effect of a memory leak.

See [Worker mode](/docs/worker) for the worker script and its loop. See [HTTP](/docs/http) for how Rapira handles requests and responses.

## Dispatcher

In Dispatcher mode, the worker script gets each work unit through an API call. `Rapira\get_dispatcher()` returns the dispatcher of the pool, and its `receive()` method waits for the next unit. With the HTTP plugin, each unit is a `Rapira\Http\Exchange`. The exchange gives a `Rapira\Http\Request` object and has methods that write the response. With the gRPC plugin, each unit is a `Rapira\Grpc\UnaryCall`.

The application can pass the request object to functions or middleware. Rapira does not fill the superglobals in this mode. An application that reads superglobals needs Worker mode, or an adapter that copies request data to these variables. `echo` and other PHP output do not go to the client. Rapira writes this output to the log on the `php` target at the `info` level.

Each worker handles one work unit at a time. Finalize the current unit before you call `receive()` again. To handle more requests at the same time, increase `http.pool.processes`.

See [Dispatcher mode](/docs/dispatcher) for the loop, the request and response API, and the exceptions. See [gRPC](/docs/grpc) for the gRPC call API.

## `$_SERVER` before the first request

In Worker and Dispatcher modes, the entry script starts before the first request. At that time, Rapira fills `$_SERVER` as the PHP CLI does for `php entrypoint.php`.

| Key | Value |
| --- | --- |
| Each process environment variable | The value from the environment |
| `PHP_SELF`, `SCRIPT_NAME`, `SCRIPT_FILENAME`, `PATH_TRANSLATED` | The absolute path of the entry script |
| `DOCUMENT_ROOT` | An empty string |
| `REQUEST_TIME`, `REQUEST_TIME_FLOAT` | The start time of the entry script |
| `argv` | A list that contains the absolute path of the entry script |
| `argc` | `1` |

`$_SERVER` gets the environment variables when `variables_order` contains `S`. `$_ENV` gets them only when `variables_order` contains `E`. The production value `GPCS` does not contain `E`. The entry script path replaces an environment variable with the same name, such as `SCRIPT_FILENAME`. The `$argv` and `$argc` globals contain the same values as `$_SERVER`.

In Dispatcher mode, `$_SERVER` keeps these values until the entry script starts again. Request data is in the request object. In Worker mode, Rapira refills `$_SERVER` with request data for each request. The request values do not contain the environment variables, and `SCRIPT_NAME` contains the entry script name with a leading slash.

## Reading the mode at runtime

`Rapira\get_mode()` returns the process mode as a `Rapira\Mode` enum case. The cases are `Classic`, `Worker`, and `Dispatcher`. The case is the mode of the worker's pool, and it does not change while the process runs. The function takes no arguments and does not throw. An entry script can use it to support more than one mode.

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
Rapira reads the mode of the pool before it starts the interpreter. Every request in that worker reports the same case. A reload does not read `rapira.toml` again. To change the mode, restart Rapira.
:::

## Mode selection

The `mode` key of the pool table selects the mode. The default is `dispatcher`. Set the mode explicitly in `rapira.toml`.

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"                      # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
```

```sh
rapira serve rapira.toml
```

The HTTP pool supports all three modes. The gRPC pool supports only `dispatcher`. Another `grpc.pool.mode` value stops Rapira at startup with an error.

In Worker and Dispatcher modes, the entry script must take requests in a loop. If the script ends before it takes a request, the boot fails. An ordinary php-fpm entry script fails in this way under the default mode. See [Process model](/docs/process-model) for what Rapira does after a failed boot.

Application code and dependencies can restrict the selection. Use Classic when global state cannot remain between requests. Code that reads superglobals cannot use Dispatcher without an adapter. Some framework integrations support Worker mode. See [Frameworks](/docs/frameworks/) for documented integrations.

The mode applies to a complete pool, so all routes in that pool use the same mode. The HTTP and gRPC pools can use different modes in one server. Run incompatible HTTP routes in a separate Rapira instance in Classic mode. See [Configuration](/docs/configuration) and the [CLI reference](/docs/cli) for more information.

::: tip
Start with Classic when you replace php-fpm. Verify that the application operates correctly. Select Worker after you confirm that the application initializes correctly and does not keep request state.
:::
