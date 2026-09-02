---
title: Framework integration
description: "The mechanics shared by every framework running on Rapira: the worker loop, per-request and resident state, error handling, static files and OPcache."
---

# Framework integration

A framework application runs on Rapira unchanged in Classic mode: you point the server at the entry script you already have. In Worker mode the PHP process stays alive between requests, and what the application can keep resident depends on the framework's own design. This page covers the mechanics shared by every framework. The three framework guides assume you have read this page and cover only framework-specific behavior.

::: info Verified with

- **PHP 8.5.8**, NTS, embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4.15** and **8.1.2**, **Yii3** app template 1.4 (yii-runner-http 3.2.1)

Everything on this page was observed by running those applications on Linux, with a single worker process. The statements below about framework behavior come from those runs. The configuration keys come from Rapira's own [configuration](/docs/configuration) reference.
:::

## Classic and Worker modes

**In Classic mode, nothing changes.** Rapira uses the existing entry script and executes it from scratch for every request. Every framework that runs under php-fpm also runs here. This includes frameworks whose state cannot survive a second request. See [Classic mode](/docs/classic) for more information; of the sections below, only static files, TLS and OPcache apply.

**In Worker mode, the process stays alive.** Your script boots the application once and then loops, asking Rapira for the next request. The framework is no longer torn down between requests. See [execution modes](/docs/execution-modes) for the mode descriptions, and [Worker mode](/docs/worker) for its API reference.

One codebase runs in both modes: leave `public/index.php` as it is and add a `worker.php` next to it. The verified Symfony and Yii3 applications keep the two files side by side, and the `--mode` flag selects which one runs: `rapira serve --mode classic public/index.php` or `rapira serve --mode worker worker.php`. Classic mode stays available as a rollback while you migrate.

## The loop, line by line

Every worker script has the same shape, whichever framework sits inside it:

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

Read from the top:

