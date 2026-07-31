---
title: Logging
description: How Rapira logs — levels, per-target overrides, PHP diagnostics, the plain and JSON formats, and the RUST_LOG debugging override.
---

# Logging

Rapira writes everything to a single stream: the server's own lifecycle events, the master's supervision decisions, the HTTP front, and PHP's diagnostics — all of it on stderr, all of it shaped by the same filter. PHP is no exception: a PHP warning is not something you go looking for in a separate `error_log` file, it is a record in the same log as everything else, and you raise or lower it like any other record.

The default is deliberately quiet. Out of the box only `error` gets through, because a server that logs constantly on a production box produces a log nobody reads. Raising the level is one line of config, and if you don't want to touch config at all there is an environment variable for it.

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

One global level is often too coarse. When you are chasing a problem in PHP you want PHP's diagnostics at `debug` without raising every internal detail of the HTTP stack along with them. That is what `[log.targets]` is for:

```toml
[log]
level = "error"

[log.targets]
php = "debug"
pingora_core = "warn"
```

Each key names a target and raises or lowers just that one; everything else stays on `level`. A key matches **by prefix**, so `php` also covers `php_sys` and `php_sys::callbacks` — you name the shortest prefix that covers what you care about, and you never have to enumerate submodules.

The targets Rapira itself emits under:

| Target   | What it covers                                                  |
| -------- | --------------------------------------------------------------- |
| `rapira` | server lifecycle: boot, worker lifecycle, shutdown              |
| `master` | supervision: forks, reaps, respawns, reloads, pool scaling      |
| `http`   | the HTTP front: listeners, request and response field handling, drain |
| `ext`    | extension task outcomes                                          |
| `php`    | output and diagnostics coming from PHP itself                   |

Dependencies log under their own module paths — `pingora_core`, `tokio`, and the rest — and are filtered exactly the same way. If a noisy library shows up in your log, its target name is right there in the record, ready to use in `[log.targets]`.

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

Deprecations sit at `debug` so that a codebase with a few thousand vendor deprecations does not bury the two warnings you actually needed to see.

A diagnostic that the script's [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) mask excludes does not vanish — it drops to `trace`. So the usual mask does what you expect:

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

That keeps vendor deprecations out of the log at any normal level, while `level = "trace"` still brings them back when you want to know what was being silenced. Two exceptions are worth knowing. Fatals are **never** demoted, whatever the mask says: they are the only account of why a worker recycled, and an `error_reporting(0)` buried in a vendor directory must not be able to hide that. And `E_CORE_ERROR`/`E_CORE_WARNING` are raised before a script can set a mask at all, so no mask applies to them either.

::: info
Diagnostics go to the log, not into responses. Rapira defaults [`display_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.display-errors) to `0` and [`log_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.log-errors) to `1` — a server should not leak stack traces into a page. These are *defaults*, not overrides: a php.ini that sets either one wins.
:::

## Formats

Both formats are written to stderr, one write per record. That single-write rule is what keeps a master and a dozen workers writing to the same file descriptor from interleaving mid-record — each record is written whole rather than assembled from fragments.

**`plain`** is the one you want in a terminal — a timestamp, the level, the target, the message:

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

It is colored when stderr is a terminal and never when it is redirected to a file, so a captured log stays free of escape sequences. Setting [`NO_COLOR`](https://no-color.org/) to any non-empty value turns the color off even on a terminal.

**`json`** is the one you want in front of a log collector — one object per line:

```text
{"timestamp":…,"level":"ERROR","message":…,"target":…}
```

`timestamp` is RFC 3339 UTC with milliseconds. Newlines inside a message are escaped, so a record is always exactly one line and a multi-line PHP stack trace never turns into four unparseable ones. Records coming from the bundled proxy engine carry extra `log.*` caller fields. JSON output is never colored, terminal or not.

## `RUST_LOG`

Editing a config file to answer one question and then editing it back is a bad loop, so there is an environment variable that skips it:

```sh
RUST_LOG=info rapira serve worker.php
RUST_LOG=rapira=debug,php=info rapira serve worker.php
RUST_LOG=warn,rapira=trace rapira serve worker.php
```

The first turns everything up to `info`. The second is a targeted pair — the `rapira` target at `debug`, PHP at `info`. The third quiets the dependencies to `warn` and raises Rapira's `rapira` target — boot, worker lifecycle, shutdown — to `trace`. The other targets match by their own names, so add them when the question is elsewhere: `RUST_LOG=warn,rapira=trace,master=trace`.

::: warning
When `RUST_LOG` is set to a non-blank value it **replaces** `level` and `[log.targets]` entirely — the whole filter, not a merge. Your `[log.targets]` entries are not layered underneath it; they are simply not consulted. Leave the variable unset (or blank) to go back to the config. It never affects `format`.
:::

::: question My log is empty — did something break?
Almost certainly not: `level` defaults to `error`, so a healthy server logs nothing. Start it with `RUST_LOG=info` and you'll see boot, the listener, and worker lifecycle.
:::

::: question How do I write the log to a file?
Redirect the process's stderr. Rapira writes only there, which also means a service manager collects it for you without any configuration — see [deployment](/docs/deployment).
:::

::: question Why do I still see a deprecation I masked with `error_reporting()`?
Masked diagnostics drop to `trace` rather than disappearing, so they only reappear at `level = "trace"`. If you are running at `trace` and don't want them, raise the level.
:::

::: question Is there an access log?
No — there is no one-line-per-request log. The `http` target reports listeners, drain, and anything unusual about a request's or response's fields; see [HTTP](/docs/http) for what it does with those.
:::
