---
title: Running in production
description: A systemd unit, a config layout, a reverse proxy in front, zero-downtime reloads and JSON logs — Rapira on a real server.
---

# Running in production

On your laptop, `rapira serve app/worker.php` is the whole story. On a server you want a few more things: start at boot, come back after a crash, reload new code without dropping a single request, and put the logs somewhere you can actually read them. This page is the operational half of that — a systemd unit, a place for the config, a proxy in front, and the handful of settings that keep long-lived workers healthy.

Almost nothing here is baked into the binary. Rapira has no opinion about where your config lives or who supervises it, so the layout below is a convention this page establishes; the rest of the docs just happen to assume it. Get the binary onto the machine first — that part is on [Installation](/docs/installation).

## A systemd unit

The `.deb` and `.rpm` packages install the binary and the PHP runtime it embeds, and nothing else — **no service unit and no `php.ini`** ([Installation](/docs/installation) lists the exact files). It's deliberate: both are policy, they belong to you, and a package that shipped them would be in the business of overwriting your edits on every upgrade.

So write your own. Drop this into `/etc/systemd/system/rapira.service`:

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

Six lines in there are worth a word each:

- `Type=exec` — Rapira runs in the **foreground** and never forks itself into the background. There is no daemon mode and none is wanted: the process systemd starts *is* the master, so `$MAINPID` is exactly the pid you want to signal.
- `ExecReload` — turns `systemctl reload rapira` into a `SIGUSR2` to the master, which is the zero-downtime reload described below.
- `KillMode=mixed` — systemd's default sends the stop signal to every process in the cgroup, and a worker takes `SIGTERM` as an immediate kill. `mixed` sends it to the master alone, which then runs the graceful `SIGQUIT` drain described below; the `SIGKILL` at `TimeoutStopSec` still covers the whole group. Without this line, `systemctl stop` and `systemctl restart` drop in-flight requests.
- `Restart=on-failure` — a clean drain exits zero and stays stopped, so this only brings the server back after a crash or a failed boot.
- `RuntimeDirectory=rapira` — systemd creates `/run/rapira` on start and removes it on stop. It is where the pidfile and the Unix socket in the examples below live.
- `Environment=PHPRC` — where PHP looks for its `php.ini`, see the next section.

::: tip Don't want to run as root?
Add `User=` and `Group=` to the `[Service]` block — systemd chowns the `RuntimeDirectory` to that account, so the pidfile and the Unix socket under `/run/rapira/` keep working. Paths outside it, `/run/rapira.pid` and friends, sit in a root-owned directory and will fail to open.
:::

## Where the config lives

The convention is `/etc/rapira/rapira.toml` for Rapira's own settings, and a `php.ini` sitting next to it, found through `PHPRC=/etc/rapira`. Neither path is compiled in. `--config` takes any path you like, and `PHPRC` isn't a Rapira feature at all — Rapira leaves PHP's ini search alone, so PHP looks in `$PHPRC` first exactly as it would under any other SAPI. Point both somewhere else if your distro or your Ansible role prefers it.

