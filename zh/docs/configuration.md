---
title: 配置
description: "rapira.toml 的所有键、类型、默认值和验证规则。"
---

# 配置

Rapira 需要一个配置文件。`rapira serve` 命令以它的路径作为唯一参数。任何文件名都可以，本文档使用 `rapira.toml`：

```bash
rapira serve /etc/rapira/rapira.toml
```

文件设置监听器、worker 数量、回收策略、超时、pidfile 和日志级别。文件中的值覆盖内置默认值。

`[http]` 和 `[grpc]` 分别配置独立的监听器和 PHP worker 进程池。请至少配置其中一个部分。可选的 `[observability]` 部分配置一个用于指标和健康检查的监听器。`[server]` 配置服务器级设置。`[log]` 配置 stderr 输出。

每个启用的 HTTP 或 gRPC 进程池都需要 PHP 入口脚本。请设置 `http.pool.entrypoint`、`grpc.pool.entrypoint`，或同时设置两者。

## 一份完整的 rapira.toml

以下配置文件启用两种协议，并展示支持的表。大多数缺少的键使用默认值。每个进程池都需要 `entrypoint`。`[http.static]` 表需要 `http.static.root`。

部分键必须一起出现。`[http.static]` 表需要 `"static"` 中间件条目，该条目也需要此表。`[http.compress]` 表需要 `middleware` 中的 `"compress"`（而省略该表时 `"compress"` 会使用默认值）。`[grpc.auth]` 表和 `"auth"` 拦截器条目也相互需要。

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # Optional. Sets SERVER_NAME for PHP.
server_port = 8000                    # Optional. Uses the TCP listen port by default.
max_body_size_mb = 8                  # Optional. Rapira returns 413 for larger request bodies.
write_timeout_secs = 30               # Optional. Closes a connection after a response write times out.
keepalive_timeout_secs = 60           # Optional. Limits idle periods and read operations.
middleware = ["static", "compress"]   # Optional. Rapira uses the list order.

[http.static]                         # Required when middleware contains "static".
root = "public"                       # Required. Relative paths use this file's directory.
forbid = [".php"]                     # Optional. Rapira does not serve these suffixes.

[http.compress]                       # Optional when middleware contains "compress".
min_size = 1024                       # Optional. Minimum response size in bytes.
gzip_level = 4                        # Optional. Compression level 1..=9.
zstd_level = 3                        # Optional. Compression level 1..=19.

[http.sendfile]                       # Optional. Sets the sendFile() root in Dispatcher mode.
root = "public"                       # Optional. Uses the entry script directory by default.

[http.uploads]                        # Optional. Sets multipart limits in Dispatcher mode.
dir = "/var/spool/rapira"             # Optional. Uses the system temporary directory by default.
max_file_size_mb = 2                  # Optional. Limits one file part.
max_field_size_kb = 256               # Optional. Limits one field part.
max_files = 20                        # Optional. Limits file parts in one request.
max_parts = 1024                      # Optional. Limits all parts in one request.
max_part_headers = 32                 # Optional. Limits fields in one part.

[http.pool]                           # The worker pool behind the http listener.
entrypoint = "index.php"              # Relative paths use this file's directory.
mode = "dispatcher"                   # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
workers = 4                           # Sets the fixed worker thread count.
max_requests = 0                      # Recycles the app after this unit count. Zero disables the limit.
max_boot_failures = 5                 # Consecutive boot failures before exit 70. Zero allows unlimited retries.
request_terminate_timeout_secs = 0    # Watchdog wall-clock limit for one unit. Zero disables the limit.
execution_clock = "wall"              # Use "wall" or "cpu" for max_execution_time on Linux. Default: "wall".

[http.pool.env]                       # Optional. Pool environment variables for PHP.
APP_ENV = "prod"

[grpc]
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"          # Required. A path or an http(s) URL of a FileDescriptorSet with its imports.
services = ["example.v1.Echo"]        # Optional. Default: the services of the files that no other file imports.
reflection = false
default_timeout_secs = 30             # Optional. Deadline of a call without a client timeout.
max_timeout_secs = 60                 # Optional. Upper limit for a client timeout.
keepalive_interval_secs = 10          # Optional. Idle time before an HTTP/2 PING.
keepalive_timeout_secs = 10           # Optional. Closes a connection that does not answer the PING.
interceptors = ["auth"]               # Optional. Rapira uses the list order.

