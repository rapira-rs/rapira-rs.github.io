---
title: HTTP requests and responses
description: "How Rapira maps HTTP requests to PHP and returns PHP responses, including fields, body limits, response framing, and rapira_finish_request()."
faqLevel: 2
---

# HTTP requests and responses

The HTTP server converts a client connection into a PHP request and converts the PHP response into network data. It uses the [hyper](https://hyper.rs) library and accepts HTTP/1.1 and HTTP/1.0. It does not proxy requests to another server.

Middleware can answer a request before PHP runs. Rapira uses middleware to serve [static files](/docs/static-files).

::: info
The HTTP server accepts plain HTTP. Use a proxy to terminate TLS. See [Deployment](/docs/deployment).
:::

## Request checks

The HTTP server checks each request before PHP runs. It does not call PHP for a request that fails a check.

Rapira returns `501` for a `CONNECT` request. The HTTP server does not create tunnels.

Rapira accepts an absolute-form request target, such as `GET http://host.example/admin?x=1 HTTP/1.1`. Rapira removes the user information from the target authority. Then the authority replaces the `Host` field, so `$_SERVER['HTTP_HOST']` and the target agree. PHP receives the origin-form path and query in `$_SERVER['REQUEST_URI']`.

`http.keepalive_timeout_secs` limits each read from the client. It applies to an idle connection and the request headers. Rapira returns `408` if it receives no request body data before the limit. It then closes the connection. The default is 60 seconds.

```toml
[http]
keepalive_timeout_secs = 60
```

## From a header name to a `$_SERVER` key

CGI converts a request field name to uppercase, replaces each `-` with `_`, and adds `HTTP_`. See [RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18). Thus, `X-Forwarded-For` becomes `HTTP_X_FORWARDED_FOR`.

PHP applies another conversion when it registers the variable. It also replaces `.` with `_`. Thus, these three network field names map to one PHP key:

| On the wire       | In PHP                              |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
Without Rapira's mandatory field-name check, this aliasing can create a security risk. A proxy can set `X-Forwarded-For`, while a client sends `X_Forwarded_For`. Both names map to the same `$_SERVER` key. A proxy filter for the hyphenated name might not remove the name with underscores. The application could then trust a value from the client.
:::

Rapira also sets the CGI request variables. `SERVER_NAME` comes from `http.server_name`, and the default is `localhost`. `SERVER_PORT` comes from `http.server_port`, and the default is the TCP port of `http.listen` or `80` for a Unix socket. For a client on a Unix socket, `REMOTE_ADDR` is `127.0.0.1` and `REMOTE_PORT` is `0`. Rapira does not set `PATH_INFO`.

Rapira accepts plain HTTP only. Thus, `$_SERVER['HTTPS']` is always empty and `REQUEST_SCHEME` is always `http`. Behind a TLS proxy, configure the application to read the proxy fields.

## Names that alias a CGI variable

Rapira accepts only the bytes `A-Z`, `a-z`, `0-9`, and `-` in a request field name. This rule rejects `_` and `.`, and also other characters such as `~`. `http.unsafe_field_names` sets the action for a rejected name:

- **`drop`** is the default. In Classic and Worker modes, Rapira removes the fields before PHP receives them. It writes one `warn` record for each request. In Dispatcher mode, `drop` keeps all names, because Rapira does not put request fields in `$_SERVER` in this mode.
- **`reject`** makes Rapira return `400` in all modes.

```toml
[http]
unsafe_field_names = "drop"
```

You cannot disable the check or add exceptions for individual names. See [Configuration](/docs/configuration) for the complete setting reference.

Change a required field name with underscores to use hyphens. Rapira applies the same rule to fields from a proxy. It cannot determine whether a client or trusted proxy sent a field with underscores. Configure the proxy to change the name before it sends the field.

::: tip
`drop` writes its records at `warn`, but the default log level is `error`. Set the `http` target to `warn` to see these records. See [Logging](/docs/logging) for more information.
:::

## Fields sent more than once

HTTP permits repeated fields, but CGI provides one value for each variable. Rapira combines repeated values according to the field syntax:

- **List fields:** Rapira joins the values with a comma and a space. For example, two `Accept` lines become `text/*, image/*`. [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) permits this format for comma-separated fields.
- **`Cookie`:** Rapira joins the values with a semicolon and a space. The PHP cookie parser expects this format.
- **Single-value fields:** Rapira keeps the first `Authorization`, `Proxy-Authorization`, `Content-Type`, `Referer`, or `From` line. It ignores the other lines, because a combined value has a different meaning.
- **`Host`:** Rapira returns `400` for more than one `Host` line. [RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2) requires this behavior.

Rapira returns `400` for `Content-Length` lines with different values before this processing.

PHP receives field values as unmodified bytes. Thus, a Latin-1 cookie or signed field keeps each byte that the client sent.

## Request bodies

Rapira reads the request body into memory before PHP runs. `http.max_body_size_mb` limits the memory for one body. The default is 8 MiB, which equals the PHP `post_max_size` default. Rapira returns `413` for a larger body and closes the connection. It does not read the rest of the body data.

Rapira checks the limit twice:

- Rapira first checks the declared `Content-Length` before it reads body data.
- It checks again as body chunks arrive. This second check limits chunked requests that have no declared length.

Rapira supports `Expect: 100-continue` for HTTP/1.1 requests. It sends `100 Continue` before the client sends the body. Rapira checks `Content-Length` first. Thus, it can return `413` before the client uploads a body that is too large. Rapira ignores the expectation for HTTP/1.0, as [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1) requires.

```toml
[http]
max_body_size_mb = 8
```

## Response transmission

The mode controls when the HTTP server receives the response from PHP:

- In Classic and Worker modes, Rapira keeps the complete response in memory. It sends the response when the request ends, or when the script calls `rapira_finish_request()`.
- In Dispatcher mode, Rapira sends the head with the first body write or with `Exchange::flush()`. It then sends each body chunk when the script writes it.

`http.write_timeout_secs` limits the time that one write to the client can stall. When the limit expires, Rapira closes the connection. The default is 30 seconds.

The server controls response framing. Thus, an incorrect length from PHP does not change message boundaries. The server removes these fields that PHP sets: `Content-Length`, `Transfer-Encoding`, `Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE`, and `Proxy-Connection`. [RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1) defines these connection-specific fields.

When PHP sends `Connection`, Rapira also removes each field that it names. Rapira adds its own `Content-Length` after this step. Thus, `Connection: content-length` cannot remove the response framing.

Rapira then sets the length:

- In Classic and Worker modes, Rapira sets `Content-Length` to the length of the complete body.
- In Dispatcher mode, Rapira uses the `Content-Length` that the script declares in the head. It closes the connection when the body is shorter, so the client does not read the next response as part of this one. It cuts a body that is longer.
- In Dispatcher mode, Rapira calculates `Content-Length` when the first `writeBody()` or `sendFile()` ends the response before the head is sent. A declared length takes priority. A trailers-only response gets length zero.
- If the head has no declared or calculated length, Rapira uses chunked transfer coding for HTTP/1.1. For HTTP/1.0, it closes the connection after the body. This applies to streaming writes and an early `Exchange::flush()`.

For PHP responses, Rapira removes `Content-Length` and sends no body for `204`, `304`, and `HEAD`. Static-file `HEAD` responses keep the file length. See [Static files](/docs/static-files).

Rapira sends other PHP fields without changes, for example repeated `Set-Cookie`, `Vary`, and `Link` fields. In Classic and Worker modes, it removes an invalid field and writes a `debug` log record, but it sends the rest of the response. Rapira does not send interim (`1xx`) heads or trailers from PHP. Thus, `103 Early Hints` does not reach the client.

If a worker stops before the body ends, the server closes the connection without a complete terminator. A fatal error after output starts can also cut the response. In Worker mode, an uncaught handler exception after output starts cuts the response, but the loop continues. The client can detect each incomplete message.

::: question Does `flush()` send output early in Classic and Worker modes?
No. The PHP `flush()` function does not send data to the client. Use Dispatcher mode to stream a response. When the buffered body exceeds 1 GiB, Rapira stops the request, and the client receives an incomplete response.
:::

## Error responses

The HTTP server sends an error response when a request does not reach PHP or PHP sends no response head. This response has no body. It includes `cache-control: private, no-store` and `connection: close`.

| Status | Cause |
| --- | --- |
| `400` | The request has more than one `Host` field. An HTTP/1.1 request has no `Host` field or an empty `Host` field. A field name is unsafe and `unsafe_field_names = "reject"` is set. The body read failed. In Dispatcher mode, a multipart body is not valid. |
| `408` | No body data arrived within `http.keepalive_timeout_secs`. |
| `413` | The body is larger than `http.max_body_size_mb`, or a multipart body exceeds an `[http.uploads]` limit. |
| `500` | The worker pool stopped. In Dispatcher mode, Rapira cannot write an uploaded file to `[http.uploads].dir`. |
| `501` | The request uses `CONNECT`. |
| `502` | The PHP worker stopped before it sent the response head. |
| `503` | The worker queue stayed full for 30 seconds. |

Rapira sends these statuses without the two fields:

- `503` when a worker fails to start its entry script. After each failed start, the worker answers one queued request with this status.
- `502` when PHP sets a final status below `200`, such as `101`.
- `500` when a Dispatcher script releases an exchange before Rapira sends the response head.

## Dispatcher mode

In Dispatcher mode, Rapira does not put request fields in `$_SERVER`. The script reads the request from a `Rapira\Http\Exchange` object and writes the response with its methods. Rapira parses a `multipart/form-data` body before the script receives it. See [Dispatcher mode](/docs/dispatcher) for the API, uploads, and `sendFile()`.

## Finishing the response early

A handler can continue its work after the response is ready. For example, it can send a webhook, write a queue entry, or update cached data. The client does not have to wait for this work.

`rapira_finish_request()` ends the response at that point. PHP flushes its output buffers and gives the response to the HTTP server. The HTTP server sends the response while the handler continues. The function works like the php-fpm `fastcgi_finish_request()` function. Rapira does not provide `fastcgi_finish_request()`. Replace each call to it with `rapira_finish_request()`:

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// This code runs after the client receives the response.
$mailer->sendConfirmation($order);
$metrics->flush();
```

The signature is `rapira_finish_request(): bool`. [`crates/sapi/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php) declares it and the other PHP functions and classes. Configure the IDE to use this file for completion and type information.

`rapira_finish_request()` works in Classic and Worker modes. In Dispatcher mode, the call throws `\Error`. In this mode, finalize the exchange that `receive()` returns, and then continue the work. See [Dispatcher mode](/docs/dispatcher) and [execution modes](/docs/execution-modes) for more information.

The function has these limits:

- **Rapira discards output after the call.** Write all client output before the call.
- **The worker continues to run the handler.** It cannot accept its next request until the handler returns. Thus, the call can reduce the client wait time, but it does not add concurrency. Put long operations in a queue. See [Process model](/docs/process-model) for worker concurrency.
