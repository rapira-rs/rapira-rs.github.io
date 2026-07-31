---
title: Classic mode
description: The php-fpm-shaped rung of Rapira — an ordinary front controller, executed from scratch on every request, with fresh state each time.
---

# Classic mode

Classic mode is where most applications start, and for many of them it is the only rung they ever need. The entry script is an ordinary PHP front controller — the same `public/index.php` you already point php-fpm at — and Rapira executes it from scratch for every request that arrives. Nothing in your code has to know it is running inside a Rust server: the superglobals are filled in, the script runs top to bottom, and whatever it prints becomes the response.

That is the whole promise of the first rung. Rapira takes php-fpm's place, and the application does not notice.

## Fresh state on every request

Every request gets a complete PHP request cycle: request startup, your entry script, request shutdown. Everything the script built along the way — globals, static properties, the DI container, the ORM's identity map — is torn down before the next request begins, exactly as it would be under php-fpm.

This is why classic mode is the safe drop-in. A leaked handle, a singleton poisoned halfway through a request, a library that stashes request data in a static — none of it can reach the next request, because nothing your script created survives the request it was created in. The same exceptions as php-fpm apply: persistent connections and extension-level state live in the worker process, not in the request. Code that was never written with a long-lived process in mind is fine here, and that includes a great deal of code that is in production right now.

The price is that the application boots again for every request: autoloader, config, container, routes. Whether that matters is exactly the question the [execution modes](/docs/execution-modes) page is about.

## Turning it on

There are two ways to select the mode, and they do the same thing:

- `--classic` on the command line, next to the entry script.
- `classic = true` in the `[pool]` section of a `rapira.toml`.

The flag only ever turns the mode *on* — there is no `--no-classic`, so a config file that sets `classic = true` stays classic no matter what the command line says. Everything else follows the usual precedence, where CLI flags win over the config file; the full key list lives on the [configuration](/docs/configuration) page.

A classic entry script is just PHP:

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

## One entry script, always

Rapira does not map URLs onto files on disk, and it serves nothing from disk on its own. Every request runs the entry script you named, whatever the path was, and the URL arrives as `$_SERVER['REQUEST_URI']` for the application to route. It is the same arrangement as an nginx rule that rewrites everything onto `index.php`, minus the rule.

The CGI variables follow from that: `SCRIPT_FILENAME` is always the entry script, `SCRIPT_NAME` its file name with a leading slash (`/index.php`), and `DOCUMENT_ROOT` the directory it sits in. Static assets need something in front of Rapira — a CDN, or the reverse proxy the [deployment](/docs/deployment) page sets up.

## What stays warm anyway

"From scratch" describes your application's state, not the compiler's work. The master process starts PHP exactly once, at module startup, *before* it forks any worker — so OPcache creates its shared memory segment a single time and every forked worker inherits that same mapping. With OPcache enabled, compiled scripts stay cached across requests and across the whole pool, and re-executing your front controller does not mean re-parsing it.

The fork story behind this — one master, N workers, who serves what — is on the [process model](/docs/process-model) page.

::: info
`Rapira\create_plugin_handler()` throws a `Rapira\RapiraException` in classic mode: *plugin handlers require worker mode*. There is no resident loop to hand a handler to, since the script ends when the request does. Worker scripts belong on the [SAPI Worker](/docs/worker) rung.
:::

## Staying here, or climbing

Stay on classic when the application's state cannot survive a second request — an old codebase, a framework that leaks into statics, a vendor library you do not control — or simply when you are migrating off php-fpm and want one thing to change at a time. Move up to the [SAPI Worker](/docs/worker) rung when the boot work is worth removing and the code can tolerate a process that keeps running; the [execution modes](/docs/execution-modes) page walks the whole ladder, of which Classic and SAPI Worker are the rungs that ship today.

::: question My app calls `fastcgi_finish_request()`. Does that work?
That function comes from the php-fpm binary and Rapira is not it, so no. Rapira exposes `rapira_finish_request()` with the same contract — flush the response to the client early, keep working after it — and it is documented on the [HTTP](/docs/http) page.
:::

::: question Does classic mode still run more than one process?
Yes. The process pool is the same in both modes: the master forks workers, and each worker handles one request at a time, so concurrency comes from the number of processes. See [process model](/docs/process-model).
:::

::: question Do I need a worker script to try Rapira?
No — that is the point of this rung. Point `rapira serve --classic` at the front controller you already have and it runs, unchanged. The [quickstart](/docs/quickstart) does exactly that.
:::
