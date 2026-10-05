---
title: Logging
description: Rapira log levels, target overrides, PHP diagnostics, application records, formats, and the RUST_LOG override.
---

# Logging

Rapira writes log records to stderr. These records include server events, master decisions, HTTP and gRPC events, PHP diagnostics, and application messages. PHP sends its diagnostics to this log when the `error_log` ini setting is empty, which is the default.

The default level is `error`, so stderr contains only errors. Change the `[log]` section or set `RUST_LOG` to select another level.

## Levels and format

The `[log]` section of `rapira.toml` controls stderr logging:

```toml
[log]
level = "error"   # Use error, warn, info, debug, or trace. Default: error.
format = "plain"  # Use plain or json. Default: plain.
```

`level` sets the minimum level for all targets. `error` shows only errors, and each following level adds more records. `trace` shows all records. `format` selects readable lines or one JSON object per line.

Both keys and the complete section are optional. See [configuration](/docs/configuration) for the other configuration file sections.

## Per-target overrides

`[log.targets]` overrides the global level for individual targets. For example, it can enable PHP debug records and leave HTTP debug records disabled:

```toml
[log]
level = "error"

[log.targets]
php = "debug"
http = "warn"
```

Each key names one target. Other targets use `level`. A key matches **by prefix**, so `h2` also matches the `h2::codec` and `h2::proto` module paths of a dependency. You do not need to list submodules.

Rapira uses these targets:

| Target          | What it covers                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `rapira`        | server initialization, worker lifecycle, shutdown                                               |
| `master`        | pool status, spawn errors, reload readiness warnings, and request timeout warnings             |
| `http`          | HTTP listeners, request and response field processing, shutdown                                 |
| `grpc`          | gRPC listeners, transport failures, shutdown                                                    |
| `net`           | the accept loop of the HTTP and gRPC listeners, accept failures                                 |
| `observability` | the [metrics and probe process](/docs/observability): listener, request drain, failures         |
| `php`           | output and diagnostics from PHP itself                                                          |
| `app`           | records the application writes with `\Rapira\log()`                                              |

Rapira does not write an access log with one line for each request. The [HTTP](/docs/http) page lists field records from the `http` target.

A dependency writes trace records under its module path. The same prefix filtering applies to these records. Each record contains its target name. Add that name to `[log.targets]` to change its level.

::: tip
The `master` target reports pool status, spawn errors, reload readiness warnings, and request timeout warnings. See [Process model](/docs/process-model) for pool supervision.
:::

## PHP diagnostics

Rapira maps PHP diagnostics to the `php` target. Each PHP error type maps to a log level:

| Diagnostic                                                                                     | Level   |
| ---------------------------------------------------------------------------------------------- | ------- |
| Fatal errors: `E_ERROR`, `E_PARSE`, `E_CORE_ERROR`, `E_COMPILE_ERROR`, `E_USER_ERROR`, `E_RECOVERABLE_ERROR` | `error` |
| Warnings: `E_WARNING`, `E_CORE_WARNING`, `E_COMPILE_WARNING`, `E_USER_WARNING`                | `warn`  |
| Notices: `E_NOTICE`, `E_USER_NOTICE`                                                          | `info`  |
| Deprecations: `E_DEPRECATED`, `E_USER_DEPRECATED`                                             | `debug` |

Deprecations use `debug`. Thus, vendor deprecations do not hide warnings and errors.

Rapira sets a diagnostic's level to `trace` when [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) excludes it. For example:

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

This mask excludes vendor deprecations. Set `level = "trace"` to write them.

PHP does not write a masked diagnostic. In Worker and Dispatcher modes, Rapira writes the last PHP diagnostic at fixed points. Worker mode does this after the boot run, after each job, and when the entrypoint script ends. Dispatcher mode does this only when the entrypoint script ends. Thus, Rapira writes a masked diagnostic only when it is the last diagnostic before one of these points. Classic mode does not write masked diagnostics.

Fatal errors always keep the `error` level, so `error_reporting(0)` cannot hide them. The mask also does not apply to `E_CORE_ERROR` and `E_CORE_WARNING`, because PHP raises them before a script can set a mask.

::: info
Rapira sends diagnostics to the log instead of responses. It sets the default `display_errors` to `0` and `log_errors` to `1`. A `php.ini` value overrides these defaults.
:::

