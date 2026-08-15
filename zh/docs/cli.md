---
title: 命令行
description: "rapira serve 接受的全部选项、命令行参数如何叠加在配置文件之上，以及入口脚本路径的解析规则。"
---

# 命令行

Rapira 只有一个可执行文件，也只有一个子命令：

```bash
rapira serve [OPTIONS] [SCRIPT]
```

服务器就是由 `serve` 拉起来的：它启动 PHP，注册内置扩展，然后开始应答请求。不带任何参数直接执行 `rapira`，它只会打印帮助信息然后退出；`rapira serve --help` 则直接从可执行文件里列出下面这些选项。想知道手上是哪个构建版本，执行 `rapira --version`。

配置文件是可选的：一条命令加上一个脚本路径，就已经是一台完整可用的服务器，而配置文件是在命令行参数不够用时才需要的。

## 设置是怎么叠加的

一项设置最多经过三层来确定，查找顺序如下：

**命令行参数 > 配置文件 > 内置默认值。**

只有下表里的四个选项和位置参数 `SCRIPT` 有命令行写法，其余设置要么来自配置文件，要么用默认值。

也就是说，同一项设置，命令行参数压过 `rapira.toml`，`rapira.toml` 又压过默认值。有了这个顺序，你可以把稳定的配置写进文件，临时跑一次时在命令行上单独覆盖某一项——测试时换个端口，机器大了就多开几个 worker——什么都不用改。

完全没设过的项，就落到下表的默认值上。命令行参数覆盖不到的设置——进程池伸缩、日志、请求限制——都来自配置文件；配置文件能写哪些内容，完整清单见[配置](/zh/docs/configuration)。

## 选项

| 选项              | 默认值           | 作用                                                             |
| ----------------- | ---------------- | ---------------------------------------------------------------- |
| `--config <PATH>` | 无               | 从 `rapira.toml` 读取设置。                                      |
| `--listen <ADDR>` | `127.0.0.1:8000` | 绑定地址：`host:port`、`:port`（所有接口）或 `unix:<path>`。     |
| `--processes <N>` | CPU 核数         | fork 出的 worker 进程数。                                        |
| `--classic`       | 关闭             | 每个请求都把脚本从头跑一遍，而不是让它常驻。                     |
| `SCRIPT`          | 必填*            | PHP 入口脚本。会覆盖配置文件里的 `pool.entrypoint`。             |

\* 除非配置文件里设了 `pool.entrypoint`，否则必填。两者都没有时，`serve` 会报错并且不会启动。

**`--listen`** 有三种写法。`127.0.0.1:8000`（默认值）只绑定一个网络接口——仅回环，机器外部无法访问。`:8080` 是 `0.0.0.0:8080` 的简写，绑定全部 IPv4 接口，容器里通常就这么绑；IPv6 则写成 `[::]:8080`。`unix:/run/rapira.sock` 改为绑定 Unix 套接字，适合反向代理跟它跑在同一台机器上的情况。IPv6 字面量要用方括号括起来：`[::1]:8000`。光一个端口号*不算*地址，会被拒绝，因为它没说清楚是只绑回环还是绑全部接口——`--listen 8080` 是错的，得写 `--listen :8080` 或 `--listen 127.0.0.1:8080`。主机部分必须是 IP 字面量，主机名一律不做解析，所以 `--listen localhost:8000` 同样是错的，请写 `--listen 127.0.0.1:8000`。

**`--processes`** 默认取逻辑 CPU 的数量。在默认的 static 进程池下，这就是实际 fork 出的 worker 进程数；如果配置文件把进程池换成 `dynamic` 或 `ondemand`，这个数字就变成它们伸缩的上限。master 和 worker 各自到底在干什么，见[进程模型](/zh/docs/process-model)。

**`--classic`** 决定应用运行在哪种模式下。不加它，入口脚本只加载一次并常驻内存，也就是 [SAPI Worker](/zh/docs/worker) 模式；加上它，脚本会像在 php-fpm 下那样每个请求重新 include 一遍，也就是[经典模式](/zh/docs/classic)。拿不准自己的应用能用哪一种，[执行模式](/zh/docs/execution-modes)那一页介绍了全部四种模式。

::: info
`--classic` 是个只能打开的开关。没有 `--no-classic`，所以配置文件里一旦写了 `classic = true`，就无法从命令行关掉——只能把这个键从文件里删掉。
:::

## 入口脚本的路径解析

入口脚本可以指定两次——命令行上的位置参数 `SCRIPT`，或者配置文件里的 `pool.entrypoint`——两个都写了，命令行赢，而文件里其余的设置照旧生效。不管走哪一条，Rapira 都会在 fork 出任何进程之前先把它变成绝对路径，因为守护进程的工作目录并不是你部署代码的那个目录。

两种相对路径的解析基准并不一样：

- 命令行上的相对 `SCRIPT` 相对**当前目录**解析。
- `pool.entrypoint` 里的相对路径则相对**配置文件自己所在的目录**解析——这样配置文件和挨着它的应用就能作为一个整体随便搬、随便拷、随便挂载，路径照样能解析正确。

```toml
[pool]
entrypoint = "public/index.php"
```

把这段放进 `/etc/rapira/rapira.toml`，入口脚本就是 `/etc/rapira/public/index.php`——你在哪个目录下执行的命令，完全不影响这个结果。

## 示例

常见的几种用法：

```bash
rapira serve app/worker.php
rapira serve --classic public/index.php
rapira serve --listen :8080 --processes 8 app/worker.php
rapira serve --listen unix:/run/rapira.sock app/worker.php
rapira serve --config /etc/rapira/rapira.toml
rapira serve --config /etc/rapira/rapira.toml --listen 127.0.0.1:9000
```

第一条没写 `--listen`，服务器就起在默认地址上，再来一行就能给它发一个请求。可以配合它运行的 worker 脚本见[快速开始](/zh/docs/intro/quickstart)。

```bash
curl http://127.0.0.1:8000/
```

## 停止服务器

第一个 `SIGINT` 或 `SIGTERM`——终端里的 `Ctrl-C`，或者你的 init 系统发来的那个——会把手上的请求跑完，并干净地关掉扩展；第二个就不等了，直接强制退出。信号都发给 master 进程；完整的信号对照表，连同重载在内，都在[进程模型](/zh/docs/process-model)里。
