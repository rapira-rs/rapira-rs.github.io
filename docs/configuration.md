---
title: Configuration
description: "All rapira.toml keys, types, defaults, and validation rules."
---

# Configuration

Rapira requires a configuration file. The `rapira serve` command takes its path as the single argument. Any file name works, and this documentation uses `rapira.toml`:

```bash
rapira serve /etc/rapira/rapira.toml
```

The file sets the address, worker count, recycling policy, pidfile, and log level. A value in the file overrides the built-in default.

`[http]` and `[grpc]` configure separate listeners and PHP worker pools. Configure at least one of these sections. The optional `[observability]` section configures a listener for metrics and health checks. `[supervisor]` configures the master process. `[log]` configures output to stderr.

Each enabled HTTP or gRPC pool requires a PHP entry script. Set `http.pool.entrypoint`, `grpc.pool.entrypoint`, or both.

## A complete rapira.toml

The following configuration enables both protocols and shows the supported tables. Most keys use their default when they are absent. Each pool requires `entrypoint`. The `[http.static]` table requires `http.static.root`.

Some keys must occur together. The `[http.static]` table requires a `"static"` middleware entry, and that entry requires the table. The `[grpc.auth]` table and the `"auth"` interceptor entry use the same rule.

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

[http.pool]                           # The worker pool behind the http listener.
entrypoint = "index.php"              # Relative paths use this file's directory.
mode = "dispatcher"                   # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
processes = 4                         # Sets the fixed worker count.
max_requests = 0                      # Replaces a worker after this request count. Zero disables the limit.
request_terminate_timeout_secs = 0    # Replaces a worker when one request exceeds this time. Zero disables the limit.

[grpc]
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"          # Required. A FileDescriptorSet with its imports.
services = ["example.v1.Echo"]        # Optional. Default: the services of the files that no other file imports.
reflection = false
default_timeout_secs = 30             # Optional. Deadline of a call without a client timeout.
max_timeout_secs = 60                 # Optional. Upper limit for a client timeout.
keepalive_interval_secs = 10          # Optional. Idle time before an HTTP/2 PING.
keepalive_timeout_secs = 10           # Optional. Closes a connection that does not answer the PING.
interceptors = ["auth"]               # Optional. Rapira uses the list order.

[grpc.auth]                           # Required when interceptors contains "auth".
tokens_file = "grpc-tokens"           # Required. One bearer token on each line.

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"                   # Required mode for gRPC.
processes = 4
max_requests = 0
request_terminate_timeout_secs = 0

[observability]                       # Optional. Starts one process without PHP for metrics and probes.
listen = "127.0.0.1:9180"             # Required.
keepalive_timeout_secs = 60           # Optional.

[observability.metrics]               # Enables GET /metrics. Set this table, the probes table, or both.

[observability.probes]                # Enables GET /livez and GET /readyz.

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

## The `[http]` section

This section defines the listener and the server information reported to PHP. It also defines request-body limits and the middleware that runs before PHP.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `listen` | string | `"127.0.0.1:8000"` | The bind address. Use `host:port` with an IP address, `:port` for all IPv4 interfaces, or `unix:/run/rapira.sock` for a Unix socket. Use `[::]:8080` for all IPv6 interfaces. Put an IPv6 literal in brackets, as in `[::1]:8000`. Rapira rejects host names and a port without a colon, such as `8000`. |
| `server_name` | string | `"localhost"` | What PHP reads as `$_SERVER['SERVER_NAME']`. |
| `server_port` | integer | the listen port, `80` for `unix:` | The value of `$_SERVER['SERVER_PORT']`. Set it when the proxy port differs from the Rapira port. |
| `max_body_size_mb` | integer | `8` | The largest request body in MiB. Rapira returns `413` for a larger body. The minimum is 1. |
| `write_timeout_secs` | integer | `30` | The maximum time without progress during a response write. Rapira then closes the connection. The range is 1 through `86400`. |
| `keepalive_timeout_secs` | integer | `60` | The time limit to receive the request headers. It includes the wait on an idle connection. It is also the maximum time between two request body frames. After the limit, Rapira closes the connection. A stalled request body gets `408` first. The range is 1 through `86400`. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | Processing for a field name outside `[A-Za-z0-9-]`. `"reject"` returns `400`. In Classic and Worker modes, `"drop"` removes and logs the field. In Dispatcher mode, `"drop"` keeps the field. See the [HTTP page](/docs/http). |
| `middleware` | list of strings | empty | Middleware that runs before PHP, in list order. Only `"static"` is available. Rapira rejects duplicate names and names without configuration tables. It also rejects unused middleware tables. |

### The `[http.static]` table

The `static` middleware can return a file before PHP receives the request. It handles `GET` and `HEAD`. PHP receives other methods and paths that do not identify a file. PHP also receives hidden paths and directory paths. The middleware does not serve index files.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `root` | string | none, required | The served directory. A relative path uses the configuration file directory as its base. The directory must exist and be accessible during initialization. |
| `forbid` | list of strings | `[".php"]` | File name suffixes that the middleware does not serve. Each entry starts with a dot and has at least two characters. It cannot contain `/` or whitespace. Matching is not case-sensitive. An explicit list replaces the default. |

