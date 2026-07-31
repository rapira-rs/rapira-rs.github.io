---
title: Worker mode
description: The programming guide for Rapira's resident worker — boot your application once, then loop over requests with handleRequest(), and know what survives in between.
---

# Worker mode

In [classic mode](/docs/classic) PHP does what it has always done: the entry script runs from scratch, the request is answered, and everything the script built is thrown away. Booting a modern framework — autoloader, container, config, routes, database connections — costs the same on the first request as on the millionth.

Worker mode is the alternative. The process stays alive: your script boots the application once, then sits in a loop asking Rapira for the next request. The boot cost is paid at startup, and every request after that starts with a warm application already in memory. In exchange, you have to think about state — because now it outlives the request.

This is the **SAPI Worker** rung of Rapira's execution ladder, and together with Classic it is what ships today. [Execution modes](/docs/execution-modes) explains the whole ladder and how to tell which rung your app can use; this page is the programming guide for the rung you can use right now.

## The resident loop

A worker script has three parts: whatever you boot at the top, a handler that answers one request, and a loop that runs the handler until the server shuts down. The loop is written in PHP — Rapira hands you a handler object and you drive it.

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

use Rapira\Plugin\Http\HttpHandlerConfig;
use function Rapira\create_plugin_handler;

$http = create_plugin_handler(new HttpHandlerConfig());
$app = new App(); // booted once, reused for every request

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Point the server at it and you are done — worker mode is what `rapira serve` does by default, classic is the opt-in:

```bash
rapira serve app/worker.php
```

See [CLI](/docs/cli) for the rest of the flags, and [Configuration](/docs/configuration) for the `rapira.toml` equivalents.

## What `handleRequest()` does

`handleRequest(callable $handler)` is the whole contract:

- **It blocks** until a request arrives for this worker. A worker parked on `handleRequest()` burns no CPU while it waits — it still holds its interpreter and your booted application in memory.
- **It fills the superglobals** — `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` and friends — with that request's data, freshly, before your handler runs. Ordinary PHP code that reads them keeps working exactly as it does under php-fpm.
- **It calls your handler with zero arguments.** Everything about the request is in the superglobals; the callable's signature is `function (): void`. Anything else it needs — the container, the app, a logger — you capture with `use`.
- **Your output is the response.** `echo`, `print`, `header()`, `http_response_code()`, `setcookie()`: the handler produces a response the same way a classic script does. See [HTTP](/docs/http) for how request data and response output are wired up.
- **It returns `true`** once the request is finished — meaning keep looping — and **`false`** when the server is shutting down. That is the loop condition — when it goes false, fall out of the loop and let the script end.

So a request in worker mode is one turn of your `while` loop. Rapira closes the request around your handler — shutdown functions and destructors run, output buffers are flushed and reset, the session is written and closed, and the superglobals are refilled for the next turn — while everything your script holds outside the handler stays exactly where it was.

## One handler, one worker

`handleRequest()` returns after every single request. It is not a "serve forever" call — the loop around it is what keeps the worker alive, and that loop belongs to you.

The consequence catches people out: a worker script drives exactly one handler at a time. If you write two loops one after another, the second is unreachable until the first one exits — and the first one only exits when `handleRequest()` returns `false`, which means the server is already shutting down. Routing to different code paths is something your single handler does internally, not something you express with several loops.

```php
while ($http->handleRequest($api)) {
}

// unreachable until shutdown
while ($http->handleRequest($web)) {
}
```

## What survives between requests

Everything you create **outside** the handler stays alive for the life of the worker process: the autoloader, the DI container, compiled routes, config, open database and cache connections, warm caches. That is the entire point of worker mode — it is the cost you stop paying per request.

Everything you create **inside** the handler is ordinary per-request work, freed when the handler returns and the request is torn down.

The boundary between those two is the design decision worker mode asks you to make. State that is meant to be shared goes up top; state that belongs to one request stays in the handler — or gets reset before the next one.

::: warning
Anything global is shared too, whether you meant it or not: static properties, singletons, registries a library populates lazily, an `ini_set()` you never undo. Under php-fpm those were per-request because PHP's request shutdown reset them — statics, globals and `ini_set()` alike. A Rapira worker skips that reset between jobs on purpose, so they are not.
:::

## Picking the plugin

`create_plugin_handler()` takes a config object, and the *class* of that config is what selects the plugin. `HttpHandlerConfig` means this worker serves HTTP, and you get an `HttpHandler` back.

It throws a `Rapira\RapiraException` in two cases: when no plugin matches the config class you passed, and when the script is not running in worker mode at all — classic mode has no resident loop, so a handler there could never do anything but report shutdown.