- **`require .../vendor/autoload.php`** — the autoloader is registered once for the life of the worker, and every class it resolves stays loaded afterwards.
- **`$app = new App();`** — the application boots here, once, before the loop starts. This line is where the two worker guides diverge: Symfony keeps a resident kernel here, Yii3 either keeps a resident runner here or builds one inside the handler — and each guide adds its own bootstrap above the loop and its own per-request cleanup inside the handler.
- **`$handler = static function () use ($app): void`** — the handler takes no arguments. The request is in the superglobals; anything else it needs, it captures with `use`.
- **`header()`, `http_response_code()`, `echo`** — you write the response exactly as a classic script does. See [HTTP](/docs/http) for how that becomes bytes on the wire.
- **`while (\Rapira\handle_request($handler))`** - `handle_request()` blocks until a request arrives. It fills the superglobals for that request, runs your handler, closes the request, and returns `true`. It returns `false` when the worker starts to drain, which is how the loop ends. Call it only from the top level of the boot script. It throws `Rapira\Exception\NotInWorkerModeError` outside Worker mode.
- **`gc_collect_cycles();`** — the loop body runs *between* requests, which is where work belongs when it should happen at a predictable moment rather than during a request. It collects ordinary reference cycles and is not a memory fix — see [Memory and recycling](#memory-and-recycling).

Your entry script is `worker.php`, so `SCRIPT_NAME` is `/worker.php`. `DOCUMENT_ROOT` is the directory that contains the script. `REQUEST_URI` contains the path that the client requested. Symfony and Yii3 routed and generated URLs correctly with these values. Generated URLs did not contain `worker.php`, and the applications did not modify `$_SERVER`. First, check a framework that builds URLs from `SCRIPT_NAME` instead of `REQUEST_URI`.

## Per-request and resident state

Rapira rebuilds everything in the left column for every request, so ordinary PHP code that reads it keeps working. Everything in the right column persists for the life of the worker and has to be managed by the worker script.

| Fresh for every request | Survives every request |
| ----------------------- | ---------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` — refilled with this request's data | The Composer autoloader, and every class already loaded through it |
| `php://input` — this request's raw body, with `CONTENT_TYPE` and `CONTENT_LENGTH` beside it | `static` properties and variables, which keep counting across requests |
| `$_FILES`, and the uploaded temp files behind it | Objects created before the loop — the container, the kernel, your application |
| Session wiring: `session_start()`, the cookie in, the `Set-Cookie` out | Open resources: database handles, cache clients, streams |
| Response state: status code, headers, `setcookie()`, the output buffers | The process itself — same pid, one resident PHP interpreter per worker |
| Shutdown functions registered **inside** the handler | The worker's own counters: `handled` and `errors` keep incrementing |
| The `max_execution_time` clock, re-armed for each request | |

On Linux (and FreeBSD), where Zend's per-request timer exists, the `max_execution_time` clock is re-armed for each request and the time a worker spends parked waiting for the next one is never counted against it — only the request itself is on the clock. Elsewhere, macOS included, no per-request timeout is armed at all.

Three behaviors below are properties of resident PHP rather than of Rapira. All three are verified and all three show up at bootstrap time.

::: warning A resident object's destructor fires at the end of the first request

Give an object created *outside* the loop a userland `__destruct` and it runs — once, at the end of the **first** request, when PHP walks the object store at request shutdown. The object itself is fine afterwards: still an object, methods still callable, and the destructor never fires again, not on later requests and not at worker shutdown.

A class that closes a handle, flushes a buffer or writes a "goodbye" log line from its destructor therefore does so once, at the end of the first request, and never again for the life of the process. Keep teardown out of destructors on anything you hold resident.
:::

::: warning `register_shutdown_function()` at bootstrap fires once, then never again

Called outside the handler, the callback runs at the end of the first request and is then freed; no later request runs it. Registered *inside* the handler it behaves exactly as it does under php-fpm: it runs at the end of that request, every request.

If your bootstrap installs a shutdown handler — to flush metrics, to catch a fatal, to close something — register it inside the handler instead, on each turn of the loop.
:::

::: warning `$_ENV` is silently re-imported mid-request

With stock ini settings (`variables_order = "GPCS"`, `auto_globals_jit = On`), PHP re-arms the JIT flag for `$_ENV` on every request. The first file compiled during that request that mentions `$_ENV` makes PHP rebuild the superglobal — and with no `E` in `variables_order` there is nothing to import, so `$_ENV` comes back **empty**: everything a Dotenv-style bootstrap wrote into it at worker start is gone mid-request, and PHP emits no diagnostic.

The effect depends on *when* a file is compiled. Config that a framework resolves eagerly during boot is already cached and works fine; anything resolved lazily, on the first request, reads an `$_ENV` that was emptied a moment earlier. The same application can work in one environment and return 500 on every request in another for exactly this reason.

There are two workarounds. The first is verified: have the bootstrap write the values into the real environment as well — `putenv()` survives the re-import, and a framework that falls back to `getenv()` then finds them. Prefer the second in production: set real environment variables in your unit file or container and stop parsing a `.env` at runtime. Neither puts anything back into `$_ENV` — under `GPCS` it stays empty however the environment is populated, and `getenv()` is what sees the values. The [Symfony guide](/docs/frameworks/symfony) walks through the concrete failure and the one-line fix.

Any PHP runtime that keeps the process alive across requests hits this.
:::

## Error handling

Three failure shapes, all watched against a single worker with its pid tracked:

- **`exit` or `die` inside the handler** — the response is flushed to the client, status and body-so-far included, and the worker keeps serving. Frameworks do this in normal operation — a maintenance-mode check that ends the request with `exit`, for instance — and it is not fatal to the process.
- **An uncaught exception** — a `500`. If your framework's error handler catches it first, it renders its own error page; if nothing catches it, Rapira answers `500` with an empty body. Either way the worker keeps serving.
- **An uncaught `Error`** — calling a function that does not exist, for instance. PHP logs it as `Uncaught Error`; it takes the same path as any other uncaught throwable — a `500`, and the worker keeps serving on the same pid.

The worker's `errors` counter increases for the two error cases. An `exit` request is an ordinary `200` and only changes `handled`. In all three cases, `recycles` and `restarts` stay at zero. An uncaught throwable does not stop the worker or affect the next request. A bailout-class fatal unwinds the resident script. The worker then runs the script from the top and boots the application again, which increases `recycles`. The [process model](/docs/process-model) status dump prints these counters for every worker.

## Static files

Rapira serves static assets with the [static file middleware](/docs/static-files). Point `root` in `[http.static]` at the framework's `public/` directory and list the middleware in `[http]`:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

The middleware answers a request only when the path matches a file under that root. Its default `forbid` list keeps `.php` files out, so the entry script in `public/` is never served as a file. Every other URL runs the entry script, in Classic and Worker mode alike. `$_SERVER['REQUEST_URI']` tells the application where the client wanted to go. A directory URL runs the entry script as well, because the middleware serves no index file for it.

A CDN or a reverse proxy in front can still serve the assets instead. [Running in production](/docs/deployment) sets up such a proxy.

## TLS and proxies

Rapira's listener speaks plain HTTP and there is no TLS section in the config. Terminate TLS at the proxy you already run and let it reach Rapira over loopback or a Unix socket. The proxy must spell forwarded fields with `-` and never `_`, because both spellings fold onto the same `$_SERVER` key. See [HTTP](/docs/http) for that mapping and [running in production](/docs/deployment) for the proxy configuration.

## Memory and recycling

A worker can rebuild the application inside the handler. This is the simpler of the two Yii3 designs. It keeps less state resident than a Symfony-style kernel, but more than Classic mode. The loop is in the worker script. You can move work out of the handler as you identify the state that survives a second request. This design does not provide a container that is ready when the request arrives.

Every request in that shape leaves a discarded object graph behind. PHP does not reclaim those one at a time. They are held together by reference cycles, so the heap grows request after request until the cycle collector runs and takes a large batch at once: a sawtooth, not a leak, but a sawtooth whose peak is a good deal higher than any single request's footprint.

Calling `gc_collect_cycles()` yourself does not flatten it — verified, in the loop and inside the handler both. The old graphs stay strongly referenced until a later bootstrap releases them, so the collector has nothing to take yet. Two things follow. Give `memory_limit` real headroom, because what has to fit is the peak and not the average. And set a recycle budget:

```toml
[pool]
max_requests = 100
```

A worker retires after that many requests (plus a little jitter, so the pool does not rotate in lockstep) and the master forks a replacement that starts from a fresh heap. Verified across hundreds of sequential requests through several recycles: workers rotate, memory resets each cycle, and not one request was dropped or answered with anything but a `200`. It is a deterministic bound on a memory profile that is otherwise left entirely to the collector.

The resident shapes — Symfony's kernel, Yii3's container behind `StateResetter` — are flat by comparison: memory stayed level over the same runs. Keep recycling enabled for them as well, as a safeguard. See [configuration](/docs/configuration) for the key and [process model](/docs/process-model) for what recycling does to the pool.

## OPcache and changed code

Rapira starts PHP exactly once, in the master, before it forks a single worker — so OPcache creates its shared memory segment one time and every worker inherits the same mapping. Compiled scripts stay hot across requests *and* across the whole pool, in both modes. A worker that re-includes your framework's files is not re-parsing them.

In production, `opcache.validate_timestamps = 0` removes the per-file stat from every request. With this setting, nothing invalidates the cache. The segment belongs to the master and outlives every worker generation. Therefore, a rolling reload continues to serve old opcodes, and a deployment requires a full restart. See [running in production](/docs/deployment) for the sequence.

While developing, the same outcome has a different cause. A resident bootstrap never re-reads the code it loaded at startup, whatever OPcache is doing: edits to a service the container already built, or to the worker script itself, do not reach the running process. Restart after every edit — `rapira serve` runs in the foreground and never daemonizes, so it is Ctrl-C and run it again.

## Framework guides

- **[Symfony](/docs/frameworks/symfony)** — the kernel boots once and stays resident, and the framework's own `services_resetter` puts stateful services back the way it found them between requests. One worker file covers 7.4 and 8.1, byte for byte.
- **[Laravel](/docs/frameworks/laravel)** — Classic mode: the stock `public/index.php` runs unchanged. Worker mode for Laravel is under development — a resident Laravel application needs the state unwinding that Octane implements, and Rapira has no Octane driver yet.
- **[Yii3](/docs/frameworks/yii3)** — a resident container reset per request through `StateResetter`, which is Yii3's own design for long-running processes (its RoadRunner runner has the same shape), or a simpler fresh runner per request if you would rather start there.

A framework that these guides do not cover runs with the same worker script. It can use Worker mode if the application handles a second request in the same process. Start by rebuilding the application inside the handler. This design has no framework requirements. Then, you can make the application resident and reset its state for each request. If neither design works, [Classic mode](/docs/classic) runs the application unchanged.
