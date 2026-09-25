---
title: gRPC
description: "Serve unary gRPC, gRPC-Web, and Connect calls from a PHP dispatcher, and call them with grpcurl or curl."
---

# gRPC

Rapira serves unary RPC calls from PHP. One listener accepts gRPC, gRPC-Web, and Connect calls over HTTP/1.1 or cleartext HTTP/2, on TCP or Unix sockets. A unary call has one request message and one response message.

The gRPC pool uses Dispatcher mode. Rapira handles the transport and gives binary protobuf messages to PHP. Each PHP worker handles one call at a time. Streaming methods are not supported. The listener does not terminate TLS.

## Run an echo service

Install Rapira. Install [buf](https://buf.build/docs/installation/) to build the descriptor set, and [grpcurl](https://github.com/fullstorydev/grpcurl#installation) for the client commands. This example returns the request bytes as its response. It needs no generated PHP classes and no PHP gRPC extension.

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

The route is `/example.v1.Echo/Echo`. The PHP context gives the method as `example.v1.Echo/Echo`, without the leading slash.

### Build the descriptor set

Rapira reads the schema from a descriptor set: a binary `google.protobuf.FileDescriptorSet` that contains every imported file. Build it from `app/`:

```sh
buf build proto --as-file-descriptor-set -o api.binpb
```

`protoc` can also build it. Add `--include_imports`, because `protoc` does not include the imported files without it:

```sh
protoc --include_imports --descriptor_set_out=api.binpb -I proto proto/echo.proto
```

Rapira needs no `protoc` executable at runtime.

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

The request and the response use one message type, so the handler can return the bytes directly. `ClosedException` ends the loop during shutdown. `WorkDiscardedException` means that the host has already cancelled the call.

### Configure the listener and pool

Save this configuration as `rapira.toml`:

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

`descriptor_set` uses the configuration file directory as its base. A gRPC-only configuration needs no `[http]` section.

Start the server from `app/`:

```sh
rapira serve rapira.toml
```

### Call the service

List the services from another terminal:

```sh
grpcurl -plaintext 127.0.0.1:50051 list
```

Call the echo method:

```sh
grpcurl -plaintext -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

The response is:

```json
{
  "text": "hello"
}
```

grpcurl gets the schema through reflection. Add `-v` before the address to see the response headers and trailers.

A Connect client can send JSON. Rapira converts the JSON request to binary protobuf before PHP gets it, and converts the binary reply back to JSON:

```sh
curl -H 'Content-Type: application/json' -d '{"text":"hello"}' http://127.0.0.1:50051/example.v1.Echo/Echo
```

## Use generated PHP messages

Generate PHP classes when a handler must read or change message fields. Install `protoc` and Composer for this build step.

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

Restart the example server. The same client call now returns `{"text":"HELLO"}`. In an application handler, catch the protobuf parse exceptions and send `StatusCode::InvalidArgument`.

The [PHP generated code guide](https://protobuf.dev/reference/php/php-generated/) describes the message accessors and serialization. This server API does not need the PHP gRPC extension.

## Dispatcher contract

`Rapira\get_dispatcher()` returns a `Rapira\Grpc\GrpcDispatcher` in a gRPC worker. Start the autoloader and the shared application services before the loop.

| API | Behavior |
| --- | --- |
| `receive(int $timeout = -1)` | Returns the next `UnaryCall`. The wait limit is in microseconds. `-1` waits with no limit. At the limit, it throws `Rapira\Exception\TimeoutException`. |
| `tryReceive()` | Returns a `UnaryCall`, or `null` when no call waits. It does not wait. |
| `getServices()` | Lists the served services with their methods, input types, output types, and method kinds. Streaming methods are in the list. Available before the first call. |
| `$call->getContext()` | Returns the method, metadata, peer address, protocol, receipt time, and deadline. |
| `$call->getMessage()` | Returns the request message as binary protobuf in a PHP string. |
| `$call->respond(string $message)` | Ends the call with one serialized protobuf response. |
| `$call->fail(Status $status)` | Ends the call with a gRPC error status. |
| `$call->isCancelled()` | Reports a client cancel, a closed connection, or an expired deadline. |
| `$call->isFinalized()` | Reports whether the call has ended. |

Finalize the current call before you receive the next call. While the call is open, `receive()` throws `\Error`. A second finalization throws `Rapira\Exception\AlreadyFinalizedError`. A response after a cancel throws `WorkDiscardedException`.

A call that PHP does not finalize is lost. The client then gets `INTERNAL` with the message `internal error`. An uncaught throwable also loses the call, and the client does not see its message.

Use `$call->getContext()->method` to select a handler when the schema has several methods. `$call->getContext()->protocol` is `Grpc`, `GrpcWeb`, or `Connect`. Clear the application state of a call before the next iteration. The dispatcher does not fill the HTTP superglobals.

## Return errors and details

Use `fail()` for an expected application error. Run this code in the handler of the current call:

```php
$call->fail(new Rapira\Grpc\Status(
    Rapira\Grpc\StatusCode::InvalidArgument,
    'text is required',
));
```

`StatusCode` contains the gRPC status codes. A successful `respond()` sends the status `OK`. `fail()` is the only way to send an error status.

The optional third `Status` argument is a list of `Rapira\Grpc\ErrorDetail` objects. Each object holds a protobuf type URL and the serialized message bytes. For gRPC and gRPC-Web, Rapira sends the details in `grpc-status-details-bin`. For Connect, it sends them in the JSON error body.

Rapira does not catch `Rapira\Grpc\Exception\GrpcException`. Catch it, and give its `$status` property to `fail()`.

The client gets `UNAVAILABLE` when Rapira refuses a call before PHP gets it. This occurs when the worker queue stays full for 30 seconds, when the pool stops, or when the PHP boot of the worker failed.

## Metadata

Read the request metadata from `$call->getContext()->metadata`. `values($name)` returns all values of a name, in arrival order, and ignores the case of the name. The readonly `entries` array has lowercase names.

Rapira removes the transport names from the request metadata, for example `grpc-timeout`, `content-type`, and `te`. It drops a text value that is not printable ASCII. For a name that ends in `-bin`, Rapira splits the value on `,` and decodes each piece from base64. PHP gets the raw bytes. A piece that does not decode is dropped.

Add response metadata before `respond()` or `fail()`:

```php
$requestId = $call->getContext()->metadata->values('x-request-id')[0] ?? '';
$metadata = $call->getResponseMetadata();
$metadata->addHeader('x-request-id', $requestId);
$metadata->addBinaryHeader('x-token-bin', "\x00\xff");
$metadata->addTrailer('x-result', 'completed');
```

`addHeader()` and `addTrailer()` accept printable ASCII values. An empty value is permitted. Rapira removes the leading and trailing spaces of a text value when it sends the value. Use `addBinaryHeader()` or `addBinaryTrailer()` for binary values. The name of a binary value must end in `-bin`.

A metadata name can contain only `0-9`, `a-z`, `_`, `-`, and `.`, as the [gRPC protocol](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md#requests) specifies. A transport name, an invalid name, or an invalid value throws `\ValueError`. A repeated name adds a value.

`headers()` and `trailers()` return snapshots. For Connect, each trailer is a header with the `trailer-` prefix. Send request metadata with the grpcurl option `-H 'x-request-id: demo-1'`.

## Deadlines and cancellation

A client sets a timeout with `grpc-timeout` (gRPC and gRPC-Web) or `connect-timeout-ms` (Connect). `grpc.default_timeout_secs` sets the timeout of a call that has no client timeout. `grpc.max_timeout_secs` reduces a longer client timeout to its value. Both keys are unset by default, so a call with no client timeout has no deadline.

`$call->getContext()->deadline` is the deadline as a Unix timestamp in seconds, or `null`. `receivedAt` is the time when Rapira has read the complete request message.

For example, set a two-second client deadline:

```sh
grpcurl -plaintext -max-time 2 -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

When the deadline expires, the client gets `DEADLINE_EXCEEDED`, and `isCancelled()` returns `true`. Rapira cannot stop PHP code, so PHP continues the call. Check `isCancelled()` during long operations. Catch `WorkDiscardedException` around the response methods, because a cancel can occur after the check.

The `receive()` timeout sets how long PHP waits for new work. It is not related to a call deadline. `grpc.pool.request_terminate_timeout_secs` is a process watchdog. It replaces a worker when a call runs longer than the limit.

## Services and reflection

The master loads the descriptor set before it forks the workers. An invalid set, a set without its imports, or an unknown service stops the start. A changed set needs a stop and a start of Rapira. A reload keeps the old set.

By default, the pool serves the services of the files that no other file in the set imports. A file that another file imports is a dependency, for example `google/longrunning/operations.proto`. Its services are not served. Set `grpc.services` to name the served services, for example `["billing.v1.InvoiceService"]`. Use this key when several Rapira instances share one set, or to serve a service of an imported file.

A streaming method, a method of a service that the pool does not serve, and an unknown method return `UNIMPLEMENTED`. At startup, Rapira logs a warning for each streaming method of a served service.

Reflection is disabled by default. With `reflection = true`, Rust serves `grpc.reflection.v1` and `grpc.reflection.v1alpha`. `ListServices` returns the served services. Every file and symbol of the descriptor set is available, so each client can read the complete set.

With `reflection = false`, give the schema to the client:

```sh
grpcurl -plaintext -import-path proto -proto echo.proto -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

## Health checks

Rust serves the [gRPC health checking protocol](https://github.com/grpc/grpc/blob/master/doc/health-checking.md) (`grpc.health.v1.Health`) in each worker. `Check` and `Watch` report `SERVING` for the empty name `""` and for each served service. During shutdown, they report `NOT_SERVING`.

The health service does not check PHP. A worker with a failed PHP boot reports `SERVING`, and its calls get `UNAVAILABLE`. `grpc.services` cannot name the health or reflection services, because Rapira serves them itself.

Reflection does not list the health service. A Connect JSON request needs no schema:

```sh
curl -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:50051/grpc.health.v1.Health/Check
```

## Protocols and limits

- A Connect JSON request that does not decode returns `INVALID_ARGUMENT`, and PHP does not get the call. The JSON decoder ignores unknown fields. It does not ignore an enum value name that the descriptor set does not declare.
- A method with `option idempotency_level = NO_SIDE_EFFECTS;` also accepts a Connect GET request.
- Messages can use gzip compression. A request with another message encoding returns `UNIMPLEMENTED`.
- The message size limit is 4 MiB. A larger request returns `RESOURCE_EXHAUSTED`.
- `$call->getContext()->tls` is always `null`. Put a TLS proxy in front of the listener when clients need TLS. For native gRPC, the proxy must use HTTP/2 for its connection to Rapira.
- Rapira sends an HTTP/2 keepalive PING to an idle connection every 10 seconds. It closes a connection that does not answer within 10 seconds.

::: warning One connection uses one worker
One worker process serves each connection. A gRPC client usually sends all calls of a channel on one HTTP/2 connection. Such a client gets the throughput of one worker, for all pool sizes. To use more workers, open several connections, or use an L7 load balancer that spreads the calls.
:::

## HTTP and gRPC together

One configuration can contain `[http]` and `[grpc]`. Each plugin has its own listener, PHP entrypoint, and worker pool. The master supervises the two pools. The gRPC pool accepts the scaling and recycling settings of the HTTP pool, with `mode = "dispatcher"`.

See [Configuration](./configuration#grpc) for all gRPC settings and [Process model](./process-model) for pool supervision.

## Windows

The [Windows build](https://github.com/rapira-rs/rapira-windows) serves the same gRPC listener and PHP API. These differences apply:

- `grpc.listen` accepts only a TCP address.
- The gRPC pool is a static pool of PHP interpreter threads in one process. `grpc.pool.processes` sets the thread count.
- `getmypid()` returns the same process ID in each interpreter.
- A PHP boot failure in either pool stops the server with exit code 70.
