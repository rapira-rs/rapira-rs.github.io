---
title: 日志
description: "Rapira 怎么记日志——级别、按目标单独覆盖、PHP 诊断信息、应用自己的日志、plain 与 json 两种格式，以及调试用的 RUST_LOG 覆盖开关。"
---

# 日志

Rapira 把所有内容都写进同一条流：服务器自身的生命周期事件、master 的监管决策、HTTP 接入层、PHP 的诊断信息，还有应用自己记的日志——统统写到 stderr，统统由同一套过滤规则决定去留。PHP 的一条警告就是这份日志里的一条记录，而不是另一个 `error_log` 文件里的一行，它的级别和别的记录一样可以调高或调低。

默认级别是 `error`，因此只有错误能通过，运行正常的服务器不写任何日志。提高级别只需配置里的一行；完全不想改配置时，也可以用 `RUST_LOG` 环境变量。

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

一个全局级别往往不够用。`[log.targets]` 在它之上单独调高或调低各个目标，于是 PHP 的诊断信息可以跑在 `debug`，而 HTTP 那一层的内部细节不会跟着一起上来：

```toml
[log]
level = "error"

[log.targets]
php = "debug"
pingora_core = "warn"
```

每个键点名一个目标，只调它一个的高低，其余照旧跟着 `level` 走。键**按前缀**匹配，所以 `php` 连 `php_sys` 和 `php_sys::callbacks` 一起管住了——最短的匹配前缀就够了，子模块从来不必逐个列出。

Rapira 自己用的目标有这些：

| 目标     | 覆盖范围                                             |
| -------- | ---------------------------------------------------- |
| `rapira` | 服务器生命周期：启动、worker 生命周期、关闭          |
| `master` | 监管：fork、回收、重新拉起、重载、进程池伸缩         |
| `http`   | HTTP 接入层：监听器、请求和响应的字段处理、排空      |
| `ext`    | 扩展任务的执行结果                                   |
| `php`    | 来自 PHP 本身的输出和诊断信息                        |
| `app`    | 应用通过 `\Rapira\log()` 写入的记录                  |

没有访问日志：Rapira 不会为每个请求写一行。`http` 目标就请求和响应字段报告哪些内容，见 [HTTP](/zh/docs/http) 那一页。

依赖库以自己的模块路径作为目标——`pingora_core`、`tokio` 等等——过滤方式完全一样。每条记录都带着自己的目标名，把这个名字抄进 `[log.targets]` 就能压下吵闹的依赖。

::: tip
想弄明白进程池为什么是眼下这个样子，就盯着 `master` 这个目标看——重新拉起、重载、进程池伸缩，都会记在那里。这些事件各自意味着什么，见[进程模型](/zh/docs/process-model)。
:::

## PHP 诊断信息

PHP 报出来的一切都落在 `php` 目标上，每条诊断信息的级别取自它的错误类型——于是控制服务器的那套过滤规则，同时也决定了 PHP 有多少输出会进日志：

| 诊断信息                                                                                        | 级别    |
| ----------------------------------------------------------------------------------------------- | ------- |
| 致命错误——`E_ERROR`、`E_PARSE`、`E_CORE_ERROR`、`E_COMPILE_ERROR`、`E_USER_ERROR`、`E_RECOVERABLE_ERROR` | `error` |
| 警告——`E_WARNING`、`E_CORE_WARNING`、`E_COMPILE_WARNING`、`E_USER_WARNING`                     | `warn`  |
| 提示——`E_NOTICE`、`E_USER_NOTICE`                                                              | `info`  |
| 弃用提醒——`E_DEPRECATED`、`E_USER_DEPRECATED`                                                  | `debug` |

弃用提醒落在 `debug`，是为了让 vendor 里躺着几千条弃用提醒的代码库，不至于把同时报出来的警告和错误埋掉。

被脚本的 [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) 掩码挡掉的诊断信息不会凭空消失——它掉到 `trace`。所以常见的那套掩码，效果和你预期的一致：

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

这样一来，日常任何级别下 vendor 的弃用提醒都进不了日志；等你想知道究竟屏蔽掉了什么，`level = "trace"` 又能把它们全找回来。这里有两个例外。致命错误**绝不**降级，掩码怎么写都一样，因为 worker 为什么被回收只有它们说得清——vendor 目录里的 `error_reporting(0)` 藏不住它们。`E_CORE_ERROR`/`E_CORE_WARNING` 在脚本还来不及设掩码之前就已经抛出，任何掩码对它们同样无效。

