---
title: Worker mode
description: "How to write a Rapira worker script: the resident loop, the handle_request() contract, what survives between requests, and the common pitfalls."
faqLevel: 2
---

# Worker mode

Worker mode keeps the PHP process alive across requests. The script boots the application once and then waits for requests in a loop. Each request starts with a warm application in memory. State also outlives a request, so the worker script must manage it.

In [Classic mode](/docs/classic), the entry script runs from scratch for every request. The server discards everything that the script built after it answers the request. This includes the autoloader, container, configuration, routes, and database connections.

This page is the programming guide for Worker mode. Worker mode does not require a specific framework. It requires an application that can handle many requests after one boot. Most current frameworks support this process. See [Execution modes](/docs/execution-modes) for the three modes and their application requirements. See [Frameworks](/docs/frameworks/) for framework-specific guides.

## The resident loop

A worker script has three parts. The first part boots the application. The second part is a handler that answers one request. The third part is a loop that runs the handler until the worker drains. Write the loop in PHP around the `\Rapira\handle_request()` function.

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // booted once, reused for every request

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Dispatcher is the default mode. There are two ways to select Worker mode, and they do the same thing:

- `--mode worker` on the command line, next to the entry script.
- `mode = "worker"` in the `[pool]` section of a `rapira.toml`.

```bash
rapira serve --mode worker app/worker.php
```

See [CLI](/docs/cli) for the rest of the flags, and [Configuration](/docs/configuration) for the `rapira.toml` equivalents.

## The `handle_request()` contract

`\Rapira\handle_request(callable $handler): bool` is the whole contract:

- **It blocks** until a request arrives for this worker. A waiting worker uses no CPU. It keeps its interpreter and the booted application in memory.
- **It fills the superglobals** (`$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` and others) before the handler runs. Ordinary PHP code can read them as it does under php-fpm.
- **It calls your handler with zero arguments.** The request data is in the superglobals. The callable's signature is `function (): void`. Capture other dependencies, such as the container or logger, with `use`.
- **Your output is the response.** `echo`, `print`, `header()`, `http_response_code()`, `setcookie()`: the handler produces a response the same way a classic script does. See [HTTP](/docs/http) for how request data and response output are wired up.
- **It returns `true`** once the request is finished, which means the loop continues. It returns **`false`** when the worker is draining. That is the loop condition: when it goes false, fall out of the loop and let the script end.
- **It belongs at the boot script's top level.** Call it from the script's own loop and from nowhere else: a call from a shutdown function or from a destructor is undefined.

A request in Worker mode is one iteration of the `while` loop. Rapira completes request shutdown around the handler. It runs request shutdown functions, flushes output buffers, closes the session, and refills the superglobals. Values that the script holds outside the handler stay in memory. Rapira does not run a destructor pass at the end of a request. An object is destroyed when its last reference is removed.

## Single handler per worker

`handle_request()` returns after every request. The worker script must provide the loop that keeps the worker alive.

A worker script drives one handler at a time. If you write two consecutive loops, the second loop cannot run until the first loop exits. The first loop exits when `handle_request()` returns `false`, which means that the worker is draining. Route requests inside one handler instead of using multiple loops.

```php
while (\Rapira\handle_request($api)) {
}

// unreachable until shutdown
while (\Rapira\handle_request($web)) {
}
```

## What survives between requests

Everything you create **outside** the handler stays alive for the life of the worker process: the autoloader, the DI container, compiled routes, config, open database and cache connections, warm caches. None of it is rebuilt per request.

Values created **inside** the handler belong to one request. PHP frees them after the handler returns and their last references are removed.

Where the boundary between those two falls is a design decision for the worker script: state that is meant to be shared goes above the loop, and state that belongs to one request stays in the handler or gets reset before the next one.

::: warning
Global state is also shared, whether or not you intended it. Examples include static properties, singletons, lazily populated registries, and persistent `ini_set()` changes. PHP request shutdown resets these values under php-fpm. A Rapira worker skips this reset between requests, so the values persist. Use [Classic mode](/docs/classic) if the application cannot reset global state. Classic mode does not keep a warm application in memory. However, it remains a drop-in replacement for php-fpm. You can move to Worker mode after you resolve the shared state.
:::

## Shutdown functions

A shutdown function registered at boot runs once when the worker cycle ends. It does not run at the end of each request. A shutdown function registered by the handler runs once at the end of that request.

Register the cleanup of process-wide resources at boot, and the cleanup of one request's own resources inside the handler.

```php
register_shutdown_function(static function (): void {
    // runs once, when the worker's cycle ends
});

$handler = static function (): void {
    register_shutdown_function(static function (): void {
        // runs at the end of this request
    });
};

while (\Rapira\handle_request($handler)) {
}
```

At the end of the cycle the boot registrations run first, in registration order. A function that the script registers after the loop runs after them.

Objects follow a different rule. Rapira does not run a destructor pass at the end of a request. PHP destroys an object when its last reference is removed. A handler-local object is therefore destroyed when the handler returns. A boot-level global stays in memory across requests. Its `__destruct()` method runs once when the cycle ends.

::: question Why does a shutdown function registered at boot not run at the end of the first request?
PHP stores shutdown functions in per-request state. Request shutdown calls the functions and then frees the list. At the first `handle_request()` call, Rapira removes and stores the boot registrations. Each request then has only its own registrations. At the end of the cycle, Rapira restores the boot list and appends registrations from after the loop. The final shutdown runs the boot entries first, in registration order, and then runs the later entries.
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

## Pitfalls

**State leaking between requests.** An application that misbehaves in a worker but not under php-fpm is usually leaking state between requests. A static array that grows, a request object cached in a singleton, a logger holding on to the last user's context — each one is a bug that only shows up on the second request. Clean up explicitly at the top or bottom of your handler, and reset anything a library leaves behind. `pool.max_requests` makes a worker exit after N requests so the master can replace it with a fresh process, which bounds the damage of a slow leak without fixing it.

**Uncollected reference cycles.** PHP's reference-counting frees most things immediately, but cycles are only collected when the cycle collector runs. Calling `gc_collect_cycles()` once per loop turn — as the script above does — is not required, but it collects them at a predictable point, between requests instead of in the middle of one.

**Requests that never finish.** A worker stuck in a hung request stays there indefinitely and handles nothing else in the meantime. `pool.request_terminate_timeout_secs` puts a wall-clock limit on a single request and kills the worker that exceeds it. See [Configuration](/docs/configuration) for this key and `pool.max_requests`, and [Process model](/docs/process-model) for what the master does when a worker dies.

**An uncaught exception is per-request, not per-worker.** An uncaught handler exception produces a `500` unless the handler already sent the response head. The loop continues, so the exception does not stop the worker. A fatal error unwinds the resident script. The worker then runs the script from the top and boots the application again.

**Work after the response.** If you want to send the response and then keep working — flush a queue, write an audit record — `rapira_finish_request()` does exactly that. It is documented on the [HTTP](/docs/http) page.

## The IDE stubs

Rapira declares its PHP functions and classes in stub files under `crates/php_sys`. The worker API is in [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php). The exception classes are in [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_exception.stub.php). These files are the authoritative declarations for signatures, property types, and class purposes. They also act as IDE stubs. Add them to the project to enable completion for `\Rapira\handle_request()`, `\Rapira\get_mode()`, and the other APIs.
