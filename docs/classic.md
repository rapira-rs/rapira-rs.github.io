---
title: Classic mode
description: Classic mode runs an ordinary PHP entry script with new state for each request.
---

# Classic mode

Classic mode executes an ordinary PHP entry script. This can be the same `public/index.php` file that php-fpm runs. Rapira starts a new PHP request for each HTTP request. It fills the superglobals and executes the script. Script output becomes the response. Most applications can move from php-fpm to Classic mode with no code changes.

## New state for each request

Each request has a complete PHP request cycle. The cycle includes request initialization, entry script execution, and request shutdown. PHP removes request state before the next request. This state includes globals, static properties, the dependency injection container, and the ORM identity map.

Objects and request data cannot affect a later request. Some state stays in the worker process: persistent connections, extension state, and the working directory. Applications that do not support persistent processes can run in Classic mode.

The application initializes its autoloader, configuration, container, and routes for each request. See [execution modes](/docs/execution-modes) for more information.

Each worker uses the entry script directory as its working directory. A `chdir()` call in a request stays in effect for later requests of the same worker, until the worker exits. If a request changes the working directory, restore it before the request ends.

Rapira does not provide the php-fpm `fastcgi_finish_request()` function. Use `rapira_finish_request()` to send the response before the script ends. See [HTTP](/docs/http) for more information.

## Mode selection

Select Classic mode with `mode = "classic"` in the `[http.pool]` table of `rapira.toml`. Only the HTTP pool supports Classic mode. See [configuration](/docs/configuration) for the complete key list.

A classic entry script is ordinary PHP:

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

The `rapira.toml` for this script is:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

Start Rapira with `rapira serve rapira.toml`. A relative `http.pool.entrypoint` uses the configuration file directory as its base. See the [CLI reference](/docs/cli) for the command.

## Entry script

Rapira does not map URLs to PHP scripts. Each request runs the configured entry script. `$_SERVER['REQUEST_URI']` contains the URL for application routing.

The [static file middleware](/docs/static-files) can return files for `GET` and `HEAD` requests. The entry script processes the requests that the middleware does not answer. A CDN or reverse proxy can also serve static assets. See [deployment](/docs/deployment) for a reverse proxy example.

`SCRIPT_FILENAME` contains the absolute entry script path. `SCRIPT_NAME` contains its file name with a leading slash, such as `/index.php`. `DOCUMENT_ROOT` contains the entry script directory.

## Uploads

PHP parses `multipart/form-data` bodies and fills `$_FILES`, as under php-fpm. The `upload_max_filesize` and `post_max_size` settings in `php.ini` apply.

Rapira applies `http.max_body_size_mb` to the complete request body before PHP runs. The default is 8 MiB. Rapira returns `413` for a larger body. If `php.ini` permits larger uploads, increase `http.max_body_size_mb` to match `post_max_size`. See [request bodies](/docs/http#request-bodies) for more information.

The `[http.uploads]` table applies only to Dispatcher mode. Rapira does not start when a Classic configuration contains this table. See [configuration](/docs/configuration#the-http-uploads-table) for more information.

## OPcache

Each PHP request removes application state. OPcache keeps compiled bytecode across requests. The master process starts PHP before it creates workers, so all workers use the same OPcache shared memory segment. When you enable OPcache, later requests use the cached bytecode, and PHP does not compile unchanged scripts again. See [deployment](/docs/deployment) for the OPcache setup.

Each worker handles one request at a time. `http.pool.processes` sets the worker count, which is also the maximum number of concurrent requests. See the [process model](/docs/process-model) for more information.

## Choosing between Classic and Worker

Use Classic mode when the application cannot safely keep state between requests. For example, some applications and vendor libraries store request data in static properties. Classic mode also decreases application changes when you move from php-fpm. Use [Worker](/docs/worker) mode when the application supports a persistent process. Worker mode removes application initialization from each request. See [execution modes](/docs/execution-modes) for all three modes.

::: info
`Rapira\handle_request()` throws `Rapira\Exception\NotInWorkerModeError` in Classic mode. A Classic script ends with its request and cannot run a request loop.
:::
