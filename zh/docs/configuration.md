---
title: 配置
description: "rapira.toml 完整参考：[http]、[pool]、[supervisor] 和 [log] 里的每一个键，以及各自的类型、默认值和会让错误取值被拒绝的规则。"
---

# 配置

Rapira 不需要配置文件也能启动——`rapira serve app/worker.php` 会替每一项设置挑好默认值。等默认值不够用了，才轮到 `rapira.toml` 出场：换一个监听地址、把 worker 数量固定下来、定一套回收策略、写一个 init 系统读得到的 pidfile、把日志级别调到真能说明问题的档位。把服务器指向这个文件，它就接管一切：

```bash
rapira serve --config /etc/rapira/rapira.toml
```

文件由四个小节组成，每一节都可以不写：`[http]` 管监听器，`[pool]` 管 worker 进程，`[supervisor]` 管 master 进程，`[log]` 管往 stderr 写什么。唯一一个 Rapira 没法替你猜出来的值是 PHP 入口脚本——要么在这里设 `pool.entrypoint`，要么在命令行上把脚本作为位置参数传进去。

::: info
设置是分层的：命令行参数压过配置文件，配置文件压过内置默认值。所以 `--processes 8` 会盖掉文件里的 `processes = 4`——纳入版本控制的配置，照样能为某一次运行临时改口。参数本身见[命令行](/zh/docs/cli)那一页。
:::

## 一份完整的 rapira.toml

Rapira 认识的每一个键，都在这一个文件里。下面没有一行是必填的——删掉哪一行，哪一行的默认值就接手；只有两个例外：`pool.entrypoint` 没有默认值可退，而只要 `mode = "dynamic"` 还写在那里，`min_spare` 和 `max_spare` 就必须给。

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # optional; SERVER_NAME reported to PHP
server_port = 8000                    # optional; defaults to the listen TCP port (80 for unix:)
max_body_size_mb = 8                  # optional; larger request bodies get a 413
unsafe_field_names = "drop"           # optional; drop (default) | reject

[pool]
entrypoint = "index.php"              # relative → resolved against this file's directory
processes = 4                         # worker processes to fork (max_children for mode = dynamic/ondemand)
classic = false                       # optional; default false
mode = "dynamic"                      # static (default) | dynamic | ondemand
min_spare = 1                         # dynamic only: keep at least this many idle workers
max_spare = 3                         # dynamic only: trim to at most this many idle workers (rejected under other modes)
max_requests = 0                      # recycle a worker after N requests (+jitter); 0 = unlimited
process_idle_timeout_secs = 10        # ondemand: retire an idle worker after this long
request_terminate_timeout_secs = 0    # kill a worker whose single request runs longer (wall clock); 0 = off

[supervisor]                          # optional; master-process policy
pidfile = "/run/rapira.pid"           # optional; relative paths resolve against this file's dir
process_control_timeout_secs = 30     # graceful-stop budget before QUIT → TERM → KILL

[log]                                 # optional; verbosity and record shape
level = "error"                       # error (default) | warn | info | debug | trace
format = "plain"                      # plain (default) | json

