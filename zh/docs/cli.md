---
title: 命令行
description: "rapira serve 接受的全部选项、命令行参数如何叠加在配置文件之上，以及入口脚本路径的解析规则。"
---

# 命令行

Rapira 只有一个可执行文件，也只有一个子命令：

```bash
rapira serve [OPTIONS] [SCRIPT]
```

`serve` 命令启动 PHP、注册内置扩展并接受请求。
运行不带参数的 `rapira` 以显示帮助。运行 `rapira serve --help` 以显示可用选项。
运行 `rapira --version` 以显示已安装的版本。

配置文件是可选的。包含脚本路径的命令可以使用默认设置启动服务器。

## 设置优先级

Rapira 按以下顺序读取设置：

**命令行参数 > 配置文件 > 内置默认值。**

只有表中的四个选项和 `SCRIPT` 参数有命令行形式。其他设置使用文件值或默认值。

命令行参数覆盖 `rapira.toml` 中的对应值。`rapira.toml` 中的值覆盖默认值。
此顺序允许一次运行使用临时值。例如，无需编辑文件即可测试其他端口。

未设置的选项使用表中的默认值。配置文件控制进程池伸缩、日志和请求限制。
所有文件设置见[配置](/zh/docs/configuration)。

## 选项

| 选项              | 默认值           | 作用                                                             |
| ----------------- | ---------------- | ---------------------------------------------------------------- |
| `--config <PATH>` | 无               | 从 `rapira.toml` 读取设置。                                      |
| `--listen <ADDR>` | `127.0.0.1:8000` | 绑定地址：`host:port`、`:port`（所有接口）或 `unix:<path>`。     |
| `--processes <N>` | CPU 核数         | fork 出的 worker 进程数。                                        |
| `--mode <MODE>`   | `dispatcher`     | 运行模式：`classic`、`worker` 或 `dispatcher`。会覆盖配置文件里的 `pool.mode`。 |
| `SCRIPT`          | 必填*            | PHP 入口脚本。会覆盖配置文件里的 `pool.entrypoint`。             |

\* 除非配置文件里设了 `pool.entrypoint`，否则必填。两者都没有时，`serve` 会报错并且不会启动。

**`--listen`** 接受三种地址格式。`127.0.0.1:8000` 绑定回环接口。
远程系统无法连接此地址。`:8080` 等于 `0.0.0.0:8080`，并绑定所有 IPv4 接口。
对所有 IPv6 接口使用 `[::]:8080`。`unix:/run/rapira.sock` 为本地反向代理创建 Unix 套接字。
将 IPv6 字面量放在方括号中，例如 `[::1]:8000`。
Rapira 拒绝没有地址的端口。请使用 `--listen :8080` 或 `--listen 127.0.0.1:8080`。
Rapira 不会在此选项中解析主机名。请使用 `127.0.0.1:8000`，不要使用 `localhost:8000`。

**`--processes`** 默认使用逻辑 CPU 数量。静态伸缩将其用作准确的 worker 数量。
动态伸缩和 `ondemand` 将其用作最大 worker 数量。有关详细信息，请参阅[进程模型](/zh/docs/process-model)。

**`--mode`** 决定运行模式。默认是 `dispatcher`：常驻脚本自己向宿主取走每一个请求。`worker` 让入口脚本常驻，每个请求调用一次 handler。`classic` 每个请求都把入口脚本从头执行一遍，和在 php-fpm 下一样。这个参数带值，所以不管配置文件里写的是哪一种，命令行都能选中任意一种。更多内容见 [Classic 模式](/zh/docs/classic)、[Worker 模式](/zh/docs/worker)和[执行模式](/zh/docs/execution-modes)。

::: info
`pool.scaling` 和 `pool.mode` 是两个不同的键。`pool.scaling` 定的是给进程池定尺寸的策略；`pool.processes` 定的是这个策略要用的 worker 数量，`--processes` 可以覆盖它。`pool.mode` 定的是 worker 拿到请求之后做什么。`pool.scaling` 没有对应的命令行参数，只能写在配置文件里。
:::

## 入口脚本的路径解析

入口脚本可以指定两次--命令行上的位置参数 `SCRIPT`，或者配置文件里的 `pool.entrypoint`--两个都写了，命令行赢，而文件里其余的设置照旧生效。不管走哪一条，Rapira 都会在 fork 出任何进程之前先把它变成绝对路径，因为守护进程的工作目录并不是你部署代码的那个目录。

两种相对路径的解析基准并不一样：

- 命令行上的相对 `SCRIPT` 相对**当前目录**解析。
- `pool.entrypoint` 里的相对路径则相对**配置文件自己所在的目录**解析--这样配置文件和挨着它的应用就能作为一个整体随便搬、随便拷、随便挂载，路径照样能解析正确。

```toml
[pool]
entrypoint = "public/index.php"
```

把这段放进 `/etc/rapira/rapira.toml`，入口脚本就是 `/etc/rapira/public/index.php`--你在哪个目录下执行的命令，完全不影响这个结果。

## 示例

常见的几种用法：

```bash
rapira serve app/dispatcher.php
rapira serve --mode worker app/worker.php
rapira serve --mode classic public/index.php
rapira serve --listen :8080 --processes 8 app/dispatcher.php
rapira serve --listen unix:/run/rapira.sock app/dispatcher.php
rapira serve --config /etc/rapira/rapira.toml
rapira serve --config /etc/rapira/rapira.toml --listen 127.0.0.1:9000
```

第一个命令未设置 `--listen`。因此，服务器使用默认地址。
使用此命令发送请求：

```bash
curl http://127.0.0.1:8000/
```

`--mode classic` 和 `--mode worker` 这两条命令要用的入口脚本，[快速开始](/zh/docs/intro/quickstart)里都给了。Dispatcher 模式的入口脚本，可以直接取仓库 [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) 目录下的 `dispatcher-sync.php` 或 `dispatcher-async.php`。

## 停止服务器

第一个 `SIGINT` 或 `SIGTERM` 允许完成当前请求。然后，服务器关闭扩展并退出。
第二个信号停止等待并强制退出。将信号发送到 master 进程。
有关完整的信号表，请参阅[进程模型](/zh/docs/process-model)。