The config also carries a description of what it targets, in `$http->config->info` — a `Rapira\PluginInfo` with a `name` and a `description` (`http` and `HTTP request handler` for the HTTP plugin):

```php
$http = create_plugin_handler(new HttpHandlerConfig());

echo $http->config->info->name;        // http
echo $http->config->info->description; // HTTP request handler
```

## Watching a worker with `getInfo()`

`$http->getInfo()` returns a `Rapira\Plugin\Http\RuntimeInfo` — this worker's own live counters, read at call time:

| Field      | What it is                                                                     |
| ---------- | ------------------------------------------------------------------------------ |
| `state`    | `starting`, `idle`, `active`, `draining` or `free` — see below                  |
| `pid`      | The process id of this worker                                                   |
| `queued`   | How many requests are waiting in this worker's intake right now                 |
| `handled`  | Requests this worker has finished                                               |
| `errors`   | How many of those ended in an error                                             |
| `recycles` | How many times this worker had to rebuild its state after PHP bailed out        |
| `restarts` | How many times the worker's PHP thread itself had to be rebuilt                 |

The five states describe where a worker sits in its lifecycle: **starting** — the master forked it and it has not reported in yet; **idle** — parked, waiting for a request, and counting as spare capacity; **active** — running a request; **draining** — it has decided to exit (its request quota is up, or it was flagged unhealthy) and no longer counts as spare capacity; **free** — the slot has no worker bound to it.

Note that `queued` is the current depth of the intake, not a running total, and every counter is scoped to this process: they start at zero when the worker starts, so a replacement worker counts from zero again.

A tiny status endpoint is the natural use:

```php
$handler = static function () use ($http): void {
    $info = $http->getInfo();
    header('Content-Type: application/json');
    echo json_encode([
        'pid' => $info->pid,
        'state' => $info->state,
        'queued' => $info->queued,
        'handled' => $info->handled,
        'errors' => $info->errors,
    ]);
};
```

## Pitfalls

**State leaking between requests.** This is the big one, and it is almost always the reason an app misbehaves in a worker but not under php-fpm. A static array that grows, a request object cached in a singleton, a logger holding on to the last user's context — each one is a bug that only shows up on the second request. Clean up explicitly at the top or bottom of your handler, and reset anything a library leaves behind. As a safety net, `pool.max_requests` makes a worker exit after N requests so the master can replace it with a fresh process; it bounds the damage of a slow leak, but it is a net, not a fix.

**Garbage that no request owns.** PHP's reference-counting frees most things immediately, but cycles are only collected when the cycle collector runs. Calling `gc_collect_cycles()` once per loop turn — as the canonical script does — collects them at a predictable point, between requests instead of in the middle of one.

**Requests that never end.** A resident worker will sit inside a hung request indefinitely, and while it does it serves nobody. `pool.request_terminate_timeout_secs` puts a wall-clock limit on a single request and kills the worker that exceeds it. See [Configuration](/docs/configuration) for both keys and [Process model](/docs/process-model) for what the master does when a worker dies.

**An uncaught exception is per-request, not per-worker.** An uncaught exception in your handler is counted in `errors` and answered with a `500`, unless the handler already committed a status before it threw. Either way the loop keeps going: the exception does not take the worker down with it, so the failure you are reading about in the logs did not necessarily stop anything. A fatal error is different: it unwinds the resident script, so the worker re-runs it from the top and boots your application again. That is what the `recycles` counter counts.

**Work after the response.** If you want to send the response and then keep working — flush a queue, write an audit record — `rapira_finish_request()` does exactly that. It is documented on the [HTTP](/docs/http) page.

## The IDE stub

Every class and function Rapira exposes to PHP is declared in [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php). It is the authoritative declaration of the API — signatures, property types, what each class is for — and it doubles as an IDE stub: drop it into your project and your editor will autocomplete `create_plugin_handler()`, `handleRequest()` and the rest instead of flagging them as undefined.

::: question Do I need a special framework to run in worker mode?
No — what you need is an application that survives being booted once and asked to handle many requests. Most modern frameworks can do this, and the [framework guides](/docs/frameworks/) cover the specifics for the ones we have written up.
:::

::: question Is `gc_collect_cycles()` in the loop mandatory?
Not mandatory, but a good default. Without it, reference cycles pile up until PHP's collector decides to run on its own — possibly in the middle of serving someone. Calling it between requests keeps that work at a predictable point.
:::

::: question My app has global state it can't give up. Can I still use Rapira?
Yes: run it in [classic mode](/docs/classic). You lose the warm-boot advantage of a worker, but you keep the drop-in replacement for php-fpm, and you can move to a worker later once the state is untangled.
:::
