---
title: Logging
description: How Rapira logs — levels, per-target overrides, PHP diagnostics, application logging from PHP, the plain and JSON formats, and the RUST_LOG debugging override.
---

# Logging

Rapira writes everything to a single stream: the server's own lifecycle events, the master's supervision decisions, the HTTP front, PHP's diagnostics, and whatever the application logs itself — all of it on stderr. A PHP warning is a record in that same log rather than a line in a separate `error_log` file, and it is raised or lowered like any other record.

The default level is `error`, so only errors get through and a healthy server logs nothing. Raising it is one line of config, or the `RUST_LOG` environment variable when you don't want to edit config at all.

## Levels and format

Logging lives in the `[log]` section of your `rapira.toml`:

```toml
[log]
level = "error"   # error (default) | warn | info | debug | trace
format = "plain"  # plain (default) | json
```

`level` is the floor for every target at once: `error` shows only errors, `warn` adds warnings, and so on down to `trace`, which shows everything. `format` picks the shape of each record — human-readable lines or one JSON object per line.

Both keys are optional, and so is the whole section. The rest of the file — listeners, the pool, the supervisor — is described on the [configuration](/docs/configuration) page.

## Per-target overrides

One global level is often too coarse. `[log.targets]` raises or lowers individual targets on top of it, so PHP's diagnostics can run at `debug` without every internal detail of the HTTP stack coming with them:

```toml
[log]
level = "error"

[log.targets]
php = "debug"
http = "warn"
```

Each key names a target and raises or lowers just that one; everything else stays on `level`. A key matches **by prefix**, so `php` also covers `php_sys` and `php_sys::callbacks` — the shortest matching prefix is enough, and submodules never have to be listed individually.

The targets Rapira itself emits under:

| Target   | What it covers                                                  |
| -------- | --------------------------------------------------------------- |
| `rapira` | server lifecycle: boot, worker lifecycle, shutdown              |
| `master` | supervision: forks, reaps, respawns, reloads, pool scaling      |
| `http`   | the HTTP front: listeners, request and response field handling, drain |
| `ext`    | extension task outcomes                                          |
| `php`    | output and diagnostics coming from PHP itself                   |
| `app`    | records the application writes with `\Rapira\log()`              |

There is no access log: Rapira does not write one line per request. What the `http` target reports about a request's or response's fields is described on the [HTTP](/docs/http) page.

A dependency that emits tracing records logs under its own module path, and the same prefix filtering applies to it. Every record carries its target name. To quiet a noisy target, copy its name into `[log.targets]`.

::: tip
`master` is the target to watch when you want to understand why the pool is behaving the way it is — respawns, reloads and pool scaling are all logged there. See [process model](/docs/process-model) for what those events mean.
:::

## PHP diagnostics

Everything PHP reports lands on the `php` target, and each diagnostic takes its level from its error type — so the same filter that controls the server controls how much of PHP's output reaches the log:

| Diagnostic                                                                                     | Level   |
| ---------------------------------------------------------------------------------------------- | ------- |
| Fatal errors — `E_ERROR`, `E_PARSE`, `E_CORE_ERROR`, `E_COMPILE_ERROR`, `E_USER_ERROR`, `E_RECOVERABLE_ERROR` | `error` |
| Warnings — `E_WARNING`, `E_CORE_WARNING`, `E_COMPILE_WARNING`, `E_USER_WARNING`                | `warn`  |
| Notices — `E_NOTICE`, `E_USER_NOTICE`                                                          | `info`  |
| Deprecations — `E_DEPRECATED`, `E_USER_DEPRECATED`                                             | `debug` |

Deprecations sit at `debug` so that a codebase with a few thousand vendor deprecations does not bury the warnings and errors reported alongside them.

A diagnostic that the script's [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) mask excludes does not vanish — it drops to `trace`. So the usual mask does what you expect:

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

That keeps vendor deprecations out of the log at any normal level, while `level = "trace"` still brings them back when you want to know what was being silenced. There are two exceptions. Fatals are **never** demoted, whatever the mask says, because they are the only account of why a worker recycled — an `error_reporting(0)` in a vendor directory cannot hide them. `E_CORE_ERROR`/`E_CORE_WARNING` are raised before a script can set a mask at all, so no mask applies to them either.

