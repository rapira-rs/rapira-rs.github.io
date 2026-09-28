---
title: 命令行
description: "rapira serve 命令、它的配置文件参数和入口脚本路径解析。"
---

# 命令行

Rapira 只有一个可执行文件，也只有一个子命令：

```bash
rapira serve <CONFIG>
```

`serve` 命令启动 PHP、注册内置扩展并接受请求。`CONFIG` 是配置文件的路径。它是必填的。任何文件名都可以，本文档使用 `rapira.toml`。运行不带参数的 `rapira` 以显示帮助。运行 `rapira serve --help` 以显示该命令的帮助。运行 `rapira --version` 以显示已安装的版本。

配置文件保存服务器的所有设置。文件中的值覆盖内置默认值。`RUST_LOG` 和 `NO_COLOR` 只改变 stderr 输出。所有键和 `listen` 的地址格式见[配置](/zh/docs/configuration)。

## 入口脚本的路径解析

`http.pool.entrypoint` 指定 PHP 入口脚本。相对路径以配置文件目录为基准。 Rapira 在创建 worker 前将脚本路径转换为绝对路径。这样，之后的工作目录更改不会影响该路径。

```toml
[http.pool]
entrypoint = "public/index.php"
```

`/etc/rapira/rapira.toml` 中的此设置解析为 `/etc/rapira/public/index.php`。当前目录不会影响该路径。

## 示例

每个示例都是一个完整的 `rapira.toml`。默认是 Dispatcher 模式：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/dispatcher.php"
mode = "dispatcher"
```

Worker 模式：

```toml
[http]
listen = ":8080"

[http.pool]
entrypoint = "app/worker.php"
mode = "worker"
```

Classic 模式：

```toml
[http]
listen = "unix:/run/rapira.sock"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

使用文件路径启动服务器：

```bash
rapira serve rapira.toml
rapira serve /etc/rapira/rapira.toml
```

第一个示例监听 `127.0.0.1:8000`。使用此命令发送请求：

```bash
curl http://127.0.0.1:8000/
```

[快速开始](/zh/docs/intro/quickstart)包含 Classic 模式和 Worker 模式使用的入口脚本。对于 Dispatcher，请使用 [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) 目录中的 `dispatcher-sync.php` 或 `dispatcher-async.php`。

## 停止服务器

第一个 `SIGINT` 或 `SIGTERM` 允许完成当前请求。然后，服务器关闭扩展并退出。 第二个信号停止等待并强制退出。将信号发送到 master 进程。 有关完整的信号表，请参阅[进程模型](/zh/docs/process-model)。
