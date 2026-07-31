---
title: 日志
description: Rapira 怎么记日志——级别、按目标单独覆盖、PHP 诊断信息、plain 与 json 两种格式，以及调试用的 RUST_LOG 覆盖开关。
---

# 日志

Rapira 要说的话全都汇进同一条流：服务器自身的生命周期事件、master 的监管决策、HTTP 接入层，还有 PHP 的诊断信息——统统写到 stderr，统统由同一套过滤规则决定去留。最后这一点值得停下来多说两句：PHP 报一条警告，不用你翻到另一个 `error_log` 文件里去找，它和别的记录一样躺在同一份日志里，也和别的记录一样可以随手调高调低。

默认是刻意安静的。开箱只有 `error` 能过，因为一台在生产机器上絮絮叨叨的服务器，日志根本没人看。想把音量调大，配置里加一行就够；一点都不想碰配置文件的话，还有个环境变量可用。

## 级别与格式

日志的开关都在 `rapira.toml` 的 `[log]` 小节里：

```toml
[log]
level = "error"   # error (default) | warn | info | debug | trace
format = "plain"  # plain (default) | json
```

`level` 一次给所有目标定下同一条下限：`error` 只放行错误，`warn` 再添上警告，一路往下到 `trace`，那就是什么都放行。`format` 决定每条记录长什么样——是给人读的文本行，还是一行一个 JSON 对象。

这两个键都可以不写，整个小节不写也行。文件里的其余部分——监听器、进程池、supervisor——见[配置](/zh/docs/configuration)那一页。

## 按目标单独覆盖

一个全局级别毕竟太糙。追查 PHP 里的问题时，你想把 PHP 的诊断信息开到 `debug`，又不想被 HTTP 那一层的内部细节淹死。`[log.targets]` 就是干这个的：

```toml
[log]
level = "error"

[log.targets]
php = "debug"
pingora_core = "warn"
```

每个键点名一个目标，只调它一个的高低，其余照旧跟着 `level` 走。键**按前缀**匹配，所以 `php` 连 `php_sys` 和 `php_sys::callbacks` 一起管住了——写出能覆盖你关心范围的最短前缀就行，永远不用把子模块一个个列出来。

Rapira 自己用的目标有这些：

| 目标     | 覆盖范围                                             |
| -------- | ---------------------------------------------------- |
| `rapira` | 服务器生命周期：启动、worker 生命周期、关闭          |
| `master` | 监管：fork、回收、重新拉起、重载、进程池伸缩         |
| `http`   | HTTP 接入层：监听器、请求和响应的字段处理、排空      |
| `ext`    | 扩展任务的执行结果                                   |
| `php`    | 来自 PHP 本身的输出和诊断信息                        |

依赖库以自己的模块路径作为目标——`pingora_core`、`tokio` 等等——过滤方式完全一样。哪个库在日志里吵得慌，它的目标名就明明白白写在那条记录上，直接抄进 `[log.targets]` 摁下去。

::: tip
想弄明白进程池为什么是眼下这个样子，就盯着 `master` 这个目标看——重新拉起、重载、进程池伸缩，都会在那里自报家门。这些事件各自意味着什么，见[进程模型](/zh/docs/process-model)。
:::

## PHP 诊断信息

PHP 报出来的一切都落在 `php` 目标上，每条诊断信息的级别取自它的错误类型——于是控制服务器的那套过滤规则，同时也决定了你能听见多少 PHP 的动静：

| 诊断信息                                                                                        | 级别    |
| ----------------------------------------------------------------------------------------------- | ------- |
| 致命错误——`E_ERROR`、`E_PARSE`、`E_CORE_ERROR`、`E_COMPILE_ERROR`、`E_USER_ERROR`、`E_RECOVERABLE_ERROR` | `error` |
| 警告——`E_WARNING`、`E_CORE_WARNING`、`E_COMPILE_WARNING`、`E_USER_WARNING`                     | `warn`  |
| 提示——`E_NOTICE`、`E_USER_NOTICE`                                                              | `info`  |
| 弃用提醒——`E_DEPRECATED`、`E_USER_DEPRECATED`                                                  | `debug` |

这张表的要害就在于弃用提醒落在 `debug`：vendor 里躺着几千条弃用提醒的代码库，不至于把你真正需要看见的那两条警告埋掉。

