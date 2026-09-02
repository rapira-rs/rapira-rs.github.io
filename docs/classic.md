---
title: Classic mode
description: Classic mode runs an ordinary PHP entry script with new state for each request.
---

# Classic mode

Classic mode executes an ordinary PHP entry script. This can be the same `public/index.php` file that php-fpm runs.
Rapira starts a new PHP request for each HTTP request. It fills the superglobals and executes the script. Script output becomes the response.
Rapira can replace php-fpm without changes to the application.

## New state for each request

Each request has a complete PHP request cycle. The cycle includes request initialization, entry script execution, and request shutdown.
PHP removes request state before the next request. This state includes globals, static properties, the dependency injection container, and the ORM identity map.

Objects and request data cannot affect a later request. Persistent connections and extension state are exceptions because they exist in the worker process.
Applications that do not support persistent processes can run in Classic mode.
Rapira does not provide the php-fpm `fastcgi_finish_request()` function. Use `rapira_finish_request()` to send a response before the script ends.
See [HTTP](/docs/http) for more information.

The application initializes its autoloader, configuration, container, and routes for each request. See [execution modes](/docs/execution-modes) for more information.

## Mode selection

Select Classic mode with one of these settings:

- `--mode classic` on the command line, next to the entry script.
- `mode = "classic"` in the `[pool]` section of a `rapira.toml`.

`--mode` overrides `pool.mode` in the configuration file. Other CLI flags also override the corresponding configuration values.
See [configuration](/docs/configuration) for the complete key list.

A classic entry script is ordinary PHP:

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Select the mode with the CLI or the configuration file:

::: code-group

```bash [CLI]
rapira serve --mode classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
mode = "classic"
```

:::

Start Rapira with `rapira serve --config rapira.toml` when you use the configuration file.
A relative `pool.entrypoint` uses the configuration file directory as its base. A relative CLI script path uses the current directory.
See the [CLI reference](/docs/cli) for the other options.

## Entry script

Rapira does not map URLs to PHP scripts. Each request runs the configured entry script.
`$_SERVER['REQUEST_URI']` contains the URL for application routing.
The [static file middleware](/docs/static-files) is an exception. It can return files for `GET` and `HEAD` requests.
The entry script processes requests that the middleware does not answer.

`SCRIPT_FILENAME` always contains the entry script path. `SCRIPT_NAME` contains its file name with a leading slash, such as `/index.php`.
`DOCUMENT_ROOT` contains the script directory. A CDN or reverse proxy can serve static assets instead.
See [deployment](/docs/deployment) for a reverse proxy example.

## OPcache

Each PHP request resets application state but does not reset compiled bytecode. The master process starts PHP before it creates workers.
OPcache creates one shared memory segment. Each worker uses the same mapping.
When you enable OPcache, the worker pool uses cached scripts across requests. PHP does not parse the entry script again.

Classic and Worker modes use the same process pool. The master creates workers, and each worker handles one request at a time.
The worker count sets the maximum concurrent request count. See the [process model](/docs/process-model) for more information.

::: info
`Rapira\handle_request()` throws `Rapira\Exception\NotInWorkerModeError` in Classic mode. The script ends with the request and cannot run a request loop.
Use [Worker](/docs/worker) mode for worker scripts.
:::

## Choosing between Classic and Worker

Use Classic mode when the application cannot safely retain state between requests. Examples include applications or vendor libraries that store request data in static properties.
Classic mode also reduces application changes during a migration from php-fpm.
Use [Worker](/docs/worker) mode when the application supports a persistent process. Worker mode removes application initialization from each request.
See [execution modes](/docs/execution-modes) for all three modes.
