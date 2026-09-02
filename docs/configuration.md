---
title: Configuration
description: "The complete rapira.toml reference: every key in [http], [pool], [supervisor] and [log], with its type, default and the rules that reject a bad value."
---

# Configuration

Rapira does not need a configuration file to start. `rapira serve --mode worker app/worker.php` uses the default settings. Add a `rapira.toml` when you need a different address, worker count, recycling policy, pidfile, or log level. Point the server at the file, and it reads its settings from there:

```bash
rapira serve --config /etc/rapira/rapira.toml
```

The file has four sections, and every one of them is optional: `[http]` configures the listener, `[pool]` the worker processes, `[supervisor]` the master process, `[log]` what gets written to stderr. The one value Rapira has no default for is the PHP entry script — set `pool.entrypoint` here, or pass the script as a positional argument on the command line.

::: info
Settings are layered: a CLI flag beats the config file, which beats the built-in default. `--processes 8` therefore wins over `processes = 4` in the file, so a config you keep in version control can still be overridden for a single run. Environment variables are not part of that layering: apart from two that only affect logging, settings come from the file and the flags alone. The flags themselves are documented on the [CLI page](/docs/cli).
:::

## A complete rapira.toml

Every key Rapira understands, in one file. Nothing below is mandatory: delete any line and its default applies. Four keys are the exception. `pool.entrypoint` has no default to fall back on. `min_spare` and `max_spare` are required for as long as `scaling = "dynamic"` is set. `http.static.root` is required for as long as the `[http.static]` table is present.

Two groups of keys must remain together, so a partial deletion stops the boot. Delete the `[http.static]` table and the `"static"` middleware entry together. Rapira rejects either item when the other item is absent. Delete `min_spare` and `max_spare` when you remove `scaling = "dynamic"`. Rapira rejects both spare keys under `static` and `ondemand` scaling.

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # optional; SERVER_NAME reported to PHP
server_port = 8000                    # optional; defaults to the listen TCP port (80 for unix:)
max_body_size_mb = 8                  # optional; larger request bodies get a 413
write_timeout_secs = 30               # optional; closes the connection when a response write stalls
keepalive_timeout_secs = 60           # optional; bounds an idle keepalive connection, one head read, one body frame
unsafe_field_names = "drop"           # optional; drop (default) | reject
middleware = ["static"]               # optional; the list order is the chain order

[http.static]                         # required when middleware lists "static"
root = "public"                       # required; the directory must exist; relative → this file's directory
forbid = [".php"]                     # optional; suffixes never served; an explicit list replaces the default

[http.sendfile]                       # optional; containment root for sendFile(), Dispatcher mode only
root = "public"                       # optional; defaults to the entrypoint's directory

[http.uploads]                        # optional; host-side multipart limits, Dispatcher mode only
dir = "/var/spool/rapira"             # optional; defaults to the system temp directory
max_file_size_mb = 2                  # optional; per file part
max_field_size_kb = 256               # optional; per field part
max_files = 20                        # optional; file parts per request
max_parts = 1024                      # optional; parts per request
max_part_headers = 32                 # optional; header fields per part

[pool]
entrypoint = "index.php"              # relative → resolved against this file's directory
mode = "dispatcher"                   # classic | worker | dispatcher (default)
processes = 4                         # worker processes to fork (max_children for dynamic/ondemand scaling)
scaling = "dynamic"                   # static (default) | dynamic | ondemand
min_spare = 1                         # dynamic only: keep at least this many idle workers
max_spare = 3                         # dynamic only: trim to at most this many idle workers (rejected under other scaling)
max_requests = 0                      # recycle a worker after N requests (+jitter); 0 = unlimited
process_idle_timeout_secs = 10        # ondemand: retire an idle worker after this long
request_terminate_timeout_secs = 0    # kill a worker whose single request runs longer (wall clock); 0 = off

[supervisor]                          # optional; master-process policy
pidfile = "/run/rapira.pid"           # optional; relative paths resolve against this file's dir
process_control_timeout_secs = 30     # graceful-stop budget before QUIT → TERM → KILL

[log]                                 # optional; verbosity and record shape
level = "error"                       # error (default) | warn | info | debug | trace
format = "plain"                      # plain (default) | json