被脚本的 [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) 掩码挡掉的诊断信息不会凭空消失——它掉到 `trace`。所以常见的那套掩码，效果和你预期的一致：

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

这样一来，日常任何级别下 vendor 的弃用提醒都进不了日志；等你想知道究竟屏蔽掉了什么，`level = "trace"` 又能把它们全找回来。有两个例外值得记住。致命错误**绝不**降级，掩码怎么写都一样：worker 为什么被回收，只有它说得清，绝不能让某个埋在 vendor 目录里的 `error_reporting(0)` 把这件事捂住。另外 `E_CORE_ERROR`/`E_CORE_WARNING` 在脚本还来不及设掩码之前就已经抛出来了，任何掩码对它们同样无效。

::: info
诊断信息进日志，不进响应。Rapira 把 [`display_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.display-errors) 默认设为 `0`，[`log_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.log-errors) 默认设为 `1`——服务器不该把调用栈漏进页面里。这些只是*默认值*，不是强制覆盖：php.ini 里写了其中哪一项，就以 php.ini 为准。
:::

## 格式

两种格式都写到 stderr，一条记录一次写入。正是这条“一次写完”的规则，让一个 master 加十几个 worker 往同一个文件描述符里写时，不会在记录中间互相串行——每条记录整条写出去，而不是一片片拼起来。

**`plain`** 是你在终端里想要的那种——时间戳、级别、目标、消息：

```
2026-07-30T09:12:34.567890Z ERROR php: …
```

stderr 是终端时它带颜色，重定向到文件时绝不带，所以收集下来的日志里不会混进转义序列。把 [`NO_COLOR`](https://no-color.org/) 设成任意非空值，即便在终端里颜色也会关掉。

**`json`** 是你摆在日志收集器前面想要的那种——一行一个对象：

```
{"timestamp":…,"level":"ERROR","message":…,"target":…}
```

`timestamp` 是精确到毫秒的 RFC 3339 UTC 时间。消息里的换行会被转义，所以一条记录永远正好一行，一段多行的 PHP 调用栈不会散成四行谁也解析不了的东西。来自内置代理引擎的记录还会多带几个 `log.*` 调用方字段。JSON 输出永远不带颜色，在不在终端里都一样。

## `RUST_LOG`

为了搞清一个问题去改配置文件，问完再改回来——这循环实在难受，所以有个环境变量能直接跳过它：

```sh
RUST_LOG=info rapira serve worker.php
RUST_LOG=rapira=debug,php=info rapira serve worker.php
RUST_LOG=warn,rapira=trace rapira serve worker.php
```

第一条把所有东西都调到 `info`。第二条是有针对性的一对——服务器开到 `debug`，PHP 开到 `info`。第三条把依赖库压到 `warn`，同时把 Rapira 的 `rapira` 目标——启动、worker 生命周期、关闭——拉到 `trace`。其他目标同样按各自的名字匹配，问题出在别处就把它们加上：`RUST_LOG=warn,rapira=trace,master=trace`。

::: warning
`RUST_LOG` 一旦设成非空值，就会把 `level` 和 `[log.targets]` 整个**替换**掉——换掉的是整套过滤规则，不是两边合并。你写的 `[log.targets]` 不会垫在它下面继续生效，而是压根不会被读取。想回到配置文件，把这个变量取消设置（或者留空）即可。它从不影响 `format`。
:::

::: question 日志是空的——是不是出什么问题了？
基本可以肯定没有：`level` 默认就是 `error`，所以一台健康的服务器本来就一声不吭。用 `RUST_LOG=info` 启动，启动过程、监听器和 worker 生命周期就都出来了。
:::

::: question 怎么把日志写到文件里？
把进程的 stderr 重定向出去。Rapira 只往那里写，这也意味着服务管理器不需要任何配置就能替你收好日志——见[生产环境部署](/zh/docs/deployment)。
:::

::: question 用 `error_reporting()` 屏蔽掉的弃用提醒，为什么还看得见？
被屏蔽的诊断信息是掉到了 `trace`，不是消失，所以只有在 `level = "trace"` 下才会重新露面。如果你正跑在 `trace` 上又不想看到它们，把级别调高一档。
:::

::: question 有访问日志吗？
没有——Rapira 不会为每个请求记一行。`http` 目标报告的是监听器、排空，以及请求或响应字段上任何不寻常的情况；它拿这些字段具体怎么办，见 [HTTP](/zh/docs/http)。
:::