See [Static files](/docs/static-files) for the file cache and other details.

### The `[http.sendfile]` table

The sendfile root is the directory that `sendFile()` can read. Rapira resolves the root and the requested path to canonical paths. It rejects a path outside the root.

`sendFile()` is a method of `Rapira\Http\Exchange`. Only Dispatcher mode gives an exchange to the script. Thus, this table affects only Dispatcher mode. Classic and Worker modes accept but do not use it.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `root` | string | the directory of `http.pool.entrypoint` | The only directory `sendFile()` may read. A relative path resolves against the directory that contains the configuration file. |

If the root does not exist at start, Rapira logs a warning, and `sendFile()` rejects every path. Create the directory before you start the server.

### The `[http.uploads]` table

The `[http.uploads]` table sets limits for host-side `multipart/form-data` parsing. Only Dispatcher mode parses multipart bodies in the host. Classic and Worker modes parse them in PHP and use `php.ini` limits. Rapira rejects this table in these two modes.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `dir` | string | the system temp directory | Storage directory for file parts. A relative path uses the configuration file directory as its base. Rapira creates and checks this directory. Each worker creates a `rapira-spool-<pid>` subdirectory and removes it during shutdown. |
| `max_file_size_mb` | integer | `2` | Largest single file part, in MiB. |
| `max_field_size_kb` | integer | `256` | Largest single field part, in KiB. |
| `max_files` | integer | `20` | File parts permitted in one request. |
| `max_parts` | integer | `1024` | File and field parts permitted in one request. |
| `max_part_headers` | integer | `32` | Header fields permitted in one part. |

Each limit must be at least 1. Rapira returns `413` when a request exceeds a limit.

### The `[http.pool]` table {#http-pool}

Workers run PHP. This table defines what they run, how many run, and when the master removes one. The [process model](/docs/process-model) explains how the master uses these values.

The `http` plugin owns this PHP worker pool. The gRPC listener uses a separate `[grpc.pool]` table.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `entrypoint` | string | none, required | The PHP script that each worker runs. A relative path uses the configuration file directory as its base. The path must identify a readable regular file. |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | How a worker runs the entry script. `classic` starts a new PHP request each time. `worker` keeps the script and refills the superglobals. `dispatcher` keeps the script and gives it a dispatcher object. See [execution modes](/docs/execution-modes). |
| `processes` | integer | available parallelism, or `1` if unavailable | The worker count. The master keeps this many workers running. The minimum is 1. The sum of `processes` in all pools must not be more than 2048. An `[observability]` section adds one process to this sum. |
| `max_requests` | integer | `0` | The request limit before worker replacement. Rapira varies the limit slightly to prevent simultaneous replacements. `0` disables the limit. |
| `request_terminate_timeout_secs` | integer | `0` | Wall-clock limit for one request. Rapira terminates and replaces a worker that exceeds this limit. `0` disables the check. |

## The `[grpc]` section {#grpc}

This section enables unary gRPC, gRPC-Web, and Connect calls on one listener. See [gRPC](./grpc) for a complete PHP service and client commands.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `listen` | string | `"127.0.0.1:50051"` | TCP address or `unix:` socket path. Uses the same address syntax as `http.listen`. |
| `descriptor_set` | string | none, required | Path of a binary `google.protobuf.FileDescriptorSet` that contains every imported file. Build it with `buf build --as-file-descriptor-set` or `protoc --include_imports`. |
| `services` | list of strings | unset | Fully qualified names of the served services. When unset, the pool serves the services of the files that no other file in the set imports. The list must not be empty. |
| `reflection` | boolean | `false` | Enables the `grpc.reflection.v1` and `v1alpha` services. |
| `default_timeout_secs` | integer | unset | Deadline of a call that has no client timeout. When unset, such a call has no deadline. |
| `max_timeout_secs` | integer | unset | Upper limit for a client timeout. When unset, there is no limit. |
| `keepalive_interval_secs` | integer | `10` | The idle time before Rapira sends an HTTP/2 keepalive PING. It does not apply to HTTP/1.1 clients. The range is 1 through `86400`. |
| `keepalive_timeout_secs` | integer | `10` | The time that Rapira waits for the PING answer. If no answer arrives in this time, Rapira closes the connection. The range is 1 through `86400`. |
| `interceptors` | list of strings | empty | Interceptors that run before PHP, in list order. Only `"auth"` is available. Rapira rejects duplicate names, unknown names, and names without a configuration table. It also rejects a `[grpc.auth]` table that the list does not name. |

The master loads the descriptor set before it forks the workers. These errors stop initialization: a set that Rapira cannot read or decode, a set without its imports, and a set with no service to serve. A `services` entry that is not in the set, a duplicate entry, and an entry that names the health or reflection service also stop it. `default_timeout_secs` must not be larger than `max_timeout_secs`.

### The `[grpc.auth]` table {#grpc-auth}

