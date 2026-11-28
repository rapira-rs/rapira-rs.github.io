---
title: Command line
description: The rapira serve command, its configuration file argument, relative paths, stop signals, and exit codes.
---

# Command line

Rapira ships as a single binary with one subcommand:

```bash
rapira serve <CONFIG>
```

The `serve` command starts PHP, prepares the plugins, and serves requests in the foreground. `CONFIG` is the path to the configuration file and is required. Any file name works, and this documentation uses `rapira.toml`.

Run `rapira` with no arguments to show the help. Run `rapira serve --help` to show the command help. Run `rapira --version` to show the installed version.

The configuration file holds every server setting. A value in the file overrides the built-in default. `RUST_LOG` and `NO_COLOR` change only stderr output. See [Configuration](/docs/configuration) for all keys and for the `listen` address formats.

::: question Can I set the mode or the listen address on the command line?
No. `rapira serve` accepts only the configuration file. Set `workers`, `mode`, and `entrypoint` in `[http.pool]`. Set `listen` in `[http]`.
:::

## Relative paths

A relative path in the configuration file uses the configuration file directory as its base. This applies to `http.pool.entrypoint`, `grpc.pool.entrypoint`, relative `unix:` listen paths, and all other path keys. For example, `entrypoint = "public/index.php"` in `/etc/rapira/rapira.toml` resolves to `/etc/rapira/public/index.php`. The current directory has no effect on these paths. See [Relative paths](/docs/configuration#relative-paths) for the list of path keys.

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

The first `SIGTERM`, `SIGINT`, or `SIGQUIT` starts a controlled stop. Rapira closes listeners, drains open connections within `[server].stop_timeout_secs`, shuts down PHP, and exits. Pressing `Ctrl-C` in a terminal sends `SIGINT` and performs the same controlled stop.

A second `SIGTERM` or `SIGINT` during drain forces an immediate exit with code `130`. See [Process model](/docs/process-model) for the complete signal table.

## Exit codes {#exit-codes}

| Code | Meaning |
| --- | --- |
| `0` | The server stopped cleanly. `--help`, `--version`, and `rapira` with no arguments also exit with `0`. |
| `1` | Startup or runtime failure, such as invalid configuration, unreadable file, bind error, PHP or `SIGRTMAX` setup error, or listener failure. The error is on stderr. |
| `2` | The command line is not valid, for example an unknown option or a missing `CONFIG`. |
| `70` | A resident worker reached `max_boot_failures` before its pool served a unit. |
| `101` | A PHP worker thread panicked. |
| `124` | Every worker in one pool stayed blocked past the 5-second watchdog grace period after `request_terminate_timeout_secs`. |
| `130` | A second `SIGTERM` or `SIGINT` arrived during a stop and forced the exit. |
