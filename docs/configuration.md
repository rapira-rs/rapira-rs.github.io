---
title: Configuration
description: "All rapira.toml keys, types, defaults, and validation rules."
---

# Configuration

Rapira can start without a configuration file. `rapira serve --mode worker app/worker.php` uses the default settings.
Create a configuration file named `rapira.toml` to change the address, worker count, recycling policy, pidfile, or log level. Specify the configuration file with this command:

```bash
rapira serve --config /etc/rapira/rapira.toml
```

The configuration file has four optional sections. `[http]` configures the listener, and `[pool]` configures worker processes.
`[supervisor]` configures the master process. `[log]` configures output to stderr.
The PHP entry script has no default. Set `pool.entrypoint` or pass the script as a CLI argument.

::: info
CLI flags override configuration file values. Configuration file values override built-in defaults.
For example, `--processes 8` overrides `processes = 4` for one run.
Only two logging environment variables affect the settings. See the [CLI page](/docs/cli) for the available flags.
:::

## A complete rapira.toml

The following configuration file contains each supported key. Most keys use their default when they are absent.
`pool.entrypoint` has no default. Dynamic scaling requires `min_spare` and `max_spare`.
The `[http.static]` table requires `http.static.root`.

Some keys must occur together. The `[http.static]` table requires a `"static"` middleware entry, and that entry requires the table.
Remove `min_spare` and `max_spare` when scaling is not `dynamic`. Rapira rejects these keys with `static` and `ondemand` scaling.

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # Optional. Sets SERVER_NAME for PHP.
server_port = 8000                    # Optional. Uses the TCP listen port by default.
max_body_size_mb = 8                  # Optional. Rapira returns 413 for larger request bodies.
write_timeout_secs = 30               # Optional. Closes a connection after a response write times out.
keepalive_timeout_secs = 60           # Optional. Limits idle periods and read operations.
unsafe_field_names = "drop"           # Optional. Use "drop" or "reject". Default: "drop".
middleware = ["static"]               # Optional. Rapira uses the list order.

[http.static]                         # Required when middleware contains "static".
root = "public"                       # Required. Relative paths use this file's directory.
forbid = [".php"]                     # Optional. Rapira does not serve these suffixes.

[http.sendfile]                       # Optional. Sets the sendFile() root in Dispatcher mode.
root = "public"                       # Optional. Uses the entry script directory by default.

[http.uploads]                        # Optional. Sets multipart limits in Dispatcher mode.
dir = "/var/spool/rapira"             # Optional. Uses the system temporary directory by default.
max_file_size_mb = 2                  # Optional. Limits one file part.
max_field_size_kb = 256               # Optional. Limits one field part.
max_files = 20                        # Optional. Limits file parts in one request.
max_parts = 1024                      # Optional. Limits all parts in one request.
max_part_headers = 32                 # Optional. Limits fields in one part.

[pool]
entrypoint = "index.php"              # Relative paths use this file's directory.
mode = "dispatcher"                   # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
processes = 4                         # Sets the worker count and the scaling maximum.
scaling = "dynamic"                   # Use "static", "dynamic", or "ondemand". Default: "static".
min_spare = 1                         # For dynamic scaling. Sets the minimum idle worker count.
max_spare = 3                         # For dynamic scaling. Sets the maximum idle worker count.
max_requests = 0                      # Replaces a worker after this request count. Zero disables the limit.
process_idle_timeout_secs = 10        # For ondemand scaling. Removes workers after this idle time.
request_terminate_timeout_secs = 0    # Replaces a worker when one request exceeds this time. Zero disables the limit.

[supervisor]                          # Optional. Sets master process behavior.
pidfile = "/run/rapira.pid"           # Optional. Relative paths use this file's directory.
process_control_timeout_secs = 30     # Waits after SIGQUIT before SIGTERM. SIGKILL follows one second later.

[log]                                 # Optional. Sets the level and record format.
level = "error"                       # Use error, warn, info, debug, or trace. Default: error.
format = "plain"                      # Use plain or json. Default: plain.

