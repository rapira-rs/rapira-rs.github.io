---
title: Worker mode
description: "A Rapira worker loop, the handle_request() contract, persistent state, and common errors."
faqLevel: 2
---

# Worker mode

Worker mode keeps the PHP process active between requests. The script initializes the application once and then waits for requests in a loop. Application state stays in memory, so the worker script must manage it.

In [Classic mode](/docs/classic), the entry script runs in a new PHP request each time, and Rapira removes application state after the response. This state includes the autoloader, container, configuration, routes, and database connections.

Worker mode does not require a specific framework. It requires an application that can process many requests after one initialization. See [Execution modes](/docs/execution-modes) to select a mode. See [Frameworks](/docs/frameworks/) for framework guides.

## The persistent loop

A worker script has three parts. The first part initializes the application. The second part defines a handler for one request. The third part calls `\Rapira\handle_request()` in a loop until the worker stops.

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

Dispatcher is the default mode. Select Worker mode with `mode = "worker"` in the `[http.pool]` table of a `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/worker.php"
mode = "worker"
```

```bash
rapira serve rapira.toml
```

See [Configuration](/docs/configuration) for the other keys.

## The `handle_request()` contract

`\Rapira\handle_request(callable $handler): bool` has this contract:

- **It waits** until a request arrives for this worker. The worker uses no CPU while it waits.
- **It fills request data** in `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE`, `$_FILES`, and `$_REQUEST` before the handler runs. Code reads these superglobals as it does under php-fpm.
- **It calls the handler without arguments.** Use the signature `function (): void`. Capture dependencies, such as the container or logger, with `use`. Rapira ignores the return value.
- **Handler output is the response.** The handler can use `echo`, `print`, `header()`, `http_response_code()`, and `setcookie()`. See [HTTP](/docs/http) for request and response processing.
- **It returns `true`** after each request. It returns `false` when the worker starts to shut down. End the loop and the script when it returns `false`.
- **Call it only from the top-level loop of the script.** A call from inside the handler throws an `\Error`. Do not call it from a shutdown function or a destructor.

A request in Worker mode is one iteration of the `while` loop. Before each handler call, Rapira refills the superglobals. After the call, Rapira runs the request shutdown functions, flushes the output buffers, and closes the session. Values that the script holds outside the handler stay in memory.

Before the first `handle_request()` call, `$_SERVER` contains the process environment and the entry script path, as under the PHP CLI. See [Execution modes](/docs/execution-modes) for the complete list.

## One loop per worker

A worker script runs one loop with one handler. In the example below, the second loop runs only after the first loop ends, and the first loop ends only at shutdown. Use one handler that routes all requests.

```php
while (\Rapira\handle_request($api)) {
}

// Code reaches this loop only during shutdown.
while (\Rapira\handle_request($web)) {
}
```

## State that remains between requests

Objects created **outside** the handler remain until the worker cycle ends. Examples include the autoloader, container, routes, configuration, open connections, and cached data. Rapira does not create this state for each request.

Values created **inside** the handler belong to one request. PHP frees them after the handler returns and code removes their last references.

The worker script defines the state lifetime. Put application state before the loop. Put request state in the handler or reset it before the next request.

::: warning
Global state also remains between requests. Examples include static properties, singletons, registries, and `ini_set()` changes. php-fpm discards these values at the end of each request. A Rapira worker keeps them.

Use [Classic mode](/docs/classic) if the application cannot reset global state. Classic mode is a compatible php-fpm replacement. Select Worker mode after you correct the global state.
:::

## Shutdown functions

A worker cycle is one run of the worker script, from initialization to the end of the script. PHP runs each shutdown function that initialization code registers once, at the end of the cycle. PHP runs each shutdown function that the handler registers once, at the end of that request.

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

Objects use a different rule. Rapira does not run all destructors at the end of a request. PHP destroys an object after code removes its last reference. Thus, PHP destroys a handler object when the handler returns. A global object created during initialization remains between requests. Its `__destruct()` method runs once when the cycle ends.

::: question Why does an initialization shutdown function not run after the first request?
PHP stores shutdown functions in request state. Request shutdown calls the functions and then releases the list. At the first `handle_request()` call, Rapira removes and stores the initialization registrations, so each request has only its own registrations. At the end of the cycle, Rapira restores the stored list and adds the registrations from after the loop.
:::

## Worker mode only

`handle_request()` needs the resident loop that only Worker mode has. In Classic mode and in Dispatcher mode, it throws `Rapira\Exception\NotInWorkerModeError`. All Rapira exception classes implement the marker interface `Rapira\Exception\RapiraThrowable`. Some usage errors are plain `\Error` or `\ValueError`, and a `catch` for `RapiraThrowable` does not catch them. An example is a `handle_request()` call inside its handler.

`Rapira\get_mode()` returns the [mode](/docs/execution-modes) of the current process as a `Rapira\Mode` case. A script that runs in more than one mode reads it before it enters the loop:

```php
if (\Rapira\get_mode() === \Rapira\Mode::Worker) {
    while (\Rapira\handle_request($handler)) {
    }
}
```

## Common problems

**Request state remains between requests.** If an application fails only in Worker mode, look for request state that remains. Examples include a static array that grows, a request object in a singleton, or old user data in a logger.

Reset this state at the start or end of the handler. Also reset request state in libraries. `http.pool.max_requests` replaces a worker after it serves more than this number of requests. This limits the effect of a memory leak, but it does not correct it.

**Uncollected reference cycles.** PHP reference counting releases most values at once. It releases reference cycles only when the cycle collector runs. The example calls `gc_collect_cycles()` between requests. This call is optional, but it makes the collection time predictable.

**Requests that do not finish.** A worker cannot handle another request while its current request runs. `http.pool.request_terminate_timeout_secs` limits the elapsed time of one request. When a request exceeds the limit, Rapira stops the worker and starts a new one. See [Configuration](/docs/configuration) for this key and `http.pool.max_requests`. See [Process model](/docs/process-model) for the stop sequence.

**Initialization fails.** The worker script must call `handle_request()` and receive a request. An uncaught exception during initialization can end the script before that. Rapira counts this as a failed boot. The worker then waits up to 5 seconds for a request, answers it with `503`, and runs the script again.

After five failed boots in sequence, Rapira logs `worker keeps failing to boot; flagged unhealthy`, and the worker exits. The master starts a new worker after a delay. At server start, if no worker of the pool has booted or served a request, the server stops with [exit code](/docs/cli#exit-codes) 70 instead. See [Process model](/docs/process-model) for worker supervision.

**An uncaught exception affects one request, not the worker.** If the handler throws an exception, Rapira first calls the callback that `set_exception_handler()` registered. If no callback handles the exception, Rapira returns `500`, unless the handler already sent the response head. In both cases, the loop continues. A call to `exit()` or `die()` in the handler ends only the current request, and Rapira sends the output as the response. A fatal error ends the worker script, and Rapira runs the script again with a new initialization.

**Work after the response.** `rapira_finish_request()` sends the response before the handler ends. The handler can then do more work, for example write an audit record. See [HTTP](/docs/http) for more information.

## The IDE stubs

Rapira declares its PHP functions and classes in stub files under `crates/sapi` and `crates/plugins`. The worker API is in [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php). The shared exception classes are in [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira_exception.stub.php). These files declare the signatures, property types, and class purposes. Add them to the project to enable IDE completion for `\Rapira\handle_request()`, `\Rapira\get_mode()`, and the other APIs.
