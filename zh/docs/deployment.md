---
title: 生产环境部署
description: "生产环境的 systemd unit、配置结构、反向代理、重载过程、JSON 日志和 worker 替换。"
---

# 生产环境部署

生产部署必须在重启后启动 Rapira，并在故障后恢复服务。 生产部署还必须在不丢失请求的情况下更新代码，并保存日志。本页介绍 systemd unit、反向代理和 worker 设置。

Rapira 不定义部署结构。它不要求特定配置路径或进程监管器。 本页为其他文档定义一个约定。请先按照[安装](/zh/docs/intro/installation)安装二进制文件。

Rapira 也提供 `ghcr.io/rapira-rs/rapira` 容器镜像。使用 `COPY --from` 将其文件复制到应用镜像。 容器使用运行时的重启策略代替 systemd。其他配置设置不变。 请参阅 [Docker](/zh/docs/intro/installation#docker)。

## 一份 systemd unit

Rapira 可以替代 php-fpm。master 进程创建、监控、替换和删除 worker。它还会更改进程池大小。 Systemd 只需监控 master 进程。不需要单独的进程管理器。

`.deb` 和 `.rpm` 软件包安装二进制文件和嵌入式 PHP。它们不安装 service unit 或 `php.ini`。 这些文件包含站点特定设置。软件包更新不应替换这些文件。 已安装的文件见[安装](/zh/docs/intro/installation)。

创建 `/etc/systemd/system/rapira.service`：

```ini
[Unit]
Description=Rapira PHP application server
After=network.target

[Service]
Type=exec
WorkingDirectory=/srv/app
ExecStart=/usr/bin/rapira serve --config /etc/rapira/rapira.toml
ExecReload=/bin/kill -USR2 $MAINPID
KillMode=mixed
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

- `Type=exec`：Rapira 在**前台**运行。systemd 启动的进程是 master，因此 `$MAINPID` 标识该进程。
- `ExecReload`：`systemctl reload rapira` 向 master 发送 `SIGUSR2`。此信号启动下面所述的重载过程。
- `KillMode=mixed`：systemd 仅向 master 发送停止信号。master 随后向 worker 发送 `SIGQUIT` 并等待。`TimeoutStopSec` 结束后，systemd 向整个组发送 `SIGKILL`。如果没有 `KillMode=mixed`，停止操作可能会终止当前请求。
- `Restart=on-failure`：systemd 在 Rapira 发生故障后重启它。正常停止后，systemd 不会重启 Rapira。
- `RuntimeDirectory=rapira`：systemd 在启动时创建 `/run/rapira`，并在停止时将其删除。以下示例将 pidfile 和 Unix socket 放在此目录中。
- `Environment=PHPRC`：PHP 使用此目录查找 `php.ini`。

::: tip 以非 root 用户运行
将 `User=` 和 `Group=` 添加到 `[Service]` 部分。Systemd 将 `RuntimeDirectory` 的所有权分配给该账户。 该账户可以在 `/run/rapira/` 中创建 pidfile 和 Unix socket。它通常不能直接在 `/run` 中创建文件。
:::

同一主机上的两个应用需要不同的配置文件、unit 和监听地址。可以使用 `rapira@.service` 等 systemd 模板 unit 来定义它们。 每个实例初始化 PHP，并创建独立的 worker 池。

## 配置路径

本指南使用 `/etc/rapira/rapira.toml` 保存 Rapira 设置。它将 `php.ini` 保存在同一目录，并设置 `PHPRC=/etc/rapira`。 Rapira 二进制文件不包含这些路径。`--config` 选项接受任何路径。 PHP 使用 `PHPRC` 查找配置。系统需要其他路径时，请更改这些路径。

Rapira 可以在没有 `php.ini` 的情况下运行。默认值将 PHP 诊断信息写入日志，而不是 HTTP 响应。 创建 `/etc/rapira/php.ini` 以配置 OPcache、内存限制或时区。请参阅[日志](/zh/docs/logging)。

相对 `pool.entrypoint` 以配置文件目录为基准。因此，此结构中的 `entrypoint = "index.php"` 表示 `/etc/rapira/index.php`。 在生产环境中使用入口脚本的绝对路径。`supervisor.pidfile` 使用相同规则。 位置参数 `SCRIPT` 和 PHP 文件操作使用工作目录。Rapira 不更改此目录。 Systemd 默认使用 `/`，所以 unit 设置 `WorkingDirectory=/srv/app`。PHP 也会在此目录中查找 ini 文件。 所有键见[配置](/zh/docs/configuration)。

## 反向代理

Rapira 接受明文 HTTP，并且不提供 TLS 设置。
[TLS 终止代理](https://en.wikipedia.org/wiki/TLS_termination_proxy)接受客户端的 HTTPS，解密连接，然后向 Rapira 发送明文 HTTP。
使用 nginx、Caddy、HAProxy 或云负载均衡器来完成此任务。
通过环回接口或 Unix socket 将代理连接到 Rapira。Rapira 的公共地址也使用明文 HTTP。

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Rapira 使用 `0666` 模式创建 Unix socket。任何可以访问运行时目录的进程都可以连接到该 socket。 Rapira 不配置 socket 模式。请使用目录权限限制访问。 对于此 unit，请设置 `RuntimeDirectoryMode=0750`。将 `Group=` 设置为包含代理账户的组。

使用连字符转发字段，例如 `X-Forwarded-For`。不要使用 `X_Forwarded_For` 等名称。 带下划线或点的名称可能映射到同一个 `$_SERVER` 键。Rapira 会在 PHP 接收这些名称之前将其删除。 [HTTP 页面](/zh/docs/http)介绍了此映射和 `http.unsafe_field_names`。

Rapira 可以使用[静态文件中间件](/zh/docs/static-files)提供静态资源。代理不需要文档根目录的第二个副本。 代理或 CDN 也可以提供这些资源。

## 不中断服务的部署

部署新代码。然后重新加载 Rapira：

```bash
sudo systemctl reload rapira
```

此命令向 master 进程发送 `SIGUSR2`。master 每次替换一个 worker，并完成当前请求。 如果 worker 超过 `process_control_timeout_secs`，master 会发送 `SIGTERM`，然后发送 `SIGKILL`。这会终止当前请求。 替换顺序见[进程模型](/zh/docs/process-model)。

当 systemd 不管理进程时，直接向 master 进程发送信号。设置 `supervisor.pidfile` 以保存进程标识符。 启动 Rapira 前，创建 pidfile 目录。也可以选择现有目录。 如果 master 无法写入文件，它不会启动。

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

只有 master 写入 pidfile。它会在受控退出期间删除该文件。 残留的文件可能表示发生了 `SIGKILL`、进程故障或系统故障。

`process_control_timeout_secs` 限制关停和重载期间每次等待 worker 的时间。超过此限制后，master 会发送下一个终止信号。 请将此值设置为低于 systemd 的 `TimeoutStopSec`。否则，systemd 可能会在序列完成前终止 master。 有关信号序列，请参阅[进程模型](/zh/docs/process-model)。

::: warning 重载不会做的事
重载期间，master 保留其初始设置和 OPcache 共享内存。更改 `rapira.toml` 后，请重启 Rapira。 当 `opcache.validate_timestamps = 0` 时，也请重启 Rapira。在此配置中，重载不会替换缓存的 opcode。
:::

## 日志

Rapira 将每条日志记录写入 **stderr**。systemd unit 的 stderr 无需其他配置即可进入 journal。 生产环境请使用 JSON：

```toml
[log]
level = "info"
format = "json"
```

每行包含一个对象，其中有 `timestamp`、`level`、`target` 和 `fields`。`fields` 对象包含 `message` 和其他事件字段。 时间戳使用 RFC 3339 UTC。 Rapira 会转义消息中的换行符。Journald 将对象原样发送到日志收集器。

```bash
journalctl -u rapira -f
```

配置日志收集器以读取 unit journal。也可以将 Rapira 的 stderr 直接发送到收集器。 收集器可以将每条记录解析为 JSON，而不使用正则表达式。 有关 target 级别和 `RUST_LOG` 覆盖，请参阅[日志](/zh/docs/logging)。

## worker 回收与请求超时

在 [Worker 模式](/zh/docs/execution-modes)下，进程在请求之间保留应用状态。因此，内存泄漏可能会随着时间增加进程内存。 请使用以下两个设置来限制其影响：

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` 在达到指定请求数后替换 worker。Rapira 会添加一个小的随机值，以防止同时替换整个进程池。 此设置限制泄漏的影响，但不会修复泄漏。 `request_terminate_timeout_secs` 限制一个请求的运行时间。Rapira 会替换超过此值的 worker。 两个设置默认都关闭。用于生产环境前，请启用它们。

有关进程池大小调整、替换延迟和 worker 故障处理，请参阅[进程模型](/zh/docs/process-model)。
