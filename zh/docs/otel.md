---
title: OpenTelemetry
description: "原生追踪、日志、指标、OTLP 导出和 PHP 追踪上下文。"
---

# OpenTelemetry

`otel` 插件通过 HTTP/protobuf 传输 OTLP，导出原生追踪、日志和指标。`http` 插件管理 PHP worker 进程池。`otel` 插件管理一个导出器进程。

## 启用遥测

将以下部分添加到 `rapira.toml`：

```toml
[otel]
enabled = true
endpoint = "http://localhost:4318"
service_name = "rapira"
sample_ratio = 1.0
```

`enabled` 默认为 `false`。禁用遥测时，PHP 追踪上下文 API 返回空数组。Rapira 从 TOML 读取遥测设置，不读取 `OTEL_*` 环境变量。PHP SDK 的配置相互独立。

根包的 Cargo feature `otel` 默认启用。crate 名为 `otel`，位于 `crates/plugins/otel`。要构建不含 SDK 和导出器的程序，请使用：

```sh
cargo build --release --no-default-features
```

此二进制文件拒绝 `[otel].enabled = true`。所有默认值和验证规则请参阅[配置](./configuration#otel)。

Endpoint 是 HTTP 或 HTTPS 基础 URL。Rapira 在路径前缀后追加 `/v1/traces`、`/v1/logs` 或 `/v1/metrics`。例如，`https://collector.example/tenant` 将追踪发送到 `https://collector.example/tenant/v1/traces`。

## 进程与数据传输

master 监管一个通过 `exec` 启动的子进程。该导出器批量处理记录、重试请求并发送 OTLP。单线程 master 不运行网络导出器或 SDK 后台线程。

worker 通过非阻塞本地 Unix 流将记录直接发送到导出器。master 记录也使用同一个导出器。缓冲区有容量限制，在过载或导出器不可用时丢弃记录。请求执行不等待导出。每条编码后的 IPC 记录小于 1 MiB。

- worker 崩溃后，导出器已接收的完整记录仍保留在导出器中。
- 未提交的记录和未完成的 span 随 worker 一起丢失。
- 导出器将队列保存在内存中，不使用持久化存储。
- 导出器崩溃会丢失其队列中的记录。master 会替换导出器，数据发送端会重新连接。
- 正常关闭会在 `export_timeout_secs` 内发送待处理记录。
- 进程故障记录包含 `worker_pid`、`pool`，以及 `exit_code` 或 `signal`。

Rapira 不捕获请求快照，也不从共享内存重建追踪。master 不追踪 PHP 活动。

## 追踪上下文与采样

Rapira 根据 W3C `traceparent` 和 `tracestate` 请求头继续上游追踪。父上下文缺失或无效时，会开始新的追踪。Rapira 合并重复的 `tracestate` 字段。原生操作获得新的本地 span ID。PHP 接收原生 `php.execute` span 的上下文。

`sample_ratio` 控制根追踪的采样。ParentBased 采样器遵循传入的 sampled 或 unsampled 状态，仅对没有父上下文的追踪使用 `sample_ratio`。`traces`、`logs` 和 `metrics` 是相互独立的导出开关。设置 `traces = false` 时，Rapira 仍传递上下文。

::: info SDK 限制
Rust `opentelemetry` 0.32 SDK 会拒绝系统 ID 恰好为 14 个字符的有效 multi-tenant `tracestate` 键，例如 `tenant@abcdefghijklmn`。这会丢弃整个 `tracestate`。追踪 ID 和 sampled 标志仍会传递。请参阅 [SDK 验证源码](https://docs.rs/opentelemetry/0.32.0/src/opentelemetry/trace/span_context.rs.html)和 [W3C 键语法](https://www.w3.org/TR/trace-context/#key)。
:::

## 原生信号

原生 span 覆盖启动、请求接纳、中间件、请求体收集、multipart 解析、`queue.wait` 和 `php.execute`。它们还覆盖响应流式发送、sendfile、排空和 worker 关闭。

| 指标 | 类型与单位 | 属性 |
| --- | --- | --- |
| `http.server.request.duration` | 直方图，秒（`s`） | `http.request.method`、`http.response.status_code` |
| `rapira.operation.duration` | 直方图，秒（`s`） | `rapira.operation` |
| `rapira.otel.dropped_records` | 计数器，记录数 | 无 |

请求和原生操作完成后会触发累积指标快照。OTLP 资源包含 `service.name`、`process.pid` 和 `rapira.role`。每个进程还有一个稳定的随机 `service.instance.id`。worker 资源还包含 `rapira.pool`。

日志记录与当前原生 span 关联。`[log]` 和 `RUST_LOG` 仅控制 stderr 过滤。OTLP 使用自己的信号开关。低于 stderr 日志级别的原生 span 仍然有效。

导出器和内部 SDK 诊断保留在 stderr 中，不会再次进入 OTLP。所有进程使用相同的 stderr 过滤器和格式设置。请参阅[日志](./logging)。

## PHP 应用 span

Rapira 提供两个类型为 `array<string, string>` 的上下文载体：

- `Rapira\Http\Request::$traceContext` 保存原生载体。`Request` 是 `final readonly` 类，其公开构造函数的最后一个参数是 `array $traceContext`。
- 宿主创建的请求对象捕获自己的载体。延迟创建或保留请求对象时，仍保存该请求的上下文。
- `Rapira\trace_context(): array` 返回当前 Worker 回调或 Dispatcher exchange 的载体。没有活动工作时返回空数组。

Worker 模式在每个任务的关闭和资源清理期间保留原生作用域。Dispatcher 作用域在 exchange 完成时结束。PHP 执行期间，Rust 保留请求上下文。PHP 不向 Rust 返回 span ID。

PHP 管理自己的子 span、上下文激活、SDK、采样、刷新和导出器。Rapira 不自动对 PHP 代码或其 Fiber 调度器进行插桩。并发 Fiber 请使用 [PHP SDK 上下文支持](https://opentelemetry.io/docs/languages/php/context/#context-in-asynchronous-environments)。

### Dispatcher 示例

运行本示例前，请配置 PHP SDK。将配置放入 `instrumentation.php`。请按照官方 [SDK 配置](https://opentelemetry.io/docs/languages/php/instrumentation/#initialize-the-sdk)和[导出器指南](https://opentelemetry.io/docs/languages/php/exporters/)操作。在请求循环前注册追踪提供器。为应用配置 PHP 采样和刷新。

此示例为每个请求提取父上下文，并创建 PHP 子 span。它使用标准 [PHP 上下文传播 API](https://opentelemetry.io/docs/languages/php/propagation/#manual-context-propagation)。

```php
<?php

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\Context\Context;
use Rapira\Exception\ClosedException;

require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/instrumentation.php';

$tracer = Globals::tracerProvider()->getTracer('app');
$dispatcher = \Rapira\get_dispatcher();

while (true) {
    try {
        $exchange = $dispatcher->receive();
    } catch (ClosedException) {
        break;
    }

    $request = $exchange->getRequest();
    $parent = TraceContextPropagator::getInstance()->extract($request->traceContext, null, Context::getRoot());
    $span = $tracer->spanBuilder('app.handle')->setParent($parent)->startSpan();
    $scope = $span->activate();

    try {
        $exchange->writeHead(200, ['content-type' => ['text/plain']]);
        $exchange->writeBody("Hello\n");
    } finally {
        $scope->detach();
        $span->end();
    }
}
```

为每个请求提取上下文。为该请求激活上下文。在 `finally` 中分离作用域。在同一代码块中结束 span。仅在 worker 启动时设置一次进程全局父上下文，无法标识后续请求。

### Worker 载体

在 `Rapira\handle_request()` 回调中，使用以下父上下文提取方式，并使用相同的子 span 和 `finally` 模式：

```php
$parent = TraceContextPropagator::getInstance()->extract(\Rapira\trace_context(), null, Context::getRoot());
```

在此回调中使用 `header()` 和 `echo` 等 Worker 响应函数。循环请参阅 [Worker 模式](./worker)。