[log.targets]                         # optional; per-target overrides on top of level
php = "debug"
http = "warn"
```

The rest of this page documents those keys section by section.

## The `[http]` section

This section defines the listener and the server information reported to PHP. It also defines request-body limits and the middleware that runs before PHP.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `listen` | string | `"127.0.0.1:8000"` | The bind address, in one of three shapes: `host:port` with an IP literal (`127.0.0.1:8000`, `[::1]:8000`), `:port` for every interface, or `unix:/run/rapira.sock` for a Unix socket. A bare port and a hostname are both rejected — an address has to say which interface it means. |
| `server_name` | string | `"localhost"` | What PHP reads as `$_SERVER['SERVER_NAME']`. |
| `server_port` | integer | the listen port, `80` for `unix:` | What PHP reads as `$_SERVER['SERVER_PORT']`. Set it when a proxy in front of Rapira terminates on a different port than the one Rapira binds. |
| `max_body_size_mb` | integer | `8` | Largest request body Rapira will accept, in MiB (1024 × 1024 bytes). Anything bigger is answered `413`. Must be at least 1. |
| `write_timeout_secs` | integer | `30` | How long one response write may make no progress. Rapira closes the connection when a client stops reading for longer than this. Must be at least 1, and at most `86400`. |
| `keepalive_timeout_secs` | integer | `60` | How long a connection may make no progress on a request. It bounds an idle keepalive connection waiting for the next request, one request head read, and one request body frame read. A body that stalls past the limit is answered `408`. Must be at least 1, and at most `86400`. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | What happens to a request field whose name is not `[A-Za-z0-9-]`: remove it before PHP sees it, logging each removal at `warn`, or answer `400`. Both the reasoning and the CGI mapping behind it are on the [HTTP page](/docs/http). |
| `middleware` | list of strings | empty | Which middleware handles a request before PHP does. The list order is the chain order. `"static"` is the only name Rapira knows currently. A name listed twice is rejected, a listed name without its table is rejected, and a configured table that the list omits is rejected too, so the list is the single switch for each middleware. |

`server_name` and `server_port` only shape what PHP sees in `$_SERVER`; neither changes what the server binds, which is set by `listen` alone.

### The `[http.static]` table

The `static` middleware answers a request from a directory on disk before the request reaches PHP. It handles `GET` and `HEAD`. Every other method goes to PHP. A path that names no file falls through to PHP. A path with a segment that starts with a dot falls through as well. A directory URL falls through too: the middleware serves no index file.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `root` | string | none, required | The directory the middleware serves. A relative path resolves against the directory holding the config file. The directory has to exist when the server boots, and the server process needs permission to enter it. The boot fails otherwise. |
| `forbid` | list of strings | `[".php"]` | File-name suffixes the middleware never serves. Each entry starts with a dot, holds at least two characters, and carries neither `/` nor whitespace. The match ignores case. An explicit list replaces the default, so `forbid = []` serves every file under the root, PHP sources included. |

Each worker process keeps served files in memory: at most 16MiB, and no single file above 256KiB. An entry stays fresh for one second, so a rewritten file reaches clients one second after the write.

See [Static files](/docs/static-files) for more information.

### The `[http.sendfile]` table

The sendfile root is the directory `sendFile()` reads from. Rapira canonicalizes both the root and the requested path, and rejects every path that resolves outside the root. `sendFile()` is a method of `Rapira\Http\Exchange`, and only Dispatcher mode hands an exchange to the script. This table therefore has an effect in Dispatcher mode only. Classic and Worker mode accept the table and never read it.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `root` | string | the directory holding `pool.entrypoint` | The only directory `sendFile()` may read. A relative path resolves against the directory holding the config file. |

A root that does not exist when the server boots cannot be canonicalized, and `sendFile()` then rejects every path. Create the directory before you start the server.

### The `[http.uploads]` table

The `[http.uploads]` table bounds host-side `multipart/form-data` parsing. Rapira parses a multipart body in the host in Dispatcher mode only. Classic and Worker mode parse it in PHP, where `php.ini` owns the limits, so this table under either mode stops the boot.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dir` | string | the system temp directory | Spool root for file parts. A relative path resolves against the directory holding the config file. Rapira creates the directory at boot, checks that it is writable, and gives each worker its own `rapira-spool-<pid>` subdirectory that the worker removes when it exits. |
| `max_file_size_mb` | integer | `2` | Largest single file part, in MiB. |
| `max_field_size_kb` | integer | `256` | Largest single field part, in KiB. |
| `max_files` | integer | `20` | File parts one request may carry. |
| `max_parts` | integer | `1024` | Parts one request may carry, file parts and field parts together. |
| `max_part_headers` | integer | `32` | Header fields one part may carry. |

Every one of these limits must be at least 1. A request over any of them is answered `413`.

## The `[pool]` section

