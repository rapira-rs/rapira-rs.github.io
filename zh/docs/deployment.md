---
title: 生产环境部署
description: 一份 systemd unit、一套配置布局、前面挡一层反向代理、不中断服务的重载和 JSON 日志——把 Rapira 跑在真正的服务器上。
---

# 生产环境部署

在自己的笔记本上，`rapira serve app/worker.php` 就是全部。到了服务器上，你还想要几件事：开机自启、崩溃之后能自己回来、上了新代码能重载而一个请求都不掉、日志落在你真能翻得动的地方。这一页讲的就是运维那一半——一份 systemd unit、一个放配置的位置、前面挡一层代理，以及那几项让常驻 worker 保持健康的设置。

这里几乎没有一样东西是写死在二进制里的。配置放在哪、由谁来看着它，Rapira 都没有意见，所以下面这套布局只是本页立的一个约定，文档其余部分恰好也照着它写。先把二进制装到机器上——这一步见[安装](/zh/docs/installation)。

## 一份 systemd unit

`.deb` 和 `.rpm` 包只装两样东西：二进制，以及它内置的 PHP 运行时——**既没有 service unit，也没有 `php.ini`**（具体落地哪些文件，[安装](/zh/docs/installation)那一页列得很清楚）。这是有意为之：这两样都属于策略，该由你说了算；包里要是带上它们，就等于每次升级都来覆盖一遍你的改动。

所以自己写一份。把下面这段放进 `/etc/systemd/system/rapira.service`：

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

里面有六行值得各说一句：

- `Type=exec`——Rapira 跑在**前台**，绝不会把自己 fork 到后台。没有守护进程模式，也不需要有：systemd 启起来的那个进程*就是* master，所以 `$MAINPID` 正好是你要发信号的那个 pid。
- `ExecReload`——把 `systemctl reload rapira` 变成发给 master 的一个 `SIGUSR2`，也就是下文那套不中断服务的重载。
- `KillMode=mixed`——systemd 默认会把停止信号发给 cgroup 里的每一个进程，而 worker 收到 `SIGTERM` 就是立刻退出。`mixed` 只发给 master，由它去走下文那套 `SIGQUIT` 优雅收尾；到了 `TimeoutStopSec` 的那记 `SIGKILL` 依然覆盖整个组。少了这一行，`systemctl stop` 和 `systemctl restart` 都会把手上的请求丢掉。
- `Restart=on-failure`——干净收尾的退出码是 0，退了就不再拉起，所以这一行只在崩溃或者启动失败之后才把服务器带回来。
- `RuntimeDirectory=rapira`——systemd 启动时建出 `/run/rapira`，停止时把它删掉。下面例子里的 pidfile 和 Unix socket 就放在这儿。
- `Environment=PHPRC`——PHP 去哪里找它的 `php.ini`，见下一节。

::: tip 不想用 root 跑？
在 `[Service]` 段里加上 `User=` 和 `Group=`——systemd 会把 `RuntimeDirectory` 的属主改成这个账号，所以 `/run/rapira/` 下面的 pidfile 和 Unix socket 照常能用。落在它外面的路径，`/run/rapira.pid` 之类，所在目录归 root，打开会失败。
:::

## 配置放在哪里

约定是这样：Rapira 自己的设置放 `/etc/rapira/rapira.toml`，`php.ini` 就摆在它旁边，靠 `PHPRC=/etc/rapira` 找到。两条路径都不是编译进去的。`--config` 你给什么路径都行，而 `PHPRC` 根本不是 Rapira 的功能——Rapira 没动 PHP 找 ini 的那套逻辑，所以 PHP 会先看 `$PHPRC`，和在别的 SAPI 下一模一样。你的发行版或者 Ansible role 更中意别的位置，那就都指过去。

动手写这个文件之前有一点要知道：相对的 `pool.entrypoint` 是按**配置文件**所在的目录解析的，不是按工作目录。照上面这套布局，`entrypoint = "index.php"` 指的是 `/etc/rapira/index.php`，而你的应用并不在那儿。生产环境里给入口脚本写绝对路径，这个问题就压根不会冒出来。`supervisor.pidfile` 也是同一条规矩：配置里的这两条路径都挂在配置文件所在的目录下。真正按工作目录解析的，是位置参数 `SCRIPT`，以及你的 PHP 代码在运行时打开的那些相对路径；而 Rapira 从不 chdir——不设 `WorkingDirectory=` 的话，systemd 会在 `/` 里启动服务，上面那份 unit 之所以设了就是这个缘故（PHP 找 ini 时也会看 `.`，所以它同样会往那儿瞧一眼）。每个键连同默认值，都在[配置](/zh/docs/configuration)那一页。

## 挡在反向代理后面

Rapira 的监听器只讲明文 HTTP：配置里没有 TLS 那一节，而且是故意没有。TLS 就在你本来就在跑的代理上终结——nginx、Caddy、HAProxy，或者云上的负载均衡器——再让它走回环地址或者 Unix socket 连到 Rapira。绑到公网网卡当然做得到，只是那个监听器上没有 TLS，所以你多半并不想这么做。

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Unix socket 建出来是 `0666`，也就是说只要够得着这个路径，谁都能连上去。这个权限 Rapira 没有开关可调。如果这一点要紧，那就去限制目录：在上面那份 unit 里加上 `RuntimeDirectoryMode=0750`，再配一个代理用户所属的 `Group=`，`/run/rapira` 就把其他人挡在了外面。

