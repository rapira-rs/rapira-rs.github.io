---
title: 生产环境部署
description: "如何在服务器上运行 Rapira：systemd unit、配置布局、前置反向代理、不中断服务的重载、JSON 日志和 worker 回收。"
---

# 生产环境部署

生产部署必须在重启后启动 Rapira，并在故障后恢复服务。
生产部署还必须在不丢失请求的情况下更新代码，并保存日志。本页介绍 systemd unit、反向代理和 worker 设置。

Rapira 不定义部署结构。它不要求特定配置路径或进程监管器。
本页为其他文档定义一个约定。请先按照[安装](/zh/docs/intro/installation)安装二进制文件。

Rapira 也提供 `ghcr.io/rapira-rs/rapira` 容器镜像。使用 `COPY --from` 将其文件复制到应用镜像。
容器使用运行时的重启策略代替 systemd。其他配置设置不变。
请参阅 [Docker](/zh/docs/intro/installation#docker)。

## 一份 systemd unit

Rapira 可以替代 php-fpm。master 进程创建、监控、替换和删除 worker。它还会更改进程池大小。
Systemd 只需监控 master 进程。不需要单独的进程管理器。

`.deb` 和 `.rpm` 软件包安装二进制文件和嵌入式 PHP。它们不安装 service unit 或 `php.ini`。
这些文件包含站点特定设置。软件包更新不应替换这些文件。
已安装的文件见[安装](/zh/docs/intro/installation)。

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

- `Type=exec`--Rapira 跑在**前台**，绝不会把自己 fork 到后台。没有守护进程模式，也不需要有：systemd 启起来的那个进程*就是* master，所以 `$MAINPID` 正好是你要发信号的那个 pid。
- `ExecReload`--把 `systemctl reload rapira` 变成发给 master 的一个 `SIGUSR2`，也就是下文那套不中断服务的重载。
- `KillMode=mixed`--systemd 默认会把停止信号发给 cgroup 里的每一个进程，而 worker 收到 `SIGTERM` 就是立刻退出。`mixed` 只发给 master，由它去走下文那套 `SIGQUIT` 优雅收尾；到了 `TimeoutStopSec` 的那记 `SIGKILL` 依然覆盖整个组。少了这一行，`systemctl stop` 和 `systemctl restart` 都会把手上的请求丢掉。
- `Restart=on-failure`--干净收尾的退出码是 0，退了就不再拉起，所以这一行只在崩溃或者启动失败之后才把服务器带回来。
- `RuntimeDirectory=rapira`--systemd 启动时建出 `/run/rapira`，停止时把它删掉。下面例子里的 pidfile 和 Unix socket 就放在这儿。
- `Environment=PHPRC`--PHP 去哪里找它的 `php.ini`，见下一节。

::: tip 以非 root 用户运行
在 `[Service]` 段里加上 `User=` 和 `Group=`--systemd 会把 `RuntimeDirectory` 的属主改成这个账号，所以 `/run/rapira/` 下面的 pidfile 和 Unix socket 照常能用。落在它外面的路径，`/run/rapira.pid` 之类，所在目录归 root，打开会失败。
:::

一台主机上跑两个应用，就要两份配置、两个 unit、两个监听地址；这种情况请用 systemd 的模板 unit（`rapira@.service`）。每个实例都会启动自己的 PHP 和自己的 worker 池，除了这台机器，两个实例之间什么都不共享。

## 配置路径

本指南使用 `/etc/rapira/rapira.toml` 保存 Rapira 设置。它将 `php.ini` 保存在同一目录，并设置 `PHPRC=/etc/rapira`。
Rapira 二进制文件不包含这些路径。`--config` 选项接受任何路径。
PHP 使用 `PHPRC` 查找配置。系统需要其他路径时，请更改这些路径。

Rapira 可以在没有 `php.ini` 的情况下运行。默认值将 PHP 诊断信息写入日志，而不是 HTTP 响应。
创建 `/etc/rapira/php.ini` 以配置 OPcache、内存限制或时区。请参阅[日志](/zh/docs/logging)。

相对 `pool.entrypoint` 以配置文件目录为基准。因此，此结构中的 `entrypoint = "index.php"` 表示 `/etc/rapira/index.php`。
在生产环境中使用入口脚本的绝对路径。`supervisor.pidfile` 使用相同规则。
位置参数 `SCRIPT` 和 PHP 文件操作使用工作目录。Rapira 不更改此目录。
Systemd 默认使用 `/`，所以 unit 设置 `WorkingDirectory=/srv/app`。PHP 也会在此目录中查找 ini 文件。
所有键见[配置](/zh/docs/configuration)。

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

Unix socket 建出来是 `0666`，也就是说本机上任何能进到这个目录的进程都可以连上来，直接把请求发给你的应用。这个权限 Rapira 没有对应的设置项，所以谁能碰到这个 socket，只由目录本身的权限决定。如果这一点要紧，那就去限制目录：在上面那份 unit 里加上 `RuntimeDirectoryMode=0750`，再配一个代理用户所属的 `Group=`，`/run/rapira` 就把其他人挡在了外面。

转发字段送到 Rapira 时必须用普通的 `-` 写法--`X-Forwarded-For`，绝不能写成 `X_Forwarded_For`。下划线和点号的写法会压到和正规写法同一个 `$_SERVER` 键上，客户端正是借这一手覆盖掉代理刚设好的值，所以 Rapira 会在 PHP 看到之前把它们摘掉。这套映射，以及管着它的 `http.unsafe_field_names` 设置项，都在 [HTTP](/zh/docs/http) 那一页。

开启[静态文件中间件](/zh/docs/static-files)之后，静态资源由 Rapira 自己提供，代理那边不必再放一份文档根目录的副本。前面挡一层代理或者一层 CDN 来提供这些资源，依旧是可选项。

## 不中断服务的部署

部署新代码。然后重新加载 Rapira：

```bash
sudo systemctl reload rapira
```

此命令向 master 进程发送 `SIGUSR2`。master 每次替换一个 worker，并完成当前请求。
如果 worker 超过 `process_control_timeout_secs`，master 会发送 `SIGTERM`，然后发送 `SIGKILL`。这会终止当前请求。
替换顺序见[进程模型](/zh/docs/process-model)。

当 systemd 不管理进程时，直接向 master 进程发送信号。设置 `supervisor.pidfile` 以保存进程标识符。
启动 Rapira 前，创建 pidfile 目录。也可以选择现有目录。
如果 master 无法写入文件，它不会启动。

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

这个文件只有 master 会写，worker 碰不到；而且凡是 master 自己掌控的退出路径，它都会把文件删掉。所以看到一个残留的 pidfile，就说明 master 没走完自己的关停流程就死了--一记 `SIGKILL`、一次硬崩溃，或者整台机器掉了。

`process_control_timeout_secs` 是 master 在升级手段之前留给 worker 收尾的时间，滚动重载的每一步也受它约束，所以一个卡死的 worker 拖不垮整轮替换--逐级升级的顺序和完整的信号对照表都在[进程模型](/zh/docs/process-model)。把它留得比 systemd 的 `TimeoutStopSec` 宽裕地小一些，否则先超时的是 systemd，它会在升级到一半时把 master 杀掉。

::: warning 重载不会做的事
master 一直用着启动时读到的那份设置，OPcache 的共享内存也归 master，所以它比任何一代 worker 都活得久。改了 `rapira.toml` 就得 `systemctl restart rapira`。另外，要是你设了 `opcache.validate_timestamps = 0`，重载仍会继续返回旧的 opcode--这时候请用 restart。
:::

## 日志

Rapira 将每条日志记录写入 **stderr**。systemd unit 的 stderr 无需其他配置即可进入 journal。
生产环境请使用 JSON：

```toml
[log]
level = "info"
format = "json"
```

每行包含一个对象，其中有 `timestamp`、`level`、`target` 和 `fields`。`fields` 对象包含 `message` 和其他事件字段。
时间戳使用 RFC 3339 UTC。

```bash
journalctl -u rapira -f
```

要把日志送出这台机器，让收集器去读这个 unit 的 journal；不想经过 journald 的话，就把 Rapira 的 stderr 直接管道接进 agent。两种做法拿到的记录都已经是结构化的，收集器那一头不必再用正则去解析。按 target 分别设级别，以及那个能为一次调试整体替换掉过滤器的 `RUST_LOG`，见[日志](/zh/docs/logging)。

## worker 回收与请求超时

在 [Worker 模式](/zh/docs/execution-modes)下进程会一直常驻，所以在 php-fpm 下不会被察觉的慢泄漏，会在一个个请求之间累积起来。有两项设置可以防住这一点：

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` 在达到指定请求数后替换 worker。Rapira 会添加一个小的随机值，以防止同时替换整个进程池。
此设置限制泄漏的影响，但不会修复泄漏。
`request_terminate_timeout_secs` 限制一个请求的运行时间。Rapira 会替换超过此值的 worker。
两个设置默认都关闭。用于生产环境前，请启用它们。

进程池的其余部分--static、dynamic 和 ondemand 三种规模策略、重启退避，以及 worker 死掉时 master 会做什么--都在[进程模型](/zh/docs/process-model)。
