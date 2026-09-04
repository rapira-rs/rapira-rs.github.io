---
title: Framework integration
description: "Framework worker loops, request state, persistent state, error handling, static files, and OPcache."
---

# Framework integration

A framework application runs without changes in Classic mode. Configure Rapira to use the existing entry script.
In Worker mode, the PHP process remains active between requests. The framework design determines which application state can remain in memory.
This page describes behavior that applies to all frameworks. The framework guides describe only framework-specific behavior.

::: info Verified with

- **PHP 8.5.8**, NTS, embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4.15** and **8.1.2**, **Yii3** app template 1.4 (yii-runner-http 3.2.1)

Tests ran these applications on Linux with one worker process. Framework statements on this page come from those tests.
See [configuration](/docs/configuration) for the Rapira settings.
:::

## Classic and Worker modes

**Classic mode uses the existing entry script.** It starts a new PHP request for each HTTP request.
A framework that runs under php-fpm can also run in this mode. See [Classic mode](/docs/classic) for more information.
Only the static files, TLS, and OPcache sections below apply to Classic mode.

**Worker mode keeps the process active.** The script initializes the application and requests work in a loop.
The application state remains between requests. See [execution modes](/docs/execution-modes) and [Worker mode](/docs/worker) for more information.

One codebase can use both modes. Keep `public/index.php`. Add `worker.php` to the project root. Use `--mode` to select the execution mode. Select the script with the `SCRIPT` argument or `pool.entrypoint`. Classic mode remains available if a Worker mode migration fails.

## Worker loop

Each framework uses the same basic worker script:

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

The script contains these operations:

