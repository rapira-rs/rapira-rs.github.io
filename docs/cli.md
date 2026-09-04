---
title: Command line
description: Options for rapira serve, configuration precedence, and entry script path resolution.
---

# Command line

Rapira ships as a single binary with one subcommand:

```bash
rapira serve [OPTIONS] [SCRIPT]
```

The `serve` command starts PHP, registers the built-in extensions, and accepts requests.
Run `rapira` without arguments to show help. Run `rapira serve --help` to list the available options.
Run `rapira --version` to show the installed version.

A configuration file is optional. A command with a script path can start the server with default settings.

## Configuration precedence

Rapira reads settings in this order:

**CLI flags > configuration file > built-in defaults.**

Only the four flags in the table and the `SCRIPT` argument have CLI forms. Other settings use the configuration file or default value.

A flag overrides the related value in `rapira.toml`. A value in `rapira.toml` overrides the default.
Use a flag to change one value for one run. For example, test another port without editing the configuration file.

Unset options use the defaults in the table. The configuration file controls settings without flags, such as pool scaling, logging, and request limits.
See [Configuration](/docs/configuration) for all configuration file settings.

## Options

| Option            | Default          | What it does                                                                                     |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `--config <PATH>` | none             | Load settings from a `rapira.toml`.                                                              |
| `--listen <ADDR>` | `127.0.0.1:8000` | Bind address: `host:port`, `:port` (all interfaces), or `unix:<path>`.                           |
| `--processes <N>` | CPU count        | Number of worker processes.                                                                       |
| `--mode <MODE>`   | `dispatcher`     | Execution mode: `classic`, `worker` or `dispatcher`. Overrides `pool.mode` from the configuration file. |
| `SCRIPT`          | required*        | The PHP entry script. Overrides `pool.entrypoint` from the configuration file.                    |

\* Required unless the configuration file sets `pool.entrypoint`. With neither, `serve` reports an error and does not start.

**`--listen`** accepts three address formats. `127.0.0.1:8000` binds the loopback interface. Remote systems cannot connect to this address.
`:8080` is equal to `0.0.0.0:8080` and binds all IPv4 interfaces. Use `[::]:8080` for all IPv6 interfaces.
`unix:/run/rapira.sock` creates a Unix socket for a local reverse proxy. Put IPv6 literals in brackets, as in `[::1]:8000`.
Rapira rejects a port without an address. Use `--listen :8080` or `--listen 127.0.0.1:8080`.
Rapira does not resolve host names in this option. Use `127.0.0.1:8000` instead of `localhost:8000`.

**`--processes`** defaults to the logical CPU count. Static scaling uses it as the exact worker count.
Dynamic and ondemand scaling use it as the maximum worker count. See [Process model](/docs/process-model) for more information.

**`--mode`** selects the execution mode. `dispatcher` is the default and gets each request from the host.
`worker` retains the entry script and runs a handler for each request. `classic` starts a new PHP request for each HTTP request.
The flag overrides the mode in the configuration file.
See [Classic mode](/docs/classic), [Worker mode](/docs/worker), and [Execution modes](/docs/execution-modes) for more information.

::: info
`pool.scaling` and `pool.mode` are separate keys. `pool.scaling` sets the policy that sizes the pool. `pool.processes` sets the worker count the policy applies, and `--processes` overrides it. `pool.mode` sets what a worker does with a request. `pool.scaling` has no flag. Set it in the configuration file.
:::

## Entry script resolution

Specify the script with the `SCRIPT` argument or `pool.entrypoint`. The argument overrides `pool.entrypoint`, but other configuration file settings still apply.
Rapira converts the script path to an absolute path before it creates workers. This prevents later changes to the working directory from affecting it.

The two relative forms resolve against different bases:

- A relative `SCRIPT` on the command line resolves against **the current directory**.
- A relative `pool.entrypoint` resolves against **the configuration file directory**.

```toml
[pool]
entrypoint = "public/index.php"
```

This setting in `/etc/rapira/rapira.toml` resolves to `/etc/rapira/public/index.php`. The current directory does not affect it.

## Examples

Common invocations:

```bash
rapira serve app/dispatcher.php
rapira serve --mode worker app/worker.php
rapira serve --mode classic public/index.php
rapira serve --listen :8080 --processes 8 app/dispatcher.php
rapira serve --listen unix:/run/rapira.sock app/dispatcher.php
rapira serve --config /etc/rapira/rapira.toml
rapira serve --config /etc/rapira/rapira.toml --listen 127.0.0.1:9000
```

The first command does not set `--listen`. Therefore, the server uses the default address.
Send a request with this command:

```bash
curl http://127.0.0.1:8000/
```

[Quickstart](/docs/intro/quickstart) gives the entry scripts for the `--mode classic` and `--mode worker` commands. For a Dispatcher entry script, use `dispatcher-sync.php` or `dispatcher-async.php` from the repository [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) directory.

## Stopping the server

The first `SIGINT` or `SIGTERM` lets current requests finish. It then shuts down extensions and exits.
A second signal stops the wait and forces an exit. Send signals to the master process.
See [Process model](/docs/process-model) for the complete signal table.
