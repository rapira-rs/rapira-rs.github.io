---
title: Running in production
description: A production systemd unit, configuration layout, reverse proxy, reload process, JSON logs, health checks, metrics, and worker replacement.
---

# Running in production

Production deployments must keep Rapira available after restarts and code changes. They start Rapira during system initialization and restart it after failures. They also reload code without dropped requests and keep logs. This page describes a systemd unit, a reverse proxy, health checks, metrics, and persistent worker settings.

Rapira does not define a deployment layout. It does not require a specific configuration path or process supervisor. This page establishes the convention that the other documentation uses. Install the binary first, as described in [Installation](/docs/intro/installation).

Rapira is also available as the `ghcr.io/rapira-rs/rapira` container image. Copy its files into an application image with `COPY --from`. A container uses the restart policy of its runtime instead of the systemd unit. The other configuration settings do not change. See [Docker](/docs/intro/installation#docker) for more information.

## A systemd unit

Rapira can replace php-fpm. Its master process creates, monitors, and replaces workers. Each pool runs a fixed number of workers, set by `processes`. Systemd only has to monitor the master process. A separate process manager is not necessary.

The `.deb` and `.rpm` packages install the binary and the embedded PHP runtime. They do not install a service unit or `php.ini`. These files contain site-specific settings. Package updates must not replace them. See [Installation](/docs/intro/installation) for the installed files.

Create `/etc/systemd/system/rapira.service`:

```ini
[Unit]
Description=Rapira PHP application server
After=network.target

[Service]
Type=exec
WorkingDirectory=/srv/app
ExecStart=/usr/bin/rapira serve /etc/rapira/rapira.toml
ExecReload=/bin/kill -USR2 $MAINPID
KillMode=mixed
Restart=on-failure
RuntimeDirectory=rapira
Environment=PHPRC=/etc/rapira

[Install]
WantedBy=multi-user.target
```

Reload the systemd configuration:

```bash
sudo systemctl daemon-reload
```

Enable Rapira with `--now`:

```bash
sudo systemctl enable --now rapira
```

The unit uses these settings:

- `Type=exec`: Rapira runs in the **foreground**. The process that systemd starts is the master, so `$MAINPID` identifies it.
- `ExecReload`: `systemctl reload rapira` sends `SIGUSR2` to the master. This signal starts the reload process described below.
- `KillMode=mixed`: systemd sends the stop signal only to the master. The master then sends `SIGQUIT` to workers and waits for them. After `TimeoutStopSec`, systemd sends `SIGKILL` to the complete group. Without `KillMode=mixed`, a stop can terminate current requests.
- `Restart=on-failure`: systemd restarts Rapira after a failure. It does not restart Rapira after a normal stop.
- `RuntimeDirectory=rapira`: systemd creates `/run/rapira` during start and removes it during stop. The examples below put the pidfile and Unix socket in this directory.
- `Environment=PHPRC`: PHP uses this directory to find `php.ini`.

::: tip Running as a non-root user
Add `User=` and `Group=` to the `[Service]` block. Systemd gives that account ownership of `RuntimeDirectory`. The account can then create the pidfile and Unix socket in `/run/rapira/`. It usually cannot create files directly in `/run`.
:::

Two applications on one host require separate configuration files, units, and listen addresses. A systemd template unit such as `rapira@.service` can define them. Each instance initializes PHP and creates a separate worker pool.

## Configuration paths

This guide uses `/etc/rapira/rapira.toml` for Rapira settings. It puts `php.ini` in the same directory and sets `PHPRC=/etc/rapira`. Rapira does not contain these paths in the binary. The `CONFIG` argument accepts any file path. PHP uses `PHPRC` to find its configuration. Use different paths when the system configuration requires them.

Rapira can run without a `php.ini`. Its defaults write PHP diagnostics to the log instead of HTTP responses. Create `/etc/rapira/php.ini` to configure OPcache, a memory limit, or a time zone. See [Logging](/docs/logging) for diagnostic settings.

On PHP 8.4, OPcache is a separate `opcache.so` file. Load it with a `zend_extension` line in `php.ini`, as described in [php.ini](/docs/intro/installation#php-ini). PHP 8.5 includes OPcache in `libphp`.

A relative `http.pool.entrypoint` uses the **configuration file directory** as its base. In this layout, `entrypoint = "index.php"` means `/etc/rapira/index.php`. Use an absolute entry point path in production. `supervisor.pidfile` uses the same resolution rule.

Each time a worker starts or restarts its app, it resolves the symbolic links in the entry point path and enters the entry point directory. PHP file operations with relative paths use that directory. PHP does not search the working directory for `php.ini`, so set `PHPRC`. The `WorkingDirectory=` setting applies only to the master. The master uses it as the base for a relative `CONFIG` path and a relative `unix:` listen path. See [Configuration](/docs/configuration) for all keys and defaults.

## Reverse proxy

Rapira accepts plain HTTP and does not provide TLS settings. A [TLS termination proxy](https://en.wikipedia.org/wiki/TLS_termination_proxy) accepts HTTPS from a client, decrypts the connection, and sends plain HTTP to Rapira. Use nginx, Caddy, HAProxy, or a cloud load balancer for this task. Connect the proxy to Rapira through loopback or a Unix socket. A public Rapira address also uses plain HTTP.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Rapira creates the Unix socket with mode `0666`. Any process that can access the runtime directory can connect to the socket. Rapira does not configure the socket mode. Use directory permissions to restrict access. For this unit, set `RuntimeDirectoryMode=0750`. Set `Group=` to a group that includes the proxy account.

Forward fields with hyphens, such as `X-Forwarded-For`. Do not use names such as `X_Forwarded_For`. In Classic and Worker modes, a name with `_` or `.` can map to the same `$_SERVER` key as the name with hyphens. In these modes, Rapira always removes each name with a character other than an ASCII letter, a digit, or a hyphen. The [HTTP page](/docs/http) explains the mapping.

Rapira can serve static assets with the [static file middleware](/docs/static-files). The proxy does not need a second copy of the document root. A proxy or CDN can serve the assets instead.

## Zero-downtime deploys

Deploy the new code. Then reload Rapira:

```bash
sudo systemctl reload rapira
```

This command sends `SIGUSR2` to the master. The master tells each worker to restart its app. Each worker runs the entry script again in the same process, and the new app serves the next requests. No connection closes, and no request is lost. See [Process model](/docs/process-model#a-reload-restarts-the-apps) for more information.

Send the signal directly when systemd does not manage the process. Set `supervisor.pidfile` to record the master process identifier. Create the pidfile directory before you start Rapira. Alternatively, select a directory that exists. The master does not start if it cannot write the file.

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Only the master writes the pidfile. It removes the file during a controlled exit. A file that remains can indicate `SIGKILL`, a process failure, or a system failure.

`process_control_timeout_secs` limits the shutdown wait. After the shutdown wait, the master sends `SIGTERM`. It sends `SIGKILL` one second later. Set systemd `TimeoutStopSec` above this complete interval.

Connections have a shorter drain budget: the control timeout minus the smaller of five seconds or half the timeout. The default budget is 25 seconds. Responses that exceed this budget can be cut short during shutdown.

A deployment can put each application version in its own directory and switch a symbolic link in the entry point path to the new directory. A reload after the switch moves every worker of every pool to the new version: the code, the working directory, and the default sendfile root. Reload Rapira immediately after the switch. Before the reload, an app that starts for another cause, for example after `max_requests`, starts in the new version. Thus, the pool runs two versions until the reload.

A reload empties OPcache, so it also loads the new PHP code when `opcache.validate_timestamps = 0`. Until the longest request that was active at the reload ends, requests run without OPcache and compile their files again. In Worker and Dispatcher modes, most workers start the app two times, so the code before the worker loop runs two times.

::: warning What a reload does not do
A reload restarts the apps but not the processes. The master keeps the Rapira binary and the settings from `rapira.toml` and `php.ini`. It also keeps the gRPC descriptor set and the `[grpc.auth]` tokens file. Restart Rapira after you change one of these files. Also restart it after you change a file that `opcache.preload` loads. PHP loads these files one time, when the master starts.

When `opcache.restrict_api` is set, a reload does not empty OPcache. With this setting and `opcache.validate_timestamps = 0`, restart Rapira after each deployment.
:::

## Logs

Rapira writes filtered log records to **stderr**. Systemd sends stderr to the journal. Use JSON format for stderr in production:

```toml
[log]
level = "info"
format = "json"
```

Each line contains one object with `timestamp`, `level`, `target`, and `fields`. The `fields` object contains `message` and other event fields. The timestamp uses RFC 3339 UTC. Rapira escapes newline characters in messages. Journald sends the object to log collectors without changes.

```bash
journalctl -u rapira -f
```

Configure a log collector to read the unit journal. Alternatively, send Rapira stderr directly to the collector. The collector can parse each record as JSON without regular expressions. See [Logging](/docs/logging) for target levels and the `RUST_LOG` override.

## Health checks and metrics

Add an `[observability]` table to serve health probes and Prometheus metrics. Rapira then starts one more process, which does not run PHP. `GET /livez` shows that the master runs. `GET /readyz` shows that each PHP pool has an idle or active worker. `GET /metrics` returns the metrics in the Prometheus text format.

```toml
[observability]
listen = "127.0.0.1:9180"

[observability.metrics]

[observability.probes]
```

The endpoints have no authentication and no TLS. Use a loopback address or a Unix socket. See [Metrics and health checks](/docs/observability) for status codes, probe examples, and the metric reference.

## Recycling and request timeouts

In [Worker and Dispatcher modes](/docs/execution-modes), a worker keeps application state between requests. Thus, a memory leak can increase the worker memory over time. Use these settings to limit the effect:

```toml
[http.pool]
max_requests = 500
max_memory_mb = 256
request_terminate_timeout_secs = 30
```

The `[grpc.pool]` table accepts the same keys.

`max_requests` restarts the app inside a worker after the specified request count. The worker process stays, so no connection closes and no request is lost. Rapira adds a random count of up to half the limit for each worker to prevent simultaneous restarts. The restart frees the PHP memory of the app. It does not free memory that an extension or a C library leaks outside PHP. This setting limits the effect of a memory leak but does not correct it. Classic mode ignores it.

`max_memory_mb` replaces a worker process when its resident set size (RSS) exceeds the limit in MiB. The master checks each worker once each second. The worker stops accepting new connections; existing connections can receive their next response within the drain timeout. Responses that exceed this timeout can be cut short. Worker exit releases memory inside and outside PHP, and the master then starts a replacement. This setting applies in all modes.

Use `max_memory_mb` when a container has a memory limit. When a container reaches its limit, the kernel can terminate a process, and all requests of that process fail. Keep the sum of `processes × max_memory_mb` for all pools below the container limit. Keep headroom for the master, for the observability process, and for growth between two checks. The RSS of each worker includes shared memory, for example OPcache, so this sum is larger than the real use.

Set the limit above the RSS of a new worker. Otherwise, each new worker can trigger another memory drain at the next check. The `rapira_worker_rss_bytes` metric shows the RSS of each worker.

`request_terminate_timeout_secs` limits the elapsed time for one request. Rapira terminates and replaces a worker that exceeds the limit. The default value of these settings is zero, which disables them. Enable them for production.

See [Process model](/docs/process-model) for pool sizing, replacement delays, and worker failure processing.
