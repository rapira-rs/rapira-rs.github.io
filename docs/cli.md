---
title: Command line
description: Every option rapira serve accepts, how CLI flags layer over the config file, and how entry-script paths are resolved.
---

# Command line

Rapira ships as a single binary with one subcommand:

```bash
rapira serve [OPTIONS] [SCRIPT]
```

`serve` is what boots the server: it starts PHP, registers the built-in extensions and begins answering requests. Running bare `rapira` with no arguments prints the help and exits, and `rapira serve --help` lists the options below straight from the binary. `rapira --version` tells you which build you have.

A config file is optional: a single command with a script path is a complete, working server, and the file is there for when the flags are not enough.

## How settings layer

A setting is resolved from up to three layers, consulted in this order:

**CLI flags > config file > built-in defaults.**

Only the four flags in the table below and the `SCRIPT` argument have a command-line form; everything else comes from the file or the default.

So a flag always wins over the same value in `rapira.toml`, and `rapira.toml` always wins over the default. That ordering lets you keep the stable configuration in the file and override one value on the command line for a single run — a different port while you test, more workers on a bigger box — without editing anything.

Anything you don't set at all falls through to the defaults in the table below. Settings the flags don't expose — pool scaling, logging, request limits — come from the file, and the full list of what a config file can hold lives on [Configuration](/docs/configuration).

## Options

| Option            | Default          | What it does                                                                                     |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `--config <PATH>` | none             | Load settings from a `rapira.toml`.                                                              |
| `--listen <ADDR>` | `127.0.0.1:8000` | Bind address: `host:port`, `:port` (all interfaces), or `unix:<path>`.                           |
| `--processes <N>` | CPU count        | Worker processes to fork.                                                                        |
| `--classic`       | off              | Re-run the script from scratch on every request instead of keeping it resident.                  |
| `SCRIPT`          | required*        | The PHP entry script. Overrides `pool.entrypoint` from the config file.                          |

\* Required unless the config file sets `pool.entrypoint`. With neither, `serve` reports an error and does not start.

**`--listen`** takes three shapes. `127.0.0.1:8000` (the default) binds one interface — loopback only, so nothing outside the machine can reach it. `:8080` is shorthand for `0.0.0.0:8080` — every IPv4 interface, which is the usual binding in a container; for IPv6 write `[::]:8080`. `unix:/run/rapira.sock` binds a Unix socket instead, for a reverse proxy on the same host. IPv6 literals go in brackets: `[::1]:8000`. A bare port is *not* an address and is rejected because it doesn't say whether to bind loopback only or every interface — `--listen 8080` is an error, write `--listen :8080` or `--listen 127.0.0.1:8080`. The host part has to be an IP literal — hostnames are never resolved, so `--listen localhost:8000` is an error; write `--listen 127.0.0.1:8000`.

**`--processes`** defaults to the number of logical CPUs. Under the default static pool that is exactly how many worker processes get forked; when the config file switches the pool to `dynamic` or `ondemand`, the same number becomes the ceiling those modes scale up to. See [Process model](/docs/process-model) for what the workers and the master actually do.

**`--classic`** picks the mode the app runs in. Without it the entry script is loaded once and stays resident, which is [SAPI Worker](/docs/worker) mode; with it, the script is re-included per request exactly as it would be under php-fpm, which is [Classic](/docs/classic) mode. If you are not sure which one your application can use, [Execution modes](/docs/execution-modes) describes all four modes.

::: info
`--classic` is a switch that only turns on. There is no `--no-classic`, so `classic = true` in a config file cannot be turned off from the command line — remove the key from the file instead.
:::

## Entry script resolution

The script can be given twice — as the positional `SCRIPT` argument or as `pool.entrypoint` in the config file — and if both are present, the command line wins while every other setting in the file still applies. Either way Rapira turns it into an absolute path before the server forks anything, because a daemon's working directory is not the directory you deployed into.

The two relative forms resolve against different bases:

- A relative `SCRIPT` on the command line resolves against **the current directory**.
- A relative `pool.entrypoint` resolves against **the config file's own directory** — so a config file and the application next to it can be moved, copied or mounted anywhere as a unit and the path still resolves.

```toml
[pool]
entrypoint = "public/index.php"
```

With that in `/etc/rapira/rapira.toml`, the entry script is `/etc/rapira/public/index.php` — regardless of the current directory you ran the command from.

## Examples

Common invocations:

```bash
rapira serve app/worker.php
rapira serve --classic public/index.php
rapira serve --listen :8080 --processes 8 app/worker.php
rapira serve --listen unix:/run/rapira.sock app/worker.php
rapira serve --config /etc/rapira/rapira.toml
rapira serve --config /etc/rapira/rapira.toml --listen 127.0.0.1:9000
```

The first command takes no `--listen`, so the server comes up on the default address and one more line is enough to send it a request. See [Quickstart](/docs/quickstart) for a worker script to run with it.

```bash
curl http://127.0.0.1:8000/
```

## Stopping the server

The first `SIGINT` or `SIGTERM` — a `Ctrl-C` in the terminal, or what your init system sends — drains in-flight requests and shuts extensions down cleanly; a second one stops waiting and forces the exit. Signals go to the master process, and the complete table of them, reloads included, is on [Process model](/docs/process-model).
