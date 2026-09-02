---
title: Quickstart
description: Serving a PHP application with Rapira in Classic and Worker modes, and moving the settings into a rapira.toml file.
---

# Quickstart

This page covers serving a page in Classic mode and converting the application to Worker mode. It also moves the settings into a configuration file. The steps require a working `rapira` binary with its bundled PHP. See [Installation](/docs/intro/installation) for more information.

## Classic mode

Classic mode is available to every application: Rapira re-includes your entry script for every request, exactly the way php-fpm would run a front controller. Nothing about the code has to change.

Create `public/index.php`:

```php
<?php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Start the server. The `--mode classic` flag selects the mode, and the positional argument is the entry script:

```bash
rapira serve --mode classic public/index.php
```

Rapira binds `127.0.0.1:8000` unless you tell it otherwise. From another terminal:

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

The process is not thrown away between requests — Rapira forks its workers once and keeps a PHP interpreter booted inside each of them. What gets discarded is your script's own state: variables, the autoloader, whatever the framework built.

## Worker mode

Worker mode keeps the script alive. It boots once and then waits for requests in a loop. Rapira refills the superglobals and calls your handler. The PHP code still reads `$_GET` and uses `echo` for a response. The boot work runs once per process instead of once per request. See [Execution modes](/docs/execution-modes) for more information.

Create `worker.php` in the project root:

```php
<?php

// Outside the loop, so it survives every request this worker serves.
$handled = 0;

$handler = static function () use (&$handled): void {
    $handled++;
    header('Content-Type: text/plain');
    echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
    echo "worker " . getmypid() . " handled {$handled} request(s)\n";
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

`\Rapira\handle_request()` blocks until the next job arrives, hands it to your callback, and returns `true`. It returns `false` while the worker drains, which is what ends the loop. The callback reads the superglobals and responds through `echo` and `header()`. Call `\Rapira\handle_request()` only from the boot script's top level. It throws `Rapira\Exception\NotInWorkerModeError` in any other mode.

`\Rapira\handle_request()` comes from the PHP module Rapira registers when it boots the interpreter, so the script above runs with no autoloader. An application with Composer dependencies loads its own `vendor/autoload.php` before the loop.

Stop the Classic server first with `Ctrl-C` in its terminal, because both servers bind `127.0.0.1:8000`. The default mode is Dispatcher, so Worker mode needs the `--mode worker` flag:

```bash
rapira serve --mode worker worker.php
```

```bash
curl '127.0.0.1:8000/?name=world'
```

Run that `curl` a few times and the counter goes up, because the same process keeps serving the requests. By default Rapira forks one worker per logical CPU, so a request can land on any of them: the kernel picks which worker accepts it. Each worker keeps its own count, and the pid in the output tells you which worker answered. Start the server with `rapira serve --mode worker --processes 1 worker.php` if you want the count to run as a single sequence. The [process model](/docs/process-model) explains how the pool is supervised.

Everything you build before the `while` loop stays in memory for the life of the worker: the Composer autoloader, a DI container, database and cache connections, compiled routes and templates — all of it built once, at boot, instead of on every request. Only the per-request state is new each time round.

::: warning
State that survives between requests must be reset by the worker script. A static property, a global, an open transaction left behind by one request is still there for the next one. [Worker mode](/docs/worker) covers what to watch for and how to keep a worker clean.
:::

Inside the handler the usual functions work — `header()`, `http_response_code()`, `echo`, and `rapira_finish_request()` to flush the response early and keep working afterwards. See [HTTP](/docs/http) for more information.

## Configuration file

Settings can live in a `rapira.toml` file instead of on the command line. A file next to your code is enough to start:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
```

```bash
rapira serve --config rapira.toml
```

::: info
A relative `pool.entrypoint` resolves against the config file's own directory, so the same file works whatever your current directory is. Flags still win over the file — `rapira serve --config rapira.toml --processes 1` keeps everything else and forks a single worker.
:::

The file also accepts pool scaling modes, worker recycling, request timeouts, logging and the supervisor's pidfile. Unknown keys are rejected rather than ignored, so a typo fails the boot instead of quietly doing nothing. The full reference is in [Configuration](/docs/configuration), and the flags in [CLI](/docs/cli).

## Stopping the server

Press `Ctrl-C` and Rapira drains: it stops taking new work, lets the requests already in flight finish, shuts the extensions down and exits. A second `Ctrl-C` skips the wait and forces the exit, so a stuck request does not hold the server open. `SIGTERM` behaves the same way, which is what makes a service manager's restart graceful. [Process model](/docs/process-model) has the full signal table, including reload without dropping connections.

## Next steps

- [Worker mode](/docs/worker) — the resident loop in depth: state, leaks, recycling, and how to boot a real application before the loop.
- [Configuration](/docs/configuration) — every key `rapira.toml` accepts, with defaults.
- [Frameworks](/docs/frameworks/) — integration guides for Symfony, Laravel and Yii3.