::: info
Diagnostics go to the log, not into responses: Rapira defaults [`display_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.display-errors) to `0` and [`log_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.log-errors) to `1`. These are *defaults*, not overrides: a php.ini that sets either one wins.
:::

## Application logging

`\Rapira\log()` writes a record from PHP onto the `app` target. It takes a message, an optional level and an optional context array, and is available in every execution mode:

```php
<?php

\Rapira\log('order placed');
\Rapira\log('payment declined', \Rapira\LogLevel::Warning);
\Rapira\log('cache miss', \Rapira\LogLevel::Debug, ['key' => 'user:42', 'ttl' => 300]);
```

The level is a case of the `\Rapira\LogLevel` enum, and each case maps onto the level the rest of the log already uses:

| `LogLevel` case | Record level |
| --------------- | ------------ |
| `Error`         | `error`      |
| `Warning`       | `warn`       |
| `Info`          | `info`       |
| `Debug`         | `debug`      |
| `Trace`         | `trace`      |

Omitting the level logs at `Info`. Because these are the same levels as everywhere else, `[log.targets]` and `RUST_LOG` filter application records exactly as they filter the server's own — `app = "debug"` in `[log.targets]` raises the application's records without touching anything around them.

The context array is serialized to JSON and attached to the record as a `context` field. In the `json` format that field sits inside the record's `fields` object. Keys are preserved as written, and nested arrays keep their structure:

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

A `Throwable` in the context is expanded before serialization, because `json_encode()` sees an exception as an empty object — its state lives in private properties of `Exception` and `Error`. The expansion carries the class name, message, code, file and line, and follows the `previous` chain; the stack trace is not included:

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

`\Rapira\log()` never throws: it discards an exception raised by a context value's `jsonSerialize()`, writes that value as `null`, and keeps the other keys unchanged.

Two limits are worth knowing when deciding what to put in a context. A value JSON cannot represent — a resource, a closure, `NAN` or `INF`, a string that is not valid UTF-8 — is replaced with a placeholder rather than costing you the record, so the surrounding keys still arrive. And the context is not bounded in size: a large array or a long string is serialized in full and becomes a correspondingly large record, so pass identifiers rather than the objects they identify.

## Formats

Both formats are written to stderr, one write per record. That single-write rule is what keeps a master and a dozen workers writing to the same file descriptor from interleaving mid-record — each record is written whole rather than assembled from fragments.

Rapira writes nowhere else, so redirecting the process's stderr is what puts the log in a file, and a service manager collects it without any configuration. See [deployment](/docs/deployment) for more information.

**`plain`** is for reading in a terminal — a timestamp, the level, the target, the message:

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

It is colored when stderr is a terminal and never when it is redirected to a file, so a captured log stays free of escape sequences. Setting [`NO_COLOR`](https://no-color.org/) to any non-empty value turns the color off even on a terminal.

**`json`** is for a log collector — one object per line:

```text
{"timestamp":…,"level":"ERROR","fields":{"message":…},"target":…}
```

`timestamp` is RFC 3339 UTC with milliseconds. The `fields` object holds the message and every other field of the record, such as the `context` field of an application record. Newlines inside a message are escaped, so a record is always exactly one line, including a multi-line PHP stack trace. JSON output is never colored, terminal or not.

## `RUST_LOG`

`RUST_LOG` sets the log filter from the environment, so a one-off debugging session needs no config edit:

```sh
RUST_LOG=info rapira serve --mode worker worker.php
RUST_LOG=rapira=debug,php=info rapira serve --mode worker worker.php
RUST_LOG=warn,rapira=trace rapira serve --mode worker worker.php
```

The first turns everything up to `info`. The second is a targeted pair: the `rapira` target at `debug`, PHP at `info`. The third sets every target to `warn` and then raises the `rapira` target to `trace`. That target covers boot, worker lifecycle and shutdown. The other targets match by their own names, so add them when the question is elsewhere: `RUST_LOG=warn,rapira=trace,master=trace`.

::: warning
When `RUST_LOG` is set to a non-blank value it **replaces** `level` and `[log.targets]` entirely — the whole filter, not a merge. Your `[log.targets]` entries are not layered underneath it; they are simply not consulted. Leave the variable unset (or blank) to go back to the config. It never affects `format`.
:::