进来这一侧，你的代理只有一项义务：转发用的字段名必须用普通的 `-` 写法——`X-Forwarded-For`，绝不能写成 `X_Forwarded_For`。下划线和点号的写法会压到和正规写法同一个 `$_SERVER` 键上，客户端正是借这一手覆盖掉代理刚设好的值，所以 Rapira 会在 PHP 看到之前把它们摘掉。这套映射，以及管着它的 `http.unsafe_field_names` 开关，都在 [HTTP](/zh/docs/http) 那一页。

## 不中断服务的部署

把新代码发上去，然后：

```bash
sudo systemctl reload rapira
```

这条命令发给 master 的是一个 `SIGUSR2`，master 用一次**滚动重载**来回应：进程池一次只换一个 worker，手上的请求会跑完；只有当某个 worker 超出 `process_control_timeout_secs`，才会被升级到 `SIGTERM`、随后 `SIGKILL`，连它手上那个请求一起断掉（见下文）。新旧 worker 在这一轮里怎么交叠，见[进程模型](/zh/docs/process-model)。

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

`process_control_timeout_secs` 是 master 在升级手段之前留给 worker 收尾的那点耐心，滚动重载的每一步也受它约束，所以一个卡死的 worker 拖不垮整轮替换——逐级升级的顺序和完整的信号对照表都在[进程模型](/zh/docs/process-model)。把它留得比 systemd 的 `TimeoutStopSec` 宽裕地小一些，否则先耗尽耐心的是 systemd，它会在升级到一半时把 master 杀掉。

::: warning 重载只是滚动换 worker，不会重新读取任何东西
master 一直用着启动时读到的那份设置，OPcache 的共享内存也归 master，所以它比任何一代 worker 都活得久。改了 `rapira.toml` 就得 `systemctl restart rapira`。另外，要是你设了 `opcache.validate_timestamps = 0`，重载会心安理得地继续吐旧的 opcode——这时候请用 restart。
:::

## 日志

Rapira 把每一条日志都写到 **stderr**，一条记录一次写入，所以 master 和 worker 的输出绝不会在一行中间串到一起。systemd unit 的 stderr 不用任何配置就会进 journal，于是只剩格式这一件事要定——生产环境上就是 JSON：

```toml
[log]
level = "info"
format = "json"
```

每行一个对象，`timestamp` 是 RFC 3339 的 UTC 时间，另外还有 `level`、`message` 和 `target`；消息里的换行会被转义，所以一条记录永远正好占一行。日志收集器要的就是这个形状，而且它经过 journald 一趟还能原样出来。

```bash
journalctl -u rapira -f
```

要把日志送出这台机器，让收集器去读这个 unit 的 journal；不想经过 journald 的话，就把 Rapira 的 stderr 直接管道接进 agent。两种做法拿到的记录都已经是结构化的——另一头不用再写正则去解析。按 target 分别设级别，以及那个能为一次调试整体替换掉过滤器的 `RUST_LOG`，见[日志](/zh/docs/logging)。

## worker 的日常保养

进程常驻正是 [worker 那几级](/zh/docs/execution-modes)的意义所在——同时也是为什么在 php-fpm 下根本不会被察觉的慢泄漏，到这里突然就要紧了。有两项设置是安全网：

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` 让 worker 处理够这么多请求就退休，再 fork 一个新的顶上，另外加了一点抖动，免得整个进程池齐刷刷一起换血。它治不好泄漏，它管的是别让一个还没找出来的泄漏在凌晨三点变成一次线上故障。`request_terminate_timeout_secs` 是单个请求的墙钟时间上限：超过就把这个 worker 杀掉重开，免得一个卡住的请求永久占掉你一个 worker。两项默认都关着，上线之前都值得打开。

进程池的其余部分——static、dynamic 和 ondemand 三种规模策略、重启退避，以及 worker 死掉时 master 会做什么——都在[进程模型](/zh/docs/process-model)。

::: question 我还需要 php-fpm，或者 supervisord 这类进程管理器吗？
都不需要。Rapira 顶替的就是 php-fpm，而它的 master 本身就在看着进程池——fork、回收、带退避地重启、按策略换掉 worker、伸缩池子的规模。systemd 要干的只有一件事：让那个 master 进程一直活着。
:::

::: question 一台机器上能跑两个应用吗？
可以——两份配置、两个 unit、两个监听地址。用 systemd 的模板 unit（`rapira@.service`）是比较清爽的做法。每个实例都会启动自己的 PHP 和自己的 worker 池，除了这台机器，它们之间什么都不共享。
:::

::: question 为什么安装包不装一个 php.ini？
因为这恰恰是你百分之百会去改的那个文件，而一个被改过的、由包管理的配置文件，意味着每次升级都是一次合并冲突。何况没有它 Rapira 照样跑得好好的——内置的 ini 默认值会把 PHP 的诊断信息留在日志里，而不是塞进你的响应，[日志](/zh/docs/logging)那一页有解释。想调 OPcache、设内存上限或者时区，就在 `/etc/rapira` 里写自己的 `php.ini`；它设了什么就以它为准。
:::