::: info
诊断信息进日志，不进响应：Rapira 把 [`display_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.display-errors) 默认设为 `0`，[`log_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.log-errors) 默认设为 `1`。这些只是*默认值*，不是强制覆盖：php.ini 里写了其中哪一项，就以 php.ini 为准。
:::

## 应用自己的日志

`\Rapira\log()` 从 PHP 往 `app` 目标写一条记录。它接受一条消息、一个可选的级别和一个可选的上下文数组，在所有执行模式下都可用：

```php
<?php

\Rapira\log('order placed');
\Rapira\log('payment declined', \Rapira\LogLevel::Warning);
\Rapira\log('cache miss', \Rapira\LogLevel::Debug, ['key' => 'user:42', 'ttl' => 300]);
```

级别是 `\Rapira\LogLevel` 枚举的一个成员，每个成员都对应到日志其余部分已经在用的那个级别：

| `LogLevel` 成员 | 记录级别 |
| --------------- | -------- |
| `Error`         | `error`      |
| `Warning`       | `warn`       |
| `Info`          | `info`       |
| `Debug`         | `debug`      |
| `Trace`         | `trace`      |

省略该参数时按 `Info` 记录。因为用的是和别处一样的级别，`[log.targets]` 和 `RUST_LOG` 过滤应用记录的方式，和过滤服务器自己的记录完全一致——在 `[log.targets]` 里写 `app = "debug"` 就能只把应用的记录调高，周围什么都不动。

上下文数组会被序列化成 JSON，作为 `context` 字段挂在记录上。键按写下的样子保留，嵌套数组保持原有结构：

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

上下文里的 `Throwable` 会在序列化前展开，因为 `json_encode()` 看到的异常是一个空对象——它的状态存在 `Exception` 和 `Error` 的私有属性里。展开后带上类名、消息、代码、文件和行号，并沿 `previous` 链继续；调用栈不包含在内：

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

决定往上下文里放什么时，有两个限制值得知道。JSON 表达不了的值——资源、闭包、`NAN` 或 `INF`、不是合法 UTF-8 的字符串——会被替换成占位符，而不是让你整条记录都没了，所以周围的键照样到达。另外上下文的大小没有上限：大数组或长字符串会被完整序列化，记录也就相应地大，所以请传标识符，而不是它们指向的对象。

## 格式

两种格式都写到 stderr，一条记录一次写入。正是这条“一次写完”的规则，让一个 master 加十几个 worker 往同一个文件描述符里写时，不会在记录中间互相串行——每条记录整条写出去，而不是一片片拼起来。

Rapira 不往别处写，所以把进程的 stderr 重定向出去，日志就落到文件里，而服务管理器不需要任何配置就能收好它。更多内容见[生产环境部署](/zh/docs/deployment)。

**`plain`** 用于在终端里阅读——时间戳、级别、目标、消息：

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

stderr 是终端时它带颜色，重定向到文件时绝不带，所以收集下来的日志里不会混进转义序列。把 [`NO_COLOR`](https://no-color.org/) 设成任意非空值，即便在终端里颜色也会关掉。

**`json`** 用于日志收集器——一行一个对象：

```text
{"timestamp":…,"level":"ERROR","message":…,"target":…}
```

`timestamp` 是精确到毫秒的 RFC 3339 UTC 时间。消息里的换行会被转义，所以一条记录永远正好一行，多行的 PHP 调用栈也不例外。来自内置代理引擎的记录还会多带几个 `log.*` 调用方字段。JSON 输出永远不带颜色，在不在终端里都一样。

## `RUST_LOG`

`RUST_LOG` 从环境变量设定日志过滤规则，一次性的调试因此不用改配置文件：

```sh
RUST_LOG=info rapira serve worker.php
RUST_LOG=rapira=debug,php=info rapira serve worker.php
RUST_LOG=warn,rapira=trace rapira serve worker.php
```

第一条把所有东西都调到 `info`。第二条是有针对性的一对——`rapira` 目标开到 `debug`，PHP 开到 `info`。第三条把依赖库压到 `warn`，同时把 Rapira 的 `rapira` 目标——启动、worker 生命周期、关闭——拉到 `trace`。其他目标同样按各自的名字匹配，问题出在别处就把它们加上：`RUST_LOG=warn,rapira=trace,master=trace`。

::: warning
`RUST_LOG` 一旦设成非空值，就会把 `level` 和 `[log.targets]` 整个**替换**掉——换掉的是整套过滤规则，不是两边合并。你写的 `[log.targets]` 不会垫在它下面继续生效，而是压根不会被读取。想回到配置文件，把这个变量取消设置（或者留空）即可。它从不影响 `format`。
:::