[grpc.auth]                           # Required when interceptors contains "auth".
tokens_file = "grpc-tokens"           # Required. One bearer token on each line.

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"                   # Required mode for gRPC.
workers = 4
max_requests = 0
max_boot_failures = 5
request_terminate_timeout_secs = 0
execution_clock = "wall"

[observability]                       # Optional. Starts a listener thread without PHP for metrics and probes.
listen = "127.0.0.1:9180"             # Required.
keepalive_timeout_secs = 60           # Optional.

[observability.metrics]               # Enables GET /metrics. Set this table, the probes table, or both.

[observability.probes]                # Enables GET /livez and GET /readyz.

[server]                              # Optional. Sets server-wide behavior.
pidfile = "/run/rapira.pid"           # Optional. Relative paths use this file's directory.
stop_timeout_secs = 30                # Stop deadline for connection drain and PHP shutdown.

[log]                                 # Optional. Sets the level and record format.
level = "error"                       # Use error, warn, info, debug, or trace. Default: error.
format = "plain"                      # Use plain or json. Default: plain.

[log.targets]                         # Optional. Overrides the level for each target.
php = "debug"
http = "warn"
```

## `[http]` 小节

此部分定义监听器和报告给 PHP 的服务器信息。它还定义请求体上限和在 PHP 之前运行的中间件。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `listen` | 字符串 | `"127.0.0.1:8000"` | 绑定地址。带 IP 地址时使用 `host:port`，所有 IPv4 网络接口使用 `:port`，Unix socket 使用 `unix:/run/rapira.sock`。所有 IPv6 网络接口使用 `[::]:8080`。IPv6 字面量放在方括号里，例如 `[::1]:8000`。Rapira 拒绝主机名，也拒绝不带冒号的端口，例如 `8000`。 |
| `server_name` | 字符串 | `"localhost"` | PHP 从 `$_SERVER['SERVER_NAME']` 读到的值。 |
| `server_port` | 整数 | 监听端口，`unix:` 时为 `80` | `$_SERVER['SERVER_PORT']` 的值。代理端口与 Rapira 端口不同时，请设置它。 |
| `max_body_size_mb` | 整数 | `8` | 最大请求体，单位 MiB。请求体更大时，Rapira 返回 `413`。最小值为 1。 |
| `write_timeout_secs` | 整数 | `30` | 响应写入期间没有进展的最长时间。超过后，Rapira 关闭连接。范围是 1 到 `86400`。 |
| `keepalive_timeout_secs` | 整数 | `60` | 接收请求头的时间上限。它包含在空闲连接上的等待时间。它也是两个请求体分片之间的最长时间。超过上限后，Rapira 关闭连接。停滞的请求体先收到 `408`。范围是 1 到 `86400`。 |
| `middleware` | 字符串列表 | 空 | 在 PHP 之前运行的中间件，按列表顺序运行。内置名称有 `"static"` 和 `"compress"`。Rapira 拒绝重复的名称、未知的名称和未使用的中间件表。 |

### `[http.static]` 表

`static` 中间件可以在 PHP 收到请求之前返回文件。它处理 `GET` 和 `HEAD`。其他方法和不对应文件的路径由 PHP 接收。隐藏路径和目录路径也由 PHP 接收。此中间件不提供索引文件。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `root` | 字符串 | 无，必填 | 提供文件的目录。相对路径以配置文件目录为基准。初始化时此目录必须存在并且可以访问。 |
| `forbid` | 字符串列表 | `[".php"]` | 中间件不提供的文件名后缀。每一项都以点开头，至少两个字符。它不能包含 `/` 或空白字符。匹配不区分大小写。显式的列表替换默认值。 |

文件缓存和其他细节请参阅[静态文件](/zh/docs/static-files)。

### `[http.compress]` 表

`compress` 中间件根据 `Accept-Encoding` 使用 gzip 或 zstd 压缩 HTTP 响应。将 `"compress"` 添加到 `http.middleware` 即可使用默认值启用它；该表是可选的。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `min_size` | 整数 | `1024` | 应用压缩前的最小响应大小，单位字节。 |
| `gzip_level` | 整数 | `4` | Gzip 压缩级别，从 `1` 到 `9`。 |
| `zstd_level` | 整数 | `3` | Zstd 压缩级别，从 `1` 到 `19`。 |

### `[http.sendfile]` 表

sendfile 根目录是 `sendFile()` 可以读取的目录。Rapira 把根目录和请求的路径解析为规范路径。它拒绝根目录之外的路径。Rapira 在每个应用实例第一次调用 `sendFile()` 时为该实例解析根目录。因此，根目录会在下一次应用启动时（例如重载）跟随符号链接的切换。

`sendFile()` 是 `Rapira\Http\Exchange` 的方法。只有 Dispatcher 模式把 exchange 交给脚本。因此，此表只影响 Dispatcher 模式。Classic 和 Worker 模式接受此表，但不使用它。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `root` | 字符串 | `http.pool.entrypoint` 所在的目录 | `sendFile()` 唯一可以读取的目录。相对路径按配置文件所在的目录解析。 |

如果应用实例第一次调用 `sendFile()` 时根目录不存在，Rapira 记录一条警告。随后，`sendFile()` 在该应用实例中拒绝所有路径。稍后创建的根目录在下一次应用启动后生效，例如重载后。请在启动服务器之前创建此目录。

### `[http.uploads]` 表

`[http.uploads]` 表设置宿主侧解析 `multipart/form-data` 的上限。只有 Dispatcher 模式在宿主中解析多部分请求体。Classic 和 Worker 模式在 PHP 中解析它们，并使用 `php.ini` 的上限。在这两种模式下，Rapira 拒绝此表。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `dir` | 字符串 | 系统临时目录 | 文件部分的存储目录。相对路径以配置文件目录为基准。Rapira 创建并检查此目录。服务器进程创建一个 `rapira-spool-<pid>` 子目录，并在关闭时删除它。Rapira 将文件部分放入其中带编号的子目录中。 |
| `max_file_size_mb` | 整数 | `2` | 单个文件部分的最大大小，单位 MiB。 |
| `max_field_size_kb` | 整数 | `256` | 单个字段部分的最大大小，单位 KiB。 |
| `max_files` | 整数 | `20` | 一个请求允许的文件部分数量。 |
| `max_parts` | 整数 | `1024` | 一个请求允许的文件部分和字段部分总数。 |
| `max_part_headers` | 整数 | `32` | 一个部分允许的头字段数量。 |

每项上限都必须至少为 1。请求超出某项上限时，Rapira 返回 `413`。

### `[http.pool]` 表 {#http-pool}

worker 线程运行 PHP。此表定义它们运行什么、运行多少个线程，以及 Rapira 如何回收或中断它们。[进程模型](/zh/docs/process-model)说明服务器如何使用这些值。

`http` 插件管理此 PHP worker 进程池。gRPC 监听器使用独立的 `[grpc.pool]` 表。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `entrypoint` | 字符串 | 无，必填 | 每个 worker 运行的 PHP 脚本。相对路径以配置文件目录为基准。路径必须指向可读的普通文件。 |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | worker 运行入口脚本的方式。`classic` 每次启动一个新的 PHP 请求。`worker` 保留脚本并重新填充超全局变量。`dispatcher` 保留脚本并给它一个 dispatcher 对象。请参阅[执行模式](/zh/docs/execution-modes)。 |
| `workers` | 整数 | 可用并行度，无法确定时为 `1` | worker 线程数量。最小值为 `1`。在 NTS PHP 构建上，Rapira 会将该数量限制为 `1` 并发出警告。 |
| `max_requests` | 整数 | `0` | Worker 和 Dispatcher 模式下一个应用实例的工作单元数限制。达到限制后，worker 在同一线程上回收其应用。Rapira 会稍微改变此限制，避免多个应用同时回收。Classic 模式忽略此键。`0` 禁用此限制。 |
| `max_boot_failures` | 整数 | `5` | Worker 或 Dispatcher 模式下连续启动失败的次数限制，达到后（如果进程池尚未处理任何工作单元）Rapira 以退出码 `70` 退出。一次成功的启动会重置计数。Classic 模式忽略此键。`0` 允许无限次重试。请参阅[进程模型](/zh/docs/process-model#pool-management)。 |
| `request_terminate_timeout_secs` | 整数 | `0` | 单个工作单元的墙钟时间看门狗上限，从 `0` 到 `86400`。达到限制时，看门狗中断 PHP 并唤醒阻塞的响应写入。再过五秒后，Rapira 记录一次仍阻塞的 worker；如果进程池中的所有 worker 仍处于阻塞状态，则以 `124` 退出。`0` 禁用此检查。 |
| `execution_clock` | `"wall"` \| `"cpu"` | `"wall"` | 在带有每线程计时器的 Linux 构建上用于 PHP `max_execution_time` 的时钟。`"wall"` 计算工作单元的经过时间；`"cpu"` 仅计算 worker 线程的 CPU 时间，从而让 `sleep()` 和数据库等待不消耗该时间预算。 |
| `[http.pool.env]` | 字符串到字符串的表 | 空 | 用于 PHP 的进程池环境变量。请参阅[`[http.pool.env]` 表](#http-pool-env)。 |

### `[http.pool.env]` 表 {#http-pool-env}

每个键是一个环境变量名，每个值必须是字符串。非字符串值会阻止启动。Rapira 不会在值内展开 `$VAR` 或 `${VAR}`。

```toml
[http.pool.env]
APP_ENV = "prod"
APP_DEBUG = "0"
```

Rapira 在启动时、worker 启动之前验证此表。空名称、包含 `=` 或 NUL 的名称，或包含 NUL 的值都会阻止启动，且错误信息会指明该键。

进程池变量仅适用于各自的进程池：`[http.pool.env]` 对 gRPC worker 不可见，`[grpc.pool.env]` 对 HTTP worker 不可见。同名的进程池变量会覆盖启动环境变量，而其他启动变量对 `getenv()` 以及启动时的 `$_SERVER` 和 `$_ENV`（当 `variables_order` 包含 `E` 时）仍然可见。

在 Classic 和 Worker 模式下，每个请求的 `$_SERVER` 包含 `[http.pool.env]` 变量，而不包含其他进程环境变量。同名的请求变量优先：例如，当 `SERVER_SOFTWARE = "x"` 时，请求收到 `$_SERVER['SERVER_SOFTWARE'] === 'Rapira'`，而 `getenv('SERVER_SOFTWARE')` 返回 `'x'`。在 Dispatcher 模式下，`$_SERVER` 保留其启动值（包括 `[http.pool.env]`）。

`getenv()` 先读取线程本地的 `putenv()` 写入，然后读取 `[http.pool.env]`，最后读取服务器启动时的进程环境。`putenv()` 写入在 Classic 模式下持续一个请求，在 Worker 和 Dispatcher 模式下持续一个应用实例，且不会修改操作系统进程环境。`parse_ini_file()` 和 `parse_ini_string()` 中的 `${NAME}` 读取同一个分层表。在没有显式环境参数的情况下启动的原生库和子进程只继承操作系统启动环境；请将 `getenv()` 作为环境参数传给 `proc_open()`，以转发进程池和 `putenv()` 的值。

Rapira 在主线程上解析 `php.ini` 并运行一次 PHP 模块启动（`MINIT`），此操作发生在 worker 线程进入各自进程池之前。因此，`php.ini` 中的 `${VAR}`、在 `MINIT` 期间读取环境变量的扩展，以及 `LD_PRELOAD` 或 `MIMALLOC_*` 等进程启动变量都看不到 `[http.pool.env]`。

## `[grpc]` 小节 {#grpc}

此部分在一个监听器上启用 gRPC、gRPC-Web 和 Connect 调用。完整的 PHP 服务和客户端命令请参阅 [gRPC](/zh/docs/grpc)。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `listen` | 字符串 | `"127.0.0.1:50051"` | TCP 地址或 `unix:` 套接字路径。使用与 `http.listen` 相同的地址语法。 |
| `descriptor_set` | 字符串 | 无，必填 | 二进制 `google.protobuf.FileDescriptorSet` 的路径或 URL，其中包含所有导入的文件。以 `http://` 或 `https://` 开头的值是 Rapira 在启动时下载的 URL；请参阅[从 URL 加载描述符集](/zh/docs/grpc#descriptor-set-url)。使用 `buf build --as-file-descriptor-set` 或 `protoc --include_imports` 构建它。 |
| `services` | 字符串列表 | 未设置 | 所提供服务的完全限定名称。未设置时，进程池提供集合中未被其他文件导入的文件里的服务。列表不能为空。 |
| `reflection` | 布尔值 | `false` | 启用 `grpc.reflection.v1` 和 `v1alpha` 服务。 |
| `default_timeout_secs` | 整数 | 未设置 | 没有客户端超时的调用的截止时间。未设置时，此类调用没有截止时间。 |
| `max_timeout_secs` | 整数 | 未设置 | 客户端超时的上限。未设置时，没有上限。 |
| `keepalive_interval_secs` | 整数 | `10` | Rapira 发送 HTTP/2 keepalive PING 之前的空闲时间。它不适用于 HTTP/1.1 客户端。范围是 1 到 `86400`。 |
| `keepalive_timeout_secs` | 整数 | `10` | Rapira 等待 PING 应答的时间。如果在此时间内没有应答，Rapira 关闭连接。范围是 1 到 `86400`。 |
| `interceptors` | 字符串列表 | 空 | 在 PHP 之前运行的拦截器，按列表顺序运行。只有 `"auth"` 可用。Rapira 拒绝重复的名称、未知的名称和没有配置表的名称。它也拒绝列表中没有列出的 `[grpc.auth]` 表。 |

