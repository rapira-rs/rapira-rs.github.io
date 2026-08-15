---
title: Running in production
description: How to run Rapira on a server — a systemd unit, config layout, a reverse proxy in front, zero-downtime reloads, JSON logs and worker recycling.
---

# Running in production

Running Rapira on a server adds what a local `rapira serve app/worker.php` does not need: starting at boot, coming back after a crash, reloading new code without dropping a request, and logs you can read afterwards. This page covers a systemd unit, a place for the config, a proxy in front, and the settings that bound long-lived workers.

Almost none of this is compiled into the binary. Nothing in Rapira depends on where your config lives or on what supervises the process, so the layout below is a convention this page establishes and the rest of the docs assume. Get the binary onto the machine first — that part is on [Installation](/docs/intro/installation).

## A systemd unit

Rapira takes php-fpm's place, and its master already supervises the pool — it forks, reaps, respawns with backoff, recycles workers and scales the pool. Keeping that one master process alive is systemd's only job, so there is nothing for a separate process manager like supervisord to do.

The `.deb` and `.rpm` packages install the binary and the PHP runtime it embeds, and nothing else — **no service unit and no `php.ini`** ([Installation](/docs/intro/installation) lists the exact files). Both are site policy, and a package that shipped them would overwrite your edits on every upgrade.

Write your own into `/etc/systemd/system/rapira.service`:

```ini
[Unit]
Description=Rapira PHP application server
After=network.target

[Service]
Type=exec
WorkingDirectory=/srv/app
ExecStart=/usr/bin/rapira serve --config /etc/rapira/rapira.toml
ExecReload=/bin/kill -USR2 $MAINPID
KillMode=mixed
Restart=on-failure
RuntimeDirectory=rapira
Environment=PHPRC=/etc/rapira

[Install]
WantedBy=multi-user.target
```

