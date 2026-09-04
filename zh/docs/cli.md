---
title: 命令行
description: "rapira serve 的选项、配置优先级和入口脚本路径解析。"
---

# 命令行

Rapira 只有一个可执行文件，也只有一个子命令：

```bash
rapira serve [OPTIONS] [SCRIPT]
```

`serve` 命令启动 PHP、注册内置扩展并接受请求。 运行不带参数的 `rapira` 以显示帮助。运行 `rapira serve --help` 以显示可用选项。 运行 `rapira --version` 以显示已安装的版本。

配置文件是可选的。包含脚本路径的命令可以使用默认设置启动服务器。

## 设置优先级

Rapira 按以下顺序读取设置：

**命令行参数 > 配置文件 > 内置默认值。**

只有表中的四个选项和 `SCRIPT` 参数有命令行形式。其他设置使用文件值或默认值。

命令行参数覆盖 `rapira.toml` 中的对应值。`rapira.toml` 中的值覆盖默认值。 此顺序允许一次运行使用临时值。例如，无需编辑文件即可测试其他端口。

未设置的选项使用表中的默认值。配置文件控制进程池伸缩、日志和请求限制。 所有文件设置见[配置](/zh/docs/configuration)。

## 选项

| 选项              | 默认值           | 作用                                                             |
| ----------------- | ---------------- | ---------------------------------------------------------------- |
| `--config <PATH>` | 无               | 从 `rapira.toml` 读取设置。                                      |
| `--listen <ADDR>` | `127.0.0.1:8000` | 绑定地址：`host:port`、`:port`（所有接口）或 `unix:<path>`。     |
| `--processes <N>` | CPU 核数         | fork 出的 worker 进程数。                                        |
| `--mode <MODE>`   | `dispatcher`     | 运行模式：`classic`、`worker` 或 `dispatcher`。会覆盖配置文件里的 `pool.mode`。 |
| `SCRIPT`          | 必填*            | PHP 入口脚本。会覆盖配置文件里的 `pool.entrypoint`。             |

\* 除非配置文件里设了 `pool.entrypoint`，否则必填。两者都没有时，`serve` 会报错并且不会启动。

**`--listen`** 接受三种地址格式。`127.0.0.1:8000` 绑定回环接口。 远程系统无法连接此地址。`:8080` 等于 `0.0.0.0:8080`，并绑定所有 IPv4 接口。 对所有 IPv6 接口使用 `[::]:8080`。`unix:/run/rapira.sock` 为本地反向代理创建 Unix 套接字。 将 IPv6 字面量放在方括号中，例如 `[::1]:8000`。 Rapira 拒绝没有地址的端口。请使用 `--listen :8080` 或 `--listen 127.0.0.1:8080`。 Rapira 不会在此选项中解析主机名。请使用 `127.0.0.1:8000`，不要使用 `localhost:8000`。

**`--processes`** 默认使用逻辑 CPU 数量。静态伸缩将其用作准确的 worker 数量。 动态伸缩和 `ondemand` 将其用作最大 worker 数量。有关详细信息，请参阅[进程模型](/zh/docs/process-model)。

**`--mode`** 选择执行模式。`dispatcher` 是默认值，它从宿主获取每个请求。 `worker` 保留入口脚本，并为每个请求运行一个 handler。`classic` 为每个 HTTP 请求启动一个新的 PHP 请求。 此选项会覆盖配置文件中的模式。 有关详细信息，请参阅 [Classic 模式](/zh/docs/classic)、[Worker 模式](/zh/docs/worker)和[执行模式](/zh/docs/execution-modes)。

::: info
`pool.scaling` 和 `pool.mode` 是不同的键。`pool.scaling` 设置调整进程池大小的策略。`pool.processes` 设置该策略使用的 worker 数量，`--processes` 会覆盖此值。`pool.mode` 设置 worker 处理请求的方式。`pool.scaling` 没有命令行选项。请在配置文件中设置它。
:::

## 入口脚本的路径解析

使用 `SCRIPT` 参数或 `pool.entrypoint` 指定脚本。该参数会覆盖 `pool.entrypoint`，但配置文件中的其他设置仍然生效。 Rapira 在创建 worker 前将脚本路径转换为绝对路径。这样，之后的工作目录更改不会影响该路径。

两种相对路径的解析基准并不一样：

- 命令行上的相对 `SCRIPT` 相对**当前目录**解析。
- 相对 `pool.entrypoint` 以**配置文件目录**为基准进行解析。

```toml
[pool]
entrypoint = "public/index.php"
```

`/etc/rapira/rapira.toml` 中的此设置解析为 `/etc/rapira/public/index.php`。当前目录不会影响该路径。

## 示例

常见调用：

```bash
rapira serve app/dispatcher.php
rapira serve --mode worker app/worker.php
rapira serve --mode classic public/index.php
rapira serve --listen :8080 --processes 8 app/dispatcher.php
rapira serve --listen unix:/run/rapira.sock app/dispatcher.php
rapira serve --config /etc/rapira/rapira.toml
rapira serve --config /etc/rapira/rapira.toml --listen 127.0.0.1:9000
```

第一个命令未设置 `--listen`。因此，服务器使用默认地址。 使用此命令发送请求：

```bash
curl http://127.0.0.1:8000/
```

[快速开始](/zh/docs/intro/quickstart)包含 `--mode classic` 和 `--mode worker` 使用的入口脚本。对于 Dispatcher，请使用 [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) 目录中的 `dispatcher-sync.php` 或 `dispatcher-async.php`。

## 停止服务器

第一个 `SIGINT` 或 `SIGTERM` 允许完成当前请求。然后，服务器关闭扩展并退出。 第二个信号停止等待并强制退出。将信号发送到 master 进程。 有关完整的信号表，请参阅[进程模型](/zh/docs/process-model)。