The `auth` interceptor accepts a call only with a valid bearer token. PHP does not receive a rejected call. See [gRPC authentication](/docs/grpc#authentication) for the client side and the health service.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `tokens_file` | string | none, required | The file with the accepted tokens. A relative path uses the configuration file directory as its base. Write one token on each line. Rapira skips blank lines and lines that start with `#`. Each token must be an [RFC 6750 bearer token](https://www.rfc-editor.org/rfc/rfc6750#section-2.1). The file must contain at least one token. |

### The `[grpc.pool]` table {#grpc-pool}

This table uses the [HTTP pool keys and defaults](#http-pool), with a required `entrypoint` and `mode = "dispatcher"`. Classic and Worker modes are rejected. The worker count, recycling, and the process watchdog apply to this pool independently.

HTTP and gRPC can run together. Each listener uses its own pool and entrypoint. The master reads the descriptor set and the tokens file once at start. Restart Rapira to load a changed file. A reload keeps the old files.

## The `[observability]` section {#observability}

This section starts one more process that serves metrics and health probes over HTTP. This process runs no PHP code. The section is not a plugin table, so the file still needs `[http]` or `[grpc]`. See [Metrics and health checks](/docs/observability) for the endpoints and the metrics.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `listen` | string | none, required | The bind address. It uses the same syntax as `http.listen`. Use an address that the `http` and `grpc` listeners do not use. |
| `keepalive_timeout_secs` | integer | `60` | The time limit to receive the request headers. It includes the wait on an idle connection. The range is 1 through `86400`. |
| `[observability.metrics]` | empty table | absent | Enables `GET /metrics` in the Prometheus text format. |
| `[observability.probes]` | empty table | absent | Enables `GET /livez` and `GET /readyz`. |

Set at least one of the two sub-tables. The sub-tables accept no keys.

## The `[supervisor]` section

This section defines the master process policy. The master owns the listen sockets, supervises workers, and receives signals. The init system controls the master. See [deployment](/docs/deployment) for a unit file.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `pidfile` | string | none | The file for the master process identifier. A relative path uses the configuration file directory as its base. Send process signals to this identifier. See [process model](/docs/process-model). |
| `process_control_timeout_secs` | integer | `30` | How long the master waits after `SIGQUIT` before it sends `SIGTERM`. The master sends `SIGKILL` one second after `SIGTERM`. |

Connections have a shorter drain budget: the control timeout minus the smaller of five seconds or half the timeout. The default budget is 25 seconds. This budget applies during shutdown and reload.

## The `[log]` section

This section controls the stderr log level and format. See [logging](/docs/logging) for targets, formats, and PHP diagnostic levels.

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | Verbosity, applied to every target at once. |
| `format` | `"plain"` \| `"json"` | `"plain"` | The record format. Plain output contains readable lines and can use colors. JSON output contains one object per line. |
| `[log.targets]` | table of target → level | empty | Log level overrides for targets. Keys match target prefixes. See [Logging](/docs/logging#per-target-overrides) for the target list. |

A `[log.targets]` key uses letters, digits, `_`, `:`, `.`, or `-`. It must start with a letter, digit, or `_`. Rapira rejects other characters because the log filter can interpret them as syntax. A target key that contains `:` or `.` must use quotes because TOML does not permit these characters in a bare key. For example:

```toml
[log.targets]
"h2::proto" = "debug"
```

`RUST_LOG` and `NO_COLOR` affect stderr output only. `RUST_LOG` replaces the complete stderr filter for one run. `NO_COLOR` disables plain output colors when its value is not empty.

## Unknown key rejection

Rapira accepts only documented tables and keys. For example, `[htttp]` or `lissten = ":8000"` causes initialization to fail. The error identifies the unknown name. Each key belongs to one table. For example, `max_requests` belongs to `[http.pool]`, and `pidfile` belongs to `[supervisor]`.

Rapira also validates values. It rejects unsupported values and does not replace them with defaults. For example, it rejects `level = "verbose"`, `format = "pretty"`, and `unsafe_field_names = "allow"`. Worker counts, body sizes, and upload limits must be at least 1. Each `*_secs` key must be 1 through `86400`. Only `request_terminate_timeout_secs` also accepts `0`.

::: warning
Rapira reads the configuration file only at start. A reload with `SIGHUP` or `SIGUSR2` does not read it again. Restart Rapira to apply a changed file.
:::

## Relative paths

File system paths include both pool entrypoints, `grpc.descriptor_set`, `grpc.auth.tokens_file`, `supervisor.pidfile`, `http.static.root`, `http.sendfile.root`, and `http.uploads.dir`. Each relative path uses the configuration file directory as its base. For example, set `entrypoint = "app/worker.php"` in `/etc/rapira/rapira.toml`. Rapira then uses `/etc/rapira/app/worker.php`.

A relative `unix:` listener path uses the working directory of the Rapira process as its base. Use an absolute path for a Unix socket.

::: tip
Keep the `rapira.toml` configuration file inside the application. Write its paths relative to the configuration file. You can move the application directory. These paths do not change.
:::