PHP output outside a response goes to the `php` target at `info`. For example, `echo` in the boot run of Worker mode goes to the log. In [Dispatcher mode](/docs/dispatcher), all `echo` output goes to the log, because responses use the dispatcher API. The default `error` level hides these records. Set `php = "info"` in `[log.targets]` to show them.

::: question Why does a PHP warning appear two times in the log?
In Worker and Dispatcher modes, Rapira also writes the last PHP diagnostic. If this diagnostic is not masked, PHP writes it too. Thus, the log contains two records with the same level and different text formats.
:::

## Application logging

`\Rapira\log()` writes a record to the `app` target. It accepts a message, an optional level, and an optional context array. The function is available in each execution mode:

```php
<?php

\Rapira\log('order placed');
\Rapira\log('payment declined', \Rapira\LogLevel::Warning);
\Rapira\log('cache miss', \Rapira\LogLevel::Debug, ['key' => 'user:42', 'ttl' => 300]);
```

The level is a case of the `\Rapira\LogLevel` enum. Each case maps to a Rapira log level:

| `LogLevel` case | Record level |
| --------------- | ------------ |
| `Error`         | `error`      |
| `Warning`       | `warn`       |
| `Info`          | `info`       |
| `Debug`         | `debug`      |
| `Trace`         | `trace`      |

`\Rapira\log()` uses `Info` when you omit `level`. The default `error` level hides `Info` records. Set `app = "info"` in `[log.targets]` to write them.

Rapira encodes the context array as JSON text and adds it as the `context` field. In JSON output, `fields.context` is a string, not a nested object. The JSON text keeps the key names and the nested array structure. Decode this string in the log collector to read the keys:

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

Rapira expands a `Throwable` that is a top-level value of the context. It does this because `json_encode()` returns an empty object for a `Throwable`. Rapira does not expand a `Throwable` in a nested array, so it encodes as an empty object. The expanded value contains the class, message, code, file, and line. It also contains up to four `previous` exceptions. It does not contain the stack trace:

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

`\Rapira\log()` does not throw. If a context `jsonSerialize()` call throws, Rapira writes `null` for that value. It keeps the other keys.

::: question How does Rapira serialize large log contexts?
Rapira encodes the context with the `JSON_PARTIAL_OUTPUT_ON_ERROR` flag. A resource or an invalid UTF-8 string becomes `null`. `NAN` and `INF` become `0`. The other fields stay in the record.

Rapira does not shorten arrays or strings. Pass identifiers instead of large objects.
:::

## Formats

Rapira writes both formats to stderr. Large records from different processes can interleave when the processes write to the same stderr pipe.

Redirect stderr to write logs to a file. A service manager can collect stderr. See [deployment](/docs/deployment) for more information.

**`plain`** is readable terminal output. It contains a timestamp, level, target, and message:

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

Rapira uses colors only when stderr is a terminal. Set [`NO_COLOR`](https://no-color.org/) to any non-empty value to disable terminal colors.

**`json`** provides one object per line for a log collector:

```text
{"timestamp":…,"level":"ERROR","fields":{"message":…},"target":…}
```

`timestamp` uses RFC 3339 UTC with microseconds. The `fields` object contains the message and other record fields. For example, it can contain the application `context` field. Rapira escapes newlines in messages, such as PHP stack traces. Thus, each record uses exactly one line. JSON output does not use colors.

## `RUST_LOG`

`RUST_LOG` sets the stderr log filter from the environment. The commands below change the filter and keep the configuration file unchanged:

```sh
RUST_LOG=info rapira serve rapira.toml
RUST_LOG=error,rapira=debug,php=info rapira serve rapira.toml
RUST_LOG=warn,rapira=trace,master=trace rapira serve rapira.toml
```

The first command sets all targets to `info`. The second sets `rapira` to `debug`, `php` to `info`, and all other targets to `error`. The third sets all targets to `warn`, and `rapira` and `master` to `trace`.

A target that the value does not match writes no records. For example, `RUST_LOG=php=info` hides all errors from the `master` and `http` targets. Add a level without a target name, such as `error`, to keep records from the other targets.

::: warning
A non-blank `RUST_LOG` value **replaces** `level` and `[log.targets]`. Rapira does not combine the environment and file filters. Remove the variable to use the configuration file settings. Alternatively, set the variable to an empty value. `RUST_LOG` does not affect `format`.
:::
