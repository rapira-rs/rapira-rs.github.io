---
title: 日志
description: Rapira 的日志级别、按目标覆盖、PHP 诊断信息、应用记录、格式，以及 RUST_LOG 覆盖。
---

# 日志

Rapira 将日志记录写入 stderr。这些记录包括服务器事件、主进程决策、HTTP 和 gRPC 事件、PHP 诊断信息和应用消息。`error_log` ini 设置为空时，PHP 将诊断信息发送到此日志。该设置默认为空。

默认级别为 `error`，因此 stderr 仅包含错误。更改 `[log]` 部分或设置 `RUST_LOG` 以选择其他级别。

## 级别与格式

`rapira.toml` 的 `[log]` 部分控制 stderr 日志：

```toml
[log]
level = "error"   # Use error, warn, info, debug, or trace. Default: error.
format = "plain"  # Use plain or json. Default: plain.
```

`level` 设置所有目标的最低级别。`error` 仅显示错误，后续每个级别会添加更多记录。`trace` 显示所有记录。`format` 选择可读文本行或每行一个 JSON 对象。

两个键和整个部分都是可选的。配置文件的其他部分请参阅[配置](/zh/docs/configuration)。

## 按目标覆盖

`[log.targets]` 为单个目标覆盖全局级别。例如，它可以启用 PHP 调试记录，并保持 HTTP 调试记录禁用：

```toml
[log]
level = "error"

[log.targets]
php = "debug"
http = "warn"
```

每个键指定一个目标。其他目标使用 `level`。键**按前缀**匹配，因此 `h2` 也匹配依赖项的 `h2::codec` 和 `h2::proto` 模块路径。无需列出子模块。

Rapira 使用以下目标：

| 目标            | 覆盖范围                                                                     |
| --------------- | ---------------------------------------------------------------------------- |
| `rapira`        | 服务器初始化、worker 生命周期、关闭                                          |
| `master`        | 进程池状态、进程创建错误、重载就绪警告和请求超时警告                              |
| `http`          | HTTP 监听器、请求和响应的字段处理、关闭                                      |
| `grpc`          | gRPC 监听器、传输故障、关闭                                                  |
| `net`           | HTTP 和 gRPC 监听器的 accept 循环、accept 失败                               |
| `observability` | [指标与探针进程](/zh/docs/observability)：监听器、请求排空、故障             |
| `php`           | 来自 PHP 本身的输出和诊断信息                                                |
| `app`           | 应用通过 `\Rapira\log()` 写入的记录                                          |

Rapira 不写每个请求一行的访问日志。`http` 目标的字段记录请参阅 [HTTP](/zh/docs/http)。

依赖项在其模块路径下写入 trace 记录。相同的前缀过滤适用于这些记录。每条记录包含其目标名称。将该名称添加到 `[log.targets]` 以更改其级别。

::: tip
`master` 目标报告进程池状态、进程创建错误、重载就绪警告和请求超时警告。进程池监管请参阅[进程模型](/zh/docs/process-model)。
:::

## PHP 诊断信息

Rapira 将 PHP 诊断信息映射到 `php` 目标。每种 PHP 错误类型对应一个日志级别：

| 诊断信息                                                                                        | 级别    |
| ----------------------------------------------------------------------------------------------- | ------- |
| 致命错误：`E_ERROR`、`E_PARSE`、`E_CORE_ERROR`、`E_COMPILE_ERROR`、`E_USER_ERROR`、`E_RECOVERABLE_ERROR` | `error` |
| 警告：`E_WARNING`、`E_CORE_WARNING`、`E_COMPILE_WARNING`、`E_USER_WARNING`                     | `warn`  |
| 提示：`E_NOTICE`、`E_USER_NOTICE`                                                              | `info`  |
| 弃用：`E_DEPRECATED`、`E_USER_DEPRECATED`                                                      | `debug` |

弃用使用 `debug`。因此，依赖项的弃用不会隐藏警告和错误。

当 [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) 排除某条诊断信息时，Rapira 将其级别设为 `trace`。例如：

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

此掩码排除依赖项的弃用。设置 `level = "trace"` 以写入这些记录。

PHP 不写入被掩码排除的诊断信息。在 Worker 和 Dispatcher 模式下，Rapira 在固定时间点写入最后一条 PHP 诊断信息。Worker 模式在启动阶段之后、每个任务之后以及入口脚本结束时这样做。Dispatcher 模式仅在入口脚本结束时这样做。因此，只有当被排除的诊断信息是这些时间点之前的最后一条诊断信息时，Rapira 才写入它。Classic 模式不写入被排除的诊断信息。

致命错误始终保持 `error` 级别，因此 `error_reporting(0)` 无法隐藏它们。掩码也不适用于 `E_CORE_ERROR` 和 `E_CORE_WARNING`，因为 PHP 在脚本设置掩码之前产生它们。

::: info
Rapira 将诊断信息发送到日志，而不是响应。它将 `display_errors` 的默认值设为 `0`，将 `log_errors` 的默认值设为 `1`。`php.ini` 中的值会覆盖这些默认值。
:::

