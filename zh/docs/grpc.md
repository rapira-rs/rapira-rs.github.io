---
title: gRPC
description: "通过 PHP dispatcher 提供一元 gRPC、gRPC-Web 和 Connect 调用，并使用 grpcurl 或 curl 调用服务。"
---

# gRPC

Rapira 通过 PHP 处理一元 RPC 调用。一个监听器通过 HTTP/1.1 或明文 HTTP/2，在 TCP 或 Unix 套接字上接受 gRPC、gRPC-Web 和 Connect 调用。一元调用包含一个请求消息和一个响应消息。

gRPC 进程池使用 Dispatcher 模式。Rapira 处理传输，并将二进制 protobuf 消息传给 PHP。每个 PHP worker 一次处理一个调用。不支持流式方法。监听器不终止 TLS。

## 运行回显服务

安装 Rapira。安装 [buf](https://buf.build/docs/installation/) 以构建描述符集，并安装 [grpcurl](https://github.com/fullstorydev/grpcurl#installation) 以运行客户端命令。此示例将请求字节原样返回为响应。它不需要生成的 PHP 类，也不需要 PHP gRPC 扩展。

创建以下目录结构：

```text
app/
├── proto/
│   └── echo.proto
├── grpc.php
└── rapira.toml
```

### 定义服务

将以下模式定义保存为 `proto/echo.proto`：

```protobuf
syntax = "proto3";

package example.v1;

option php_namespace = "Example\\V1";
option php_metadata_namespace = "Example\\Metadata";

service Echo {
  rpc Echo(EchoMessage) returns (EchoMessage);
}

message EchoMessage {
  string text = 1;
}
```

路由为 `/example.v1.Echo/Echo`。PHP 上下文中的方法名为 `example.v1.Echo/Echo`，不含开头的斜杠。

### 构建描述符集

Rapira 从描述符集读取模式定义。描述符集是一个二进制 `google.protobuf.FileDescriptorSet`，包含所有导入的文件。在 `app/` 中构建它：

```sh
buf build proto --as-file-descriptor-set -o api.binpb
```

也可以使用 `protoc` 构建。请添加 `--include_imports`，因为没有此选项时 `protoc` 不包含导入的文件：

```sh
protoc --include_imports --descriptor_set_out=api.binpb -I proto proto/echo.proto
```

Rapira 运行时不需要 `protoc` 可执行文件。

### 编写 PHP dispatcher

将以下脚本保存为 `grpc.php`：

```php
<?php

use Rapira\Exception\ClosedException;
use Rapira\Exception\WorkDiscardedException;

$dispatcher = Rapira\get_dispatcher();

try {
    while (true) {
        $call = $dispatcher->receive();

        try {
            $metadata = $call->getResponseMetadata();
            $metadata->addHeader('x-worker', (string) getmypid());
            $metadata->addTrailer('x-result', 'echoed');
            $call->respond($call->getMessage());
        } catch (WorkDiscardedException) {
            continue;
        }
    }
} catch (ClosedException) {
    return;
}
```

请求和响应使用同一种消息类型，因此 handler 可以直接返回这些字节。`ClosedException` 在关闭期间结束循环。`WorkDiscardedException` 表示宿主已经取消了该调用。

### 配置监听器和进程池

将以下配置保存为 `rapira.toml`：

```toml
[grpc]
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"
reflection = true

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"
processes = 2
```

`descriptor_set` 以配置文件所在目录为基准。仅使用 gRPC 的配置不需要 `[http]` 部分。

从 `app/` 启动服务器：

```sh
rapira serve rapira.toml
```

### 调用服务

在另一个终端中列出服务：

```sh
grpcurl -plaintext 127.0.0.1:50051 list
```

调用回显方法：

```sh
grpcurl -plaintext -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

响应如下：

```json
{
  "text": "hello"
}
```

grpcurl 通过反射获取模式定义。在地址前添加 `-v` 可以查看响应头和尾部字段。

Connect 客户端可以发送 JSON。Rapira 在 PHP 收到请求前将 JSON 请求转换为二进制 protobuf，并将二进制响应转换回 JSON：

```sh
curl -H 'Content-Type: application/json' -d '{"text":"hello"}' http://127.0.0.1:50051/example.v1.Echo/Echo
```

## 使用生成的 PHP 消息类

当 handler 需要读取或修改消息字段时，请生成 PHP 类。安装 `protoc` 和 Composer 以完成此构建步骤。

在 `app/` 中安装 PHP protobuf 运行时：

```sh
composer require google/protobuf
```

创建输出目录：

```sh
mkdir -p generated
```

生成类：

```sh
protoc --proto_path=proto --php_out=generated proto/echo.proto
```

将以下命名空间映射添加到 `composer.json` 的 `autoload.psr-4` 对象：

```json
{
  "autoload": {
    "psr-4": {
      "Example\\V1\\": "generated/Example/V1/",
      "Example\\Metadata\\": "generated/Example/Metadata/"
    }
  }
}
```

更新自动加载器：

```sh
composer dump-autoload
```

在 `grpc.php` 的 dispatcher 循环前加载它：

```php
require __DIR__ . '/vendor/autoload.php';
```

将内层 `try` 块中的 `respond()` 行替换为以下代码：

```php
$message = new Example\V1\EchoMessage();
$message->mergeFromString($call->getMessage());
$message->setText(strtoupper($message->getText()));
$call->respond($message->serializeToString());
```

重启示例服务器。相同的客户端调用现在返回 `{"text":"HELLO"}`。在应用 handler 中捕获 protobuf 解析异常，并发送 `StatusCode::InvalidArgument`。

[PHP 生成代码指南](https://protobuf.dev/reference/php/php-generated/)说明消息访问方法和序列化。此服务器 API 不需要 PHP gRPC 扩展。

## Dispatcher 接口约定

在 gRPC worker 中，`Rapira\get_dispatcher()` 返回 `Rapira\Grpc\GrpcDispatcher`。在循环前初始化自动加载器和应用共享服务。

| API | 行为 |
| --- | --- |
| `receive(int $timeout = -1)` | 返回下一个 `UnaryCall`。等待时限以微秒为单位。`-1` 表示无限等待。超时后抛出 `Rapira\Exception\TimeoutException`。 |
| `tryReceive()` | 返回 `UnaryCall`；没有等待中的调用时返回 `null`。它不等待。 |
| `getServices()` | 列出所提供的服务及其方法、输入类型、输出类型和方法种类。列表包含流式方法。首次调用前即可使用。 |
| `$call->getContext()` | 返回方法、元数据、对端地址、协议、接收时间和截止时间。 |
| `$call->getMessage()` | 以 PHP 字符串返回二进制 protobuf 格式的请求消息。 |
| `$call->respond(string $message)` | 用一个序列化的 protobuf 响应结束调用。 |
| `$call->fail(Status $status)` | 用 gRPC 错误状态结束调用。 |
| `$call->isCancelled()` | 报告客户端取消、连接关闭或截止时间已到。 |
| `$call->isFinalized()` | 报告调用是否已结束。 |

先完成当前调用，再接收下一个调用。调用未结束时，`receive()` 抛出 `\Error`。重复完成调用会抛出 `Rapira\Exception\AlreadyFinalizedError`。取消后响应会抛出 `WorkDiscardedException`。

PHP 未完成的调用会丢失。此时客户端收到 `INTERNAL`，消息为 `internal error`。未捕获的 throwable 也会导致调用丢失，客户端看不到其消息。

模式定义包含多个方法时，请使用 `$call->getContext()->method` 选择 handler。`$call->getContext()->protocol` 为 `Grpc`、`GrpcWeb` 或 `Connect`。在下一次迭代前清除本次调用的应用状态。dispatcher 不填充 HTTP 超全局变量。

## 返回错误和详细信息

对于预期的应用错误，请使用 `fail()`。在当前调用的 handler 中运行以下代码：

```php
$call->fail(new Rapira\Grpc\Status(
    Rapira\Grpc\StatusCode::InvalidArgument,
    'text is required',
));
```

`StatusCode` 包含 gRPC 状态码。成功的 `respond()` 发送 `OK` 状态。`fail()` 是发送错误状态的唯一方式。

`Status` 的第三个参数可选，是一个 `Rapira\Grpc\ErrorDetail` 对象列表。每个对象保存一个 protobuf 类型 URL 和序列化的消息字节。对于 gRPC 和 gRPC-Web，Rapira 在 `grpc-status-details-bin` 中发送这些详细信息。对于 Connect，Rapira 在 JSON 错误体中发送它们。

Rapira 不捕获 `Rapira\Grpc\Exception\GrpcException`。请捕获它，并将其 `$status` 属性传给 `fail()`。

Rapira 在 PHP 收到调用前拒绝该调用时，客户端收到 `UNAVAILABLE`。以下情况会发生这种拒绝：worker 队列持续满载 30 秒、进程池停止，或 worker 的 PHP 启动失败。

## 元数据

从 `$call->getContext()->metadata` 读取请求元数据。`values($name)` 按到达顺序返回指定名称的所有值，且不区分名称大小写。只读的 `entries` 数组保存小写名称。

Rapira 从请求元数据中删除传输层名称，例如 `grpc-timeout`、`content-type` 和 `te`。它丢弃不是可打印 ASCII 的文本值。对于以 `-bin` 结尾的名称，Rapira 按 `,` 拆分值，并对每一段进行 base64 解码。PHP 收到原始字节。无法解码的段会被丢弃。

在 `respond()` 或 `fail()` 前添加响应元数据：

```php
$requestId = $call->getContext()->metadata->values('x-request-id')[0] ?? '';
$metadata = $call->getResponseMetadata();
$metadata->addHeader('x-request-id', $requestId);
$metadata->addBinaryHeader('x-token-bin', "\x00\xff");
$metadata->addTrailer('x-result', 'completed');
```

`addHeader()` 和 `addTrailer()` 接受可打印的 ASCII 值。允许空值。Rapira 在发送文本值时删除其开头和结尾的空格。二进制值使用 `addBinaryHeader()` 或 `addBinaryTrailer()`。二进制值的名称必须以 `-bin` 结尾。

按照 [gRPC 协议](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md#requests)的规定，元数据名称只能包含 `0-9`、`a-z`、`_`、`-` 和 `.`。传输层名称、无效名称或无效值会抛出 `\ValueError`。重复的名称会添加一个值。

`headers()` 和 `trailers()` 返回快照。对于 Connect，每个尾部字段都作为带 `trailer-` 前缀的头部发送。使用 grpcurl 的 `-H 'x-request-id: demo-1'` 选项传递请求元数据。

## 截止时间和取消

客户端通过 `grpc-timeout`（gRPC 和 gRPC-Web）或 `connect-timeout-ms`（Connect）设置超时。`grpc.default_timeout_secs` 设置没有客户端超时的调用的超时。`grpc.max_timeout_secs` 将更长的客户端超时缩短为其值。两个键默认均未设置，因此没有客户端超时的调用没有截止时间。

`$call->getContext()->deadline` 是以秒为单位的 Unix 时间戳形式的截止时间，或为 `null`。`receivedAt` 是 Rapira 读完整个请求消息的时间。

例如，在客户端设置两秒的截止时间：

```sh
grpcurl -plaintext -max-time 2 -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

截止时间到达时，客户端收到 `DEADLINE_EXCEEDED`，`isCancelled()` 返回 `true`。Rapira 无法停止 PHP 代码，因此 PHP 会继续处理该调用。在长时间操作中检查 `isCancelled()`。在响应方法周围捕获 `WorkDiscardedException`，因为取消可能发生在检查之后。

`receive()` 的超时限制 PHP 等待新工作的时间。它与调用的截止时间无关。`grpc.pool.request_terminate_timeout_secs` 是进程看门狗。调用运行时间超过其时限时，它会替换 worker。

## 服务和反射

master 在 fork 出 worker 前加载描述符集。无效的描述符集、不含其导入文件的描述符集或未知服务会阻止启动。更改描述符集后，需要停止并重新启动 Rapira。重载会保留旧的描述符集。

默认情况下，进程池提供集合中未被其他文件导入的文件里的服务。被其他文件导入的文件是依赖项，例如 `google/longrunning/operations.proto`。其中的服务不会被提供。设置 `grpc.services` 以指定所提供的服务，例如 `["billing.v1.InvoiceService"]`。当多个 Rapira 实例共用一个描述符集，或需要提供某个导入文件中的服务时，请使用此键。

流式方法、进程池未提供的服务中的方法以及未知方法都返回 `UNIMPLEMENTED`。启动时，Rapira 为所提供服务中的每个流式方法记录一条警告。

反射默认禁用。设置 `reflection = true` 时，Rust 提供 `grpc.reflection.v1` 和 `grpc.reflection.v1alpha`。`ListServices` 返回所提供的服务。描述符集中的所有文件和符号都可获取，因此每个客户端都可以读取完整的描述符集。

设置 `reflection = false` 时，请向客户端提供模式定义：

```sh
grpcurl -plaintext -import-path proto -proto echo.proto -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

## 健康检查

Rust 在每个 worker 中提供 [gRPC 健康检查协议](https://github.com/grpc/grpc/blob/master/doc/health-checking.md)（`grpc.health.v1.Health`）。对于空名称 `""` 和每个所提供的服务，`Check` 和 `Watch` 报告 `SERVING`。关闭期间，它们报告 `NOT_SERVING`。

健康检查服务不检查 PHP。PHP 启动失败的 worker 报告 `SERVING`，而它的调用收到 `UNAVAILABLE`。`grpc.services` 不能指定健康检查服务或反射服务，因为 Rapira 自己提供这些服务。

反射不列出健康检查服务。Connect JSON 请求不需要模式定义：

```sh
curl -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:50051/grpc.health.v1.Health/Check
```

## 协议和限制

- 无法解码的 Connect JSON 请求返回 `INVALID_ARGUMENT`，PHP 不会收到该调用。JSON 解码器忽略未知字段。它不忽略描述符集未声明的枚举值名称。
- 带有 `option idempotency_level = NO_SIDE_EFFECTS;` 的方法也接受 Connect GET 请求。
- 消息可以使用 gzip 压缩。使用其他消息编码的请求返回 `UNIMPLEMENTED`。
- 消息大小限制为 4 MiB。更大的请求返回 `RESOURCE_EXHAUSTED`。
- `$call->getContext()->tls` 始终为 `null`。客户端需要 TLS 时，请在监听器前放置 TLS 代理。对于原生 gRPC，代理与 Rapira 之间的连接必须使用 HTTP/2。
- Rapira 每 10 秒向空闲连接发送一次 HTTP/2 keepalive PING。连接在 10 秒内没有响应时，Rapira 关闭该连接。

::: warning 一个连接使用一个 worker
一个 worker 进程服务每个连接。gRPC 客户端通常在一个 HTTP/2 连接上发送一个 channel 的所有调用。无论进程池大小如何，这样的客户端只能获得一个 worker 的吞吐量。要使用更多 worker，请打开多个连接，或使用能分发调用的 L7 负载均衡器。
:::

## 同时运行 HTTP 和 gRPC

一份配置可以同时包含 `[http]` 和 `[grpc]`。每个插件都有自己的监听器、PHP 入口脚本和 worker 进程池。master 监管两个进程池。gRPC 进程池支持与 HTTP 进程池相同的伸缩和回收设置，且使用 `mode = "dispatcher"`。

所有 gRPC 设置请参阅[配置](./configuration#grpc)，进程池监管请参阅[进程模型](./process-model)。

## Windows

[Windows 版本](https://github.com/rapira-rs/rapira-windows)提供相同的 gRPC 监听器和 PHP API。存在以下差异：

- `grpc.listen` 只接受 TCP 地址。
- gRPC 进程池是一个进程内 PHP 解释器线程的静态池。`grpc.pool.processes` 设置线程数。
- `getmypid()` 在每个解释器中返回相同的进程 ID。
- 任一进程池的 PHP 启动失败都会使服务器以退出码 70 停止。