Workers run PHP. This section defines what they run, how many run, and when the master removes one. The [process model](/docs/process-model) explains how the master uses these values.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `entrypoint` | string | none — required | The PHP script every worker runs. A relative path resolves against the directory holding the config file. A `SCRIPT` argument on the command line overrides it, and one of the two must be present or the server refuses to boot. |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | How a worker runs the entry script. `classic` re-runs the script from scratch on every request. `worker` keeps the script resident and refills the superglobals for each request. `dispatcher` keeps the script resident and gives it a dispatcher object that the script pulls each request from. The `--mode` flag on the command line overrides this key in both directions. See [execution modes](/docs/execution-modes). |
| `processes` | integer | one per logical CPU | How many worker processes to fork. Under `dynamic` and `ondemand` scaling this is the ceiling rather than the count. Must be at least 1. |
| `scaling` | `"static"` \| `"dynamic"` \| `"ondemand"` | `"static"` | How the pool sizes itself. `static` keeps `processes` workers alive at all times; `dynamic` scales between the spare thresholds, capped by `processes`; `ondemand` forks only when there is work and lets idle workers retire. |
| `min_spare` | integer | none | `dynamic` scaling only, and required there: keep at least this many workers idle and ready. |
| `max_spare` | integer | none | `dynamic` scaling only, and required there: trim back to at most this many idle workers. The pair must satisfy `1 <= min_spare <= max_spare <= processes`; setting either under another scaling value is an error. |
| `max_requests` | integer | `0` | Recycle a worker after it has served this many requests, plus a little jitter so the whole pool never turns over at once. `0` means never. |
| `process_idle_timeout_secs` | integer | `10` | Read by `ondemand` scaling: how long a worker may sit idle before the master retires it. |
| `request_terminate_timeout_secs` | integer | `0` | Wall-clock budget for a single request. A worker still working on one past that is killed and replaced. `0` disables the check. |

`mode` and `scaling` are separate axes: `mode` sets what a worker does with the entry script, `scaling` sets how many workers exist.

The spare bounds are checked against the effective `processes` value, so a `--processes` flag on the command line lowers the ceiling `max_spare` has to fit under.

## The `[supervisor]` section

Policy for the master process — the one that owns the listen socket, supervises the workers and receives your signals. It is also what an init system talks to, so these are the keys a unit file usually sets; see [deployment](/docs/deployment).

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `pidfile` | string | none | Where the master writes its own pid. A relative path resolves against the directory holding the config file. That pid is the one signals go to — the [process model page](/docs/process-model) has the full table of what each signal does. |
| `process_control_timeout_secs` | integer | `30` | How long the master lets a worker finish gracefully before escalating QUIT → TERM → KILL. |

## The `[log]` section

Rapira writes everything to stderr, one write per record, so master and worker output never interleaves mid-line. This section decides how verbose that stream is and what shape each record has; [logging](/docs/logging) covers the individual targets, the formats and how PHP diagnostics map onto levels.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | Verbosity, applied to every target at once. |
| `format` | `"plain"` \| `"json"` | `"plain"` | Record shape: human-readable lines (colored when stderr is a terminal), or one JSON object per line for a log collector. |
| `[log.targets]` | table of target → level | empty | Per-target overrides on top of `level`. Each key names one of the targets Rapira emits under: `php` carries PHP's own output, `http` carries the HTTP front. A key matches by prefix, so `php` also covers `php_sys::callbacks` and everything below it. [Logging](/docs/logging) lists every target. |

A `[log.targets]` key has to look like a module path: letters, digits and `_` `:` `.` `-`, starting with a letter, digit or `_`. The keys are assembled into a filter string, so anything outside that shape would be read as filter syntax instead of a target name and is rejected up front.

`RUST_LOG` and `NO_COLOR` are the only environment variables Rapira reads, and both are log-only: `RUST_LOG` replaces the whole filter for one run, so a noisy debugging session needs no config edit, and `NO_COLOR` strips the color from the `plain` format when it holds any non-empty value, even when stderr is a terminal.

## Unknown keys are rejected

Rapira parses `rapira.toml` strictly. Every table and every key inside it has to be one the server knows, so `[htttp]` or `lissten = ":8000"` is a boot failure that names what it could not recognise, not a line silently ignored. Every key also has exactly one table: `max_requests` belongs to `[pool]` and nowhere else, `pidfile` to `[supervisor]` and nowhere else, and putting one under the wrong table fails just like a typo would.

Values are checked in the same way. Rapira rejects `level = "verbose"`, `format = "pretty"` and `unsafe_field_names = "allow"`. It does not silently replace them with defaults, so a misspelling cannot downgrade a security setting. Numeric values also have limits. `pool.processes`, `http.max_body_size_mb`, both `[http]` timeouts and every `[http.uploads]` limit must be at least 1. Every `*_secs` key has a maximum value of `86400`, which is one day.

::: warning
Validation happens before anything starts, so an unrecognised key stops the boot instead of quietly degrading the run. Editing `rapira.toml` on a machine that is currently serving leaves the running process untouched, but the next start is the one that has to succeed.
:::

## Relative paths

Five keys hold a filesystem path: `pool.entrypoint`, `supervisor.pidfile`, `http.static.root`, `http.sendfile.root` and `http.uploads.dir`. Each path resolves against the directory that contains the config file, not the current working directory. For example, set `entrypoint = "app/worker.php"` in `/etc/rapira/rapira.toml`. The resulting script path is `/etc/rapira/app/worker.php`, regardless of where you run `rapira serve`.

The positional `SCRIPT` argument works the other way round. It is a command-line value, so a relative path there resolves against the current working directory.

::: tip
Keep `rapira.toml` inside the application and write its paths relative to it. Moving the directory then moves the whole configuration with it, and nothing depends on which directory the service happens to start in.
:::
