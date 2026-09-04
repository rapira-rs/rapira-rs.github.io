---
title: 日志
description: "Rapira 怎么记日志--级别、按目标单独覆盖、PHP 诊断信息、应用自己的日志、plain 与 json 两种格式，以及调试用的 RUST_LOG 覆盖开关。"
---

# 日志

Rapira 将所有日志记录写入 stderr。这些记录包括服务器事件、主进程决策、HTTP 事件、PHP 诊断和应用消息。
默认情况下，PHP 警告使用此日志，而不是单独的 `error_log` 目标。所有记录使用相同的级别过滤器。

默认级别为 `error`，因此服务器只写入错误。更改配置或设置 `RUST_LOG` 以选择其他级别。

## 级别与格式

`rapira.toml` 的 `[log]` 部分控制日志：

```toml
[log]
level = "error"   # Use error, warn, info, debug, or trace. Default: error.
format = "plain"  # Use plain or json. Default: plain.
```

`level` 设置所有目标的最低级别。`error` 仅显示错误，后续每个级别会添加更多记录。
`trace` 显示所有记录。`format` 选择可读文本或每行一个 JSON 对象。

两个键和整个部分都是可选的。其他文件部分请参阅[配置](/zh/docs/configuration)。

## 按目标单独覆盖

`[log.targets]` 为单个目标替换全局级别。例如，它可以启用 PHP 调试而不启用 HTTP 调试：

```toml
[log]
level = "error"

[log.targets]
php = "debug"
http = "warn"
```

每个键指定一个目标。其他目标使用 `level`。
键**按前缀**匹配，因此 `php` 也匹配 `php_sys` 和 `php_sys::callbacks`。无需列出子模块。

Rapira 自己用的目标有这些：

| 目标     | 覆盖范围                                             |
| -------- | ---------------------------------------------------- |
| `rapira` | 服务器生命周期：启动、worker 生命周期、关闭          |
| `master` | 监管：fork、回收、重新拉起、重载、进程池伸缩         |
| `http`   | HTTP 接入层：监听器、请求和响应的字段处理、排空      |
| `ext`    | 扩展任务的执行结果                                   |
| `php`    | 来自 PHP 本身的输出和诊断信息                        |
| `app`    | 应用通过 `\Rapira\log()` 写入的记录                  |

Rapira 不为每个请求写入单独的访问日志。`http` 目标记录请参阅 [HTTP](/zh/docs/http)。

依赖项在其模块路径下写入跟踪记录。相同的前缀过滤器适用于这些记录。
每条记录包含目标名称。将该名称添加到 `[log.targets]` 以减少输出。

::: tip
`master` 目标包含 worker 替换、重载和进程池伸缩记录。请参阅[进程模型](/zh/docs/process-model)。
:::

## PHP 诊断信息

Rapira 将 PHP 诊断映射到 `php` 目标。错误类型决定日志级别：

| 诊断信息                                                                                        | 级别    |
| ----------------------------------------------------------------------------------------------- | ------- |
| 致命错误--`E_ERROR`、`E_PARSE`、`E_CORE_ERROR`、`E_COMPILE_ERROR`、`E_USER_ERROR`、`E_RECOVERABLE_ERROR` | `error` |
| 警告--`E_WARNING`、`E_CORE_WARNING`、`E_COMPILE_WARNING`、`E_USER_WARNING`                     | `warn`  |
| 提示--`E_NOTICE`、`E_USER_NOTICE`                                                              | `info`  |
| 弃用提醒--`E_DEPRECATED`、`E_USER_DEPRECATED`                                                  | `debug` |

弃用消息使用 `debug`。因此，大量依赖项消息不会隐藏警告和错误。

被 [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) 排除的诊断会变为 `trace`。例如：

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

此掩码在常规级别排除依赖项弃用消息。设置 `level = "trace"` 以包含这些消息。
致命错误不会降低级别，因为它们说明 worker 终止原因。因此，`error_reporting(0)` 无法隐藏它们。
PHP 在脚本设置掩码前生成 `E_CORE_ERROR` 和 `E_CORE_WARNING`。掩码不适用于这些消息。

::: info
Rapira 将诊断发送到日志，而不是响应。默认值为 `display_errors = 0` 和 `log_errors = 1`。
`php.ini` 中的值会替换这些默认值。
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

省略 `level` 时，`\Rapira\log()` 使用 `Info`。除非更改过滤器，否则全局 `error` 过滤器会丢弃此记录。
`[log.targets]` 和 `RUST_LOG` 以相同方式过滤应用和服务器记录。
例如，`app = "debug"` 仅更改应用目标。

Rapira 将上下文数组序列化为 JSON，并将其添加为 `context` 字段。在 JSON 中，此字段位于 `fields` 内。
键名和嵌套数组结构保持不变：

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

Rapira 在序列化前展开 `Throwable`，因为 `json_encode()` 会返回空对象。
结果包含类、消息、代码、文件、行号和 `previous` 链。它不包含调用栈：

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

`\Rapira\log()` 不抛出异常。如果 `jsonSerialize()` 抛出异常，Rapira 为该值写入 `null`。
其他键保持不变。

Rapira 替换 JSON 无法表示的值。这些值包括资源、闭包、`NAN`、`INF` 和无效 UTF-8 字符串。
其他字段保持不变。Rapira 不限制上下文大小。
请传递标识符，而不是大型对象。

## 格式

Rapira 将两种格式都写入 stderr。不同进程向同一个 stderr 管道写入时，大型记录可能会交错。

Rapira 不会将日志写入其他位置。重定向 stderr 可以将日志写入文件。
服务管理器可以收集 stderr。请参阅[生产环境部署](/zh/docs/deployment)。

**`plain`** 用于在终端里阅读--时间戳、级别、目标、消息：

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

stderr 是终端时，Rapira 使用颜色。stderr 是文件时，Rapira 不使用颜色。
将 [`NO_COLOR`](https://no-color.org/) 设置为非空值，以禁用终端颜色。

**`json`** 用于日志收集器--一行一个对象：

```text
{"timestamp":…,"level":"ERROR","fields":{"message":…},"target":…}
```

`timestamp` 使用带毫秒的 RFC 3339 UTC。`fields` 对象包含消息和其他记录字段。
Rapira 会转义消息中的换行符。因此，每条记录仅使用一行。
JSON 输出不使用颜色。

## `RUST_LOG`

`RUST_LOG` 从环境设置日志过滤器。它可以在不编辑配置的情况下更改过滤器：

```sh
RUST_LOG=info rapira serve --mode worker worker.php
RUST_LOG=rapira=debug,php=info rapira serve --mode worker worker.php
RUST_LOG=warn,rapira=trace rapira serve --mode worker worker.php
```

第一个命令将所有目标设置为 `info`。第二个命令将 `rapira` 设置为 `debug`，将 `php` 设置为 `info`。
第三个命令将所有目标设置为 `warn`，将 `rapira` 设置为 `trace`。`rapira` 目标包含初始化、worker 和关闭记录。
需要 master 记录时，请使用 `RUST_LOG=warn,rapira=trace,master=trace`。

::: warning
非空 `RUST_LOG` 会**替换** `level` 和 `[log.targets]`。Rapira 不会合并环境和文件过滤器。
删除变量或将其设置为空值以使用配置文件。`RUST_LOG` 不影响 `format`。
:::
