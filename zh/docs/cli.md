---
title: 命令行
description: "rapira serve 命令、它的配置文件参数、相对路径、停止信号和退出码。"
---

# 命令行

Rapira 只有一个可执行文件，也只有一个子命令：

```bash
rapira serve <CONFIG>
```

`serve` 命令启动 PHP、准备插件并处理请求。`CONFIG` 是配置文件的路径，它是必填的。任何文件名都可以，本文档使用 `rapira.toml`。

运行不带参数的 `rapira` 以显示帮助。运行 `rapira serve --help` 以显示该命令的帮助。运行 `rapira --version` 以显示已安装的版本。

配置文件保存服务器的所有设置。文件中的值覆盖内置默认值。`RUST_LOG` 和 `NO_COLOR` 只改变 stderr 输出。所有键和 `listen` 的地址格式见[配置](/zh/docs/configuration)。

::: question 可以在命令行上设置模式或监听地址吗？
不可以。`rapira serve` 只接受配置文件。在 `[http.pool]` 中设置 `processes`、`mode` 和 `entrypoint`。在 `[http]` 中设置 `listen`。
:::

## 相对路径

文件中的相对路径以配置文件目录为基准。此规则适用于 `http.pool.entrypoint`、`grpc.pool.entrypoint` 和其他路径键。例如，`/etc/rapira/rapira.toml` 中的 `entrypoint = "public/index.php"` 解析为 `/etc/rapira/public/index.php`。当前目录不影响这些路径。相对的 `unix:` 监听路径不同：它使用 `rapira serve` 命令的当前目录。路径键的列表见[相对路径](/zh/docs/configuration#相对路径)。

## 示例

此 `rapira.toml` 以 Dispatcher 模式（默认模式）提供 HTTP 服务：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/dispatcher.php"
```

要选择其他模式，在 `[http.pool]` 中设置 `mode = "worker"` 或 `mode = "classic"`。见[执行模式](/zh/docs/execution-modes)。

使用文件路径启动服务器：

```bash
rapira serve rapira.toml
rapira serve /etc/rapira/rapira.toml
```

服务器监听 `127.0.0.1:8000`。使用此命令发送请求：

```bash
curl http://127.0.0.1:8000/
```

[快速开始](/zh/docs/intro/quickstart)包含 Classic 模式和 Worker 模式使用的入口脚本。对于 Dispatcher 入口脚本，请使用仓库 [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) 目录中的 `dispatcher-sync.php`。编程指南见 [Dispatcher 模式](/zh/docs/dispatcher)。

## 停止服务器

第一个 `SIGTERM` 或 `SIGINT` 开始受控停止。worker 不再接受新工作，并完成当前请求。然后 master 关闭 PHP 并退出。第二个 `SIGTERM` 或 `SIGINT` 停止等待并强制退出。将信号发送到 master 进程。完整的信号表见[进程模型](/zh/docs/process-model)。

在终端中按 Ctrl-C 会向 master 和每个 worker 发送 `SIGINT`。然后 master 向每个 worker 发送 `SIGQUIT`，因此每个 worker 收到第二个信号，并立即以退出码 `131` 退出。当前请求不会完成。要进行受控停止，只向 master 发送 `SIGTERM`，例如 `kill -TERM <master-pid>`。使用 `KillMode=mixed` 的 systemd 和 `docker stop` 也只向 master 发送信号。

## 退出码

| 退出码 | 含义 |
| --- | --- |
| `0` | 服务器已停止，所有 worker 都已退出。`--help`、`--version` 和不带参数的 `rapira` 也以 `0` 退出。 |
| `1` | 服务器没有启动。例如，配置无效、Rapira 无法读取文件、监听器无法绑定或 PHP 无法启动。错误输出到 stderr。 |
| `2` | 命令行无效，例如未知选项或缺少 `CONFIG`。 |
| `70` | master 启动后发生故障。例如，所有进程池的 worker 总数超过 2048，或 master 无法写入 pidfile。如果不健康的第零代 worker 所属进程池没有成功的请求，也没有空闲或活动的 worker，它也会导致此退出。第零代指第一次重载前创建的 worker。日志中有一条 `master failed` 记录。 |
| `130` | 停止期间收到 `SIGTERM` 或 `SIGINT`，并强制退出。 |
