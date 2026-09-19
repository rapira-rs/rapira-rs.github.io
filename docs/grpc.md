---
title: gRPC
description: "Configure a unary gRPC service, write a PHP dispatcher, and call it with grpcurl."
---

# gRPC

Rapira serves native gRPC over cleartext HTTP/2 on TCP or Unix sockets. Each PHP worker handles one unary call at a time. A unary call has one request message and one response message.

The gRPC pool uses Dispatcher mode. Rapira handles the transport and passes binary protobuf messages to PHP. Application streaming methods, gRPC-Web, and Connect are not supported. A TLS proxy must use HTTP/2 for its upstream connection to Rapira.

## Run an echo service

Install Rapira with native gRPC support. Install [grpcurl](https://github.com/fullstorydev/grpcurl#installation) for the client commands. This example returns the request bytes as its response. It needs no generated PHP classes or PHP gRPC extension.

Create this directory structure:

```text
app/
├── proto/
│   └── echo.proto
├── grpc.php
└── rapira.toml
```

### Define the service

Save this schema as `proto/echo.proto`:

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

Rapira parses the schema at startup. The route is `/example.v1.Echo/Echo`. The PHP context exposes the method as `example.v1.Echo/Echo`, without the leading slash.

### Write the PHP dispatcher

Save this script as `grpc.php`:

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

The request and response share one message type, so the handler can return the bytes directly. `ClosedException` ends the loop during shutdown. `WorkDiscardedException` means the host has already cancelled the call.

### Configure the listener and pool

Save this configuration as `rapira.toml`:

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

`protos` contains directories. Rapira searches them recursively for `.proto` files. Relative paths use the configuration file directory as their base. A gRPC-only configuration needs no `[http]` section.

Start the server from `app/`:

```sh
rapira serve rapira.toml
```

### Call the service

List the services from another terminal:

```sh
grpcurl -plaintext 127.0.0.1:9001 list
```

Call the echo method:

```sh
grpcurl -plaintext -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

The response is:

```json
{
  "text": "hello"
}
```

These commands obtain their schemas through reflection. Add `-v` before the address to inspect response headers and trailers.

## Use generated PHP messages

Generate PHP classes when a handler needs to read or change message fields. Install `protoc` and Composer for this build step. The server parses `.proto` files itself and needs no `protoc` executable at runtime.

Install the PHP protobuf runtime in `app/`:

```sh
composer require google/protobuf
```

Create the output directory:

```sh
mkdir -p generated
```

Generate the classes:

```sh
protoc --proto_path=proto --php_out=generated proto/echo.proto
```

Add these namespace mappings to the `autoload.psr-4` object in `composer.json`:

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

Update the autoloader:

```sh
composer dump-autoload
```

Load it before the dispatcher loop in `grpc.php`:

```php
require __DIR__ . '/vendor/autoload.php';
```

Replace the `respond()` line inside the inner `try` block with this code:

```php
$message = new Example\V1\EchoMessage();
$message->mergeFromString($call->getMessage());
$message->setText(strtoupper($message->getText()));
$call->respond($message->serializeToString());
```

Restart the example server. The same client call now returns `{"text":"HELLO"}`. Catch protobuf parsing exceptions in an application handler and convert them to `StatusCode::InvalidArgument`.

The [PHP generated code guide](https://protobuf.dev/reference/php/php-generated/) describes message accessors and serialization. The PHP gRPC extension is not required for this server API.

## Dispatcher contract

`Rapira\get_dispatcher()` returns a `Rapira\Grpc\GrpcDispatcher` in a gRPC worker. Initialize the autoloader and shared application services before the loop.

| API | Behavior |
| --- | --- |
| `receive(int $timeout = -1)` | Returns the next `UnaryCall`. The wait limit is in microseconds. `-1` waits indefinitely. Expiry throws `Rapira\Exception\TimeoutException`. |
| `tryReceive()` | Returns a `UnaryCall` or `null` immediately. |
| `getServices()` | Lists application services and their methods, input types, output types, and method kinds. Available before the first call. |
| `$call->getContext()` | Returns the method, metadata, peer address, protocol, receipt time, and deadline. |
| `$call->getMessage()` | Returns the request protobuf bytes as a PHP string. |
| `$call->respond(string $message)` | Completes the call with one serialized protobuf response. |
| `$call->fail(Status $status)` | Completes the call with a gRPC error. |
| `$call->isCancelled()` | Reports client cancellation or deadline expiry. |
| `$call->isFinalized()` | Reports whether the call has ended. |

Finalize the active call before receiving another. Repeated finalization throws `Rapira\Exception\AlreadyFinalizedError`. A response after cancellation throws `WorkDiscardedException`. Dropping an unfinished call reports `INTERNAL` to the client.

Use `$call->getContext()->method` to select a handler when the schema defines several methods. Clear per-call application state between iterations. The dispatcher keeps the PHP application in memory and does not fill HTTP superglobals.

## Return errors and details

Use `fail()` for an expected application error. Run this code in the active call's handler:

```php
$call->fail(new Rapira\Grpc\Status(
    Rapira\Grpc\StatusCode::InvalidArgument,
    'text is required',
));
```

`StatusCode` contains the gRPC error codes. A successful `respond()` supplies status `OK`. Rapira returns a sanitized `INTERNAL` status when an uncaught exception abandons a call.

The optional third `Status` argument is a list of `Rapira\Grpc\ErrorDetail` objects. Each object accepts a protobuf type URL and serialized message bytes. Rapira encodes these details in `grpc-status-details-bin`. A `Rapira\Grpc\Exception\GrpcException` exposes a `$status` property that an application catch block can pass to `fail()`.

## Metadata

Read request metadata from `$call->getContext()->metadata`. `values($name)` returns all values for a name and ignores name case. The readonly `entries` array stores lowercase names. Names ending in `-bin` contain raw binary values in PHP.

Add response metadata before `respond()` or `fail()`:

```php
$requestId = $call->getContext()->metadata->values('x-request-id')[0] ?? '';
$metadata = $call->getResponseMetadata();
$metadata->addHeader('x-request-id', $requestId);
$metadata->addBinaryHeader('x-token-bin', "\x00\xff");
$metadata->addTrailer('x-result', 'completed');
```

`addHeader()` and `addTrailer()` accept printable ASCII values. Use `addBinaryHeader()` or `addBinaryTrailer()` for binary values. Repeated additions preserve each value. Transport-reserved names, such as `grpc-status`, are rejected.

`headers()` and `trailers()` return immutable snapshots. The response metadata becomes fixed when the call ends. Pass request metadata with grpcurl's `-H 'x-request-id: demo-1'` option.

## Deadlines and cancellation

A client supplies its deadline through `grpc-timeout`. Rapira checks this deadline while receiving the request and waiting for PHP. `$call->getContext()->deadline` is a Unix timestamp in seconds, or `null`. `receivedAt` is the receipt timestamp in seconds.

For example, set a two-second client deadline:

```sh
grpcurl -plaintext -max-time 2 -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

PHP code can continue after cancellation. Check `isCancelled()` during long operations. Catch `WorkDiscardedException` around response methods because cancellation can occur after the check.

The `receive()` timeout limits how long PHP waits for new work. It is separate from a call deadline. `grpc.pool.request_terminate_timeout_secs` is a process watchdog that terminates and replaces a worker when an active call exceeds its limit.

## Schemas and reflection

The master loads proto2 and proto3 schemas before it forks workers. Files discovered under `protos` register application services. Files found only through `import_paths` supply dependency types and reflection data.

Import roots use configuration order: `protos` first, then `import_paths`. Standard `google/protobuf` imports are built in. Missing imports, conflicting definitions, and streaming application methods stop initialization. Restart Rapira after changing schemas.

Reflection is enabled by default. It serves `grpc.reflection.v1` and `grpc.reflection.v1alpha` in Rust. It lists application services and reflection services and supplies descriptors with their custom options. PHP's `getServices()` lists application services only.

With `reflection = false`, supply the schema to the client:

```sh
grpcurl -plaintext -import-path proto -proto echo.proto -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

## Compression and message limits

Gzip requests are accepted. Gzip responses are disabled by default. Enable application response compression with:

```toml
[grpc.compression.gzip]
enabled = true
```

The client must also advertise gzip in `grpc-accept-encoding`. Both message limits default to 4 MiB. Set `grpc.max_request_message_size_mb` and `grpc.max_response_message_size_mb` to change them. Both compressed and uncompressed payloads must fit their configured limit. Configure the client limits to accept the expected response size.

## HTTP and gRPC together

One configuration can contain both `[http]` and `[grpc]`. Each plugin has its own listener, PHP entrypoint, and worker pool. The master supervises both pools. The gRPC pool supports the same scaling and recycling settings as the HTTP pool, with `mode = "dispatcher"`.

The standalone binary accepts an empty `grpc.interceptors` list. Rust hosts can provide interceptors through the shared `Middleware` API. See [Configuration](./configuration#grpc) for all gRPC settings and [Process model](./process-model) for pool supervision.