响应之外的 PHP 输出以 `info` 级别进入 `php` 目标。例如，Worker 模式启动阶段中的 `echo` 进入日志。在 [Dispatcher 模式](/zh/docs/dispatcher)下，所有 `echo` 输出都进入日志，因为响应使用 dispatcher API。默认的 `error` 级别隐藏这些记录。在 `[log.targets]` 中设置 `php = "info"` 以显示它们。

::: question 为什么一条 PHP 警告在日志中出现两次？
在 Worker 和 Dispatcher 模式下，Rapira 也写入最后一条 PHP 诊断信息。如果此诊断信息没有被掩码排除，PHP 也会写入它。因此，日志包含两条级别相同、文本格式不同的记录。
:::

## 应用日志

`\Rapira\log()` 向 `app` 目标写入一条记录。它接受一条消息、一个可选的级别和一个可选的上下文数组。此函数在每种执行模式下都可用：

```php
<?php

\Rapira\log('order placed');
\Rapira\log('payment declined', \Rapira\LogLevel::Warning);
\Rapira\log('cache miss', \Rapira\LogLevel::Debug, ['key' => 'user:42', 'ttl' => 300]);
```

级别是 `\Rapira\LogLevel` 枚举的一个 case。每个 case 对应一个 Rapira 日志级别：

| `LogLevel` case | 记录级别 |
| --------------- | -------- |
| `Error`         | `error`  |
| `Warning`       | `warn`   |
| `Info`          | `info`   |
| `Debug`         | `debug`  |
| `Trace`         | `trace`  |

省略 `level` 时，`\Rapira\log()` 使用 `Info`。默认的 `error` 级别隐藏 `Info` 记录。在 `[log.targets]` 中设置 `app = "info"` 以写入它们。

Rapira 将上下文数组编码为 JSON 文本，并将其添加为 `context` 字段。在 JSON 输出中，`fields.context` 是字符串，而不是嵌套对象。JSON 文本保留键名和嵌套数组结构。在日志收集器中解码此字符串以读取这些键：

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

Rapira 展开上下文顶层值中的 `Throwable`。原因是 `json_encode()` 对 `Throwable` 返回空对象。Rapira 不展开嵌套数组中的 `Throwable`，因此它被编码为空对象。展开后的值包含类、消息、代码、文件和行号。它还包含最多四个 `previous` 异常。它不包含调用栈：

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

`\Rapira\log()` 不抛出异常。如果上下文中的 `jsonSerialize()` 调用抛出异常，Rapira 为该值写入 `null`。它保留其他键。

::: question Rapira 如何序列化大型日志上下文？
Rapira 使用 `JSON_PARTIAL_OUTPUT_ON_ERROR` 标志编码上下文。资源或无效的 UTF-8 字符串变为 `null`。`NAN` 和 `INF` 变为 `0`。其他字段保留在记录中。

Rapira 不缩短数组或字符串。请传递标识符，而不是大型对象。
:::

## 格式

Rapira 将两种格式都写入 stderr。不同进程向同一个 stderr 管道写入时，大型记录可能会交错。

重定向 stderr 可以将日志写入文件。服务管理器可以收集 stderr。更多信息请参阅[生产环境部署](/zh/docs/deployment)。

**`plain`** 是可读的终端输出。它包含时间戳、级别、目标和消息：

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

仅当 stderr 是终端时，Rapira 才使用颜色。将 [`NO_COLOR`](https://no-color.org/) 设置为任意非空值以禁用终端颜色。

**`json`** 为日志收集器每行提供一个对象：

```text
{"timestamp":…,"level":"ERROR","fields":{"message":…},"target":…}
```

`timestamp` 使用带微秒的 RFC 3339 UTC。`fields` 对象包含消息和其他记录字段。例如，它可以包含应用的 `context` 字段。Rapira 转义消息中的换行符，例如 PHP 调用栈中的换行符。因此，每条记录正好使用一行。JSON 输出不使用颜色。

## `RUST_LOG`

`RUST_LOG` 从环境设置 stderr 日志过滤器。下面的命令更改过滤器，并保持配置文件不变：

```sh
RUST_LOG=info rapira serve rapira.toml
RUST_LOG=error,rapira=debug,php=info rapira serve rapira.toml
RUST_LOG=warn,rapira=trace,master=trace rapira serve rapira.toml
```

第一个命令将所有目标设置为 `info`。第二个命令将 `rapira` 设置为 `debug`，将 `php` 设置为 `info`，将所有其他目标设置为 `error`。第三个命令将所有目标设置为 `warn`，将 `rapira` 和 `master` 设置为 `trace`。

未被此值匹配的目标不写入任何记录。例如，`RUST_LOG=php=info` 隐藏 `master` 和 `http` 目标的所有错误。添加一个不带目标名称的级别（例如 `error`），以保留其他目标的记录。

::: warning
非空 `RUST_LOG` 值会**替换** `level` 和 `[log.targets]`。Rapira 不合并环境过滤器和文件过滤器。删除此变量以使用配置文件设置。也可以将此变量设置为空值。`RUST_LOG` 不影响 `format`。
:::
