---
title: Classic mode
description: Classic mode runs an ordinary PHP front controller from scratch on every request, the way php-fpm does, with fresh state each time.
---

# Classic mode

Classic mode executes an ordinary PHP front controller — the same `public/index.php` you already point php-fpm at — from scratch for every request that arrives. Rapira takes php-fpm's place and the application needs no changes: the superglobals are filled in, the script runs top to bottom, and whatever it prints becomes the response.

## Fresh state on every request

Every request gets a complete PHP request cycle: request startup, your entry script, request shutdown. Everything the script built along the way — globals, static properties, the DI container, the ORM's identity map — is torn down before the next request begins, exactly as it would be under php-fpm.

A leaked handle, a singleton left half-initialized, a library that stashes request data in a static — none of it affects the next request, because nothing your script created survives the request it was created in. The same exceptions as php-fpm apply: persistent connections and extension-level state live in the worker process, not in the request. Code that was never written with a long-lived process in mind runs here unchanged. `fastcgi_finish_request()` comes from the php-fpm binary and is not available under Rapira, which exposes `rapira_finish_request()` with the same contract — flush the response to the client early, keep working after it — documented on the [HTTP](/docs/http) page.

The application boots again for every request: autoloader, config, container, routes. See [execution modes](/docs/execution-modes) for more information.

## Turning it on

There are two ways to select the mode, and they do the same thing:

- `--mode classic` on the command line, next to the entry script.
- `mode = "classic"` in the `[pool]` section of a `rapira.toml`.

`--mode` overrides `pool.mode`, so the command line selects the mode even when the config file names a different one. Everything else follows the usual precedence, where CLI flags win over the config file; the full key list lives on the [configuration](/docs/configuration) page.

A classic entry script is ordinary PHP:

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Point Rapira at it either way:

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

With the config file, the run command is `rapira serve --config rapira.toml`. A relative `pool.entrypoint` resolves against the config file's own directory, so the config stays movable; a relative script path on the command line resolves against the current directory. See the [CLI reference](/docs/cli) for the rest of the options.

## Entry script

Rapira does not map URLs onto PHP scripts. Every request runs the entry script you named, whatever the path was. The URL arrives in `$_SERVER['REQUEST_URI']`, and the application routes it. The [static file middleware](/docs/static-files) is the one exception. When it is enabled, it can answer a `GET` or a `HEAD` from a file under its root. Every request it does not answer runs the entry script.

The CGI variables follow from that rule. `SCRIPT_FILENAME` is always the entry script. `SCRIPT_NAME` is its file name with a leading slash, such as `/index.php`. `DOCUMENT_ROOT` is the directory that contains the script. A CDN or a reverse proxy in front of Rapira can serve the assets instead. The [deployment](/docs/deployment) page sets up such a proxy.

## OPcache

Executing from scratch resets your application's state, not the compiled bytecode. The master process starts PHP exactly once, at module startup, *before* it forks any worker — so OPcache creates its shared memory segment a single time and every forked worker inherits that same mapping. With OPcache enabled, compiled scripts stay cached across requests and across the whole pool, and re-executing your front controller does not mean re-parsing it.

The process pool itself is the same in both modes: the master forks workers, and each worker handles one request at a time, so concurrency comes from the number of processes. See the [process model](/docs/process-model) page for more information about the master process and its workers.

::: info
`Rapira\handle_request()` throws `Rapira\Exception\NotInWorkerModeError` in Classic mode. The script ends when the request does, so there is no loop that can take a handler. Worker scripts belong in [Worker](/docs/worker) mode.
:::

## Choosing between Classic and Worker

Use Classic mode when the application's state cannot survive a second request. Examples include old codebases, frameworks that leak into statics, and vendor libraries you do not control. Also use Classic mode when you migrate from php-fpm and want one change at a time. Use [Worker](/docs/worker) mode when the code can tolerate a process that keeps running. Worker mode removes the per-request boot work. The [execution modes](/docs/execution-modes) page describes all three modes.