[log.targets]                         # Optional. Overrides the level for each target.
php = "debug"
http = "warn"
```

The rest of this page documents those keys section by section.

## The `[http]` section

This section defines the listener and the server information reported to PHP. It also defines request-body limits and the middleware that runs before PHP.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `listen` | string | `"127.0.0.1:8000"` | The bind address. Use `host:port` with an IP address, `:port` for all interfaces, or `unix:/run/rapira.sock` for a Unix socket. Rapira rejects a port without an address and rejects host names. |
| `server_name` | string | `"localhost"` | What PHP reads as `$_SERVER['SERVER_NAME']`. |
| `server_port` | integer | the listen port, `80` for `unix:` | The value of `$_SERVER['SERVER_PORT']`. Set it when the proxy port differs from the Rapira port. |
| `max_body_size_mb` | integer | `8` | The largest request body in MiB. Rapira returns `413` for a larger body. The minimum is 1. |
| `write_timeout_secs` | integer | `30` | The maximum time without progress during a response write. Rapira then closes the connection. The range is 1 through `86400`. |
| `keepalive_timeout_secs` | integer | `60` | The maximum time without request progress. It applies to idle connections, request headers, and request body frames. Rapira returns `408` after the limit. The range is 1 through `86400`. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | Processing for a field name outside `[A-Za-z0-9-]`. Rapira can remove and log the field or return `400`. See the [HTTP page](/docs/http). |
| `middleware` | list of strings | empty | Middleware that runs before PHP, in list order. Only `"static"` is available. Rapira rejects duplicate names and names without configuration tables. It also rejects unused middleware tables. |

`server_name` and `server_port` change only `$_SERVER` values. Only `listen` changes the bind address.

### The `[http.static]` table

The `static` middleware can return a file before PHP receives the request. It handles `GET` and `HEAD`.
PHP receives other methods and paths that do not identify a file. PHP also receives hidden paths and directory paths.
The middleware does not serve index files.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `root` | string | none, required | The served directory. A relative path uses the configuration file directory as its base. The directory must exist and be accessible during initialization. |
| `forbid` | list of strings | `[".php"]` | File name suffixes that the middleware does not serve. Each entry starts with a dot and has at least two characters. It cannot contain `/` or whitespace. Matching is not case-sensitive. An explicit list replaces the default. |

Each worker caches up to 16 MiB of served files. It does not cache a file larger than 256 KiB.
A cache entry is valid for one second. Clients can receive a changed file after this interval.

See [Static files](/docs/static-files) for more information.

### The `[http.sendfile]` table

The sendfile root is the directory that `sendFile()` can read. Rapira resolves the root and requested path to canonical paths.
It rejects a path outside the root.
`sendFile()` is a method of `Rapira\Http\Exchange`. Only Dispatcher mode gives an exchange to the script.
Therefore, this table affects only Dispatcher mode. Classic and Worker modes accept but do not use it.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `root` | string | the directory holding the entry script | The only directory `sendFile()` may read. A relative path resolves against the directory holding the configuration file. |

Rapira cannot resolve a root that does not exist during initialization. In this condition, `sendFile()` rejects every path.
Create the directory before you start the server.

### The `[http.uploads]` table

The `[http.uploads]` table sets limits for host-side `multipart/form-data` parsing. Only Dispatcher mode parses multipart bodies in the host.
Classic and Worker modes parse them in PHP and use `php.ini` limits. Rapira rejects this table in these two modes.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dir` | string | the system temp directory | Storage directory for file parts. A relative path uses the configuration file directory as its base. Rapira creates and checks this directory. Each worker creates a `rapira-spool-<pid>` subdirectory and removes it during shutdown. |
| `max_file_size_mb` | integer | `2` | Largest single file part, in MiB. |
| `max_field_size_kb` | integer | `256` | Largest single field part, in KiB. |
| `max_files` | integer | `20` | File parts permitted in one request. |
| `max_parts` | integer | `1024` | File and field parts permitted in one request. |
| `max_part_headers` | integer | `32` | Header fields permitted in one part. |

Each limit must be at least 1. Rapira returns `413` when a request exceeds a limit.

## The `[pool]` section

