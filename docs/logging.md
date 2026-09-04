---
title: Logging
description: Rapira log levels, target overrides, PHP diagnostics, application records, formats, and the RUST_LOG override.
---

# Logging

Rapira writes all log records to stderr. These records include server events, master decisions, HTTP events, PHP diagnostics, and application messages. Rapira sends PHP diagnostics to this log instead of a separate `error_log` destination. The configured level filter controls which records it writes.

The default level is `error`, so the server writes only errors. Change the configuration or set `RUST_LOG` to select another level.

## Levels and format

The `[log]` section of `rapira.toml` controls logging:

```toml
[log]
level = "error"   # Use error, warn, info, debug, or trace. Default: error.
format = "plain"  # Use plain or json. Default: plain.
```

`level` sets the minimum level for all targets. `error` shows only errors, while each following level adds more records.
`trace` shows all records. `format` selects readable lines or one JSON object per line.

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

Each key names one target. Other targets use `level`.
A key matches **by prefix**, so `php` also matches `php_sys` and `php_sys::callbacks`. You do not need to list submodules.

Rapira uses these targets:

| Target   | What it covers                                                  |
| -------- | --------------------------------------------------------------- |
| `rapira` | server initialization, worker lifecycle, shutdown              |
| `master` | supervision: forks, reaps, respawns, reloads, pool scaling      |
| `http`   | HTTP listeners, request and response field processing, shutdown |
| `ext`    | extension task outcomes                                          |
| `php`    | output and diagnostics from PHP itself                          |
| `app`    | records the application writes with `\Rapira\log()`              |

Rapira does not write an access log with one line for each request. The [HTTP](/docs/http) page lists field records from the `http` target.

A dependency writes trace records under its module path. The same prefix filtering applies to these records.
Each record contains its target name. Add that name to `[log.targets]` to reduce its output.

::: tip
The `master` target contains worker replacement, reload, and pool scaling records. See [process model](/docs/process-model) for these events.
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

This mask excludes vendor deprecations. Rapira sets their level to `trace`. Set `level = "trace"` to write them.

Fatal errors never change to a lower level because they explain worker termination. Thus, `error_reporting(0)` cannot hide them.
PHP raises `E_CORE_ERROR` and `E_CORE_WARNING` before a script can set a mask. The mask does not apply to them.

::: info
Rapira sends diagnostics to the log instead of responses. It sets the default `display_errors` to `0` and `log_errors` to `1`.
A `php.ini` value overrides these defaults.
:::

## Application logging

`\Rapira\log()` writes a PHP record to the `app` target. It accepts a message, optional level, and optional context array.
The function is available in each execution mode:

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

`\Rapira\log()` uses `Info` when you omit `level`. The global `error` filter suppresses this record unless you change the filter. `[log.targets]` and `RUST_LOG` filter application and server records in the same way. For example, `app = "debug"` changes only the application target.

Rapira serializes the context array to JSON and adds it as a `context` field. In JSON output, `fields` contains this field. Rapira keeps key names and the nested array structure:

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

Rapira expands a `Throwable` before serialization because `json_encode()` returns an empty object for it.
The expanded value contains the class, message, code, file, and line. It also contains the `previous` exception chain.
It does not contain the stack trace:

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

`\Rapira\log()` does not throw. If a context `jsonSerialize()` call throws, Rapira writes `null` for that value. It keeps the other keys.

Rapira replaces values that JSON cannot represent with a placeholder. These values include resources, closures, `NAN`, `INF`, and invalid UTF-8 strings. Rapira keeps the other fields in the record. Rapira does not limit the context size. It serializes large arrays and strings completely. Pass identifiers instead of large objects.

## Formats

Rapira writes both formats to stderr. Large records from different processes can interleave when the processes write to the same stderr pipe.

Rapira does not write logs to other destinations. Redirect stderr to write logs to a file.
A service manager can collect stderr. See [deployment](/docs/deployment) for more information.

**`plain`** is readable terminal output. It contains a timestamp, level, target, and message:

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

Rapira uses colors when stderr is a terminal. It does not use colors when stderr is a file.
Set [`NO_COLOR`](https://no-color.org/) to any non-empty value to disable terminal colors.

**`json`** provides one object per line for a log collector:

```text
{"timestamp":…,"level":"ERROR","fields":{"message":…},"target":…}
```

`timestamp` uses RFC 3339 UTC with milliseconds. The `fields` object contains the message and other record fields. For example, it can contain the application `context` field. Rapira escapes newlines in messages, such as PHP stack traces. Thus, each record uses exactly one line. JSON output does not use colors.

## `RUST_LOG`

`RUST_LOG` sets the log filter from the environment. The commands below change the filter and keep the configuration file unchanged:

```sh
RUST_LOG=info rapira serve --mode worker worker.php
RUST_LOG=rapira=debug,php=info rapira serve --mode worker worker.php
RUST_LOG=warn,rapira=trace rapira serve --mode worker worker.php
```

The first command sets all targets to `info`. The second sets `rapira` to `debug` and `php` to `info`.
The third sets all targets to `warn` and `rapira` to `trace`. The `rapira` target contains initialization, worker, and shutdown records.
Add other target names as required. For example, use `RUST_LOG=warn,rapira=trace,master=trace`.

::: warning
A non-blank `RUST_LOG` value **replaces** `level` and `[log.targets]`. Rapira does not combine the environment and file filters. Remove the variable to use the configuration file settings. Alternatively, set the variable to an empty value. `RUST_LOG` does not affect `format`.
:::
