---
title: Command line
description: The rapira serve command, its configuration file argument, and entry script path resolution.
---

# Command line

Rapira ships as a single binary with one subcommand:

```bash
rapira serve <CONFIG>
```

The `serve` command starts PHP, registers the built-in extensions, and accepts requests. `CONFIG` is the path to the configuration file. It is required. Any file name works, and this documentation uses `rapira.toml`. Run `rapira` without arguments to show help. Run `rapira serve --help` to show the command help. Run `rapira --version` to show the installed version.

The configuration file holds every server setting. A value in the file overrides the built-in default. `RUST_LOG` and `NO_COLOR` change only the log output. See [Configuration](/docs/configuration) for all keys and for the `listen` address formats.

## Entry script resolution

`http.pool.entrypoint` names the PHP entry script. A relative path uses the configuration file directory as its base. Rapira converts the path to an absolute path before it creates workers. Thus, later changes to the working directory do not affect it.

```toml
[http.pool]
entrypoint = "public/index.php"
```

This setting in `/etc/rapira/rapira.toml` resolves to `/etc/rapira/public/index.php`. The current directory does not affect it.

## Examples

Each example is a complete `rapira.toml`. Dispatcher mode is the default:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/dispatcher.php"
mode = "dispatcher"
```

Worker mode:

```toml
[http]
listen = ":8080"

[http.pool]
entrypoint = "app/worker.php"
mode = "worker"
```

Classic mode:

```toml
[http]
listen = "unix:/run/rapira.sock"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

Start the server with the path to the file:

```bash
rapira serve rapira.toml
rapira serve /etc/rapira/rapira.toml
```

The first example listens on `127.0.0.1:8000`. Send a request with this command:

```bash
curl http://127.0.0.1:8000/
```

[Quickstart](/docs/intro/quickstart) gives the entry scripts for Classic and Worker modes. For a Dispatcher entry script, use `dispatcher-sync.php` or `dispatcher-async.php` from the repository [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) directory.

## Stopping the server

The first `SIGINT` or `SIGTERM` lets current requests finish. It then shuts down extensions and exits.
A second signal stops the wait and forces an exit. Send signals to the master process.
See [Process model](/docs/process-model) for the complete signal table.