Then load it and switch it on:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rapira
```

Six of those lines need explanation:

- `Type=exec` — Rapira runs in the **foreground** and never forks itself into the background. There is no daemon mode and none is needed: the process systemd starts *is* the master, so `$MAINPID` is exactly the pid you want to signal.
- `ExecReload` — turns `systemctl reload rapira` into a `SIGUSR2` to the master, which is the zero-downtime reload described below.
- `KillMode=mixed` — systemd's default sends the stop signal to every process in the cgroup, and a worker takes `SIGTERM` as an immediate kill. `mixed` sends it to the master alone, which then runs the graceful `SIGQUIT` drain described below; the `SIGKILL` at `TimeoutStopSec` still covers the whole group. Without this line, `systemctl stop` and `systemctl restart` drop in-flight requests.
- `Restart=on-failure` — a clean drain exits zero and stays stopped, so this only brings the server back after a crash or a failed boot.
- `RuntimeDirectory=rapira` — systemd creates `/run/rapira` on start and removes it on stop. It is where the pidfile and the Unix socket in the examples below live.
- `Environment=PHPRC` — where PHP looks for its `php.ini`, see the next section.

::: tip Running as a non-root user
Add `User=` and `Group=` to the `[Service]` block — systemd chowns the `RuntimeDirectory` to that account, so the pidfile and the Unix socket under `/run/rapira/` keep working. Paths outside it, `/run/rapira.pid` and friends, sit in a root-owned directory and will fail to open.
:::

Two applications on one host take two configs, two units and two listen addresses; use a systemd template unit (`rapira@.service`) for that. Each instance boots its own PHP and its own worker pool, and shares nothing with the other instance except the machine.

## Where the config lives

The convention is `/etc/rapira/rapira.toml` for Rapira's own settings, and a `php.ini` sitting next to it, found through `PHPRC=/etc/rapira`. Neither path is compiled in. `--config` takes any path you like, and `PHPRC` isn't a Rapira feature at all — Rapira leaves PHP's ini search alone, so PHP looks in `$PHPRC` first exactly as it would under any other SAPI. Point both somewhere else if your distro or your Ansible role uses different paths.

Rapira runs without a `php.ini` at all — its built-in ini defaults keep PHP's diagnostics in the log rather than in your responses, as [Logging](/docs/logging) explains. Write your own in `/etc/rapira` when you want OPcache tuning, a memory limit or a timezone; whatever it sets wins.

A relative `pool.entrypoint` resolves against the **config file's** directory, not the working directory. With the layout above, `entrypoint = "index.php"` would mean `/etc/rapira/index.php`, which is not where your app is. In production, give the entrypoint an absolute path and the question never comes up. `supervisor.pidfile` follows the same rule — both config paths hang off the config file's directory. What *does* resolve against the working directory is the positional `SCRIPT` argument and any relative path your PHP code opens at runtime, and Rapira never chdirs — systemd starts the service in `/` unless you set `WorkingDirectory=`, which is why the unit above does (PHP's own ini search includes `.`, so it looks there too). Every key, with its default, is on [Configuration](/docs/configuration).

## Behind a reverse proxy

Rapira's listener speaks plain HTTP and the config has no TLS section. Terminate TLS at the proxy you already run — nginx, Caddy, HAProxy, a cloud load balancer — and let it reach Rapira over loopback or a Unix socket. You can bind to a public interface, but that listener still serves plain HTTP.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

The Unix socket is created with mode `0666`, so any local process that can traverse the runtime directory can connect to it and send requests to your application. Rapira has no setting for that mode, so the directory's permissions are the only thing limiting who reaches the socket. If it matters, restrict the directory: with the unit above, `RuntimeDirectoryMode=0750` plus a `Group=` the proxy's user belongs to keeps everyone else out of `/run/rapira`.

Forwarded fields must reach Rapira with the ordinary `-` spelling — `X-Forwarded-For`, never `X_Forwarded_For`. Underscore and dot spellings fold onto the same `$_SERVER` key as the proper one, which is how a client would otherwise overwrite what your proxy just set, so Rapira drops them before PHP sees them. The [HTTP page](/docs/http) explains the mapping and the `http.unsafe_field_names` setting that governs it.

## Zero-downtime deploys

Deploy the new code, then:

```bash
sudo systemctl reload rapira
```

That's a `SIGUSR2` to the master, which answers it with a **rolling reload**: the pool is replaced one worker at a time and in-flight requests run to completion — nothing is dropped unless a worker overruns `process_control_timeout_secs`, which escalates it to `SIGTERM` and then `SIGKILL`, and that worker's in-flight request is lost (see below). How the roll overlaps the fresh worker with the old one is on [Process model](/docs/process-model).

Without systemd — a container entrypoint, a deploy script — signal the master directly. Set `supervisor.pidfile` and the pid is right there — nothing creates `/run/rapira` outside systemd, so make the directory first or pick a path that exists; the master refuses to boot if it can't write the file.

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Only the master ever writes that file — workers can't touch it — and the master unlinks it on every exit path it controls, so a stale one means the master died without running its own shutdown: a `SIGKILL`, a hard crash, or the machine going down.

`process_control_timeout_secs` is how long the master waits for a worker to finish before it escalates, and it caps each step of a rolling reload too, so one wedged worker can't stall the whole roll — the escalation sequence and the full signal table are on [Process model](/docs/process-model). Keep it comfortably under systemd's `TimeoutStopSec`, otherwise systemd's own timeout expires first and it kills the master mid-escalation.

::: warning What a reload does not do
The master keeps the settings it booted with, and the OPcache shared memory belongs to the master too, so it outlives every worker generation. Changing `rapira.toml` needs `systemctl restart rapira`. And if you've set `opcache.validate_timestamps = 0`, a reload will keep serving the old opcodes — restart instead.
:::

## Logs

Rapira writes every log record to **stderr**, one write per record, so master and worker output never interleave mid-line. A systemd unit's stderr goes to the journal with no configuration at all, so the only thing left to choose is the format. Use JSON in production:

```toml
[log]
level = "info"
format = "json"
```

One object per line, `timestamp` in RFC 3339 UTC, plus `level`, `message` and `target`; newlines inside a message are escaped so a record is always exactly one line. That is the shape log collectors expect, and journald passes it through unchanged.

```bash
journalctl -u rapira -f
```

To ship them off the box, point your collector at the unit's journal, or run Rapira with its stderr piped straight into the agent if you'd rather skip journald. Either way the record is already structured, so the collector does not have to parse it with regexes. For per-target levels and the `RUST_LOG` override that replaces the whole filter for one debugging session, see [Logging](/docs/logging).

## Recycling and request timeouts

In [worker mode](/docs/execution-modes) the process stays resident, so a slow leak that goes unnoticed under php-fpm accumulates across requests. Two settings guard against it:

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` retires a worker after that many requests and forks a fresh one, with a bit of jitter added so the whole pool doesn't recycle in lockstep. It is not a fix for a leak; it keeps an undiscovered leak from turning into an outage. `request_terminate_timeout_secs` is a wall-clock ceiling on a single request: a worker that exceeds it is killed and respawned, so one stuck request does not occupy a worker permanently. Both are off by default; turn them on before you go live.

[Process model](/docs/process-model) covers the rest of the pool — static, dynamic and ondemand sizing, respawn backoff, and what the master does when a worker dies.
