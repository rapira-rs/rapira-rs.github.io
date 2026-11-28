---
title: 命令行
description: "rapira serve 命令、它的配置文件参数、相对路径、停止信号和退出码。"
---

# 命令行

Rapira 只有一个可执行文件，也只有一个子命令：

```bash
rapira serve <CONFIG>
```

`serve` 命令启动 PHP、准备插件并在前台处理请求。`CONFIG` 是配置文件的路径，它是必填的。任何文件名都可以，本文档使用 `rapira.toml`。

运行不带参数的 `rapira` 以显示帮助。运行 `rapira serve --help` 以显示该命令的帮助。运行 `rapira --version` 以显示已安装的版本。

配置文件保存服务器的所有设置。文件中的值覆盖内置默认值。`RUST_LOG` 和 `NO_COLOR` 只改变 stderr 输出。所有键和 `listen` 的地址格式见[配置](/zh/docs/configuration)。

::: question 可以在命令行上设置模式或监听地址吗？
不可以。`rapira serve` 只接受配置文件。在 `[http.pool]` 中设置 `workers`、`mode` 和 `entrypoint`。在 `[http]` 中设置 `listen`。
:::

## 相对路径

配置文件中的相对路径以配置文件目录为基准。此规则适用于 `http.pool.entrypoint`、`grpc.pool.entrypoint`、相对的 `unix:` 监听路径以及所有其他路径键。例如，`/etc/rapira/rapira.toml` 中的 `entrypoint = "public/index.php"` 解析为 `/etc/rapira/public/index.php`。当前目录不影响这些路径。路径键的列表见[相对路径](/zh/docs/configuration#relative-paths)。

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

第一个 `SIGTERM`、`SIGINT` 或 `SIGQUIT` 开始受控停止。Rapira 关闭监听器，在 `[server].stop_timeout_secs` 时间内排空打开的连接，关闭 PHP 并退出。在终端中按 `Ctrl-C` 会发送 `SIGINT` 并执行相同的受控停止。

排空期间收到第二个 `SIGTERM` 或 `SIGINT` 会强制以退出码 `130` 立即退出。完整的信号表见[进程模型](/zh/docs/process-model)。

## 退出码 {#exit-codes}

| 退出码 | 含义 |
| --- | --- |
| `0` | 服务器已正常停止。`--help`、`--version` 和不带参数的 `rapira` 也以 `0` 退出。 |
| `1` | 启动或运行时故障，例如配置无效、文件不可读、绑定错误、PHP 或 `SIGRTMAX` 设置错误，或监听器故障。错误输出到 stderr。 |
| `2` | 命令行无效，例如未知选项或缺少 `CONFIG`。 |
| `70` | 常驻 worker 在其进程池处理任何工作单元前达到 `max_boot_failures`。 |
| `101` | 一个 PHP worker 线程发生 panic。 |
| `124` | 某个进程池中的所有 worker 在超过 `request_terminate_timeout_secs` 后的 5 秒看门狗宽限期内仍处于阻塞状态。 |
| `130` | 停止期间收到第二个 `SIGTERM` 或 `SIGINT`，并强制退出。 |