One thing to know before you write that file: a relative `pool.entrypoint` resolves against the **config file's** directory, not the working directory. With the layout above, `entrypoint = "index.php"` would mean `/etc/rapira/index.php`, which is not where your app is. In production, give the entrypoint an absolute path and the question never comes up. `supervisor.pidfile` follows the same rule — both config paths hang off the config file's directory. What *does* resolve against the working directory is the positional `SCRIPT` argument and any relative path your PHP code opens at runtime, and Rapira never chdirs — systemd starts the service in `/` unless you set `WorkingDirectory=`, which is why the unit above does (PHP's own ini search includes `.`, so it looks there too). Every key, with its default, is on [Configuration](/docs/configuration).

## Behind a reverse proxy

Rapira's listener speaks plain HTTP: there is no TLS section in the config, and that is on purpose. Terminate TLS at the proxy you already run — nginx, Caddy, HAProxy, a cloud load balancer — and let it reach Rapira over loopback or a Unix socket. Binding to a public interface is a thing you can do, but with no TLS on that listener it is rarely a thing you want.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

The Unix socket is created with mode `0666`, so anything that can reach the path can connect to it. Rapira has no knob for that mode. If it matters, restrict the directory instead: with the unit above, `RuntimeDirectoryMode=0750` plus a `Group=` the proxy's user belongs to keeps everyone else out of `/run/rapira`.

Your proxy has one obligation on the way in: forwarded fields must use the ordinary `-` spelling — `X-Forwarded-For`, never `X_Forwarded_For`. Underscore and dot spellings fold onto the same `$_SERVER` key as the proper one, which is how a client would otherwise overwrite what your proxy just set, so Rapira drops them before PHP sees them. The [HTTP page](/docs/http) explains the mapping and the `http.unsafe_field_names` knob that governs it.

## Zero-downtime deploys

Deploy the new code, then:

```bash
sudo systemctl reload rapira
```

That's a `SIGUSR2` to the master, which answers it with a **rolling reload**: the pool is replaced one worker at a time and in-flight requests run to completion — nothing is dropped unless a worker overruns `process_control_timeout_secs`, which escalates it to `SIGTERM` and then `SIGKILL` and takes its request with it (see below). How the roll overlaps the fresh worker with the old one is on [Process model](/docs/process-model).

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

`process_control_timeout_secs` is the patience budget the master gives a worker to finish before it escalates, and it caps each step of a rolling reload too, so one wedged worker can't stall the whole roll — the escalation ladder and the full signal table are on [Process model](/docs/process-model). Keep it comfortably under systemd's `TimeoutStopSec`, otherwise systemd's own patience runs out first and kills the master mid-escalation.

::: warning A reload rolls workers, it does not re-read anything
The master keeps the settings it booted with, and the OPcache shared memory belongs to the master too, so it outlives every worker generation. Changing `rapira.toml` needs `systemctl restart rapira`. And if you've set `opcache.validate_timestamps = 0`, a reload will happily serve the old opcodes — restart instead.
:::

## Logs

Rapira writes every log record to **stderr**, one write per record, so master and worker output never interleave mid-line. A systemd unit's stderr goes to the journal with no configuration at all, which means the only thing left to decide is the format — and in production that's JSON:

```toml
[log]
level = "info"
format = "json"
```

One object per line, `timestamp` in RFC 3339 UTC, plus `level`, `message` and `target`; newlines inside a message are escaped so a record is always exactly one line. That is the shape every log collector wants, and it survives the trip through journald intact.

```bash
journalctl -u rapira -f
```

To ship them off the box, point your collector at the unit's journal, or run Rapira with its stderr piped straight into the agent if you'd rather skip journald. Either way the record is already structured — no regex parsing on the far end. For per-target levels and the `RUST_LOG` override that replaces the whole filter for one debugging session, see [Logging](/docs/logging).

## Worker hygiene

A resident process is the point of the [worker rungs](/docs/execution-modes) — and also the reason a slow leak you'd never have noticed under php-fpm suddenly matters. Two settings are the safety net:

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` retires a worker after that many requests and forks a fresh one, with a bit of jitter added so the whole pool doesn't recycle in lockstep. It is not a fix for a leak; it's what keeps an unfound leak from becoming an incident at 3am. `request_terminate_timeout_secs` is a wall-clock ceiling on a single request: a worker that exceeds it is killed and respawned, which stops one stuck request from permanently costing you a worker. Both are off by default, and both are worth turning on before you go live.

[Process model](/docs/process-model) covers the rest of the pool — static, dynamic and ondemand sizing, respawn backoff, and what the master does when a worker dies.

::: question Do I still need php-fpm, or a process manager like supervisord?
Neither. Rapira takes php-fpm's place, and its master already supervises the pool — it forks, reaps, respawns with backoff, recycles workers and scales the pool. systemd's only job is keeping that one master process alive.
:::

::: question Can I run two apps on one host?
Yes — two configs, two units, two listen addresses. A systemd template unit (`rapira@.service`) is the tidy way to do it. Each instance boots its own PHP and its own worker pool; they share nothing but the machine.
:::

::: question Why doesn't the package install a php.ini?
Because it would be the one file you're guaranteed to edit, and a packaged config file that gets edited is a merge conflict on every upgrade. Rapira also runs fine without one — its built-in ini defaults keep PHP's diagnostics in the log rather than in your responses, as [Logging](/docs/logging) explains. Write your own `php.ini` in `/etc/rapira` when you want OPcache tuning, a memory limit or a timezone; whatever it sets wins.
:::
