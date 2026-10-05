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

Each worker changes its working directory to the directory of the entry point before it runs PHP. PHP file operations with relative paths use that directory. PHP does not search the working directory for `php.ini`, so set `PHPRC`. The `WorkingDirectory=` setting applies only to the master. The master uses it as the base for a relative `CONFIG` path and a relative `unix:` listen path. See [Configuration](/docs/configuration) for all keys and defaults.

## Reverse proxy

Rapira accepts plain HTTP and does not provide TLS settings. A [TLS termination proxy](https://en.wikipedia.org/wiki/TLS_termination_proxy) accepts HTTPS from a client, decrypts the connection, and sends plain HTTP to Rapira. Use nginx, Caddy, HAProxy, or a cloud load balancer for this task. Connect the proxy to Rapira through loopback or a Unix socket. A public Rapira address also uses plain HTTP.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Rapira creates the Unix socket with mode `0666`. Any process that can access the runtime directory can connect to the socket. Rapira does not configure the socket mode. Use directory permissions to restrict access. For this unit, set `RuntimeDirectoryMode=0750`. Set `Group=` to a group that includes the proxy account.

Forward fields with hyphens, such as `X-Forwarded-For`. Do not use names such as `X_Forwarded_For`. In Classic and Worker modes, a name with `_` or `.` can map to the same `$_SERVER` key as the name with hyphens. In these modes, Rapira removes by default each name with a character other than an ASCII letter, a digit, or a hyphen. The [HTTP page](/docs/http) explains the mapping and `http.unsafe_field_names`.

Rapira can serve static assets with the [static file middleware](/docs/static-files). The proxy does not need a second copy of the document root. A proxy or CDN can serve the assets instead.

## Zero-downtime deploys

Deploy the new code. Then reload Rapira:

```bash
sudo systemctl reload rapira
```

This command sends `SIGUSR2` to the master. The master replaces one worker at a time and lets current requests finish. If a worker exceeds `process_control_timeout_secs`, the master sends `SIGTERM` and then `SIGKILL`. This termination ends the current request. See [Process model](/docs/process-model) for the worker replacement sequence.

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

`process_control_timeout_secs` limits the initial shutdown wait and each replacement readiness wait. After the shutdown wait, the master sends `SIGTERM`. It sends `SIGKILL` one second later. Set systemd `TimeoutStopSec` above this complete interval.

Connections have a shorter drain budget: the control timeout minus the smaller of five seconds or half the timeout. The default budget is 25 seconds. Responses that exceed this budget can be cut short during shutdown or reload.

::: warning What a reload does not do
A reload replaces the workers but not the master. The master keeps the Rapira binary and the settings from `rapira.toml` and `php.ini`. It also keeps the gRPC descriptor set, the `[grpc.auth]` tokens file, and the OPcache shared memory. Restart Rapira after you change one of these files. Also restart it when `opcache.validate_timestamps = 0`. A reload does not replace the cached opcodes in this configuration.
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

In [Worker and Dispatcher modes](/docs/execution-modes), a worker keeps application state between requests. Thus, a memory leak can increase the worker memory over time. Use these two settings to limit the effect:

```toml
[http.pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

The `[grpc.pool]` table accepts the same keys.

`max_requests` replaces a worker after the specified request count. Rapira adds a random count of up to half the limit for each worker to prevent simultaneous worker replacement. This setting limits the effect of a memory leak but does not correct it.

`request_terminate_timeout_secs` limits the elapsed time for one request. Rapira terminates and replaces a worker that exceeds the limit. The default value of both settings is zero, which disables them. Enable them for production.

See [Process model](/docs/process-model) for pool sizing, replacement delays, and worker failure processing.
