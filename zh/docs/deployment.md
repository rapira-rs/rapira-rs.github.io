---
title: 生产环境部署
description: "生产环境的 systemd unit、配置结构、反向代理、重载过程、JSON 日志、健康检查、指标和 worker 替换。"
---

# 生产环境部署

生产部署必须在重启和代码更改后保持 Rapira 可用。它们在系统初始化期间启动 Rapira，并在故障后重启它。它们还在不丢失请求的情况下重新加载代码，并保存日志。本页介绍 systemd unit、反向代理、健康检查、指标和持久 worker 设置。

Rapira 不定义部署结构。它不要求特定配置路径或进程监管器。本页为其他文档定义一个约定。请先按照[安装](/zh/docs/intro/installation)安装二进制文件。

Rapira 也提供 `ghcr.io/rapira-rs/rapira` 容器镜像。镜像包含 PHP，你只需将应用添加到镜像中。请使用 `--init` 启动容器，以便 init 进程回收已退出的子进程。容器使用其运行时的重启策略，而不是 systemd unit。其他配置设置不变。更多信息请参阅 [Docker](/zh/docs/intro/installation#docker)。

## 一份 systemd unit

Rapira 可以替代 php-fpm。一个服务器进程管理所有监听器和 PHP worker 线程。每个进程池运行固定数量的 worker，数量由 `workers` 设置。Systemd 只需监控这一个服务器进程。不需要单独的进程管理器。

`.deb` 和 `.rpm` 软件包安装二进制文件和嵌入式 PHP。它们不安装 service unit 或 `php.ini`。这些文件包含站点特定设置。软件包更新不得替换这些文件。已安装的文件见[安装](/zh/docs/intro/installation)。

创建 `/etc/systemd/system/rapira.service`：

```ini
[Unit]
Description=Rapira PHP application server
After=network.target

[Service]
Type=exec
WorkingDirectory=/srv/app
ExecStart=/usr/bin/rapira serve /etc/rapira/rapira.toml
ExecReload=/bin/kill -USR2 $MAINPID
Restart=on-failure
RuntimeDirectory=rapira
Environment=PHPRC=/etc/rapira

[Install]
WantedBy=multi-user.target
```

重新加载 systemd 配置：

```bash
sudo systemctl daemon-reload
```

使用 `--now` 启用 Rapira：

```bash
sudo systemctl enable --now rapira
```

此 unit 使用以下设置：

- `Type=exec`：Rapira 在**前台**运行，因此 `$MAINPID` 标识服务器进程。
- `ExecReload`：`systemctl reload rapira` 向服务器发送 `SIGUSR2`。此信号启动下面所述的重载过程。
- `Restart=on-failure`：systemd 在 Rapira 发生故障后重启它。正常停止后，systemd 不会重启 Rapira。
- `RuntimeDirectory=rapira`：systemd 在启动时创建 `/run/rapira`，并在停止时将其删除。以下示例将 pidfile 和 Unix socket 放在此目录中。
- `Environment=PHPRC`：PHP 使用此目录查找 `php.ini`。

在服务 unit 或容器上设置内存和 CPU 限制，例如 `MemoryMax=` 和 `CPUQuota=`。

::: tip 以非 root 用户运行
将 `User=` 和 `Group=` 添加到 `[Service]` 部分。Systemd 将 `RuntimeDirectory` 的所有权分配给该账户。然后该账户可以在 `/run/rapira/` 中创建 pidfile 和 Unix socket。它通常不能直接在 `/run` 中创建文件。
:::

同一主机上的两个应用需要不同的配置文件、unit 和监听地址。可以使用 `rapira@.service` 等 systemd 模板 unit 来定义它们。每个实例初始化 PHP，并创建独立的 worker 池。

## 配置路径

本指南使用 `/etc/rapira/rapira.toml` 保存 Rapira 设置。它将 `php.ini` 保存在同一目录，并设置 `PHPRC=/etc/rapira`。Rapira 二进制文件不包含这些路径。`CONFIG` 参数接受任何文件路径。PHP 使用 `PHPRC` 查找配置。系统需要其他路径时，请更改这些路径。

Rapira 可以在没有 `php.ini` 的情况下运行。默认值将 PHP 诊断信息写入日志，而不是 HTTP 响应。创建 `/etc/rapira/php.ini` 以配置 OPcache、内存限制或时区。诊断设置见[日志](/zh/docs/logging)。

在 PHP 8.4 上，OPcache 是独立的 `opcache.so` 文件。请按照 [php.ini](/zh/docs/intro/installation#php-ini) 中的说明，在 `php.ini` 中用 `zend_extension` 行加载它。PHP 8.5 和 PHP 8.6 的 `libphp` 包含 OPcache。

相对 `http.pool.entrypoint` 以**配置文件目录**为基准。在此结构中，`entrypoint = "index.php"` 表示 `/etc/rapira/index.php`。在生产环境中使用入口脚本的绝对路径。`server.pidfile` 和相对 `unix:` 监听路径使用相同的解析规则。

每个 Classic 请求以及每个 Worker 或 Dispatcher 应用实例都在解析后的入口脚本目录中启动。使用相对路径的 PHP 文件操作使用该线程本地目录。PHP 不在工作目录中查找 `php.ini`，因此请设置 `PHPRC`。在 ZTS 下，不带 `$cwd` 参数的 `proc_open()` 会在服务器的 `WorkingDirectory=` 中启动子进程；请将 `getcwd()` 作为 `$cwd` 传入以使用应用目录。所有键和默认值见[配置](/zh/docs/configuration)。

## 反向代理

Rapira 接受明文 HTTP，并且不提供 TLS 设置。[TLS 终止代理](https://en.wikipedia.org/wiki/TLS_termination_proxy)接受客户端的 HTTPS，解密连接，然后向 Rapira 发送明文 HTTP。使用 nginx、Caddy、HAProxy 或云负载均衡器来完成此任务。通过环回接口或 Unix socket 将代理连接到 Rapira。Rapira 的公共地址也使用明文 HTTP。

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Rapira 使用 `0666` 模式创建 Unix socket。任何可以访问运行时目录的进程都可以连接到该 socket。Rapira 不配置 socket 模式。请使用目录权限限制访问。对于此 unit，请设置 `RuntimeDirectoryMode=0750`。将 `Group=` 设置为包含代理账户的组。

使用连字符转发字段，例如 `X-Forwarded-For`。不要使用 `X_Forwarded_For` 等名称。在 Classic 和 Worker 模式下，带 `_` 或 `.` 的名称可能与带连字符的名称映射到同一个 `$_SERVER` 键。在这些模式下，Rapira 始终删除包含 ASCII 字母、数字和连字符以外字符的每个名称。[HTTP 页面](/zh/docs/http)介绍了此映射。

Rapira 可以使用[静态文件中间件](/zh/docs/static-files)提供静态资源。代理不需要文档根目录的第二个副本。代理或 CDN 也可以提供这些资源。

## 不中断服务的部署

部署新代码。然后重新加载 Rapira：

```bash
sudo systemctl reload rapira
```

此命令向服务器发送 `SIGUSR2`。每个 worker 在同一线程上回收其应用，新应用处理后续请求。没有连接关闭，也没有请求丢失。更多内容见[进程模型](/zh/docs/process-model#a-reload-restarts-the-apps)。

当 systemd 不管理进程时，直接发送信号。设置 `server.pidfile` 以保存服务器进程标识符。启动 Rapira 前，创建 pidfile 目录。也可以选择现有目录。如果服务器无法写入该文件，它不会启动。

```toml
[server]
pidfile = "/run/rapira/rapira.pid"
stop_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Rapira 在正常关闭和宿主直接退出（`70`、`101`、`124`、`130`）时删除 pidfile。残留的文件表示发生了 `SIGKILL`、致命崩溃信号或系统故障；下次启动会覆盖它。

`stop_timeout_secs` 限制总的关闭等待时间（默认 `30` 秒）。打开的连接在 `stop_timeout_secs` 减去 5 秒的时间内排空；如果停止超时低于 10 秒，则排空时间为停止超时的一半。请将 systemd 的 `TimeoutStopSec` 设置为大于 `stop_timeout_secs`。

部署可以将每个应用版本放在单独的目录中，并将入口脚本路径中的符号链接切换到新目录。切换后的重载会将每个进程池的每个 worker 移到新版本：代码、工作目录和默认的 sendfile 根目录。切换后请立即重载 Rapira。在重载之前，因其他原因（例如达到 `max_requests`）回收的应用会在新版本中启动。因此，在重载之前，进程池会运行两个版本。

重载会清空 OPcache，因此在 `opcache.validate_timestamps = 0` 时它也会加载新的 PHP 代码，除非设置了 `opcache.file_cache`。由一个 worker 重置 OPcache，同时其他 worker 等待，随后的请求重新编译其文件。

::: warning 重载不会做的事
重载会回收应用，但不会重启服务器进程。Rapira 保留二进制文件以及 `rapira.toml` 和 `php.ini` 中的设置。它还保留 gRPC 描述符集和 `[grpc.auth]` 令牌文件。重载不会从 URL 重新下载描述符集。更改其中任一文件后，请重启 Rapira。更改 `opcache.preload` 加载的文件后，也请重启 Rapira。PHP 只在服务器启动时加载这些文件一次。

设置了 `opcache.restrict_api` 时，重载不会清空 OPcache。使用此设置且 `opcache.validate_timestamps = 0` 时，请在每次部署后重启 Rapira。

使用 `opcache.file_cache` 且 `opcache.validate_timestamps = 0` 时，重载和重启都不会加载更改文件的新代码。重载只清空 OPcache 的共享内存。OPcache 随后从文件缓存读取旧脚本，而不检查文件时间。替换文件后，请清空 `opcache.file_cache` 目录，然后重载或重启 Rapira。或者，将每次发布部署到新目录，使每个更改的文件获得新路径。
:::

## 日志

Rapira 将过滤后的日志记录写入 **stderr**。systemd unit 的 stderr 无需其他配置即可进入 journal。生产环境请为 stderr 使用 JSON：

```toml
[log]
level = "info"
format = "json"
```

每行包含一个对象，其中有 `timestamp`、`level`、`target` 和 `fields`。`fields` 对象包含 `message` 和其他事件字段。时间戳使用 RFC 3339 UTC。Rapira 会转义消息中的换行符。Journald 将对象原样发送到日志收集器。

```bash
journalctl -u rapira -f
```

配置日志收集器以读取 unit journal。也可以将 Rapira 的 stderr 直接发送到收集器。收集器可以将每条记录解析为 JSON，而不使用正则表达式。有关 target 级别和 `RUST_LOG` 覆盖，请参阅[日志](/zh/docs/logging)。

## 健康检查和指标

添加 `[observability]` 表以提供健康探针和 Prometheus 指标。Rapira 在一个不运行 PHP 的独立线程上运行此监听器。`GET /livez` 表示服务器正在运行。`GET /readyz` 表示每个 PHP 进程池都有空闲或活动的 worker。`GET /metrics` 以 Prometheus 文本格式返回指标。

```toml
[observability]
listen = "127.0.0.1:9180"

[observability.metrics]

[observability.probes]
```

这些端点没有身份验证，也没有 TLS。请使用环回地址或 Unix socket。状态码、探针示例和指标参考见[指标与健康检查](/zh/docs/observability)。

## 应用回收与请求超时

在 [Worker 和 Dispatcher 模式](/zh/docs/execution-modes)下，worker 在请求之间保留应用状态。因此，内存泄漏可能会随着时间增加内存使用。请使用以下设置来限制其影响：

```toml
[http.pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`[grpc.pool]` 表接受相同的键。

`max_requests` 在指定的工作单元数后在 worker 线程上回收应用。监听器、连接和进程池队列保持不变，所以没有请求丢失。Rapira 为每个 worker 增加一个随机数，最多为限制的一半，以避免同时回收。回收会释放应用的 PHP 内存。它不会释放扩展或 C 库在 PHP 之外泄漏的内存。Classic 模式忽略此设置。

`request_terminate_timeout_secs` 为单个工作单元设置墙钟时间看门狗上限。达到限制时，看门狗中断 PHP 并唤醒阻塞的响应写入。原生 I/O 仍可能继续等待，因此请为套接字和数据库调用设置超时。再过五秒后，如果某个 worker 仍然阻塞，Rapira 会记录一次日志，同时其他 worker 继续提供服务。仅当某个进程池中的所有 worker 在宽限期过后仍处于阻塞状态时，Rapira 才以退出码 `124` 退出。

请在 `php.ini` 中设置 `memory_limit`，并为 Rapira 进程设置容器或 systemd 内存限制。有关进程池大小调整、启动失败重试、`SIGRTMAX` 和 `execution_clock`，请参阅[进程模型](/zh/docs/process-model)。
