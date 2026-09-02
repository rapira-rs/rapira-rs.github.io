---
title: 生产环境部署
description: "如何在服务器上运行 Rapira：systemd unit、配置布局、前置反向代理、不中断服务的重载、JSON 日志和 worker 回收。"
---

# 生产环境部署

在服务器上运行 Rapira，需要本地那条 `rapira serve --mode worker app/worker.php` 用不到的东西：开机自启、崩溃之后能自己回来、上了新代码能重载而不丢请求，以及事后能读的日志。本页讲的是一份 systemd unit、一个放配置的位置、前面挡一层代理，以及给常驻 worker 划定边界的那几项设置。

这里几乎没有一样东西是编译进二进制的。Rapira 不依赖配置放在哪里，也不依赖由什么来监管进程，所以下面这套布局只是本页立的一个约定，文档其余部分都按它来写。先把二进制装到机器上——这一步见[安装](/zh/docs/intro/installation)。

Rapira 同时也以容器镜像的形式发布在 `ghcr.io/rapira-rs/rapira`，用 `COPY --from` 就能把它拷进你自己的镜像。改用容器之后，下面这份 systemd unit 由容器运行时的重启策略顶替；本页讲的配置布局、前置代理、日志格式和进程池设置，则一条都不用改。更多内容见 [Docker](/zh/docs/intro/installation#docker)。

## 一份 systemd unit

Rapira 顶替的就是 php-fpm，而它的 master 本身就在看着进程池：fork、回收、带退避地重启、按策略换掉 worker、伸缩池子的规模。systemd 唯一要做的就是让那个 master 进程一直活着，所以 supervisord 这类单独的进程管理器在这里没有什么可做的。

`.deb` 和 `.rpm` 包只装两样东西：二进制，以及它内置的 PHP 运行时——**既没有 service unit，也没有 `php.ini`**（具体落地哪些文件，[安装](/zh/docs/intro/installation)那一页列得很清楚）。这两样都属于各站点自己的策略，包里要是带上它们，每次升级都会覆盖掉你的改动。

自己写一份，放进 `/etc/systemd/system/rapira.service`：

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

然后加载并启用它：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rapira
```

其中有六行需要解释：

- `Type=exec`——Rapira 跑在**前台**，绝不会把自己 fork 到后台。没有守护进程模式，也不需要有：systemd 启起来的那个进程*就是* master，所以 `$MAINPID` 正好是你要发信号的那个 pid。
- `ExecReload`——把 `systemctl reload rapira` 变成发给 master 的一个 `SIGUSR2`，也就是下文那套不中断服务的重载。
- `KillMode=mixed`——systemd 默认会把停止信号发给 cgroup 里的每一个进程，而 worker 收到 `SIGTERM` 就是立刻退出。`mixed` 只发给 master，由它去走下文那套 `SIGQUIT` 优雅收尾；到了 `TimeoutStopSec` 的那记 `SIGKILL` 依然覆盖整个组。少了这一行，`systemctl stop` 和 `systemctl restart` 都会把手上的请求丢掉。
- `Restart=on-failure`——干净收尾的退出码是 0，退了就不再拉起，所以这一行只在崩溃或者启动失败之后才把服务器带回来。
- `RuntimeDirectory=rapira`——systemd 启动时建出 `/run/rapira`，停止时把它删掉。下面例子里的 pidfile 和 Unix socket 就放在这儿。
- `Environment=PHPRC`——PHP 去哪里找它的 `php.ini`，见下一节。

::: tip 以非 root 用户运行
在 `[Service]` 段里加上 `User=` 和 `Group=`——systemd 会把 `RuntimeDirectory` 的属主改成这个账号，所以 `/run/rapira/` 下面的 pidfile 和 Unix socket 照常能用。落在它外面的路径，`/run/rapira.pid` 之类，所在目录归 root，打开会失败。
:::

一台主机上跑两个应用，就要两份配置、两个 unit、两个监听地址；这种情况请用 systemd 的模板 unit（`rapira@.service`）。每个实例都会启动自己的 PHP 和自己的 worker 池，除了这台机器，两个实例之间什么都不共享。

## 配置放在哪里

约定是这样：Rapira 自己的设置放 `/etc/rapira/rapira.toml`，`php.ini` 就摆在它旁边，靠 `PHPRC=/etc/rapira` 找到。两条路径都不是编译进去的。`--config` 你给什么路径都行，而 `PHPRC` 根本不是 Rapira 的功能——Rapira 没动 PHP 找 ini 的那套逻辑，所以 PHP 会先看 `$PHPRC`，和在别的 SAPI 下一模一样。如果你的发行版或者 Ansible role 用的是别的路径，把两者都指过去。

Rapira 完全没有 `php.ini` 也能跑：内置的 ini 默认值会把 PHP 的诊断信息留在日志里，而不是塞进你的响应，[日志](/zh/docs/logging)那一页有解释。想调 OPcache、设内存上限或者时区，就在 `/etc/rapira` 里写自己的那一份；它设了什么就以它为准。

相对的 `pool.entrypoint` 是按**配置文件**所在的目录解析的，不是按工作目录。照上面这套布局，`entrypoint = "index.php"` 指的是 `/etc/rapira/index.php`，而你的应用并不在那儿。生产环境里给入口脚本写绝对路径，这个问题就压根不会冒出来。`supervisor.pidfile` 也是同一条规矩：配置里的这两条路径都挂在配置文件所在的目录下。真正按工作目录解析的，是位置参数 `SCRIPT`，以及你的 PHP 代码在运行时打开的那些相对路径；而 Rapira 从不 chdir——不设 `WorkingDirectory=` 的话，systemd 会在 `/` 里启动服务，上面那份 unit 之所以设了就是这个缘故（PHP 找 ini 时也会看 `.`，所以它同样会往那儿瞧一眼）。每个键连同默认值，都在[配置](/zh/docs/configuration)那一页。

## 挡在反向代理后面

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

转发字段送到 Rapira 时必须用普通的 `-` 写法——`X-Forwarded-For`，绝不能写成 `X_Forwarded_For`。下划线和点号的写法会压到和正规写法同一个 `$_SERVER` 键上，客户端正是借这一手覆盖掉代理刚设好的值，所以 Rapira 会在 PHP 看到之前把它们摘掉。这套映射，以及管着它的 `http.unsafe_field_names` 设置项，都在 [HTTP](/zh/docs/http) 那一页。

开启[静态文件中间件](/zh/docs/static-files)之后，静态资源由 Rapira 自己提供，代理那边不必再放一份文档根目录的副本。前面挡一层代理或者一层 CDN 来提供这些资源，依旧是可选项。

## 不中断服务的部署

把新代码发上去，然后：

```bash
sudo systemctl reload rapira
```

这条命令发给 master 的是一个 `SIGUSR2`，master 用一次**滚动重载**来回应：进程池一次只换一个 worker，手上的请求会跑完；只有当某个 worker 超出 `process_control_timeout_secs`，才会被升级到 `SIGTERM`、随后 `SIGKILL`，它手上那个请求也随之丢失（见下文）。新旧 worker 在这一轮里怎么交叠，见[进程模型](/zh/docs/process-model)。

没有 systemd 的场合——容器的 entrypoint、一个部署脚本——就直接给 master 发信号。设上 `supervisor.pidfile`，pid 就在那儿等着；离开 systemd 就没人会去建 `/run/rapira`，所以要么先把目录建出来，要么换一条已经存在的路径——文件写不进去，master 会拒绝启动。

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

这个文件只有 master 会写，worker 碰不到；而且凡是 master 自己掌控的退出路径，它都会把文件删掉。所以看到一个残留的 pidfile，就说明 master 没走完自己的关停流程就死了——一记 `SIGKILL`、一次硬崩溃，或者整台机器掉了。

`process_control_timeout_secs` 是 master 在升级手段之前留给 worker 收尾的时间，滚动重载的每一步也受它约束，所以一个卡死的 worker 拖不垮整轮替换——逐级升级的顺序和完整的信号对照表都在[进程模型](/zh/docs/process-model)。把它留得比 systemd 的 `TimeoutStopSec` 宽裕地小一些，否则先超时的是 systemd，它会在升级到一半时把 master 杀掉。

::: warning 重载不会做的事
master 一直用着启动时读到的那份设置，OPcache 的共享内存也归 master，所以它比任何一代 worker 都活得久。改了 `rapira.toml` 就得 `systemctl restart rapira`。另外，要是你设了 `opcache.validate_timestamps = 0`，重载仍会继续返回旧的 opcode——这时候请用 restart。
:::

## 日志

Rapira 把每一条日志都写到 **stderr**，一条记录一次写入，所以 master 和 worker 的输出绝不会在一行中间串到一起。systemd unit 的 stderr 不用任何配置就会进 journal，于是只剩格式这一件事要选。生产环境请用 JSON：

```toml
[log]
level = "info"
format = "json"
```

每行一个对象，`timestamp` 是 RFC 3339 的 UTC 时间，另外还有 `level`、`message` 和 `target`；消息里的换行会被转义，所以一条记录永远正好占一行。日志收集器要的就是这个格式，而且经过 journald 之后内容不会有任何改动。

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

`max_requests` 让 worker 处理够这么多请求就退休，再 fork 一个新的顶上，另外加了一点抖动，免得整个进程池同时替换。它治不好泄漏，它管的是别让一个还没找出来的泄漏变成线上故障。`request_terminate_timeout_secs` 是单个请求的墙钟时间上限：超过就把这个 worker 杀掉重开，这样一个卡住的请求就不会长期占着一个 worker。两项默认都关着；上线之前把它们打开。

进程池的其余部分——static、dynamic 和 ondemand 三种规模策略、重启退避，以及 worker 死掉时 master 会做什么——都在[进程模型](/zh/docs/process-model)。
