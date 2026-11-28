---
title: Running in production
description: A production systemd unit, configuration layout, reverse proxy, reload process, JSON logs, health checks, metrics, and worker replacement.
---

# Running in production

Production deployments must keep Rapira available after restarts and code changes. They start Rapira during system initialization and restart it after failures. They also reload code without dropped requests and keep logs. This page describes a systemd unit, a reverse proxy, health checks, metrics, and persistent worker settings.

Rapira does not define a deployment layout. It does not require a specific configuration path or process supervisor. This page establishes the convention that the other documentation uses. Install the binary first, as described in [Installation](/docs/intro/installation).

Rapira is also available as the `ghcr.io/rapira-rs/rapira` container image. The image contains PHP, and you add your application to it. Start the container with `--init` so that an init process removes exited child processes. A container uses the restart policy of its runtime instead of the systemd unit. The other configuration settings do not change. See [Docker](/docs/intro/installation#docker) for more information.

## A systemd unit

Rapira can replace php-fpm. One server process manages all listeners and PHP worker threads. Each pool runs a fixed number of workers, set by `workers`. Systemd monitors that single server process. A separate process manager is not necessary.

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

- `Type=exec`: Rapira runs in the **foreground**, so `$MAINPID` identifies the server process.
- `ExecReload`: `systemctl reload rapira` sends `SIGUSR2` to the server. This signal starts the reload process described below.
- `Restart=on-failure`: systemd restarts Rapira after a failure. It does not restart Rapira after a normal stop.
- `RuntimeDirectory=rapira`: systemd creates `/run/rapira` during start and removes it during stop. The examples below put the pidfile and Unix socket in this directory.
- `Environment=PHPRC`: PHP uses this directory to find `php.ini`.

Set memory and CPU limits on the service unit or container, for example `MemoryMax=` and `CPUQuota=`.

::: tip Running as a non-root user
Add `User=` and `Group=` to the `[Service]` block. Systemd gives that account ownership of `RuntimeDirectory`. The account can then create the pidfile and Unix socket in `/run/rapira/`. It usually cannot create files directly in `/run`.
:::

Two applications on one host require separate configuration files, units, and listen addresses. A systemd template unit such as `rapira@.service` can define them. Each instance initializes PHP and creates its own worker pools.

## Configuration paths

This guide uses `/etc/rapira/rapira.toml` for Rapira settings. It puts `php.ini` in the same directory and sets `PHPRC=/etc/rapira`. Rapira does not contain these paths in the binary. The `CONFIG` argument accepts any file path. PHP uses `PHPRC` to find its configuration. Use different paths when the system configuration requires them.

Rapira can run without a `php.ini`. Its defaults write PHP diagnostics to the log instead of HTTP responses. Create `/etc/rapira/php.ini` to configure OPcache, a memory limit, or a time zone. See [Logging](/docs/logging) for diagnostic settings.

On PHP 8.4, OPcache is a separate `opcache.so` file. Load it with a `zend_extension` line in `php.ini`, as described in [php.ini](/docs/intro/installation#php-ini). PHP 8.5 and PHP 8.6 include OPcache in `libphp`.

A relative `http.pool.entrypoint` uses the **configuration file directory** as its base. In this layout, `entrypoint = "index.php"` means `/etc/rapira/index.php`. Use an absolute entry point path in production. `server.pidfile` and relative `unix:` listen paths use the same resolution rule.

Each classic request and each Worker or Dispatcher app instance starts in the resolved entry point directory. PHP file operations with relative paths use that thread-local directory. PHP does not search the working directory for `php.ini`, so set `PHPRC`. On ZTS, `proc_open()` without a `$cwd` argument starts the child in the server's `WorkingDirectory=`; pass `getcwd()` as `$cwd` to use the app directory. See [Configuration](/docs/configuration) for all keys and defaults.

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

This command sends `SIGUSR2` to the server. Each worker recycles its app on the same thread, and the new app serves later requests. No connection closes, and no request is lost. See [Process model](/docs/process-model#a-reload-restarts-the-apps) for more information.

Send the signal directly when systemd does not manage the process. Set `server.pidfile` to record the server process identifier. Create the pidfile directory before you start Rapira. Alternatively, select a directory that exists. The server does not start if it cannot write the file.

```toml
[server]
pidfile = "/run/rapira/rapira.pid"
stop_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Rapira removes the pidfile on normal shutdown and on direct host exits (`70`, `101`, `124`, `130`). A file that remains indicates `SIGKILL`, a fatal crash signal, or a system failure; the next start overwrites it.

`stop_timeout_secs` limits the total shutdown wait (default `30` seconds). Open connections drain for `stop_timeout_secs` minus five seconds, or half the stop timeout if it is below ten seconds. Set systemd `TimeoutStopSec` above `stop_timeout_secs`.

A deployment can put each application version in its own directory and switch a symbolic link in the entry point path to the new directory. A reload after the switch moves every worker of every pool to the new version: the code, the working directory, and the default sendfile root. Reload Rapira immediately after the switch. Before the reload, an app that recycles for another cause, for example after `max_requests`, starts in the new version. Thus, the pool runs two versions until the reload.

A reload empties OPcache, so it also loads the new PHP code when `opcache.validate_timestamps = 0`, unless `opcache.file_cache` is set. One worker resets OPcache while peers wait, and later requests compile their files again.

::: warning What a reload does not do
A reload recycles the apps but does not restart the server process. Rapira keeps the binary and the settings from `rapira.toml` and `php.ini`. It also keeps the gRPC descriptor set and the `[grpc.auth]` tokens file. A reload does not download a descriptor set from its URL again. Restart Rapira after you change one of these files. Also restart it after you change a file that `opcache.preload` loads. PHP loads these files one time when the server starts.

When `opcache.restrict_api` is set, a reload does not empty OPcache. With this setting and `opcache.validate_timestamps = 0`, restart Rapira after each deployment.

With `opcache.file_cache` and `opcache.validate_timestamps = 0`, a reload and a restart do not load the new code of a changed file. A reload empties only the shared memory of OPcache. OPcache then reads the old script from the file cache and does not check the file time. After you replace the files, empty the `opcache.file_cache` directory. Then reload or restart Rapira. As an alternative, deploy each release to a new directory, so that each changed file gets a new path.
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

Add an `[observability]` table to serve health probes and Prometheus metrics. Rapira runs this listener on a separate thread without PHP. `GET /livez` shows that the server runs. `GET /readyz` shows that each PHP pool has an idle or active worker. `GET /metrics` returns the metrics in the Prometheus text format.

```toml
[observability]
listen = "127.0.0.1:9180"

[observability.metrics]

[observability.probes]
```

The endpoints have no authentication and no TLS. Use a loopback address or a Unix socket. See [Metrics and health checks](/docs/observability) for status codes, probe examples, and the metric reference.

## Recycling and request timeouts

In [Worker and Dispatcher modes](/docs/execution-modes), a worker keeps application state between requests. Thus, a memory leak can increase memory use over time. Use these settings to limit the effect:

```toml
[http.pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

The `[grpc.pool]` table accepts the same keys.

`max_requests` recycles the app on a worker thread after the specified unit count. Listeners, connections, and the pool queue stay, so no request is lost. Rapira adds a random count of up to half the limit for each worker to prevent simultaneous recycles. The recycle frees the PHP memory of the app. It does not free memory that an extension or a C library leaks outside PHP. Classic mode ignores this setting.

`request_terminate_timeout_secs` sets a wall-clock watchdog limit for one unit. At the limit, the watchdog interrupts PHP and wakes a blocked response write. Native I/O can continue waiting, so set timeouts on sockets and database calls. After five more seconds, Rapira logs a still-blocked worker once while other workers keep serving. Rapira exits with code `124` only if every worker in one pool stays blocked after the grace period.

Set `memory_limit` in `php.ini` and set container or systemd memory limits for the Rapira process. See [Process model](/docs/process-model) for pool sizing, boot failure retries, `SIGRTMAX`, and `execution_clock`.
