---
title: gRPC
description: "配置一元 gRPC 服务，编写 PHP dispatcher，并使用 grpcurl 调用服务。"
---

# gRPC

Rapira 通过 TCP 或 Unix 套接字上的明文 HTTP/2 提供原生 gRPC 服务。每个 PHP worker 一次处理一个一元调用。一元调用包含一个请求消息和一个响应消息。

gRPC 进程池使用 Dispatcher 模式。Rapira 处理传输，并将二进制 protobuf 消息传给 PHP。不支持应用流式方法、gRPC-Web 和 Connect。TLS 代理与 Rapira 之间的上游连接必须使用 HTTP/2。

## 运行回显服务

安装支持原生 gRPC 的 Rapira。安装 [grpcurl](https://github.com/fullstorydev/grpcurl#installation) 以运行客户端命令。此示例将请求字节原样返回为响应。它不需要生成的 PHP 类，也不需要 PHP gRPC 扩展。

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

Rapira 在启动时解析模式定义。路由为 `/example.v1.Echo/Echo`。PHP 上下文中的方法名为 `example.v1.Echo/Echo`，不含开头的斜杠。

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
listen = "127.0.0.1:9001"
protos = ["proto"]
reflection = true

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"
processes = 2
```

`protos` 包含目录。Rapira 在这些目录中递归搜索 `.proto` 文件。相对路径以配置文件所在目录为基准。仅使用 gRPC 的配置不需要 `[http]` 部分。

从 `app/` 启动服务器：

```sh
rapira serve rapira.toml
```

### 调用服务

在另一个终端中列出服务：

```sh
grpcurl -plaintext 127.0.0.1:9001 list
```

调用回显方法：

```sh
grpcurl -plaintext -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

响应如下：

```json
{
  "text": "hello"
}
```

这些命令通过反射获取模式定义。在地址前添加 `-v` 可以查看响应头和尾部字段。

## 使用生成的 PHP 消息类

当 handler 需要读取或修改消息字段时，请生成 PHP 类。安装 `protoc` 和 Composer 以完成此构建步骤。服务器自行解析 `.proto` 文件，运行时不需要 `protoc` 可执行文件。

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

重启示例服务器。相同的客户端调用现在返回 `{"text":"HELLO"}`。在应用 handler 中捕获 protobuf 解析异常，并将其转换为 `StatusCode::InvalidArgument`。

[PHP 生成代码指南](https://protobuf.dev/reference/php/php-generated/)说明消息访问方法和序列化。此服务器 API 不需要 PHP gRPC 扩展。

## Dispatcher 接口约定

在 gRPC worker 中，`Rapira\get_dispatcher()` 返回 `Rapira\Grpc\GrpcDispatcher`。在循环前初始化自动加载器和应用共享服务。

| API | 行为 |
| --- | --- |
| `receive(int $timeout = -1)` | 返回下一个 `UnaryCall`。等待时限以微秒为单位。`-1` 表示无限等待。超时后抛出 `Rapira\Exception\TimeoutException`。 |
| `tryReceive()` | 立即返回 `UnaryCall` 或 `null`。 |
| `getServices()` | 列出应用服务及其方法、输入类型、输出类型和方法种类。首次调用前即可使用。 |
| `$call->getContext()` | 返回方法、元数据、对端地址、协议、接收时间和截止时间。 |
| `$call->getMessage()` | 以 PHP 字符串返回请求的 protobuf 字节。 |
| `$call->respond(string $message)` | 用一个序列化的 protobuf 响应完成调用。 |
| `$call->fail(Status $status)` | 用 gRPC 错误完成调用。 |
| `$call->isCancelled()` | 报告客户端是否取消调用，或是否已到截止时间。 |
| `$call->isFinalized()` | 报告调用是否已结束。 |

先完成当前调用，再接收下一个调用。重复完成调用会抛出 `Rapira\Exception\AlreadyFinalizedError`。取消后响应会抛出 `WorkDiscardedException`。丢弃未完成的调用会向客户端报告 `INTERNAL`。

模式定义包含多个方法时，请使用 `$call->getContext()->method` 选择 handler。在迭代之间清除应用中每次调用的专有状态。dispatcher 将 PHP 应用保留在内存中，不填充 HTTP 超全局变量。

## 返回错误和详细信息

对于预期的应用错误，请使用 `fail()`。在当前调用的 handler 中运行以下代码：

```php
$call->fail(new Rapira\Grpc\Status(
    Rapira\Grpc\StatusCode::InvalidArgument,
    'text is required',
));
```

`StatusCode` 包含 gRPC 错误码。成功的 `respond()` 提供 `OK` 状态。未捕获的异常导致调用被放弃时，Rapira 返回隐藏内部细节的 `INTERNAL` 状态。

`Status` 的第三个参数可选，是一个 `Rapira\Grpc\ErrorDetail` 对象列表。每个对象接受 protobuf 类型 URL 和序列化的消息字节。Rapira 将这些详细信息编码到 `grpc-status-details-bin` 中。`Rapira\Grpc\Exception\GrpcException` 公开 `$status` 属性，应用的 catch 块可以将其传给 `fail()`。

## 元数据

从 `$call->getContext()->metadata` 读取请求元数据。`values($name)` 返回指定名称的所有值，且不区分名称大小写。只读的 `entries` 数组保存小写名称。在 PHP 中，以 `-bin` 结尾的名称所对应的值是原始二进制数据。

在 `respond()` 或 `fail()` 前添加响应元数据：

```php
$requestId = $call->getContext()->metadata->values('x-request-id')[0] ?? '';
$metadata = $call->getResponseMetadata();
$metadata->addHeader('x-request-id', $requestId);
$metadata->addBinaryHeader('x-token-bin', "\x00\xff");
$metadata->addTrailer('x-result', 'completed');
```

`addHeader()` 和 `addTrailer()` 接受可打印的 ASCII 值。二进制值使用 `addBinaryHeader()` 或 `addBinaryTrailer()`。重复添加时会保留每个值。传输层保留的名称（例如 `grpc-status`）会被拒绝。

`headers()` 和 `trailers()` 返回不可变的快照。调用结束时，响应元数据即固定。使用 grpcurl 的 `-H 'x-request-id: demo-1'` 选项传递请求元数据。

## 截止时间和取消

客户端通过 `grpc-timeout` 提供截止时间。Rapira 在接收请求和等待 PHP 时检查此截止时间。`$call->getContext()->deadline` 是以秒为单位的 Unix 时间戳，或为 `null`。`receivedAt` 是以秒为单位的接收时间戳。

例如，在客户端设置两秒的调用时限：

```sh
grpcurl -plaintext -max-time 2 -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

取消后，PHP 代码可以继续运行。在长时间操作中检查 `isCancelled()`。在响应方法周围捕获 `WorkDiscardedException`，因为取消可能发生在检查之后。

`receive()` 的超时限制 PHP 等待新工作的时间。它与调用的截止时间相互独立。`grpc.pool.request_terminate_timeout_secs` 是进程看门狗；活动调用超过其时限时，它会终止并替换 worker。

## 模式定义和反射

master 在 fork 出 worker 前加载 proto2 和 proto3 模式定义。在 `protos` 下发现的文件会注册应用服务。仅通过 `import_paths` 找到的文件提供依赖类型和反射数据。

导入根目录按配置顺序使用：先使用 `protos`，再使用 `import_paths`。标准 `google/protobuf` 导入已内置。导入缺失、定义冲突或应用流式方法都会阻止初始化。更改模式定义后，请重启 Rapira。

反射默认启用。它在 Rust 中提供 `grpc.reflection.v1` 和 `grpc.reflection.v1alpha` 服务。它列出应用服务和反射服务，并提供包含自定义选项的描述符。PHP 的 `getServices()` 仅列出应用服务。

设置 `reflection = false` 时，请向客户端提供模式定义：

```sh
grpcurl -plaintext -import-path proto -proto echo.proto -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

## 压缩和消息大小限制

服务器接受 gzip 请求。gzip 响应默认禁用。使用以下配置启用应用响应压缩：

```toml
[grpc.compression.gzip]
enabled = true
```

客户端还必须在 `grpc-accept-encoding` 中声明支持 gzip。两个消息大小限制的默认值均为 4 MiB。设置 `grpc.max_request_message_size_mb` 和 `grpc.max_response_message_size_mb` 可以更改限制。压缩和未压缩的数据都必须符合所配置的限制。请配置客户端限制，使其能接受预期大小的响应。

## 同时运行 HTTP 和 gRPC

一份配置可以同时包含 `[http]` 和 `[grpc]`。每个插件都有自己的监听器、PHP 入口脚本和 worker 进程池。master 监管两个进程池。gRPC 进程池支持与 HTTP 进程池相同的伸缩和回收设置，且使用 `mode = "dispatcher"`。

独立二进制程序接受空的 `grpc.interceptors` 列表。Rust 宿主可以通过共享的 `Middleware` API 提供拦截器。所有 gRPC 设置请参阅[配置](./configuration#grpc)，进程池监管请参阅[进程模型](./process-model)。
