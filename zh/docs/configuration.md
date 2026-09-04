---
title: 配置
description: "rapira.toml 完整参考：[http]、[pool]、[supervisor] 和 [log] 里的每一个键，以及各自的类型、默认值和会让错误取值被拒绝的规则。"
---

# 配置

Rapira 可以在没有配置文件的情况下启动。`rapira serve --mode worker app/worker.php` 使用默认设置。
创建 `rapira.toml` 以更改地址、worker 数量、替换策略、pidfile 或日志级别。使用此命令指定文件：

```bash
rapira serve --config /etc/rapira/rapira.toml
```

文件包含四个可选部分。`[http]` 配置监听器，`[pool]` 配置 worker。
`[supervisor]` 配置 master 进程。`[log]` 配置 stderr 输出。
PHP 入口脚本没有默认值。请设置 `pool.entrypoint`，或将脚本作为命令行参数传递。

::: info
命令行参数覆盖配置文件值。配置文件值覆盖内置默认值。
例如，`--processes 8` 会为一次运行覆盖 `processes = 4`。
只有两个日志环境变量会影响设置。有关可用参数，请参阅[命令行](/zh/docs/cli)。
:::

## 一份完整的 rapira.toml

以下文件包含所有支持的键。大多数缺少的键使用默认值。
`pool.entrypoint` 没有默认值。动态伸缩需要 `min_spare` 和 `max_spare`。
`[http.static]` 表需要 `http.static.root`。

部分键必须一起出现。`[http.static]` 表需要 `middleware` 中的 `"static"`，该条目也需要此表。
当伸缩方式不是 `dynamic` 时，请删除 `min_spare` 和 `max_spare`。Rapira 会拒绝 `static` 和 `ondemand` 中的这些键。

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # Optional. Sets SERVER_NAME for PHP.
server_port = 8000                    # Optional. Uses the TCP listen port by default.
max_body_size_mb = 8                  # Optional. Rapira returns 413 for larger request bodies.
write_timeout_secs = 30               # Optional. Closes a connection after a response write times out.
keepalive_timeout_secs = 60           # Optional. Limits idle periods and read operations.
unsafe_field_names = "drop"           # Optional. Use "drop" or "reject". Default: "drop".
middleware = ["static"]               # Optional. Rapira uses the list order.

[http.static]                         # Required when middleware contains "static".
root = "public"                       # Required. Relative paths use this file's directory.
forbid = [".php"]                     # Optional. Rapira does not serve these suffixes.

[http.sendfile]                       # Optional. Sets the sendFile() root in Dispatcher mode.
root = "public"                       # Optional. Uses the entry script directory by default.

[http.uploads]                        # Optional. Sets multipart limits in Dispatcher mode.
dir = "/var/spool/rapira"             # Optional. Uses the system temporary directory by default.
max_file_size_mb = 2                  # Optional. Limits one file part.
max_field_size_kb = 256               # Optional. Limits one field part.
max_files = 20                        # Optional. Limits file parts in one request.
max_parts = 1024                      # Optional. Limits all parts in one request.
max_part_headers = 32                 # Optional. Limits fields in one part.

[pool]
entrypoint = "index.php"              # Relative paths use this file's directory.
mode = "dispatcher"                   # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
processes = 4                         # Sets the worker count and the scaling maximum.
scaling = "dynamic"                   # Use "static", "dynamic", or "ondemand". Default: "static".
min_spare = 1                         # For dynamic scaling. Sets the minimum idle worker count.
max_spare = 3                         # For dynamic scaling. Sets the maximum idle worker count.
max_requests = 0                      # Replaces a worker after this request count. Zero disables the limit.
process_idle_timeout_secs = 10        # For ondemand scaling. Removes workers after this idle time.
request_terminate_timeout_secs = 0    # Replaces a worker when one request exceeds this time. Zero disables the limit.

[supervisor]                          # Optional. Sets master process behavior.
pidfile = "/run/rapira.pid"           # Optional. Relative paths use this file's directory.
process_control_timeout_secs = 30     # Waits after SIGQUIT before SIGTERM. SIGKILL follows one second later.

[log]                                 # Optional. Sets the level and record format.
level = "error"                       # Use error, warn, info, debug, or trace. Default: error.
format = "plain"                      # Use plain or json. Default: plain.

