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

- `--classic` on the command line, next to the entry script.
- `classic = true` in the `[pool]` section of a `rapira.toml`.

The flag only ever turns the mode *on* — there is no `--no-classic`, so a config file that sets `classic = true` stays classic no matter what the command line says. Everything else follows the usual precedence, where CLI flags win over the config file; the full key list lives on the [configuration](/docs/configuration) page.

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
rapira serve --classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
classic = true
```

:::

With the config file, the run command is `rapira serve --config rapira.toml`. A relative `pool.entrypoint` resolves against the config file's own directory, so the config stays movable; a relative script path on the command line resolves against the current directory. See the [CLI reference](/docs/cli) for the rest of the options.

## Entry script

Rapira does not map URLs onto files on disk, and it serves nothing from disk on its own. Every request runs the entry script you named, whatever the path was, and the URL arrives as `$_SERVER['REQUEST_URI']` for the application to route.

The CGI variables follow from that: `SCRIPT_FILENAME` is always the entry script, `SCRIPT_NAME` its file name with a leading slash (`/index.php`), and `DOCUMENT_ROOT` the directory it sits in. Static assets need something in front of Rapira — a CDN, or the reverse proxy the [deployment](/docs/deployment) page sets up.

## OPcache

Executing from scratch resets your application's state, not the compiled bytecode. The master process starts PHP exactly once, at module startup, *before* it forks any worker — so OPcache creates its shared memory segment a single time and every forked worker inherits that same mapping. With OPcache enabled, compiled scripts stay cached across requests and across the whole pool, and re-executing your front controller does not mean re-parsing it.

The process pool itself is the same in both modes: the master forks workers, and each worker handles one request at a time, so concurrency comes from the number of processes. See the [process model](/docs/process-model) page for more information about the master process and its workers.

::: info
`Rapira\create_plugin_handler()` throws a `Rapira\RapiraException` in classic mode: *plugin handlers require worker mode*. There is no resident loop to hand a handler to, since the script ends when the request does. Worker scripts belong in [SAPI Worker](/docs/worker) mode.
:::

## Choosing between Classic and SAPI Worker

Use classic mode when the application's state cannot survive a second request — an old codebase, a framework that leaks into statics, a vendor library you do not control — or when you are migrating off php-fpm and want one thing to change at a time. Use [SAPI Worker](/docs/worker) mode when the code can tolerate a process that keeps running and you want the per-request boot work removed. The [execution modes](/docs/execution-modes) page describes all four modes, of which Classic and SAPI Worker are the ones that ship today.
