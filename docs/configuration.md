---
title: Configuration
description: "The complete rapira.toml reference: every key in [http], [pool], [supervisor] and [log], with its type, default and the rules that reject a bad value."
---

# Configuration

Rapira needs no configuration file to start — `rapira serve app/worker.php` picks a default for everything. You add a `rapira.toml` when those defaults stop being enough: a different bind address, a fixed number of workers, a recycling policy, a pidfile your init system can read, a more verbose log level. Point the server at the file and it reads its settings from there:

```bash
rapira serve --config /etc/rapira/rapira.toml
```

The file has four sections, and every one of them is optional: `[http]` configures the listener, `[pool]` the worker processes, `[supervisor]` the master process, `[log]` what gets written to stderr. The one value Rapira has no default for is the PHP entry script — set `pool.entrypoint` here, or pass the script as a positional argument on the command line.

::: info
Settings are layered: a CLI flag beats the config file, which beats the built-in default. `--processes 8` therefore wins over `processes = 4` in the file, so a config you keep in version control can still be overridden for a single run. Environment variables are not part of that layering: apart from two that only affect logging, settings come from the file and the flags alone. The flags themselves are documented on the [CLI page](/docs/cli).
:::

## A complete rapira.toml

Every key Rapira understands, in one file. Nothing below is mandatory — delete any line and its default applies, with two exceptions: `pool.entrypoint` has no default to fall back on, and `min_spare`/`max_spare` are required for as long as `mode = "dynamic"` is set.

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # optional; SERVER_NAME reported to PHP
server_port = 8000                    # optional; defaults to the listen TCP port (80 for unix:)
max_body_size_mb = 8                  # optional; larger request bodies get a 413
unsafe_field_names = "drop"           # optional; drop (default) | reject

