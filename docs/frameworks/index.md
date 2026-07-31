---
title: Framework integration
description: What changes when a Symfony, Laravel or Yii3 application runs on Rapira — the worker loop, what stays fresh between requests, what survives, and the traps a resident PHP process brings with it.
---

# Framework integration

Running a framework application on Rapira is not a port. In classic mode it is not even a change: you point the server at the front controller you already have and it runs. The interesting case is the worker, where the PHP process stays alive between requests — and that is where a framework starts to have opinions. This page is the shared half of the story: the mechanics that are the same for every framework. The three per-framework guides assume you have read it and only cover what is specific to them.

::: info Verified with

- **PHP 8.5.8**, NTS, embed SAPI
- **Rapira 0.6.0**
- **Symfony 7.4.15** and **8.1.2**, **Laravel 13.23.0**, **Yii3** app template 1.4 (yii-runner-http 3.2.1)

Everything on this page was observed by running those applications on Linux, with a single worker process. Where a claim is uncomfortable, it is here because it was measured, not because it sounded right.
:::

## What running a framework on Rapira means

**In classic mode, nothing changes.** Your front controller is the entry script, Rapira executes it from scratch for every request, and every framework that runs under php-fpm runs here — including the ones whose state could never survive a second request. If that is where you are starting, [classic mode](/docs/classic) is the page you need; from here on only the last three sections — no static files, TLS, and OPcache — still concern you.

**On the SAPI Worker rung, the process stays alive.** Your script boots the application once and then loops, asking Rapira for the next request. The framework is no longer torn down between requests, which is the entire benefit and the entire risk in one sentence — and the rest of this page is about what it implies. [Execution modes](/docs/execution-modes) places this rung on the ladder; [worker mode](/docs/worker) is the API reference for it.

## The loop, line by line

Every worker script has the same shape, whichever framework sits inside it:

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

Read from the top:

- **`require .../vendor/autoload.php`** — the autoloader is registered once for the life of the worker, and every class it resolves stays loaded afterwards. This alone is most of what you buy.
- **`create_plugin_handler(new HttpHandlerConfig())`** — asks Rapira for a handler; the *class* of the config object is what picks the plugin. In classic mode it throws, because there is no resident loop to hand a handler to.
- **`$app = new App();`** — your boot, paid once at startup. This line is where the three framework guides differ from each other and from nothing else: a resident kernel goes here, a per-request application does not.
- **`$handler = static function () use ($app): void`** — the handler takes no arguments. The request is in the superglobals; anything else it needs, it captures with `use`.
- **`header()`, `http_response_code()`, `echo`** — you write the response exactly as a classic script does. See [HTTP](/docs/http) for how that becomes bytes on the wire.
- **`while ($http->handleRequest($handler))`** — `handleRequest()` blocks until a request arrives, fills the superglobals for it, runs your handler, closes the request, and returns `true`. It returns `false` when the server is shutting down, which is how the loop ends.
- **`gc_collect_cycles();`** — the loop body runs *between* requests. That is the place for work you want to happen at a predictable moment rather than in the middle of serving someone. It is hygiene for ordinary cycles, not a memory fix — see [Memory and recycling](#memory-and-recycling).

One thing worth knowing before you write the file: your entry script is `worker.php`, so `SCRIPT_NAME` is `/worker.php` and `DOCUMENT_ROOT` is the directory it sits in, while `REQUEST_URI` carries the path the client actually asked for. All three frameworks routed and generated URLs correctly on top of that, with no `$_SERVER` patching of any kind.

## What is fresh, what survives

This is the table to keep in your head. Left column: Rapira rebuilds it for every request, so ordinary PHP code that reads it keeps working. Right column: it is yours to manage now.

| Fresh for every request | Survives every request |
| ----------------------- | ---------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` — refilled with this request's data | The Composer autoloader, and every class already loaded through it |
| `php://input` — this request's raw body, with `CONTENT_TYPE` and `CONTENT_LENGTH` beside it | `static` properties and variables, which keep counting across requests |
| `$_FILES`, and the uploaded temp files behind it | Objects created before the loop — the container, the kernel, your application |
| Session wiring: `session_start()`, the cookie in, the `Set-Cookie` out | Open resources: database handles, cache clients, streams |
| Response state: status code, headers, `setcookie()`, the output buffers | The process itself — same pid, one resident PHP interpreter per worker |
| Shutdown functions registered **inside** the handler | The worker's own counters: `handled` and `errors` keep climbing |
| The `max_execution_time` clock, re-armed for each request | |

The `max_execution_time` row has a detail worth spelling out. On Linux (and FreeBSD), where Zend's per-request timer exists, the clock is re-armed for each request and the time a worker spends parked waiting for the next one is never counted against it — only the request itself is on the clock. Elsewhere, macOS included, no per-request timeout is armed at all.

Three things behave in ways that surprise people. All three are verified, all three bite at bootstrap time, and all three are properties of resident PHP rather than of Rapira.

::: warning A resident object's destructor fires at the end of the first request

Give an object created *outside* the loop a userland `__destruct` and it runs — once, at the end of the **first** request, when PHP walks the object store at request shutdown. The object itself is fine afterwards: still an object, methods still callable, and the destructor never fires again, not on later requests and not at worker shutdown.

So a class that closes a handle, flushes a buffer or writes a "goodbye" log line from its destructor does it once, early, behind your back — and then never does it again for the rest of the process's life. Keep teardown out of destructors on anything you hold resident.
:::

::: warning `register_shutdown_function()` at bootstrap fires once, then never again

Called outside the handler, the callback runs at the end of the first request and is then freed. The second request does not run it, and neither does the thousandth. Registered *inside* the handler it behaves exactly as it does under php-fpm: it runs at the end of that request, every request.

If your bootstrap installs a shutdown handler — to flush metrics, to catch a fatal, to close something — register it inside the handler instead, on each turn of the loop.
:::

::: warning `$_ENV` is silently re-imported mid-request

With stock ini settings (`variables_order = "GPCS"`, `auto_globals_jit = On`), PHP re-arms the JIT flag for `$_ENV` on every request. The first file compiled during that request that mentions `$_ENV` makes PHP rebuild the superglobal — and with no `E` in `variables_order` there is nothing to import, so `$_ENV` comes back **empty** and everything a Dotenv-style bootstrap wrote into it at worker start disappears mid-request, with no warning and no error.

What makes it nasty is that it depends on *when* a file is compiled. Config that a framework resolves eagerly during boot is already cached and looks perfectly healthy; anything resolved lazily, on the first request, reads an `$_ENV` that was emptied a moment earlier. The same application can be green in one environment and 500 on every request in another for exactly this reason.

Two ways out. The first is verified: have the bootstrap write the values into the real environment as well — `putenv()` survives the re-import, and a framework that falls back to `getenv()` then finds them. The second is the better answer in production anyway: set real environment variables in your unit file or container and stop parsing a `.env` at runtime. Neither puts anything back into `$_ENV` — under `GPCS` it stays empty however the environment is populated, and `getenv()` is what sees the values. The [Symfony guide](/docs/frameworks/symfony) walks through the concrete failure and the one-line fix.

This is not a Rapira quirk. Any PHP runtime that keeps the process alive across requests hits it.
:::

## When something goes wrong

Three failure shapes, all watched against a single worker with its pid tracked:

- **`exit` or `die` inside the handler** — the response is flushed to the client, status and body-so-far included, and the worker keeps serving. Frameworks do this more than you would expect (Laravel's maintenance-mode check ends in an `exit`), so it matters that it is not fatal to the process.
- **An uncaught exception** — a `500`. In practice your framework's error handler catches it first and renders its own error page; if nothing does, Rapira answers `500` with an empty body. Either way the worker keeps serving.
- **An uncaught `Error`** — calling a function that does not exist, for instance. PHP logs it as `Uncaught Error`; it takes the same path as any other uncaught throwable — a `500`, and the worker keeps serving on the same pid.

The worker's `errors` counter goes up for the two error shapes; the `exit` request is an ordinary `200` and only moves `handled`. In all three, `recycles` and `restarts` stay at zero: an uncaught throwable does not take the worker down and does not touch the next request. That is worth knowing before you go reading an error log in a panic. A bailout-class fatal is the one shape that does more — it unwinds the resident script, so the worker re-runs it from the top and boots your application again, which is what `recycles` counts. `getInfo()` on the [worker mode](/docs/worker) page is how you read those counters from PHP.

## Rapira serves nothing from disk

There is no document root lookup and no "serve the file if it exists" rule. Whatever the URL is, your entry script runs and `$_SERVER['REQUEST_URI']` tells the application where the client wanted to go — the same arrangement as an nginx rule that rewrites everything onto `index.php`, minus the rule, and identical in classic and worker mode.

Which means your assets need something in front: a CDN, or the reverse proxy that [running in production](/docs/deployment) sets up. Bundled JS and CSS, images, the favicon — every one of those is a PHP request otherwise.

## TLS and proxies

Rapira's listener speaks plain HTTP and there is no TLS section in the config. Terminate TLS at the proxy you already run and let it reach Rapira over loopback or a Unix socket; the proxy's one obligation on the way in is to spell forwarded fields with `-` and never `_`, because both spellings fold onto the same `$_SERVER` key. [HTTP](/docs/http) explains that mapping, [running in production](/docs/deployment) has the proxy recipe.

## Memory and recycling

If your worker rebuilds the application inside the handler — what Laravel needs today, and the simpler of the two Yii3 shapes — every request leaves a discarded object graph behind. PHP does not reclaim those one at a time. They are held together by reference cycles, so the heap climbs request after request until the cycle collector runs and takes a large batch at once: a sawtooth, not a leak, but a sawtooth whose peak is a good deal higher than any single request's footprint.

Calling `gc_collect_cycles()` yourself does not flatten it — verified, in the loop and inside the handler both. The old graphs stay strongly referenced until a later bootstrap releases them, so the collector genuinely has nothing to take yet. Two things follow. Give `memory_limit` real headroom, because what has to fit is the peak and not the average. And set a recycle budget:

```toml
[pool]
max_requests = 100
```

A worker retires after that many requests (plus a little jitter, so the pool does not rotate in lockstep) and the master forks a replacement that starts from a fresh heap. Verified across hundreds of sequential requests through several recycles: workers rotate, memory resets each cycle, and not one request was dropped or answered with anything but a `200`. It is the deterministic backstop under a pattern whose memory profile otherwise belongs to the collector.

The resident shapes — Symfony's kernel, Yii3's container behind `StateResetter` — are flat by comparison: memory stayed level over the same runs. Recycling is still worth having as a net. [Configuration](/docs/configuration) has the key, [process model](/docs/process-model) has what recycling does to the pool.

## OPcache and changed code

Rapira starts PHP exactly once, in the master, before it forks a single worker — so OPcache creates its shared memory segment one time and every worker inherits the same mapping. Compiled scripts stay hot across requests *and* across the whole pool, in both modes. A worker that re-includes your framework's files is not re-parsing them.

In production, `opcache.validate_timestamps = 0` drops the per-file stat on every request. The cost is that nothing invalidates the cache any more: the segment belongs to the master and outlives every worker generation, so a rolling reload will keep serving the old opcodes and a deploy needs a full restart instead. [Running in production](/docs/deployment) covers the sequence.

While developing, expect the same outcome for a different reason. A resident bootstrap never re-reads the code it loaded at startup, whatever OPcache is doing — edit a service the container already built, or the worker script itself, and the running process will not notice. Restart after every edit and you never have to think about which of the two reasons applies: `rapira serve` runs in the foreground and never daemonizes, so it is Ctrl-C and run it again.

## Pick your framework

- **[Symfony](/docs/frameworks/symfony)** — the kernel boots once and stays resident, and the framework's own `services_resetter` puts stateful services back the way it found them between requests. One worker file covers 7.4 and 8.1, byte for byte.
- **[Laravel](/docs/frameworks/laravel)** — a fresh application per request, because that is the honest answer today: Octane is Laravel's own resident-app story and Rapira has no Octane driver. You keep the warm autoloader and hot OPcache; you do not keep the container.
- **[Yii3](/docs/frameworks/yii3)** — a resident container reset per request through `StateResetter`, which is Yii3's own design for long-running processes (its RoadRunner runner has the same shape), or a simpler fresh runner per request if you would rather start there.

::: question My framework isn't one of these three. Can I still run it?
Probably. The worker script is a dozen lines and the only real question is whether your application tolerates being asked to handle a second request. Start by rebuilding it inside the handler — that is Laravel's shape and it asks nothing of the framework — then hoist things out of the handler as you learn what is safe to keep. If it tolerates neither, [classic mode](/docs/classic) runs it unchanged.
:::

::: question Does the entry script being `worker.php` break URL generation?
It didn't for any of the three. `SCRIPT_NAME` is `/worker.php` while `REQUEST_URI` carries the real path, and Symfony, Laravel and Yii3 all routed correctly and generated clean URLs with no `worker.php` in them — no `$_SERVER` overrides needed anywhere. If your own framework builds URLs out of `SCRIPT_NAME`, that is the thing to check first.
:::

::: question Is a per-request boot actually better than classic mode?
Yes, though less dramatically than a resident application. The autoloader and every class already loaded stay in memory instead of being rebuilt from nothing each time, and you own the loop — so you can move work out of the handler piece by piece as you find out what survives. What you don't get is the big prize: a container that is already built when the request arrives.
:::

::: question Can one codebase run in both modes?
Yes, and it is the sane way to migrate: leave `public/index.php` exactly as it is and add a `worker.php` next to it. All three verified applications have both files. Which one runs is a flag — `rapira serve --classic public/index.php` or `rapira serve worker.php` — so classic stays available as a rollback while you get comfortable with the worker.
:::