- **`require .../vendor/autoload.php`** registers the autoloader until the worker script restarts. Loaded classes remain available.
- **`$app = new App();`** initializes the application before the loop. Symfony keeps a persistent kernel here.
- Yii3 can keep a persistent runner or create a runner inside the handler. Each guide shows the required initialization and request cleanup.
- **`$handler = static function () use ($app): void`** defines a handler without arguments. The handler reads request data from the superglobals.
- It captures other dependencies with `use`.
- **`header()`, `http_response_code()`, and `echo`** create a response as they do in a classic script.
- See [HTTP](/docs/http) for response transmission.
- **`while (\Rapira\handle_request($handler))`** waits for a request. `handle_request()` fills the superglobals, runs the handler, and completes the request.
- It returns `true` after a request and `false` during worker shutdown. Call it only from the top-level script loop.
- It throws `Rapira\Exception\NotInWorkerModeError` outside Worker mode.
- **`gc_collect_cycles();`** runs between requests and collects reference cycles. It does not correct memory leaks.
- See [Memory and recycling](#memory-and-recycling).

Rapira sets `SCRIPT_NAME` to `/worker.php` because `worker.php` is the entry script. `DOCUMENT_ROOT` contains the script directory. `REQUEST_URI` contains the client path. Symfony and Yii3 routed requests and generated URLs correctly with these values. The generated URLs did not contain `worker.php`. Before you integrate another framework, check whether it builds URLs from `SCRIPT_NAME` instead of `REQUEST_URI`.

## Per-request and resident state

Rapira rebuilds everything in the left column for every request. Ordinary PHP code can continue to read these values. Everything in the right column remains between requests. The worker script must manage this state.

| New for every request | Remains between requests |
| ----------------------- | ---------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE`: Rapira refills them with request data | The Composer autoloader and each class that it loaded |
| `php://input`: the raw request body, `CONTENT_TYPE`, and `CONTENT_LENGTH` | `static` properties and variables, which keep values across requests |
| `$_FILES` and the uploaded temporary files | Objects created before the loop, such as the container, kernel, and application |
| Session data: `session_start()`, the request cookie, and the response `Set-Cookie` field | Open resources: database handles, cache clients, streams |
| Response state: status code, headers, `setcookie()`, and output buffers | The process: the same pid and one resident PHP interpreter for each worker |
| Shutdown functions registered **inside** the handler | The worker's own counters: `handled` and `errors` increase |
| The `max_execution_time` clock, re-armed for each request | `$_ENV` values loaded before the loop |

On Linux and FreeBSD, Zend starts a new `max_execution_time` timer for each request. Worker wait time does not count toward this limit.
On other systems, including macOS, PHP does not start a request timer.

The following three behaviors apply to a persistent worker.

::: warning A resident object keeps its state between requests

PHP does not call the destructor of a persistent object at the end of a request.
It calls the destructor once when the worker cycle ends, or when code removes the last reference.

Do not use a destructor for per-request cleanup. Reset per-request state inside the handler.
:::

::: warning An initialization shutdown function runs once at the end of the worker cycle

PHP runs each shutdown function that code registers outside the handler once at the end of the worker cycle. PHP runs each function that the handler registers at the end of that request.

Register request shutdown functions inside the handler. Examples include metric output, fatal error processing, and request resource cleanup.
:::

::: warning `$_ENV` remains between requests

Rapira does not rebuild `$_ENV` for each request. Values that code writes before the loop remain available until the worker script restarts. Treat `$_ENV` as resident application state. Load environment configuration before the loop. Do not store request data in `$_ENV`.

Rapira keeps values in `$_ENV` when code does not call `putenv()`. Use `putenv()` when code needs process-environment behavior, such as `getenv()` or child-process inheritance. In production, set environment variables in the service unit, container, or orchestrator.
:::

## Error handling

Tests confirmed three failure types with one worker:

- **`exit` or `die` inside the handler** sends the current status and output. The worker continues to accept requests.
- For example, a framework can use `exit` for a maintenance response. The process does not terminate.
- **An uncaught exception** returns `500`. A framework error handler can return its own error page.
- Without such a handler, Rapira returns an empty body. The worker continues to accept requests.
- **An uncaught `Error`** also returns `500`, and the worker continues. PHP writes an `Uncaught Error` log record.

The worker `errors` counter increases for the two error cases. An `exit` request returns `200` and changes only `handled`.
In all three cases, `recycles` and `restarts` remain zero. An uncaught throwable does not stop the worker or affect the next request.

A bailout-class fatal ends the persistent script. The worker then starts the script again and initializes the application.
This action increases `recycles`. The [process model](/docs/process-model) status output shows these counters.

## Static files

Rapira serves static assets with the [static file middleware](/docs/static-files).
Set `[http.static].root` to the framework `public/` directory. Add the middleware to `[http]`:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

The middleware returns a response only when a path matches a file under the root.
Its default `forbid` list prevents access to `.php` files. Thus, it does not serve the entry script as a file.
Other URLs run the entry script in Classic and Worker modes. `$_SERVER['REQUEST_URI']` contains the client path.
Directory URLs also run the entry script because the middleware does not serve index files.

A CDN or reverse proxy can serve the assets instead. See [Running in production](/docs/deployment) for reverse proxy configuration.

## TLS and proxies

Rapira accepts plain HTTP and does not provide TLS settings. Terminate TLS at a proxy.
Connect the proxy through loopback or a Unix socket. Use hyphens instead of underscores in forwarded field names.
Both characters can map to the same `$_SERVER` key. See [HTTP](/docs/http) and [running in production](/docs/deployment).

## Memory and recycling

A worker can create the application inside the handler. This design keeps the application for one request. It keeps less application state than a persistent Symfony kernel, but more than Classic mode. The worker script still contains the loop. Move initialization outside the handler only after you identify persistent state. This design creates the container after the request arrives.

Each request in this design creates an object graph. Reference cycles can keep old graphs until the cycle collector runs.
Memory use then increases for several requests and decreases when PHP releases many graphs. This cyclic use is not necessarily a memory leak.
However, peak memory can be much larger than memory for one request.

Tests found that `gc_collect_cycles()` in the loop or handler did not prevent this pattern. Later initialization can keep references to old graphs. The collector cannot release a graph while another object references it. Set `memory_limit` above the measured peak. Also set a worker replacement limit:

```toml
[pool]
max_requests = 100
```

The master replaces a worker after the request limit. Rapira varies the limit slightly to prevent simultaneous replacement.
Tests sent hundreds of requests during several replacements. Memory returned to its initial level, and each request returned `200`.
This setting sets a predictable limit for the memory pattern.

Persistent Symfony and Yii3 applications had stable memory use during the same tests. Keep worker replacement enabled to limit unexpected memory growth.
See [configuration](/docs/configuration) and [process model](/docs/process-model) for more information.

## OPcache and changed code

Rapira starts PHP once in the master before it creates workers. OPcache creates one shared memory segment.
Each worker inherits the same mapping. Compiled scripts remain cached across requests and workers in both modes.

In production, `opcache.validate_timestamps = 0` removes the file check from each request. This setting prevents automatic cache invalidation. The OPcache segment belongs to the master and remains during worker replacement. Thus, a deployment requires a complete restart. See [running in production](/docs/deployment) for the sequence.

During development, a persistent application does not read its initialization code again. This behavior does not depend on OPcache. After changes to the worker script or initialized services, press Ctrl-C. Then run `rapira serve` again.

## Framework guides

- **[Symfony](/docs/frameworks/symfony):** The kernel initializes once and remains in memory. `services_resetter` resets stateful services between requests.
- One worker file supports Symfony 7.4 and 8.1.
- **[Laravel](/docs/frameworks/laravel):** Classic mode runs the standard `public/index.php` without changes.
- Laravel Worker mode is under development. Rapira does not yet provide the required Octane driver.
- **[Yii3](/docs/frameworks/yii3):** `StateResetter` resets a persistent container after each request.
- Alternatively, the worker can create a new runner for each request.

Other frameworks can use the same basic worker script. Use Worker mode only if the application can process several requests in one process.
First, create the application inside the handler. This design does not require framework support for persistent processes.

Validate the application in this design. Then keep the application. Reset its request state after each request. Use [Classic mode](/docs/classic) if neither Worker design operates correctly.
