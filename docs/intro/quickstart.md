---
title: Quickstart
description: Serve a PHP application in Classic and Worker modes, then store the settings in rapira.toml.
---

# Quickstart

This guide starts an application in Classic mode and converts it to Worker mode. It then stores the settings in a configuration file.
The steps require a working `rapira` binary with its bundled PHP. See [Installation](/docs/intro/installation) for more information.

## Classic mode

Classic mode is available to every application. Rapira includes the entry script again for every request, as php-fpm does. The code does not need to change.

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

Rapira binds `127.0.0.1:8000` by default. Send a request from another terminal:

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

Worker processes remain active between requests. Rapira creates the workers once and keeps an initialized PHP interpreter in each worker.
Classic mode removes script state after each request. This state includes variables, the autoloader, and framework objects.

## Worker mode

Worker mode keeps the script active. It initializes once and then waits for requests in a loop.
Rapira refills the superglobals and calls the handler. PHP can still read `$_GET` and use `echo` for a response.
Application initialization runs once for each process. See [Execution modes](/docs/execution-modes) for more information.

Create `worker.php` in the project root:

```php
<?php

// This value remains available for each request in this worker.
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

`\Rapira\handle_request()` waits for the next request. It calls the handler and returns `true`.
It returns `false` during worker shutdown, which ends the loop. The handler reads superglobals and creates output with `echo` and `header()`.
Call `\Rapira\handle_request()` only from the top-level script loop. It throws `Rapira\Exception\NotInWorkerModeError` in other modes.

The PHP module that Rapira registers provides `\Rapira\handle_request()`. The example therefore needs no autoloader.
An application with Composer dependencies must load `vendor/autoload.php` before the loop.

Stop the Classic server with `Ctrl-C` because both servers bind `127.0.0.1:8000`.
Dispatcher is the default mode. Use the `--mode worker` flag to select Worker mode:

```bash
rapira serve --mode worker worker.php
```

```bash
curl '127.0.0.1:8000/?name=world'
```

Run the `curl` command several times. The counter increases because the same process handles several requests.
By default, Rapira creates one worker for each logical CPU. The operating system selects a worker for each connection.
Each worker has a separate count. The output process identifier shows which worker returned the response.
Use `rapira serve --mode worker --processes 1 worker.php` to create one worker. See [process model](/docs/process-model) for pool supervision.

Objects created before the `while` loop remain in memory for the worker lifetime.
Examples include the Composer autoloader, container, connections, routes, and templates. Rapira initializes this state once instead of for each request.
Only request state is new in each iteration.

::: warning
The worker script must reset request state that remains in memory.
Examples include static properties, global values, and open transactions. See [Worker mode](/docs/worker) for more information.
:::

The handler can use `header()`, `http_response_code()`, and `echo`.
It can use `rapira_finish_request()` to send the response before the handler ends. See [HTTP](/docs/http) for more information.

## Configuration file

Store the settings in `rapira.toml` instead of the command line. Create this file next to the application:

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
A relative `pool.entrypoint` uses the configuration file directory as its base. The current directory does not affect it.
CLI flags override file values. For example, `--processes 1` changes only the worker count.
:::

The file also controls pool scaling, worker replacement, request timeouts, logging, and the supervisor pidfile.
An unknown key prevents server initialization. See [Configuration](/docs/configuration) for the file reference and [CLI](/docs/cli) for flags.

## Stopping the server

Press `Ctrl-C` to start a controlled stop. Rapira stops accepting work, finishes current requests, shuts down extensions, and exits.
Press `Ctrl-C` again to force the exit without waiting. `SIGTERM` has the same behavior.
See [Process model](/docs/process-model) for the complete signal table.

## Next steps

- [Worker mode](/docs/worker) describes the persistent loop, state, memory leaks, worker replacement, and application initialization.
- [Configuration](/docs/configuration) lists each `rapira.toml` key and its default.
- [Frameworks](/docs/frameworks/) provides integration guides for Symfony, Laravel, and Yii3.
