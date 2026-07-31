---
title: Quickstart
description: Serve your first PHP app with Rapira — a classic front controller, the same app as a resident worker, and a five-line rapira.toml.
---

# Quickstart

This page picks up where [Installation](/docs/installation) leaves off: you have a working `rapira` binary, with the PHP it bundles. In the next few minutes you will serve a page in classic mode, turn the same app into a resident worker, and move the settings into a config file.

## Hello world in Classic mode

Classic mode is the rung every application can stand on: Rapira re-includes your entry script for every request, exactly the way php-fpm would run a front controller. Nothing about the code has to change, which makes it the right place to start.

Create `public/index.php`:

```php
<?php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Start the server — `--classic` is what selects the mode, and the positional argument is the entry script:

```bash
rapira serve --classic public/index.php
```

Rapira binds `127.0.0.1:8000` unless you tell it otherwise. From another terminal:

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

The process is not thrown away between requests — Rapira forks its workers once and keeps a PHP interpreter booted inside each of them. What gets discarded is your script's own state: variables, the autoloader, whatever the framework built. That is the deal classic mode makes, and it is why the next rung exists.

## The same app as a resident worker

The SAPI Worker rung keeps the script alive. It boots once, then sits in a loop asking Rapira for the next request; Rapira refills the superglobals and calls your handler. The shape of the PHP code stays familiar — you still read `$_GET` and `echo` a response — but the boot work happens once per process instead of once per request. See [Execution modes](/docs/execution-modes) for the whole ladder.

Create `worker.php` in the project root:

```php
<?php
use Rapira\Plugin\Http\HttpHandlerConfig;
use function Rapira\create_plugin_handler;

$http = create_plugin_handler(new HttpHandlerConfig());

// Outside the loop, so it survives every request this worker serves.
$handled = 0;

$handler = static function () use (&$handled): void {
    $handled++;
    header('Content-Type: text/plain');
    echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
    echo "worker " . getmypid() . " handled {$handled} request(s)\n";
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

`create_plugin_handler()` asks the server for the handler that serves HTTP — `HttpHandlerConfig` is what names it. `handleRequest()` then blocks until a request arrives, runs your callback for it, and returns `true`; it returns `false` when the server is shutting down, which is what ends the loop.

Stop the classic server first — `Ctrl-C` in its terminal — since both bind `127.0.0.1:8000`. Worker mode is the default, so there is no flag this time:

```bash
rapira serve worker.php
```

```bash
curl '127.0.0.1:8000/?name=world'
```

Run that `curl` a few times and watch the counter climb — that is the whole point. By default Rapira forks one worker per CPU, so a request can land on any of them — the kernel picks which worker accepts it — and each worker keeps its own count; the pid in the output tells you which one answered. Start with `rapira serve --processes 1 worker.php` if you want a single, tidy sequence. The [process model](/docs/process-model) explains how the pool is supervised.

Everything you build before the `while` loop stays in memory for the life of the worker: the Composer autoloader, a DI container, database and cache connections, compiled routes and templates — all of it paid for once, at boot, instead of on every request. Only the per-request state is new each time round.

::: warning
State that survives is state you now own. A static property, a global, an open transaction left behind by one request is still there for the next one. [Worker mode](/docs/worker) covers what to watch for and how to keep a worker clean.
:::

Inside the handler you have the usual toolkit — `header()`, `http_response_code()`, `echo`, and `rapira_finish_request()` to flush the response early and keep working afterwards. [HTTP](/docs/http) documents all of it.

## Move the settings into a config file

Flags are fine while you experiment; a deployed app usually wants its settings written down. A `rapira.toml` next to your code is enough to start:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
processes = 4
```

```bash
rapira serve --config rapira.toml
```

::: info
A relative `pool.entrypoint` resolves against the config file's own directory, so the same file works whatever your current directory is. Flags still win over the file — `rapira serve --config rapira.toml --processes 1` keeps everything else and forks a single worker.
:::

Those five lines are a fraction of what the file accepts: pool scaling modes, worker recycling, request timeouts, logging, the supervisor's pidfile. Unknown keys are rejected rather than ignored, so a typo fails the boot instead of quietly doing nothing. The full reference lives in [Configuration](/docs/configuration), and the flags in [CLI](/docs/cli).

## Stopping the server

Press `Ctrl-C` and Rapira drains: it stops taking new work, lets the requests already in flight finish, shuts the extensions down and exits. A second `Ctrl-C` gives up on waiting and forces the exit — useful when a request is wedged and you would rather not wait it out. `SIGTERM` behaves the same way, which is what makes a service manager's restart graceful. [Process model](/docs/process-model) has the full signal table, including reload without dropping connections.

## Next steps

- [Worker mode](/docs/worker) — the resident loop in depth: state, leaks, recycling, and how to boot a real application before the loop.
- [Configuration](/docs/configuration) — every key `rapira.toml` accepts, with defaults.
- [Frameworks](/docs/frameworks/) — ready-made entry scripts for Symfony, Laravel and Yii3.

::: question Do I need Composer to run the worker script?
No. `create_plugin_handler()`, `HttpHandlerConfig` and the handler classes come from the PHP module Rapira registers when it boots the interpreter, so the script above runs with no autoloader at all. A real application will of course `require` its own `vendor/autoload.php` — before the loop, so it is paid for once.
:::

::: question Can one script serve both classic and worker mode?
No, and it will tell you: `create_plugin_handler()` throws a `Rapira\RapiraException` outside worker mode, because classic mode has no resident loop to hand you. Keep the plain front controller for classic mode and a separate `worker.php` for the worker rung; the [framework guides](/docs/frameworks/) cover the per-framework wiring.
:::
