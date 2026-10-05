---
title: Command line
description: The rapira serve command, its configuration file argument, relative paths, the stop signals, and the exit codes.
---

# Command line

Rapira ships as a single binary with one subcommand:

```bash
rapira serve <CONFIG>
```

The `serve` command starts PHP, prepares the plugins, and serves requests. `CONFIG` is the path to the configuration file and is required. Any file name works, and this documentation uses `rapira.toml`.

Run `rapira` with no arguments to show the help. Run `rapira serve --help` to show the command help. Run `rapira --version` to show the installed version.

The configuration file holds every server setting. A value in the file overrides the built-in default. `RUST_LOG` and `NO_COLOR` change only stderr output. See [Configuration](/docs/configuration) for all keys and for the `listen` address formats.

::: question Can I set the mode or the listen address on the command line?
No. `rapira serve` accepts only the configuration file. Set `processes`, `mode`, and `entrypoint` in `[http.pool]`. Set `listen` in `[http]`.
:::

## Relative paths

A relative path in the file uses the configuration file directory as its base. This applies to `http.pool.entrypoint`, `grpc.pool.entrypoint`, and the other path keys. For example, `entrypoint = "public/index.php"` in `/etc/rapira/rapira.toml` resolves to `/etc/rapira/public/index.php`. The current directory has no effect on these paths. A relative `unix:` listen path is different: it uses the current directory of the `rapira serve` command. See [Relative paths](/docs/configuration#relative-paths) for the list of path keys.

## Example

This `rapira.toml` serves HTTP in Dispatcher mode, the default mode:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/dispatcher.php"
```

To select another mode, set `mode = "worker"` or `mode = "classic"` in `[http.pool]`. See [Execution modes](/docs/execution-modes).

Start the server with the path to the file:

```bash
rapira serve rapira.toml
rapira serve /etc/rapira/rapira.toml
```

The server listens on `127.0.0.1:8000`. Send a request with this command:

```bash
curl http://127.0.0.1:8000/
```

[Quickstart](/docs/intro/quickstart) gives the entry scripts for Classic and Worker modes. For a Dispatcher entry script, use `dispatcher-sync.php` from the repository [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) directory. See [Dispatcher mode](/docs/dispatcher) for the programming guide.

## Stopping the server

The first `SIGTERM` or `SIGINT` starts a controlled stop. The workers do not accept new work and finish current requests. Then the master shuts down PHP and exits. A second `SIGTERM` or `SIGINT` stops the wait and forces the exit. Send signals to the master process. See [Process model](/docs/process-model) for the complete signal table.

Ctrl-C in a terminal sends `SIGINT` to the master and to every worker. The master then sends `SIGQUIT` to each worker, so each worker gets a second signal and exits at once with code `131`. Current requests do not finish. For a controlled stop, send `SIGTERM` to the master only, for example `kill -TERM <master-pid>`. systemd with `KillMode=mixed` and `docker stop` also signal only the master.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | The server stopped, and all workers exited. `--help`, `--version`, and `rapira` with no arguments also exit with `0`. |
| `1` | The server did not start. For example, the configuration is not valid, Rapira cannot read a file, a listener cannot bind, or PHP cannot start. The error is on stderr. |
| `2` | The command line is not valid, for example an unknown option or a missing `CONFIG`. |
| `70` | The master failed after it started. For example, the worker total of all pools is more than 2048, or the master cannot write the pidfile. An unhealthy generation-zero worker also causes this exit if its pool has no successful request and no idle or active worker. Generation zero identifies workers created before the first reload. The log has a `master failed` record. |
| `130` | A `SIGTERM` or `SIGINT` arrived during a stop and forced the exit. |
