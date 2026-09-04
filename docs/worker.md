---
title: Worker mode
description: "A Rapira worker loop, the handle_request() contract, persistent state, and common errors."
faqLevel: 2
---

# Worker mode

Worker mode keeps the PHP process active between requests. The script initializes the application once and then waits for requests in a loop.
Application state also remains in memory, so the worker script must manage it.

In [Classic mode](/docs/classic), the entry script runs in a new PHP request each time. The server removes application state after the response.
This state includes the autoloader, container, configuration, routes, and database connections.

This page is the programming guide for Worker mode. Worker mode does not require a specific framework.
It requires an application that can process many requests after one initialization.
See [Execution modes](/docs/execution-modes) for mode requirements. See [Frameworks](/docs/frameworks/) for framework-specific guides.

## The persistent loop

A worker script has three parts. The first part initializes the application.
The second part defines a handler for one request. The third part runs the handler until the worker stops.
Use `\Rapira\handle_request()` in the PHP loop.

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // The worker creates this object once and reuses it.

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Dispatcher is the default mode. Select Worker mode with one of these settings:

- `--mode worker` on the command line, next to the entry script.
- `mode = "worker"` in the `[pool]` section of a `rapira.toml`.

```bash
rapira serve --mode worker app/worker.php
```

See [CLI](/docs/cli) for the rest of the flags, and [Configuration](/docs/configuration) for the `rapira.toml` equivalents.

## The `handle_request()` contract

`\Rapira\handle_request(callable $handler): bool` has this contract:

- **It waits** until a request arrives for this worker. A waiting worker uses no CPU.
- It retains its interpreter and initialized application in memory.
- **It fills the superglobals** (`$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` and others) before the handler runs. Ordinary PHP code can read them as it does under php-fpm.
- **It calls the handler without arguments.** Request data is in the superglobals. The callable signature is `function (): void`.
- Capture dependencies, such as the container or logger, with `use`.
- **Handler output is the response.** The handler can use `echo`, `print`, `header()`, `http_response_code()`, and `setcookie()`.
- See [HTTP](/docs/http) for request and response processing.
- **It returns `true`** after a request, so the loop continues. It returns **`false`** when the worker starts shutdown.
- End the loop and script when it returns `false`.
- **Call it only from the top-level script loop.** Do not call it from a shutdown function or destructor.

A request in Worker mode is one iteration of the `while` loop. Rapira completes request shutdown around the handler. It runs request shutdown functions, flushes output buffers, closes the session, and refills the superglobals. Values that the script holds outside the handler stay in memory. Rapira does not run a destructor pass at the end of a request. PHP destroys an object after code removes its last reference.

## Single handler per worker

`handle_request()` returns after every request. The worker script must provide the loop that keeps the worker alive.

A worker script drives one handler at a time. If you write two consecutive loops, the second loop cannot run until the first loop exits.
The first loop exits when `handle_request()` returns `false`, which means that the worker is stopping.
Route requests inside one handler instead of using multiple loops.

```php
while (\Rapira\handle_request($api)) {
}

// Code reaches this loop only during shutdown.
while (\Rapira\handle_request($web)) {
}
```

## State that remains between requests

Objects created **outside** the handler remain for the worker lifetime.
Examples include the autoloader, container, routes, configuration, open connections, and cached data. Rapira does not create this state for each request.

Values created **inside** the handler belong to one request. PHP frees them after the handler returns and code removes their last references.

The worker script defines the state lifetime. Put shared state before the loop.
Put request state in the handler or reset it before the next request.

::: warning
Global state also remains between requests. Examples include static properties, singletons, registries, and persistent `ini_set()` changes.
php-fpm resets these values during request shutdown. A Rapira worker does not reset them.
Use [Classic mode](/docs/classic) if the application cannot reset global state. Classic mode is a compatible php-fpm replacement.
Select Worker mode after you correct the shared state.
:::

## Shutdown functions

A shutdown function registered during initialization runs once when the worker cycle ends. It does not run at the end of each request.
A shutdown function registered by the handler runs once at the end of that request.

Register process resource cleanup during initialization. Register request resource cleanup inside the handler.

```php
register_shutdown_function(static function (): void {
    // Runs once when the worker cycle ends.
});

$handler = static function (): void {
    register_shutdown_function(static function (): void {
        // Runs at the end of this request.
    });
};

while (\Rapira\handle_request($handler)) {
}
```

At the end of the cycle, initialization registrations run first in registration order. A function registered after the loop runs after them.

Objects use a different rule. Rapira does not run all destructors at the end of a request.
PHP destroys an object after code removes its last reference. Therefore, PHP destroys a handler object when the handler returns.
A global object created during initialization remains between requests. Its `__destruct()` method runs once when the cycle ends.

::: question Why does an initialization shutdown function not run after the first request?
PHP stores shutdown functions in request state. Request shutdown calls the functions and then releases the list.
At the first `handle_request()` call, Rapira removes and stores the initialization registrations. Each request then has only its own registrations.
At the end of the cycle, Rapira restores the stored list. It then adds registrations from after the loop.
Final shutdown runs the initialization entries first in registration order. It then runs the later entries.
:::

## Worker mode only

`handle_request()` needs the resident loop that only Worker mode has. In Classic mode and in Dispatcher mode it throws a `Rapira\Exception\NotInWorkerModeError`. Every class Rapira throws implements the marker interface `Rapira\Exception\RapiraThrowable`, so one `catch` covers all of them.

`Rapira\get_mode()` returns the [mode](/docs/execution-modes) of the current process as a `Rapira\Mode` case. A script that runs in more than one mode reads it before it enters the loop:

```php
if (\Rapira\get_mode() === \Rapira\Mode::Worker) {
    while (\Rapira\handle_request($handler)) {
    }
}
```

## Common problems

**State retained between requests.** Check for retained request state when an application fails only in Worker mode.
Examples include a growing static array, a request object in a singleton, or old user data in a logger.
Reset this state at the start or end of the handler. Also reset request state in libraries.
`pool.max_requests` replaces a worker after a specified request count. This limits the effect of a memory leak but does not correct it.

**Uncollected reference cycles.** PHP reference counting immediately releases most values. It releases cycles only when the cycle collector runs.
The example calls `gc_collect_cycles()` between requests. This call is optional, but it makes collection time predictable.

**Requests that do not finish.** A worker cannot handle another request while its current request runs.
`pool.request_terminate_timeout_secs` limits the elapsed time of one request. Rapira terminates a worker that exceeds it.
See [Configuration](/docs/configuration) for this key and `pool.max_requests`. See [Process model](/docs/process-model) for worker termination processing.

**An uncaught exception affects one request, not the worker.** An uncaught handler exception usually returns `500`.
Rapira cannot change the status after the handler sends the response head.
The loop continues, so the exception does not stop the worker. A fatal error ends the persistent script.
The worker then starts the script again and initializes the application.

**Work after the response.** `rapira_finish_request()` sends the response before the handler ends. For example, the handler can then write an audit record.
See [HTTP](/docs/http) for more information.

## The IDE stubs

Rapira declares its PHP functions and classes in stub files under `crates/php_sys`. The worker API is in [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php). The exception classes are in [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_exception.stub.php). These files are the authoritative declarations for signatures, property types, and class purposes. They also act as IDE stubs. Add them to the project to enable completion for `\Rapira\handle_request()`, `\Rapira\get_mode()`, and the other APIs.
