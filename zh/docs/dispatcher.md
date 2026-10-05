---
title: Dispatcher 模式
description: "Rapira HTTP dispatcher 循环、Request 和 Exchange API、上传、sendFile() 以及 dispatcher 异常。"
faqLevel: 2
---

# Dispatcher 模式

Dispatcher 模式与 [Worker 模式](/zh/docs/worker)一样，使 PHP 进程在请求之间保持活动。脚本初始化应用一次，然后通过 API 调用取得每个请求。Rapira 不为请求填充超全局变量。脚本读取请求对象，并通过方法调用写入响应。

本页是 HTTP dispatcher 的编程指南。要比较各模式，请参阅[执行模式](/zh/docs/execution-modes)。gRPC 进程池也使用 Dispatcher 模式。gRPC 调用 API 请参阅 [gRPC](/zh/docs/grpc)。

## 接收循环

dispatcher 脚本包含三个部分。第一部分初始化应用。第二部分取得 dispatcher。第三部分在循环中接收请求，直到 Rapira 关闭 dispatcher。

```php
<?php
// worker.php
use Rapira\Exception\ClosedException;
use Rapira\Exception\WorkDiscardedException;
use Rapira\LogLevel;

require __DIR__ . '/vendor/autoload.php';

$app = new App(); // The worker creates this object once and reuses it.
$dispatcher = \Rapira\get_dispatcher();

while (true) {
    try {
        $exchange = $dispatcher->receive();
    } catch (ClosedException) {
        break; // No more requests arrive for this worker.
    }

    try {
        $body = $app->handle($exchange->getRequest());
        $exchange->writeHead(200, ['content-type' => ['text/plain']]);
        $exchange->writeBody($body); // $eos is true by default, so this call ends the response.
    } catch (WorkDiscardedException) {
        // The client left before the response ended.
    } catch (\Throwable $e) {
        \Rapira\log('request failed', LogLevel::Error, ['exception' => $e]);
    }

    unset($exchange); // If the response did not end, Rapira sends 500 or cuts the response.
}
```

Dispatcher 是默认模式。在 `rapira.toml` 的 `[http.pool]` 表中显式设置它：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/worker.php"
mode = "dispatcher"
```

```bash
rapira serve rapira.toml
```

进程池的其他键请参阅[配置](/zh/docs/configuration#http-pool)。

## 接收请求

在 HTTP worker 中，`\Rapira\get_dispatcher()` 返回 `Rapira\Http\HttpDispatcher`。在 Classic 和 Worker 模式下，它抛出 `Rapira\Exception\NoDispatcherError`。脚本支持多个模式时，请使用 `\Rapira\get_mode()` 检查模式。

| 方法 | 行为 |
| --- | --- |
| `receive(int $timeout = -1): Exchange` | 等待下一个请求。等待时限以微秒为单位。`-1` 表示无限等待，`0` 表示不等待。到达时限时，它抛出 `Rapira\Exception\TimeoutException`。 |
| `tryReceive(): ?Exchange` | 返回下一个请求；没有等待中的请求时返回 `null`。它不等待。 |
| `getInfo(): HttpDispatcherInfo` | 返回 `pendingCount()` 和 `activeCount()`。`pendingCount()` 是此 worker 队列中的请求数，`activeCount()` 为 `0` 或 `1`。 |
| `name(): string` | 返回 `http`。 |

`receive()` 在等待期间阻塞 PHP 线程。等待期间，worker 不使用 CPU。PHP 的 `max_execution_time` 计时器不计算此等待，并为每个请求重新开始计时。如果客户端在请求到达 PHP 之前离开，Rapira 跳过该排队的请求。

## 一次一个 exchange

每个 worker 一次处理一个 exchange。在再次调用 `receive()` 或 `tryReceive()` 之前，请结束当前 exchange 的响应。否则，该调用抛出 `\Error`。Fiber 不改变此规则。要同时处理更多请求，请增大 `http.pool.processes`。

以下调用结束响应：

- `$eos = true`（默认值）时的 `writeBody()` 或 `sendFile()`。
- `writeTrailers()`。

当 Rapira 检测到打开的 exchange 已取消时，`receive()` 和 `tryReceive()` 会先丢弃它，再接收更多工作。此时它们不会抛出 exchange 仍打开的 `\Error`。当代码删除打开的 exchange 的最后一个引用时，例如使用 `unset($exchange)`，Rapira 结束响应。如果头部尚未发送，Rapira 发送状态 `500` 和空的响应体。如果头部已经发送，Rapira 截断响应。

使用 `$eos = false` 发送 `Content-Length` 声明的全部字节不会终结 exchange。请在下次接收调用前终结它。完整响应交付后关闭连接不会取消 exchange。PHP 仍可终结它。完整交付前断开连接可能会取消它。

`http.pool.request_terminate_timeout_secs` 从 `receive()` 或 `tryReceive()` 返回时开始计时。worker 超过此时限时，Rapira 终止并替换该 worker。此键请参阅[配置](/zh/docs/configuration#http-pool)。

## 循环如何结束

在停止、重载或达到 `http.pool.max_requests` 后的替换期间，Rapira 关闭 dispatcher。dispatcher 已关闭且队列为空时，`receive()` 和 `tryReceive()` 抛出 `Rapira\Exception\ClosedException`。之后的每次调用都再次抛出它。请捕获此异常，退出循环，并让入口脚本结束。

未捕获的异常或致命错误会结束入口脚本。然后 Rapira 在同一个 worker 中再次运行入口脚本。打开的 exchange 的客户端收到错误响应或不完整的响应。

::: question 入口脚本在 `ClosedException` 之前结束时会发生什么？
如果脚本至少接收了一个请求，Rapira 在同一个 worker 中再次运行入口脚本。如果脚本在接收请求之前结束，Rapira 记为一次启动失败。如果在五秒内有请求到达，Rapira 用 `503` 回答该请求。然后 Rapira 再次运行脚本。连续五次启动失败后，worker 以不健康状态退出。
:::

## 请求

`$exchange->getRequest()` 返回只读的 `Rapira\Http\Request`。每次调用都返回同一个对象。

| 属性 | 类型 | 值 |
| --- | --- | --- |
| `method` | `string` | 请求方法，例如 `GET`。 |
| `uri` | `string` | 绝对 URI，例如 `http://example.com/a?b=1`。scheme 总是 `http`。没有 authority 时，Rapira 使用服务器地址。 |
| `target` | `string` | 请求目标。对于 origin-form 请求，它是路径和查询，例如 `/a?b=1`。 |
| `authority` | `?string` | `Host` 的值。对于没有 `Host` 的 HTTP/1.0 请求，它为 `null`。 |
| `protocol` | `string` | `HTTP/1.1` 或 `HTTP/1.0`。 |
| `headers` | `array<string, list<string>>` | 请求字段。名称为小写。每个名称对应一个值列表。 |
| `body` | `string` 或 `Multipart` | 完整的请求体；对于 `multipart/form-data` 请求体，是 `Rapira\Http\Multipart`。 |
| `remote` | `InetAddress` 或 `UnixAddress` | 客户端地址。`Rapira\InetAddress` 有 `ip` 和 `port`。`Rapira\UnixAddress` 有 `path`。 |
| `server` | `InetAddress` 或 `UnixAddress` | 监听器地址。 |
| `tls` | `?Rapira\Tls` | 总是 `null`。Rapira 没有 TLS 监听器。 |
| `receivedAt` | `float` | Rapira 收到请求时的 Unix 时间，以秒为单位。 |