[pool]
entrypoint = "index.php"              # relative → resolved against this file's directory
processes = 4                         # worker processes to fork (max_children for mode = dynamic/ondemand)
classic = false                       # optional; default false
mode = "dynamic"                      # static (default) | dynamic | ondemand
min_spare = 1                         # dynamic only: keep at least this many idle workers
max_spare = 3                         # dynamic only: trim to at most this many idle workers (rejected under other modes)
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
pingora_core = "warn"
```

The rest of this page documents those keys section by section.

## The `[http]` section

This section covers where Rapira listens, what the request environment tells PHP about the server it is running under, and how much of a request body it will read.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `listen` | string | `"127.0.0.1:8000"` | The bind address, in one of three shapes: `host:port` with an IP literal (`127.0.0.1:8000`, `[::1]:8000`), `:port` for every interface, or `unix:/run/rapira.sock` for a Unix socket. A bare port and a hostname are both rejected — an address has to say which interface it means. |
| `server_name` | string | `"localhost"` | What PHP reads as `$_SERVER['SERVER_NAME']`. |
| `server_port` | integer | the listen port, `80` for `unix:` | What PHP reads as `$_SERVER['SERVER_PORT']`. Set it when a proxy in front of Rapira terminates on a different port than the one Rapira binds. |
| `max_body_size_mb` | integer | `8` | Largest request body Rapira will accept, in MiB (1024 × 1024 bytes). Anything bigger is answered `413`. Must be at least 1. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | What happens to a request field whose name is not `[A-Za-z0-9-]`: remove it before PHP sees it, logging each removal at `warn`, or answer `400`. Both the reasoning and the CGI mapping behind it are on the [HTTP page](/docs/http). |

`server_name` and `server_port` only shape what PHP sees in `$_SERVER`; neither changes what the server binds, which is set by `listen` alone.

## The `[pool]` section

Workers are the processes that actually run PHP, and this section says what they run, how many of them there are, and when the master takes one away. The [process model](/docs/process-model) explains what the master does with these numbers.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `entrypoint` | string | none — required | The PHP script every worker runs. A relative path resolves against the directory holding the config file. A `SCRIPT` argument on the command line overrides it, and one of the two must be present or the server refuses to boot. |
| `processes` | integer | one per logical CPU | How many worker processes to fork. Under `dynamic` and `ondemand` this is the ceiling rather than the count. Must be at least 1. |
| `classic` | boolean | `false` | `false` keeps the worker resident between requests (SAPI Worker mode); `true` re-runs the entry script from scratch on every request, the way php-fpm would. See [execution modes](/docs/execution-modes). `--classic` only turns this on — a `true` here cannot be overridden from the command line. |
| `mode` | `"static"` \| `"dynamic"` \| `"ondemand"` | `"static"` | How the pool sizes itself. `static` keeps `processes` workers alive at all times; `dynamic` scales between the spare thresholds, capped by `processes`; `ondemand` forks only when there is work and lets idle workers retire. |
| `min_spare` | integer | none | `dynamic` only, and required there: keep at least this many workers idle and ready. |
| `max_spare` | integer | none | `dynamic` only, and required there: trim back to at most this many idle workers. The pair must satisfy `1 <= min_spare <= max_spare <= processes`; setting either under another mode is an error. |
| `max_requests` | integer | `0` | Recycle a worker after it has served this many requests, plus a little jitter so the whole pool never turns over at once. `0` means never. |
| `process_idle_timeout_secs` | integer | `10` | Read by `ondemand`: how long a worker may sit idle before the master retires it. |
| `request_terminate_timeout_secs` | integer | `0` | Wall-clock budget for a single request. A worker still working on one past that is killed and replaced. `0` disables the check. |

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
| `[log.targets]` | table of target → level | empty | Per-target overrides on top of `level` — `php = "debug"` while everything else stays quiet, for instance. A key matches by prefix, so `php` also covers `php_sys::callbacks` and everything below it. |

A `[log.targets]` key has to look like a module path: letters, digits and `_` `:` `.` `-`, starting with a letter, digit or `_`. The keys are assembled into a filter string, so anything outside that shape would be read as filter syntax instead of a target name and is rejected up front.

`RUST_LOG` and `NO_COLOR` are the only environment variables Rapira reads, and both are log-only: `RUST_LOG` replaces the whole filter for one run, so a noisy debugging session needs no config edit, and `NO_COLOR` strips the color from the `plain` format when it holds any non-empty value, even when stderr is a terminal.

## Unknown keys are rejected

Rapira parses `rapira.toml` strictly. Every table and every key inside it has to be one the server knows, so `[htttp]` or `lissten = ":8000"` is a boot failure that names what it could not recognise, not a line silently ignored. Every key also has exactly one table: `max_requests` belongs to `[pool]` and nowhere else, `pidfile` to `[supervisor]` and nowhere else, and putting one under the wrong table fails just like a typo would.

Values are checked the same way. `level = "verbose"`, `format = "pretty"` and `unsafe_field_names = "allow"` are all hard errors rather than a quiet fall back to the default, so a misspelling cannot silently downgrade a security setting. Numbers have bounds too: `pool.processes` and `http.max_body_size_mb` must be at least 1, and every `*_secs` key caps at `86400`, one day.

::: warning
Validation happens before anything starts, so an unrecognised key stops the boot instead of quietly degrading the run. Editing `rapira.toml` on a machine that is currently serving leaves the running process untouched, but the next start is the one that has to succeed.
:::

## Relative paths

Two keys hold a filesystem path, and both resolve against the directory that contains the config file rather than the working directory of whoever started the server: `pool.entrypoint` and `supervisor.pidfile`. With `/etc/rapira/rapira.toml` and `entrypoint = "app/worker.php"`, the script is `/etc/rapira/app/worker.php` regardless of where `rapira serve` was invoked from.

The positional `SCRIPT` argument works the other way round. It is a command-line value, so a relative path there resolves against the current working directory.

::: tip
Keep `rapira.toml` inside the application and write its paths relative to it. Moving the directory then moves the whole configuration with it, and nothing depends on which directory the service happens to start in.
:::
