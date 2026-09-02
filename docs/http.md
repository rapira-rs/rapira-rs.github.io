---
title: HTTP requests and responses
description: "How Rapira maps HTTP requests to PHP and returns PHP responses, including fields, body limits, response framing, and rapira_finish_request()."
faqLevel: 2
---

# HTTP requests and responses

The HTTP server converts a client connection into a PHP request. It converts the PHP response into network data.
The server uses the [hyper](https://hyper.rs) library inside the Rapira binary. It accepts HTTP/1.1 and HTTP/1.0 on the master socket.
It parses each request, sends it to PHP, and writes the PHP response. It does not proxy requests to another server.
Middleware can answer a request before PHP runs. Rapira uses this method to serve [static files](/docs/static-files).

This page describes the differences between the HTTP and PHP representations. It explains request validation, `$_SERVER` field mapping, repeated fields, and request-body limits. It also explains how the HTTP server frames a response.

::: info
The HTTP server accepts plain HTTP. Use a proxy to terminate TLS. See [Deployment](/docs/deployment).
:::

## Request admission

The HTTP server checks each request before PHP runs. It answers a request that fails a check without calling PHP.

Rapira returns `501` for a `CONNECT` request. The HTTP server does not create tunnels.

Rapira accepts an absolute-form request target, such as `GET http://host.example/admin?x=1 HTTP/1.1`. The target authority replaces the `Host` field.
Rapira first removes user information from the authority. This prevents a conflict in `$_SERVER['HTTP_HOST']`.
PHP receives the origin-form path and query in `$_SERVER['REQUEST_URI']`.

`http.keepalive_timeout_secs` limits each read from the client. It applies to an idle connection and the request headers.
Rapira returns `408` when request body reading does not progress before the limit. It then closes the connection.
The default is 60 seconds.

```toml
[http]
keepalive_timeout_secs = 60
```

## From a header name to a `$_SERVER` key

CGI converts a request field name to uppercase. It replaces each `-` with `_` and adds `HTTP_`.
See [RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18). Thus, `X-Forwarded-For` becomes `HTTP_X_FORWARDED_FOR`.

PHP applies another conversion when it registers the variable. It also replaces `.` with `_`.
Therefore, these three network field names map to one PHP key:

| On the wire       | In PHP                              |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
This aliasing causes a security risk. A proxy can set `X-Forwarded-For`, while a client sends `X_Forwarded_For`.
Both names map to the same `$_SERVER` key. A proxy filter for the hyphenated name might not remove the name with underscores.
The application could then trust a value from the client.
:::

## Names that alias a CGI variable

Rapira checks request field names before other processing. It accepts only bytes in `[A-Za-z0-9-]`.
Both `_` and `.` can map to the same `$_SERVER` key as `-`. The allowed character list also rejects other characters, such as `~`.
`http.unsafe_field_names` controls rejected names:

- **`drop`** is the default. Rapira removes the field before PHP receives it and logs each removal at `warn`.
- **`reject`** makes Rapira return `400`.

```toml
[http]
unsafe_field_names = "drop"
```

You cannot disable the check or add exceptions for individual names. See [Configuration](/docs/configuration) for the complete setting reference.

Change a required field name with underscores to use hyphens. Rapira applies the same rule to fields from a proxy.
It cannot determine whether a client or trusted proxy sent a field with underscores. Configure the proxy to change the name before sending it.

::: tip
`drop` logs each removal at `warn`, but the default log level is `error`. Set the `http` target to `warn` to see these records.
See [Logging](/docs/logging) for more information.
:::

## Fields sent more than once

HTTP permits repeated fields, but CGI provides one value for each variable. Rapira combines repeated values according to the field syntax:

- **List fields:** Rapira joins values with `, `. [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) permits this format for comma-separated fields.
- For example, two `Accept` lines become `text/*, image/*`.
- **`Cookie`:** Rapira joins values with `; `, which is the format that the PHP cookie parser expects.
- **Single-value fields:** Rapira keeps the first `Authorization`, `Proxy-Authorization`, `Content-Type`, `Referer`, or `From` line.
- It removes additional lines and writes a `warn` record. Combining these fields would change their values.
- Rapira returns `400` for repeated `Content-Length` fields before this processing.
- **`Host`:** Rapira returns `400` for more than one `Host` line. It does not combine the values.
- [RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2) requires this behavior.

PHP receives field values as unmodified bytes. Thus, a Latin-1 cookie or signed field retains each byte that the client sent.

## Request bodies

Rapira reads the request body into memory before PHP runs. `http.max_body_size_mb` limits the memory for one body.
The default is 8 MiB, which equals the PHP `post_max_size` default.
Rapira returns `413` for a larger body and closes the connection. It does not read the remaining body data.

Rapira checks the limit twice:

- Rapira first checks the declared `Content-Length` before it reads body data.
- It checks again as body chunks arrive. This second check limits chunked requests that have no declared length.

Rapira supports `Expect: 100-continue` for HTTP/1.1 requests. It sends `100 Continue` before the client sends the body.
Rapira checks `Content-Length` first. Therefore, it can return `413` before the client uploads a body that is too large.
Rapira ignores the expectation for HTTP/1.0, as [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1) requires.

```toml
[http]
max_body_size_mb = 8
```

## Response transmission

The HTTP server does not buffer the response body. It writes the response head when PHP commits it. It then writes each body frame as PHP produces it.
The mode controls when PHP produces this data. In Classic and Worker modes, PHP normally passes the complete response when the request ends.
A call to `rapira_finish_request()` passes it earlier. In Dispatcher mode, PHP passes the head and each body chunk as the code writes them.

The server controls response framing. It removes `Transfer-Encoding` and `Content-Length` fields set by PHP.
This prevents an incorrect length from changing message boundaries.
In Classic and Worker modes, the server sets the length of the complete PHP body.
In Dispatcher mode, it uses `Content-Length` from the response head and counts body bytes.
It closes the connection for a short body. It cuts a long body at the declared length.

The HTTP server frames a response that declares no length. It uses chunked transfer coding for an HTTP/1.1 client.
It closes the connection after it sends the body to an HTTP/1.0 client.

The server omits `Content-Length` from `204` and `304` responses. It also omits this field and the body from `HEAD` responses.

The server removes connection-specific fields that PHP sets. [RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1) defines this behavior.
It removes these fields:

`Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE`, `Proxy-Connection`, plus the two framing fields `Content-Length` and `Transfer-Encoding`.

When PHP sends `Connection`, Rapira also removes each field that it names. This occurs before Rapira adds its own `Content-Length`.
Therefore, `Connection: content-length` cannot remove response framing.

Rapira sends other PHP fields without changes, including repeated `Set-Cookie`, `Vary`, and `Link` fields.
It removes an invalid network field and writes a log record. It still sends the remaining response.

Rapira removes interim response heads and trailers from PHP. It creates the `100 Continue` response for an `Expect` request itself.

A truncated reply closes the connection without a complete terminator. A worker can terminate before the body ends.
The body can also be shorter than the length that PHP declared. A fatal error or uncaught exception can end a script after it writes output.
Each case produces an incomplete message. The client can detect this incomplete message.

An error response from the HTTP server has no body. It includes `cache-control: private, no-store` and `connection: close`.
Examples are `413` for a large body and `501` for `CONNECT`.

::: question Why does the HTTP server set the framing fields instead of PHP?
The HTTP server compares the response body size with its declared length. It closes the connection when the body is too short.
This prevents the client from reading the next response as part of the current response.
The server removes a PHP `Content-Length` because that field could bypass the byte count.
:::

## Finishing the response early

A handler can have work after the response is ready. Examples include sending a webhook, writing a queue entry, or updating cached data.
The client does not have to wait for this work.

`rapira_finish_request()` ends the response at that point. PHP flushes its output buffers and gives the response to the HTTP server.
The HTTP server sends the response while the handler continues. The function has the same contract as `fastcgi_finish_request()`.
Therefore, code written for php-fpm keeps the same behavior:

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// This code runs after the client receives the response.
$mailer->sendConfirmation($order);
$metrics->flush();
```

The signature is `rapira_finish_request(): bool`.
[`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) declares it and the other PHP APIs.
Configure the IDE to use this file for completion and type information.

Rapira registers the function for the complete process. The function acts on the current request.
Therefore, Classic mode also supports it. Resident and per-request scripts get the same behavior.
See [execution modes](/docs/execution-modes) for more information about the differences between the modes.

The function has two important limits:

- **Output after the call is not sent.** Rapira discards output after it closes the response.
- Write all required client output before the call.
- **The worker continues to run the handler.** It cannot accept its next request until the handler returns.
- The call can reduce client wait time but does not add concurrency. Put long operations in a queue.
- See [Process model](/docs/process-model) for worker concurrency.