在 PHP 取得请求之前，Rapira 将完整的请求体读入内存。`http.max_body_size_mb` 限制请求体大小。请求检查请参阅 [HTTP](/zh/docs/http)。

在 Dispatcher 模式下，`$_SERVER` 保留入口脚本启动时的值。Rapira 不为每个请求更改它。请参阅[第一个请求之前的 `$_SERVER`](/zh/docs/execution-modes#第一个请求之前的-server)。

## 响应

`Rapira\Http\Exchange` 有以下方法。`$headers` 和 `$trailers` 使用 `array<string, list<string>>` 结构：每个字段名称对应一个值列表。

| 方法 | 行为 |
| --- | --- |
| `writeHead(int $status, array $headers = []): void` | 设置状态和字段。状态必须在 100 到 599 之间。Rapira 不转发 `1xx` 头部。状态 `101` 使客户端收到 `502`。Rapira 在第一次写入响应体、`flush()` 或 `writeTrailers()` 时发送头部。 |
| `writeBody(string $content, bool $eos = true): void` | 写入响应体数据。没有 `writeHead()` 时，状态为 `200`。将 `$eos` 设为 `false` 可以稍后写入更多数据。 |
| `sendFile(string $path, int $offset = 0, ?int $length = null, bool $eos = true): void` | 将文件或文件的一部分作为响应体数据发送。请参阅[发送文件](#发送文件)。 |
| `writeTrailers(array $trailers): void` | 结束响应。在 `writeHead()` 或写入响应体之后调用它。Rapira 不将尾部字段发送给客户端。 |
| `flush(): void` | 立即发送头部。没有 `writeHead()` 时，状态为 `200`。 |
| `isFinalized(): bool` | exchange 已终结或 Rapira 检测到其取消时返回 `true`。 |
| `isCancelled(): bool` | Rapira 检测到 exchange 取消时返回 `true`。完整响应交付后关闭连接不会取消它。 |

知道响应体大小时，请在 `writeHead()` 中设置 `content-length`。超过此长度的写入会发送能容纳的部分，结束响应，并抛出 `ContentLengthExceededError`。没有 `content-length` 时，HTTP 服务器对响应体分帧。分帧规则和 Rapira 删除的字段请参阅[响应传输](/zh/docs/http#响应传输)。

要流式发送响应，请对每个部分调用 `writeBody()` 并设置 `$eos = false`。然后调用 `writeBody('')` 结束响应。

请将每个 `writeBody()` 数据块限制为不超过 1 GiB。更大的数据块会抛出 `\Error`，并以截断状态结束响应。此限制适用于每个数据块，而非整个流式响应。

慢速客户端可能填满响应通道。此时写入会阻塞 PHP 线程，直到通道有可用空间或关闭。这会阻塞该 worker 中的所有 PHP Fiber。

## 上传

在 PHP 取得请求之前，Rapira 解析 `multipart/form-data` 请求体。此时 `Request::$body` 是 `Rapira\Http\Multipart`：

| 类 | 属性 |
| --- | --- |
| `Multipart` | `fields`，`FormField` 的列表。`files`，`UploadedFile` 的列表。 |
| `FormField` | `name`、`value`、`headers`。 |
| `UploadedFile` | `name`、`clientFilename`、`clientMediaType`、`headers`、`tmpPath`、`size`。 |

Rapira 将每个文件部分写入 `http.uploads.dir` 的 `rapira-spool-<pid>` 子目录中的临时文件。`UploadedFile::$tmpPath` 包含此文件的路径。响应结束时，Rapira 删除临时文件。要保留文件，请在响应结束前用 `rename()` 移动它。

对于格式错误的请求体，Rapira 返回 `400`。请求体超过限制时，它返回 `413`。脚本不会收到这些请求。限制请参阅[`[http.uploads]` 表](/zh/docs/configuration#http-uploads-表)。

## 发送文件

`sendFile()` 只读取 sendfile 根目录下的文件。默认根目录是 `http.pool.entrypoint` 所在的目录。Rapira 先解析符号链接，再将路径与根目录比较。要设置根目录，请参阅[`[http.sendfile]` 表](/zh/docs/configuration#http-sendfile-表)。

文件由宿主打开。PHP `open_basedir` 不限制此操作。配置的 sendfile 根目录限制文件路径。

在以下情况下，该调用抛出 `Rapira\Http\Exception\FileNotSendableException`，并且不写入数据：

- 路径在根目录之外。
- 文件不存在，或不是普通文件。
- 偏移量或长度超过文件末尾。

Rapira 不为文件设置 `content-type`、`etag` 或范围字段。请用 `writeHead()` 设置需要的字段。

```php
$exchange->writeHead(200, ['content-type' => ['application/pdf']]);
$exchange->sendFile(__DIR__ . '/files/report.pdf');
```

请将 `report.pdf` 放在入口脚本旁的 `files/` 目录中。此路径位于默认根目录内。自定义根目录也必须包含该文件。

## 异常

`Rapira` 命名空间中的每个异常类都实现 `Rapira\Exception\RapiraThrowable`。普通的 `\Error` 和 `\ValueError` 不实现它。

| 异常 | 抛出者 | 原因 |
| --- | --- | --- |
| `Rapira\Exception\ClosedException` | `receive()`、`tryReceive()` | Rapira 关闭了 dispatcher。不会再有请求到达。 |
| `Rapira\Exception\TimeoutException` | `receive()` | 在等待时限之前没有请求到达。 |
| `Rapira\Exception\NoDispatcherError` | `\Rapira\get_dispatcher()` | 进程不在 Dispatcher 模式下运行。 |
| `Rapira\Exception\WorkDiscardedException` | 写入方法 | Rapira 在 PHP 终结 exchange 前取消了它。 |
| `Rapira\Exception\AlreadyFinalizedError` | `writeBody()`、`sendFile()`、`writeTrailers()`、`flush()` | 响应已经结束。 |
| `Rapira\Http\Exception\HeadAlreadyWrittenError` | `writeHead()` | 头部已经设置，或响应已经结束。 |
| `Rapira\Http\Exception\HeadNotWrittenError` | `writeTrailers()` | 还没有头部，也没有响应体数据。 |
| `Rapira\Http\Exception\ContentLengthExceededError` | `writeBody()`、`sendFile()` | 写入超过了声明的 `content-length`。 |
| `Rapira\Http\Exception\FileNotSendableException` | `sendFile()` | Rapira 无法发送该文件。 |
| `\Error` | `receive()`、`tryReceive()` | 上一个 exchange 仍然打开。 |
| `\Error` | `writeBody()` | 一个数据块超过 1 GiB。Rapira 以截断状态结束响应。 |
| `\Error` | `rapira_finish_request()` | 此函数在 Dispatcher 模式下不可用。请改为结束 exchange。 |
| `\ValueError` | 多个方法 | 参数无效。例如，状态不在 100 到 599 之间，字段在网络上无效，或尾部字段是 `content-type` 等字段。 |

## `echo` 的输出

在 Dispatcher 模式下，`echo`、`print` 和其他 PHP 输出不发送给客户端。Rapira 将每次输出调用以 `info` 级别写入 `php` 目标的日志。默认日志级别 `error` 隐藏这些记录。请使用 exchange 的方法写入响应。要显示 `php` 目标，请参阅[日志](/zh/docs/logging#按目标覆盖)。

## IDE 存根

Rapira 在存根文件中声明其 PHP 函数和类。dispatcher 接口和核心函数在 [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php) 中。HTTP 类型和 HTTP 异常类在 [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/plugins/http/rapira_http.stub.php) 中。其他异常类在 [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira_exception.stub.php) 中。将这些文件添加到项目中，以启用 IDE 补全。
