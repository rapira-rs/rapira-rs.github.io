---
title: Execution modes
description: What Rapira's four execution modes — Classic, SAPI Worker, PSR Worker and Async — do, and what decides which one an application can use.
---

# Execution modes

Rapira runs PHP in one of four execution modes. Two of them ship today; the other two are planned.

| Mode | Status | Description |
| --- | --- | --- |
| [Classic](/docs/classic) | Shipped | The entry script runs from scratch on every request, as under php-fpm. |
| [SAPI Worker](/docs/worker) | Shipped | A resident script boots once and handles requests in a loop; the superglobals are refilled for each request. |
| PSR Worker | Planned | The worker pulls each request through an API call and can work with a PSR-7 message instead of the superglobals. |
| Async | Planned | The worker handles several requests concurrently in one interpreter, using fibers. |

The modes are listed in order of how much control PHP has over the request lifecycle. The names describe whether the worker stays alive between requests and what contract it speaks. Each mode keeps more of the process warm when a request arrives than the one before it, and places more requirements on the code.

## Classic <Badge type="tip" text="shipped" />

The entry script runs from scratch on every request, exactly as it would under php-fpm: superglobals are filled in, the front controller boots, the response goes out, everything is torn down. Nothing the script created is carried over, so application state cannot leak from one request into the next. The same exceptions as php-fpm apply: persistent connections and extension-level state live in the worker process, not in the request.

An existing application runs as it is, because Rapira takes php-fpm's place with no changes to your code. PHP is embedded in the server process, so there is no FastCGI hop between the HTTP front and the interpreter.

See [Classic mode](/docs/classic) for more information.

## SAPI Worker <Badge type="tip" text="shipped" />

SAPI Worker mode has the same shape as Classic — you still read the superglobals, still `echo` your response — except the worker is not torn down at the end of a request. A resident script boots everything once, then loops: the server refills `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` and the rest for each new request, runs your handler, and hands you the next one. Autoloader, DI container, configuration, database connections — anything created outside the loop stays warm.

The boot runs once per worker instead of once per request, and for a modern application that boot is often the most expensive part of the request. The process no longer starts clean on every request, so whatever your application leaves in static properties, singletons or global state is still there on the next one. Rapira can recycle a worker after a set number of requests, so a slow leak in your application or one of its dependencies does not become an outage while you track it down.

See [Worker mode](/docs/worker) for the worker script and its loop, [Configuration](/docs/configuration) for the recycling limit, and [HTTP](/docs/http) for how requests and responses are handled.

## PSR Worker <Badge type="warning" text="planned" />

Control is inverted: instead of waiting to be called, the worker pulls a request from Rapira through an API call and decides what to do with it. It can fill the superglobals for compatibility, or skip them entirely and work with a PSR-7 message it passes straight to a framework's HTTP kernel. It serves one request at a time, the same as SAPI Worker.

The request stops being ambient global state and becomes a value you can pass around, wrap, or hand to a middleware stack.

::: info
PSR Worker mode is not implemented. Nothing about it ships today, and neither its configuration nor its PHP-side API has been designed, so there are no function names or config keys to show yet.
:::

## Async <Badge type="warning" text="planned" />

Async mode uses the same API as PSR Worker mode, except the worker asks for more than one request at once and handles them concurrently inside a single interpreter. PHP 8.1 fibers are what make that possible: a request that is waiting on I/O can yield while another one makes progress, without threads and without a second process.

Async has the strictest requirements of the four modes, because concurrency inside one interpreter means every library in the request path has to work correctly when it is suspended halfway through.

::: info
Async mode is not implemented either. There is nothing to install and nothing to configure. The section above describes the planned direction, not something you can run today.
:::

## Mode selection

Rapira runs SAPI Worker mode by default, and Classic is opt-in. All four modes are open to any application, and what limits the choice is the application's own stack. Global state that cannot survive a second request keeps an application on Classic. A library that is not fiber-safe rules out Async. A framework with a runtime integration makes SAPI Worker mode available with almost no work; see [Frameworks](/docs/frameworks/) for the ones with a documented integration.

The mode is set per server instance, not per route, so one instance cannot serve some routes from a worker and the rest from Classic. If part of your application is not worker-safe, run that part behind its own Rapira instance in Classic mode.

Switching to a worker mode costs work on the PHP side, because a worker needs a resident entry script that Classic does not. Switching back does not: turn Classic on with a flag on the command line or a single key in the config file, point Rapira at your ordinary front controller, and you get the same server, the same binary and the same [process model](/docs/process-model) underneath. See [Configuration](/docs/configuration) and the [CLI reference](/docs/cli) for more details.

::: tip
Start on Classic if you are replacing php-fpm and want everything working first. Switch to SAPI Worker once you know your application boots cleanly and holds no state that it should not keep between requests.
:::
