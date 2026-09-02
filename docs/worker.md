---
title: Worker mode
description: "How to write a Rapira worker script: the resident loop, the handle_request() contract, what survives between requests, and the common pitfalls."
faqLevel: 2
---

# Worker mode

Worker mode keeps the PHP process alive across requests: your script boots the application once, then sits in a loop asking Rapira for the next request. The boot runs once at startup, and every request after that starts with a warm application already in memory. State also outlives the request, so the worker script has to manage it.

In [classic mode](/docs/classic) the entry script instead runs from scratch on every request and everything it built is discarded when the request is answered, so booting a modern framework — autoloader, container, config, routes, database connections — costs the same on every request.

This page is the programming guide for Worker mode. Worker mode does not require a particular framework, only an application that survives being booted once and then asked to handle many requests, which most modern frameworks do. See [Execution modes](/docs/execution-modes) for the three modes and what decides which one an application can use, and [Frameworks](/docs/frameworks/) for the guides covering specific frameworks.

## The resident loop

A worker script has three parts: whatever you boot at the top, a handler that answers one request, and a loop that runs the handler until the worker drains. The loop is written in PHP, around the free function `\Rapira\handle_request()`.

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

## What `handle_request()` does

`\Rapira\handle_request(callable $handler): bool` is the whole contract:

- **It blocks** until a request arrives for this worker. A worker waiting in `handle_request()` uses no CPU, and it still holds its interpreter and your booted application in memory.
- **It fills the superglobals** (`$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` and friends) with that request's data, freshly, before your handler runs. Ordinary PHP code that reads them keeps working exactly as it does under php-fpm.
- **It calls your handler with zero arguments.** Everything about the request is in the superglobals; the callable's signature is `function (): void`. Anything else it needs (the container, the app, a logger) you capture with `use`.
- **Your output is the response.** `echo`, `print`, `header()`, `http_response_code()`, `setcookie()`: the handler produces a response the same way a classic script does. See [HTTP](/docs/http) for how request data and response output are wired up.
- **It returns `true`** once the request is finished, which means the loop continues. It returns **`false`** when the worker is draining. That is the loop condition: when it goes false, fall out of the loop and let the script end.
- **It belongs at the boot script's top level.** Call it from the script's own loop and from nowhere else: a call from a shutdown function or from a destructor is undefined.

So a request in worker mode is one turn of your `while` loop. Rapira closes the request around your handler: the shutdown functions the request registered run, the output buffers are flushed and reset, the session is written and closed, and the superglobals are refilled for the next turn. Everything your script holds outside the handler stays exactly where it was. Rapira runs no destructor pass at the end of a request. An object is destroyed when the last reference to it goes away.

## Single handler per worker

`handle_request()` returns after every single request rather than serving forever, so the loop around it is what keeps the worker alive and the worker script has to provide that loop.

A worker script therefore drives exactly one handler at a time. If you write two loops one after another, the second is unreachable until the first one exits, and the first one only exits when `handle_request()` returns `false`, which means the worker is already draining. Routing to different code paths is something your single handler does internally, not something you express with several loops.

```php
while (\Rapira\handle_request($api)) {
}

// unreachable until shutdown
while (\Rapira\handle_request($web)) {
}
```

## What survives between requests

Everything you create **outside** the handler stays alive for the life of the worker process: the autoloader, the DI container, compiled routes, config, open database and cache connections, warm caches. None of it is rebuilt per request.

Everything you create **inside** the handler is ordinary per-request work, freed when the handler returns and the last reference to it goes away.

Where the boundary between those two falls is a design decision for the worker script: state that is meant to be shared goes above the loop, and state that belongs to one request stays in the handler or gets reset before the next one.

::: warning
Global state is shared as well, whether or not that was intended: static properties, singletons, registries a library populates lazily, an `ini_set()` that is never undone. Under php-fpm those were per-request because PHP's request shutdown reset them — statics, globals and `ini_set()` alike. A Rapira worker deliberately skips that reset between requests, so they persist. An application whose global state cannot be given up runs in [classic mode](/docs/classic) instead: classic mode gives up the warm application a worker keeps in memory, but it stays a drop-in replacement for php-fpm, and the application can move to a worker later once the state is untangled.
:::

## Shutdown functions

A shutdown function that the script registers at boot, outside the loop, runs once, when the worker's cycle ends (normally, when the worker exits). It does not run at the end of each request. A shutdown function that your handler registers during a request runs at the end of that request, once, and does not run again.

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

Objects follow a different rule. Rapira runs no destructor pass at the end of a request. An object is destroyed when the last reference to it goes away, so an object that only a handler local holds is destroyed when the handler returns. An object that a boot-level global holds stays in memory across requests, and its `__destruct()` runs once, when the cycle ends.

::: question Why does a shutdown function registered at boot not run at the end of the first request?
The list of shutdown functions is per-request state in PHP: the request shutdown pass calls the functions in the list, then frees the list. Rapira takes the boot registrations out of that list at the first `handle_request()` call and holds them, so each request shuts down with a list that holds only its own registrations. At the end of the cycle Rapira puts the boot list back and appends what the script registered after the loop, so the final shutdown pass runs the boot entries in registration order and the later entries after them.
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

**An uncaught exception is per-request, not per-worker.** An uncaught exception in your handler is answered with a `500`, unless the handler already sent the response head before it threw. Either way the loop keeps going, so the exception does not take the worker down with it. A fatal error is different: it unwinds the resident script, so the worker re-runs it from the top and boots your application again.

**Work after the response.** If you want to send the response and then keep working — flush a queue, write an audit record — `rapira_finish_request()` does exactly that. It is documented on the [HTTP](/docs/http) page.

## The IDE stubs

Rapira declares the functions and classes it exposes to PHP in stub files under `crates/php_sys`. The worker surface is in [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php), and the exception classes are in [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_exception.stub.php). They are the authoritative declaration of the API: signatures, property types, and what each class is for. They double as IDE stubs: drop them into your project and your editor will autocomplete `\Rapira\handle_request()`, `\Rapira\get_mode()` and the rest instead of flagging them as undefined.