[log.targets]                         # Optional. Overrides the level for each target.
php = "debug"
http = "warn"
```

本页余下的部分按小节逐一说明这些键。

## `[http]` 小节

这一节讲的是：Rapira 在哪里监听、请求环境告诉 PHP 它跑在什么样的服务器下、能读进多大的请求体，以及请求在到达 PHP 之前先经过哪些中间件。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `listen` | 字符串 | `"127.0.0.1:8000"` | 绑定地址，三种写法之一：带 IP 字面量的 `host:port`（`127.0.0.1:8000`、`[::1]:8000`）、代表所有网卡的 `:port`，以及 Unix socket 的 `unix:/run/rapira.sock`。只写端口号或者写主机名都会被拒绝--地址必须说清楚指的是哪个网卡。 |
| `server_name` | 字符串 | `"localhost"` | PHP 从 `$_SERVER['SERVER_NAME']` 读到的值。 |
| `server_port` | 整数 | 监听端口，`unix:` 时为 `80` | PHP 从 `$_SERVER['SERVER_PORT']` 读到的值。如果 Rapira 前面的代理终结连接的端口和 Rapira 实际绑定的端口不是同一个，就设一下它。 |
| `max_body_size_mb` | 整数 | `8` | Rapira 愿意接收的最大请求体，单位 MiB（1024 × 1024 字节）。再大就回 `413`。至少为 1。 |
| `write_timeout_secs` | 整数 | `30` | 一次响应写入最多允许多久没有进展。客户端停止读取的时间超过它，Rapira 就关掉连接。至少为 1，最大 `86400`。 |
| `keepalive_timeout_secs` | 整数 | `60` | 一条连接在一个请求上最多允许多久没有进展。它同时管着三件事：闲着等下一个请求的 keep-alive 连接、一次请求头读取、一次请求体分片读取。请求体卡过这个上限就以 `408` 作答。至少为 1，最大 `86400`。 |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | 名字不符合 `[A-Za-z0-9-]` 的请求字段怎么处理：在 PHP 看到之前删掉，每删一个记一条 `warn` 日志；或者直接回 `400`。这么做的理由和背后的 CGI 映射规则，都在 [HTTP](/zh/docs/http) 那一页。 |
| `middleware` | 字符串列表 | 空 | 请求在交给 PHP 之前先由哪些中间件处理。列表顺序就是链的顺序。目前 Rapira 只认识 `"static"` 这一个名字。同一个名字列两次会被拒绝，列了名字却没有对应的表会被拒绝，配了表却没列进列表同样会被拒绝，所以这个列表就是每个中间件唯一的开关。 |

`server_name` 和 `server_port` 只影响 PHP 在 `$_SERVER` 里看到的内容，都不改变服务器绑定的地址--决定这件事的只有 `listen`。

### `[http.static]` 表

`static` 中间件在请求到达 PHP 之前，直接用磁盘上某个目录里的文件作答。它只处理 `GET` 和 `HEAD`，别的方法一律交给 PHP。找不到文件的路径落给 PHP，某一段以点开头的路径也落给 PHP。目录形式的 URL 同样落给 PHP：这个中间件不提供任何索引文件。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `root` | 字符串 | 无，必填 | 中间件对外提供的那个目录。相对路径按配置文件所在的目录解析。服务器启动时这个目录必须存在，服务器进程也必须有权限进入它，否则启动失败。 |
| `forbid` | 字符串列表 | `[".php"]` | 中间件永不提供的文件名后缀。每一项都以点开头，至少两个字符，不含 `/`，也不含空白字符。匹配时不分大小写。显式写出的列表会整个替换默认值，所以 `forbid = []` 会把根目录下的每个文件都提供出去，PHP 源码也不例外。 |

每个 worker 进程都会把提供过的文件留在内存里：总共最多 16MiB，单个文件超过 256KiB 就不留。一条缓存记录的新鲜期是一秒，所以文件改写之后，客户端最迟一秒后拿到新内容。

更多内容见[静态文件](/zh/docs/static-files)。

### `[http.sendfile]` 表

sendfile 根目录就是 `sendFile()` 能读取的那个目录。Rapira 会把根目录和请求的路径都规范化，并拒绝一切解析到根目录之外的路径。`sendFile()` 是 `Rapira\Http\Exchange` 的方法，而只有 Dispatcher 模式才会把 exchange 交给脚本，因此这张表也只在 Dispatcher 模式下起作用。Classic 和 Worker 模式接受这张表，但从不读它。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `root` | 字符串 | 入口脚本所在的目录 | `sendFile()` 唯一可以读取的目录。相对路径按配置文件所在的目录解析。 |

服务器启动时不存在的根目录没法规范化，此后 `sendFile()` 会拒绝所有路径。请在启动服务器之前先把目录建好。

### `[http.uploads]` 表

`[http.uploads]` 表管的是宿主侧解析 `multipart/form-data` 时的各项上限。Rapira 只在 Dispatcher 模式下于宿主里解析多部分请求体；Classic 和 Worker 模式在 PHP 里解析，上限归 `php.ini` 管，所以在这两种模式下写了这张表会挡下启动。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `dir` | 字符串 | 系统临时目录 | 文件部分的落盘根目录。相对路径按配置文件所在的目录解析。Rapira 会在启动时创建这个目录并检查它可写，再给每个 worker 分一个自己的 `rapira-spool-<pid>` 子目录，worker 退出时把它删掉。 |
| `max_file_size_mb` | 整数 | `2` | 单个文件部分的最大体积，单位 MiB。 |
| `max_field_size_kb` | 整数 | `256` | 单个字段部分的最大体积，单位 KiB。 |
| `max_files` | 整数 | `20` | 一个请求最多带多少个文件部分。 |
| `max_parts` | 整数 | `1024` | 一个请求最多带多少个部分，文件部分和字段部分合计。 |
| `max_part_headers` | 整数 | `32` | 单个部分最多带多少个头字段。 |

这里每一项上限都至少为 1。请求超出其中任何一项，都以 `413` 作答。

## `[pool]` 小节

真正跑 PHP 的进程就是 worker，这一节说的是它们跑什么、有多少个、以及 master 什么时候把某一个收走。master 拿这些数字做什么，见[进程模型](/zh/docs/process-model)。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `entrypoint` | 字符串 | 无--必填 | 每个 worker 要跑的 PHP 脚本。相对路径按配置文件所在的目录解析。命令行上的 `SCRIPT` 参数会覆盖它；两者至少得有一个，否则服务器拒绝启动。 |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | worker 怎么跑入口脚本。`classic` 每个请求都把脚本从头跑一遍；`worker` 让脚本常驻，并为每个请求重新填好超全局变量；`dispatcher` 让脚本常驻，并交给它一个 dispatcher 对象，由脚本自己从中取出每个请求。命令行上的 `--mode` 参数能双向覆盖这个键。见[执行模式](/zh/docs/execution-modes)。 |
| `processes` | 整数 | 每个逻辑 CPU 一个 | 要 fork 多少个 worker 进程。在 `dynamic` 和 `ondemand` 这两种伸缩方式下它是上限，不是实际数量。至少为 1。 |
| `scaling` | `"static"` \| `"dynamic"` \| `"ondemand"` | `"static"` | 进程池怎么决定自己的规模。`static` 始终保持 `processes` 个 worker 存活；`dynamic` 在两个空闲阈值之间伸缩，上限是 `processes`；`ondemand` 只在有活干的时候才 fork，空闲的 worker 会被淘汰。 |
| `min_spare` | 整数 | 无 | 仅用于 `dynamic` 伸缩，并且在那里是必填：至少保留这么多个空闲待命的 worker。 |
| `max_spare` | 整数 | 无 | 仅用于 `dynamic` 伸缩，并且在那里是必填：空闲 worker 最多留这么多，多的裁掉。两者必须满足 `1 <= min_spare <= max_spare <= processes`；在别的伸缩方式下写任何一个都是错误。 |
| `max_requests` | 整数 | `0` | 一个 worker 处理够这么多请求就回收掉，另外加一点抖动，免得整个进程池同时被回收。`0` 表示永不回收。 |
| `process_idle_timeout_secs` | 整数 | `10` | 使用 `ondemand` 伸缩时，master 会在 worker 空闲这么久后将其删除。 |
| `request_terminate_timeout_secs` | 整数 | `0` | 单个请求的墙钟时间预算。超时还没处理完的 worker 会被杀掉并换新。`0` 表示关掉这项检查。 |

`mode` 和 `scaling` 是两条互不相干的轴：`mode` 决定一个 worker 拿入口脚本怎么办，`scaling` 决定同时存在多少个 worker。

空闲数的上下界是按生效后的 `processes` 校验的，所以命令行上的 `--processes` 参数会把 `max_spare` 必须容身的上限一并压低。

## `[supervisor]` 小节

master 进程的策略--监听 socket 归它掌管，worker 由它照看，你发的信号也是发给它。init 系统打交道的对象同样是它，所以 unit 文件里通常设置的就是这几个键；见[部署](/zh/docs/deployment)。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `pidfile` | 字符串 | 无 | master 把自己的 pid 写到哪里。相对路径按配置文件所在的目录解析。信号要发的就是这个 pid--每个信号各做什么，[进程模型](/zh/docs/process-model)那一页有完整的对照表。 |
| `process_control_timeout_secs` | 整数 | `30` | master 在发送 `SIGQUIT` 后等待多久才发送 `SIGTERM`。master 在 `SIGTERM` 一秒后发送 `SIGKILL`。 |

## `[log]` 小节

Rapira 将所有日志记录写入 stderr。这一节决定日志的详细程度和每条记录的格式；具体目标、格式和 PHP 诊断级别见[日志](/zh/docs/logging)。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | 详细程度，一次性作用于所有 target。 |
| `format` | `"plain"` \| `"json"` | `"plain"` | 记录的形态：便于人读的文本行（stderr 是终端时带颜色），或者每行一个 JSON 对象，喂给日志收集器。 |
| `[log.targets]` | target → 级别 的表 | 空 | 在 `level` 之上按 target 单独覆盖。每个键都对应 Rapira 实际会用到的一个 target：`php` 是 PHP 自己的输出，`http` 是 HTTP 接入层。键按前缀匹配，所以 `php` 也覆盖 `php_sys::callbacks` 和它下面的一切。全部 target 列在[日志](/zh/docs/logging)那一页。 |

`[log.targets]` 键可以使用字母、数字、`_`、`:`、`.` 和 `-`。第一个字符必须是字母、数字或 `_`。
Rapira 会拒绝其他字符，因为过滤器可能将其解释为语法。
包含 `:` 或 `.` 的目标键必须加引号，因为 TOML 的裸键不允许这些字符。例如：

```toml
[log.targets]
"php_sys::callbacks" = "debug"
```

Rapira 只读取 `RUST_LOG` 和 `NO_COLOR` 环境变量。这两个变量仅影响日志。
`RUST_LOG` 在一次运行中替换完整过滤器。非空的 `NO_COLOR` 值会禁用 `plain` 格式的颜色。

## 不认识的键会被拒绝

Rapira 只接受文档中的表和键。例如，`[htttp]` 或 `lissten = ":8000"` 会导致初始化失败。
错误会标识未知名称。Rapira 不会忽略它。
每个键属于一个表。例如，`max_requests` 属于 `[pool]`，`pidfile` 属于 `[supervisor]`。

Rapira 还会验证值。它拒绝不支持的值，不会使用默认值替换。
例如，它拒绝 `level = "verbose"`、`format = "pretty"` 和 `unsafe_field_names = "allow"`。
数值有范围限制。worker 数量、正文大小、HTTP 超时和上传限制必须至少为 1。
每个 `*_secs` 键的最大值为 `86400`，即一天。

::: warning
校验发生在一切启动之前，所以不认识的键会挡下启动，而不是让这次运行悄悄降级。在正对外服务的机器上改 `rapira.toml`，正在跑的进程不受影响，但下一次启动必须成功。
:::

## 相对路径

五个键包含路径：`pool.entrypoint`、`supervisor.pidfile`、`http.static.root`、`http.sendfile.root` 和 `http.uploads.dir`。
每个相对路径都以配置文件目录为基准。
例如，`/etc/rapira/rapira.toml` 中的 `entrypoint = "app/worker.php"` 产生 `/etc/rapira/app/worker.php`。

位置参数 `SCRIPT` 使用当前目录作为相对路径的基准。

::: tip
将 `rapira.toml` 保存在应用内。相对于此文件指定路径。
此结构允许移动应用目录而不更改路径。
:::