Rapira 在启动时、worker 启动前加载描述符集。以下错误会阻止初始化：Rapira 无法读取、下载或解码的描述符集、不含其导入文件的描述符集，以及没有可提供服务的描述符集。不在描述符集中的 `services` 条目、重复的条目，以及指向健康检查服务或反射服务的条目也会阻止初始化。`default_timeout_secs` 不能大于 `max_timeout_secs`。

### `[grpc.auth]` 表 {#grpc-auth}

`auth` 拦截器只接受带有效 bearer 令牌的调用。PHP 不会收到被拒绝的调用。客户端和健康检查服务请参阅 [gRPC 身份验证](/zh/docs/grpc#authentication)。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `tokens_file` | 字符串 | 无，必填 | 包含被接受的令牌的文件。相对路径以配置文件目录为基准。每行写一个令牌。Rapira 先删除每行开头和末尾的空白字符，再跳过空行和以 `#` 开头的行。每个令牌都必须是 [RFC 6750 bearer 令牌](https://www.rfc-editor.org/rfc/rfc6750#section-2.1)。文件必须至少包含一个令牌。 |

### `[grpc.pool]` 表 {#grpc-pool}

此表使用 [HTTP 进程池的键和默认值](#http-pool)，且必须提供 `entrypoint` 并设置 `mode = "dispatcher"`。Classic 和 Worker 模式会被拒绝。worker 数量、回收、执行计时器和看门狗独立作用于此进程池。`[grpc.pool.env]` 表为 gRPC worker 设置环境变量，规则与[`[http.pool.env]` 表](#http-pool-env)相同。

HTTP 和 gRPC 可以在 ZTS PHP 上同时运行。每个监听器使用自己的进程池和入口脚本。Rapira 在启动时读取一次描述符集和令牌文件。请重启 Rapira 以加载更改后的文件或 URL 处更改后的描述符集。重载会保留旧的数据。

## `[observability]` 小节 {#observability}

此部分在服务器进程内的独立线程（`rapira-obs`）上启动监听器，通过 HTTP 提供指标和健康探针。此线程不运行 PHP 代码。此部分不是插件表，所以文件仍然需要 `[http]` 或 `[grpc]`。端点和指标请参阅[指标和健康检查](/zh/docs/observability)。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `listen` | 字符串 | 无，必填 | 绑定地址。它使用与 `http.listen` 相同的语法。请使用 `http` 和 `grpc` 监听器不使用的地址。 |
| `keepalive_timeout_secs` | 整数 | `60` | 接收请求头的时间上限。它包含在空闲连接上的等待时间。范围是 1 到 `86400`。 |
| `[observability.metrics]` | 空表 | 不存在 | 以 Prometheus 文本格式启用 `GET /metrics`。 |
| `[observability.probes]` | 空表 | 不存在 | 启用 `GET /livez` 和 `GET /readyz`。 |

请至少设置两个子表中的一个。子表不接受任何键。

## `[server]` 小节

此部分定义 Rapira 进程的服务器级设置。systemd unit 文件请参阅[部署](/zh/docs/deployment)。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `pidfile` | 字符串 | 无 | 写入服务器进程标识符的文件。相对路径以配置文件目录为基准。请向此标识符发送进程信号。请参阅[进程模型](/zh/docs/process-model)。 |
| `stop_timeout_secs` | 整数 | `30` | 整体关闭截止时间，单位秒，范围从 `1` 到 `86400`。 |

打开的连接在 `stop_timeout_secs` 减去 5 秒的时间内排空；如果停止超时低于 10 秒，则排空时间为停止超时的一半。默认排空预算为 25 秒，为 PHP 关闭留出 5 秒。

## `[log]` 小节

此部分控制 stderr 日志级别和格式。目标、格式和 PHP 诊断级别请参阅[日志](/zh/docs/logging)。

| 键 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | 详细程度，一次性作用于所有目标。 |
| `format` | `"plain"` \| `"json"` | `"plain"` | 记录格式。plain 输出包含可读的文本行，并且可以使用颜色。JSON 输出每行包含一个对象。 |
| `[log.targets]` | 目标到级别的表 | 空 | 按目标覆盖日志级别。键按目标前缀匹配。目标列表请参阅[日志](/zh/docs/logging#按目标覆盖)。 |

`[log.targets]` 键可以使用字母、数字、`_`、`:`、`.` 和 `-`。第一个字符必须是字母、数字或 `_`。Rapira 会拒绝其他字符，因为日志过滤器可能将其解释为语法。包含 `:` 或 `.` 的目标键必须加引号，因为 TOML 的裸键不允许这些字符。例如：

```toml
[log.targets]
"h2::proto" = "debug"
```

`RUST_LOG` 和 `NO_COLOR` 仅影响 stderr 输出。`RUST_LOG` 在一次运行中替换完整的 stderr 过滤器。非空的 `NO_COLOR` 值会禁用 plain 输出的颜色。

## 不认识的键会被拒绝

Rapira 只接受文档中的表和键。例如，`[htttp]` 或 `lissten = ":8000"` 会导致初始化失败。错误会标识未知名称。每个键属于一个表。例如，`max_requests` 属于 `[http.pool]`，`pidfile` 属于 `[server]`。进程池 `env` 表（`[http.pool.env]` 或 `[grpc.pool.env]`）是例外：它接受每个环境变量名作为键，并拒绝空名称、包含 `=` 或 NUL 的名称，以及包含 NUL 的值。

Rapira 还会验证值。它拒绝不支持的值，不会使用默认值替换。例如，它拒绝 `level = "verbose"` 和 `format = "pretty"`。worker 数量、请求体大小和上传上限必须至少为 1。每个 `*_secs` 键的范围是 1 到 `86400`。只有 `request_terminate_timeout_secs` 还接受 `0`。

::: warning
Rapira 只在启动时读取配置文件。使用 `SIGHUP` 或 `SIGUSR2` 重载时不会再次读取它。请重启 Rapira 以应用更改后的文件。
:::

## 相对路径 {#relative-paths}

文件系统路径包括两个进程池的入口脚本、`grpc.descriptor_set`、`grpc.auth.tokens_file`、`server.pidfile`、`http.static.root`、`http.sendfile.root`、`http.uploads.dir` 以及相对的 `unix:` 监听路径。每个相对路径都以配置文件目录为基准。例如，在 `/etc/rapira/rapira.toml` 中设置 `entrypoint = "app/worker.php"`。Rapira 随后使用 `/etc/rapira/app/worker.php`。以 `http://` 或 `https://` 开头的 `grpc.descriptor_set` 值是 URL，而不是路径。

::: tip
将 `rapira.toml` 配置文件保存在应用内。相对于配置文件写出其中的路径。你可以移动应用目录。这些路径不需要改变。
:::
