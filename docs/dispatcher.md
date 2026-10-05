---
title: Dispatcher mode
description: "The Rapira HTTP dispatcher loop, the Request and Exchange API, uploads, sendFile(), and the dispatcher exceptions."
faqLevel: 2
---

# Dispatcher mode

Dispatcher mode keeps the PHP process active between requests, as [Worker mode](/docs/worker) does. The script initializes the application once and then gets each request through an API call. Rapira does not fill the superglobals for a request. The script reads a request object and writes the response with method calls.

This page is the programming guide for the HTTP dispatcher. See [Execution modes](/docs/execution-modes) to compare the modes. The gRPC pool also uses Dispatcher mode. See [gRPC](/docs/grpc) for the gRPC call API.

## The receive loop

The script initializes the application and gets the dispatcher. It then receives requests in a loop until Rapira closes the dispatcher.

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

Dispatcher is the default mode. Set it explicitly in the `[http.pool]` table of a `rapira.toml`:

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

See [Configuration](/docs/configuration#http-pool) for the other pool keys.

## Receive a request

`\Rapira\get_dispatcher()` returns a `Rapira\Http\HttpDispatcher` in an HTTP worker. It throws `Rapira\Exception\NoDispatcherError` in Classic and Worker modes. Use `\Rapira\get_mode()` to check the mode in a script that supports more than one mode.

| Method | Behavior |
| --- | --- |
| `receive(int $timeout = -1): Exchange` | Waits for the next request. The timeout is in microseconds. `-1` waits with no limit, and `0` does not wait. At the limit, it throws `Rapira\Exception\TimeoutException`. |
| `tryReceive(): ?Exchange` | Returns the next request, or `null` when no request waits. It does not wait. |
| `getInfo(): HttpDispatcherInfo` | Returns `pendingCount()`, the requests in the queue of this worker, and `activeCount()`, which is `0` or `1`. |
| `name(): string` | Returns `http`. |

`receive()` blocks the PHP thread while it waits. The worker uses no CPU during the wait. The PHP `max_execution_time` timer does not count this wait, and it starts again for each request. Rapira skips a queued request when its client left before the request reached PHP.

## One exchange at a time

Each worker handles one exchange at a time. End the response of the current exchange before you call `receive()` or `tryReceive()` again. Otherwise, the call throws `\Error`. Fibers do not change this rule. To handle more requests at the same time, increase `http.pool.processes`.

These calls end the response:

- `writeBody()` or `sendFile()` with `$eos = true`, which is the default.
- `writeTrailers()`.

When Rapira detects cancellation of an open exchange, `receive()` and `tryReceive()` discard it before receiving more work. They do not throw the open-exchange `\Error` in this case. When code removes the last reference to an open exchange, for example with `unset($exchange)`, Rapira ends the response. If the head was not sent, Rapira sends `500` with an empty body. If the head was sent, Rapira cuts the response.

Sending all declared `Content-Length` bytes with `$eos = false` does not finalize the exchange. Finalize it before the next receive call. A connection close after complete response delivery does not cancel the exchange. PHP can still finalize it. A disconnect before complete delivery can cancel it.

`http.pool.request_terminate_timeout_secs` counts from the return of `receive()` or `tryReceive()`. Rapira terminates and replaces a worker that exceeds this limit. See [Configuration](/docs/configuration#http-pool) for this key.

## How the loop ends

During a stop, a reload, or a replacement after `http.pool.max_requests`, Rapira closes the dispatcher. When the dispatcher is closed and its queue is empty, `receive()` and `tryReceive()` throw `Rapira\Exception\ClosedException`. Every later call throws it again. Catch this exception, leave the loop, and let the entry script end.

An uncaught exception or a fatal error ends the entry script. Rapira then runs the entry script again in the same worker. The client of the open exchange gets an error response or an incomplete response.

::: question What happens when the entry script ends before `ClosedException`?
If the script received at least one request, Rapira runs the entry script again in the same worker. If the script ended before it received a request, Rapira counts a start failure. If a request arrives within five seconds, Rapira answers it with `503`. Then Rapira runs the script again. After five consecutive start failures, the worker exits as unhealthy.
:::

## The request

`$exchange->getRequest()` returns a read-only `Rapira\Http\Request`. Each call returns the same object.

| Property | Type | Value |
| --- | --- | --- |
| `method` | `string` | The request method, such as `GET`. |
| `uri` | `string` | The absolute URI, such as `http://example.com/a?b=1`. The scheme is always `http`. Without an authority, Rapira uses the server address. |
| `target` | `string` | The request target. For an origin-form request, this is the path and the query, such as `/a?b=1`. |
| `authority` | `?string` | The `Host` value. It is `null` for an HTTP/1.0 request without `Host`. |
| `protocol` | `string` | `HTTP/1.1` or `HTTP/1.0`. |
| `headers` | `array<string, list<string>>` | The request fields. The names are lowercase. Each name has a list of values. |
| `body` | `string` or `Multipart` | The complete body, or a `Rapira\Http\Multipart` for a `multipart/form-data` body. |
| `remote` | `InetAddress` or `UnixAddress` | The client address. `Rapira\InetAddress` has `ip` and `port`. `Rapira\UnixAddress` has `path`. |
| `server` | `InetAddress` or `UnixAddress` | The listener address. |
| `tls` | `?Rapira\Tls` | Always `null`. Rapira has no TLS listener. |
| `receivedAt` | `float` | The Unix time in seconds when Rapira received the request. |

Rapira reads the complete body into memory before PHP gets the request. `http.max_body_size_mb` limits the body size. See [HTTP](/docs/http) for the request checks.

In Dispatcher mode, `$_SERVER` keeps the values from the start of the entry script. Rapira does not change it for each request. See [`$_SERVER` before the first request](/docs/execution-modes#server-before-the-first-request).

## The response

`Rapira\Http\Exchange` has these methods. `$headers` and `$trailers` use the `array<string, list<string>>` shape: each field name has a list of values.

| Method | Behavior |
| --- | --- |
| `writeHead(int $status, array $headers = []): void` | Sets the status and the fields. The status must be from 100 through 599. Rapira does not forward a `1xx` head. Status `101` gives the client a `502`. Rapira sends the head with the first body write, `flush()`, or `writeTrailers()`. |
| `writeBody(string $content, bool $eos = true): void` | Writes body data. Without `writeHead()`, the status is `200`. Set `$eos` to `false` to write more data later. |
| `sendFile(string $path, int $offset = 0, ?int $length = null, bool $eos = true): void` | Sends a file or a part of a file as body data. See [Send a file](#send-a-file). |
| `writeTrailers(array $trailers): void` | Ends the response. Call it after `writeHead()` or a body write. Rapira does not send the trailers to the client. |
| `flush(): void` | Sends the head at once. Without `writeHead()`, the status is `200`. |
| `isFinalized(): bool` | Returns `true` when the exchange is finalized or Rapira detects its cancellation. |
| `isCancelled(): bool` | Returns `true` when Rapira detects cancellation of the exchange. A close after complete response delivery does not cancel it. |

Set `content-length` in `writeHead()` when you know the body size. A write past this length sends the part that fits, ends the response, and throws `ContentLengthExceededError`. Without `content-length`, the HTTP server frames the body. See [Response transmission](/docs/http#response-transmission) for the framing rules and the fields that Rapira removes.

To stream a response, call `writeBody()` with `$eos = false` for each part. Then call `writeBody('')` to end the response.

Keep each `writeBody()` chunk at or below 1 GiB. A larger chunk throws `\Error` and ends the response as truncated. This limit applies to each chunk, not the complete streamed response.

A slow client can fill the response channel. A write then blocks the PHP thread until space becomes available or the channel closes. This blocks all PHP Fibers in that worker.

## Uploads

Rapira parses a `multipart/form-data` body before PHP gets the request. `Request::$body` is then a `Rapira\Http\Multipart`:

| Class | Properties |
| --- | --- |
| `Multipart` | `fields`, a list of `FormField`. `files`, a list of `UploadedFile`. |
| `FormField` | `name`, `value`, `headers`. |
| `UploadedFile` | `name`, `clientFilename`, `clientMediaType`, `headers`, `tmpPath`, `size`. |

Rapira writes each file part to a temporary file in the `rapira-spool-<pid>` subdirectory of `http.uploads.dir`. `UploadedFile::$tmpPath` contains the path of this file. Rapira deletes the temporary files when the response ends. To keep a file, move it with `rename()` before the response ends.

Rapira returns `400` for a malformed body. It returns `413` when the body exceeds a limit. The script does not get these requests. See [The `[http.uploads]` table](/docs/configuration#the-http-uploads-table) for the limits.

## Send a file

`sendFile()` reads only files below the sendfile root. The default root is the directory of `http.pool.entrypoint`. Rapira resolves symbolic links before it compares the path with the root. See [The `[http.sendfile]` table](/docs/configuration#the-http-sendfile-table) to set the root.

The host opens the file. PHP `open_basedir` does not restrict this operation. The configured sendfile root restricts the path.

The call throws `Rapira\Http\Exception\FileNotSendableException` and writes no data in these conditions:

- The path is outside the root.
- The file does not exist or is not a regular file.
- The offset or the length goes past the end of the file.

Rapira does not set `content-type`, `etag`, or range fields for the file. Set the necessary fields with `writeHead()`.

```php
$exchange->writeHead(200, ['content-type' => ['application/pdf']]);
$exchange->sendFile(__DIR__ . '/files/report.pdf');
```

Put `report.pdf` in the `files/` directory beside the entry script. This path is inside the default root. A custom root must also contain the file.

## Exceptions

Each exception class in the `Rapira` namespaces implements `Rapira\Exception\RapiraThrowable`. Plain `\Error` and `\ValueError` do not implement it.

| Exception | Thrown by | Cause |
| --- | --- | --- |
| `Rapira\Exception\ClosedException` | `receive()`, `tryReceive()` | Rapira closed the dispatcher. No more requests arrive. |
| `Rapira\Exception\TimeoutException` | `receive()` | No request arrived before the timeout. |
| `Rapira\Exception\NoDispatcherError` | `\Rapira\get_dispatcher()` | The process does not run in Dispatcher mode. |
| `Rapira\Exception\WorkDiscardedException` | The write methods | Rapira cancelled the exchange before PHP finalized it. |
| `Rapira\Exception\AlreadyFinalizedError` | `writeBody()`, `sendFile()`, `writeTrailers()`, `flush()` | The response already ended. |
| `Rapira\Http\Exception\HeadAlreadyWrittenError` | `writeHead()` | The head is already set, or the response already ended. |
| `Rapira\Http\Exception\HeadNotWrittenError` | `writeTrailers()` | No head and no body data exist yet. |
| `Rapira\Http\Exception\ContentLengthExceededError` | `writeBody()`, `sendFile()` | The write goes past the declared `content-length`. |
| `Rapira\Http\Exception\FileNotSendableException` | `sendFile()` | Rapira cannot send the file. |
| `\Error` | `receive()`, `tryReceive()` | The previous exchange is still open. |
| `\Error` | `writeBody()` | One chunk exceeds 1 GiB. Rapira ends the response as truncated. |
| `\Error` | `rapira_finish_request()` | The function is not available in Dispatcher mode. End the exchange instead. |
| `\ValueError` | Several methods | An argument is not valid. Examples are a status outside 100 through 599, a field that is not valid on the network, or a trailer field such as `content-type`. |

## Output from `echo`

In Dispatcher mode, `echo`, `print`, and other PHP output do not go to the client. Rapira writes each output call to the log on the `php` target at the `info` level. The default log level `error` hides these records. Use the exchange methods to write the response. See [Logging](/docs/logging#per-target-overrides) to show the `php` target.

## The IDE stubs

Rapira declares its PHP functions and classes in stub files. The dispatcher interfaces and the core functions are in [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php). The HTTP types and the HTTP exception classes are in [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/plugins/http/rapira_http.stub.php). The other exception classes are in [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira_exception.stub.php). Add these files to the project to enable IDE completion.