Workers run PHP. This section defines what they run, how many run, and when the master removes one. The [process model](/docs/process-model) explains how the master uses these values.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `entrypoint` | string | none, required | The PHP script that each worker runs. A relative path uses the configuration file directory as its base. A `SCRIPT` CLI argument overrides this key. You must set one value. |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | How a worker runs the entry script. `classic` starts a new PHP request each time. `worker` retains the script and refills the superglobals. `dispatcher` gives a dispatcher object to the retained script. The `--mode` flag overrides this key. See [execution modes](/docs/execution-modes). |
| `processes` | integer | one per logical CPU | The worker count. With `dynamic` and `ondemand` scaling, it is the maximum count. The minimum is 1. |
| `scaling` | `"static"` \| `"dynamic"` \| `"ondemand"` | `"static"` | The pool size policy. `static` retains `processes` workers. `dynamic` uses the spare limits. `ondemand` creates workers for requests and removes idle workers. |
| `min_spare` | integer | none | Required with `dynamic` scaling. The master keeps at least this many idle workers. |
| `max_spare` | integer | none | Required with `dynamic` scaling. The master keeps no more than this many idle workers. The values must satisfy `1 <= min_spare <= max_spare <= processes`. |
| `max_requests` | integer | `0` | The request limit before worker replacement. Rapira varies the limit slightly to prevent simultaneous replacements. `0` disables the limit. |
| `process_idle_timeout_secs` | integer | `10` | With `ondemand` scaling, the master removes a worker after this idle time. |
| `request_terminate_timeout_secs` | integer | `0` | Wall-clock limit for one request. Rapira terminates and replaces a worker that exceeds this limit. `0` disables the check. |

`mode` controls entry script execution. `scaling` controls the worker count.

Rapira checks the spare limits against the effective `processes` value. Therefore, `--processes` can reduce the permitted `max_spare` value.

## The `[supervisor]` section

This section defines the master process policy. The master owns the listen socket, supervises workers, and receives signals.
The init system controls the master. See [deployment](/docs/deployment) for a unit file.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `pidfile` | string | none | The file for the master process identifier. A relative path uses the configuration file directory as its base. Send process signals to this identifier. See [process model](/docs/process-model). |
| `process_control_timeout_secs` | integer | `30` | How long the master waits after `SIGQUIT` before it sends `SIGTERM`. The master sends `SIGKILL` one second after `SIGTERM`. |

## The `[log]` section

Rapira writes each log record to stderr.
This section controls the log level and format. See [logging](/docs/logging) for targets, formats, and PHP diagnostic levels.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | Verbosity, applied to every target at once. |
| `format` | `"plain"` \| `"json"` | `"plain"` | The record format. Plain output contains readable lines and can use colors. JSON output contains one object per line. |
| `[log.targets]` | table of target → level | empty | Log level overrides for targets. `php` contains PHP output, and `http` contains HTTP server output. Keys match target prefixes. See [Logging](/docs/logging). |

A `[log.targets]` key uses letters, digits, `_`, `:`, `.`, or `-`. It must start with a letter, digit, or `_`.
Rapira rejects other characters because the log filter can interpret them as syntax.
A target key that contains `:` or `.` must use quotes because TOML does not permit these characters in a bare key. For example:

```toml
[log.targets]
"php_sys::callbacks" = "debug"
```

Rapira reads only the `RUST_LOG` and `NO_COLOR` environment variables. Both variables affect only logs.
`RUST_LOG` replaces the complete filter for one run. `NO_COLOR` disables plain output colors when its value is not empty.

## Unknown key rejection

Rapira accepts only documented tables and keys. For example, `[htttp]` or `lissten = ":8000"` causes initialization to fail.
The error identifies the unknown name. Rapira does not ignore it.
Each key belongs to one table. For example, `max_requests` belongs to `[pool]`, and `pidfile` belongs to `[supervisor]`.

Rapira also validates values. It rejects unsupported values instead of replacing them with defaults.
For example, it rejects `level = "verbose"`, `format = "pretty"`, and `unsafe_field_names = "allow"`.
Numeric values have limits. Worker counts, body sizes, HTTP timeouts, and upload limits must be at least 1.
Each `*_secs` key has a maximum of `86400`, which is one day.

::: warning
Rapira validates the configuration file before initialization. An unknown key prevents the server from starting.
Configuration file changes do not affect a running process. Rapira validates the changed configuration file during the next start.
:::

## Relative paths

Five keys contain file system paths: `pool.entrypoint`, `supervisor.pidfile`, `http.static.root`, `http.sendfile.root`, and `http.uploads.dir`.
Each relative path uses the configuration file directory as its base.
For example, set `entrypoint = "app/worker.php"` in `/etc/rapira/rapira.toml`. The resulting path is `/etc/rapira/app/worker.php`.

The positional `SCRIPT` argument uses the current directory as the base for a relative path.

::: tip
Keep the `rapira.toml` configuration file inside the application. Write its paths relative to the configuration file.
You can move the application directory without changing these paths.
:::