[log.targets]                         # optional; per-target overrides on top of level
php = "debug"
pingora_core = "warn"
```

本页余下的部分，就是把这个文件一个键一个键地讲一遍。

## `[http]` 小节

这是大门口：Rapira 在哪里监听、请求环境告诉 PHP 它跑在什么样的服务器下、以及愿意读进多大的请求体。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `listen` | 字符串 | `"127.0.0.1:8000"` | 绑定地址，三种写法之一：带 IP 字面量的 `host:port`（`127.0.0.1:8000`、`[::1]:8000`）、代表所有网卡的 `:port`，以及 Unix socket 的 `unix:/run/rapira.sock`。只写端口号或者写主机名都会被拒绝——地址必须说清楚指的是哪个网卡。 |
| `server_name` | 字符串 | `"localhost"` | PHP 从 `$_SERVER['SERVER_NAME']` 读到的值。 |
| `server_port` | 整数 | 监听端口，`unix:` 时为 `80` | PHP 从 `$_SERVER['SERVER_PORT']` 读到的值。如果 Rapira 前面的代理终结连接的端口和 Rapira 实际绑定的端口不是同一个，就设一下它。 |
| `max_body_size_mb` | 整数 | `8` | Rapira 愿意接收的最大请求体，单位 MiB（1024 × 1024 字节）。再大就回 `413`。至少为 1。 |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | 名字不符合 `[A-Za-z0-9-]` 的请求字段怎么处理：在 PHP 看到之前删掉，每删一个记一条 `warn` 日志；或者直接回 `400`。这么做的理由和背后的 CGI 映射规则，都在 [HTTP](/zh/docs/http) 那一页。 |

`server_name` 和 `server_port` 只影响 PHP 在 `$_SERVER` 里看到的内容，都不改变服务器实际绑定的地址。决定这件事的只有 `listen`。

## `[pool]` 小节

真正跑 PHP 的进程就是 worker，这一节说的是它们跑什么、有多少个、以及 master 什么时候把某一个收走。master 拿这些数字具体做了什么，见[进程模型](/zh/docs/process-model)；在这里它们只是一些配置键。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `entrypoint` | 字符串 | 无——必填 | 每个 worker 要跑的 PHP 脚本。相对路径按配置文件所在的目录解析。命令行上的 `SCRIPT` 参数会覆盖它；两者至少得有一个，否则服务器拒绝启动。 |
| `processes` | 整数 | 每个逻辑 CPU 一个 | 要 fork 多少个 worker 进程。在 `dynamic` 和 `ondemand` 下它是上限，不是实际数量。至少为 1。 |
| `classic` | 布尔值 | `false` | `false` 让 worker 在请求之间常驻（也就是 SAPI Worker 那一级）；`true` 则每个请求都把入口脚本从头跑一遍，跟 php-fpm 一样。见[执行模式](/zh/docs/execution-modes)。`--classic` 只能把它打开——这里写成 `true` 之后，命令行没法再把它关掉。 |
| `mode` | `"static"` \| `"dynamic"` \| `"ondemand"` | `"static"` | 进程池怎么决定自己的规模。`static` 始终保持 `processes` 个 worker 存活；`dynamic` 在两个空闲阈值之间伸缩，上限是 `processes`；`ondemand` 只在有活干的时候才 fork，空闲的 worker 会被淘汰。 |
| `min_spare` | 整数 | 无 | 仅用于 `dynamic`，并且在那里是必填：至少保留这么多个空闲待命的 worker。 |
| `max_spare` | 整数 | 无 | 仅用于 `dynamic`，并且在那里是必填：空闲 worker 最多留这么多，多的裁掉。两者必须满足 `1 <= min_spare <= max_spare <= processes`；在别的模式下写任何一个都是错误，而不是被当成建议。 |
| `max_requests` | 整数 | `0` | 一个 worker 处理够这么多请求就回收掉，另外加一点抖动，免得整个进程池同时换血。`0` 表示永不回收。 |
| `process_idle_timeout_secs` | 整数 | `10` | 只有 `ondemand` 会读它：一个 worker 最多能空闲多久，超过就被 master 收走。 |
| `request_terminate_timeout_secs` | 整数 | `0` | 单个请求的墙钟时间预算。超时还没处理完的 worker 会被杀掉并换新。`0` 表示关掉这项检查。 |

## `[supervisor]` 小节

master 进程的策略——监听 socket 归它掌管，worker 由它照看，你发的信号也是发给它。init 系统打交道的对象同样是它，所以写 unit 文件时通常就是在填这一节；见[部署](/zh/docs/deployment)。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `pidfile` | 字符串 | 无 | master 把自己的 pid 写到哪里。相对路径按配置文件所在的目录解析。信号要发的就是这个 pid——每个信号各做什么，[进程模型](/zh/docs/process-model)那一页有完整的对照表。 |
| `process_control_timeout_secs` | 整数 | `30` | master 给 worker 多少时间优雅收尾，超时就按 QUIT → TERM → KILL 逐级升级。 |

## `[log]` 小节

Rapira 把所有日志都写到 stderr，一条记录一次写入，所以 master 和 worker 的输出绝不会在一行中间串到一起。这一节决定这股流有多吵、每条记录长什么样；具体有哪些 target、有哪些格式，以及 PHP 的诊断信息怎么对应到级别，都在[日志](/zh/docs/logging)那一页。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | 详细程度，一次性作用于所有 target。 |
| `format` | `"plain"` \| `"json"` | `"plain"` | 记录的形态：便于人读的文本行（stderr 是终端时带颜色），或者每行一个 JSON 对象，喂给日志收集器。 |
| `[log.targets]` | target → 级别 的表 | 空 | 在 `level` 之上按 target 单独覆盖——比如让 `php = "debug"`，其余照旧安静。键按前缀匹配，所以 `php` 也覆盖 `php_sys::callbacks` 和它下面的一切。 |

`[log.targets]` 的键必须长得像一个模块路径：由字母、数字以及 `_` `:` `.` `-` 组成，开头是字母、数字或 `_`。这些键会被拼成一个过滤器字符串，所以超出这个形状的写法会被当成过滤器语法而不是 target 名，一开始就会被拒绝。

## 不认识的键会被拒绝

Rapira 解析 `rapira.toml` 时非常严格。每一个表、以及表里的每一个键，都必须是服务器认识的，所以 `[htttp]` 或者 `lissten = ":8000"` 会让启动失败，并明确报出它不认识的是什么，而不是默默跳过这一行。每个键也都只有一个归属：`max_requests` 只属于 `[pool]`，`pidfile` 只属于 `[supervisor]`，放错表和拼错字母一样通不过。

值也一样要过检查。`level = "verbose"`、`format = "pretty"`、`unsafe_field_names = "allow"` 全是硬错误，而不是悄悄退回默认值——一道带着拼写错误照样上线的安全过滤，比一道当着你的面拒绝启动的糟得多。数字也有范围：`pool.processes` 和 `http.max_body_size_mb` 至少为 1，所有 `*_secs` 键的上限是 `86400`，也就是一天。

::: warning
校验发生在一切启动之前，所以不认识的键会挡下启动，而不是让这次运行悄悄降级。在正对外服务的机器上改 `rapira.toml` 时，这一点值得记住：正在跑的进程不受影响，但下一次启动必须成功。
:::

## 相对路径

有两个键存的是文件系统路径：`pool.entrypoint` 和 `supervisor.pidfile`。它们都按配置文件所在的目录解析，而不是按启动服务器那个人的工作目录。配置文件是 `/etc/rapira/rapira.toml`、`entrypoint = "app/worker.php"` 时，脚本就是 `/etc/rapira/app/worker.php`，跟在哪个目录下执行 `rapira serve` 无关。

位置参数 `SCRIPT` 正好反过来。它是命令行上的值，相对路径按当前目录解析——你给任何别的程序敲一个文件名时都是这样。

::: tip
把 `rapira.toml` 放进应用里，里面的路径都写成相对它的。这样整个目录搬走时配置跟着一起走，也没有任何东西依赖服务恰好从哪个目录启动。
:::

::: question 真的需要配置文件吗？
不需要。`rapira serve` 加一个脚本、再加一两个参数，常见场景就够用了；上面写到的每个默认值，都会对你没设的那些项生效。等到要记的设置多到记不住，或者你希望它们能跟应用一起进评审、进版本控制，配置文件才开始变得划算。
:::

::: question 能用环境变量配置 Rapira 吗？
不能——设置只来自配置文件和命令行参数，没有第三个来源。例外是两个只管日志的变量：`RUST_LOG` 是调试用的覆盖开关，它整体替换掉日志过滤器，想让某次会话话多一点，不必改配置；`NO_COLOR` 则去掉 `plain` 格式里的颜色——只要值非空就关掉，哪怕输出的是终端。两者在[日志](/zh/docs/logging)那一页都有说明。
:::

::: question 为什么写了 `mode = "dynamic"` 服务器就起不来？
多半是空闲数没配对。`dynamic` 要求 `min_spare` 和 `max_spare` 都写上，并且满足 `1 <= min_spare <= max_spare <= processes`——注意 `--processes` 参数会把校验用的上限一起压低。而在 `static` 或 `ondemand` 下，这两个键会被直接拒绝，这种情况通常说明 `mode` 那一行写的不是你本来想要的模式。
:::
