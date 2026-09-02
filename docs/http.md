---
title: HTTP requests and responses
description: "How Rapira turns an HTTP request into PHP superglobals and a PHP response back into bytes on the wire: field-name mapping, repeated fields, body limits, response framing, and rapira_finish_request()."
faqLevel: 2
---

# HTTP requests and responses

The HTTP front is the Rapira component that turns a client connection into a PHP request, and the PHP response back into bytes on the wire. It is built on the [hyper](https://hyper.rs) library, and it ships inside the binary. It terminates HTTP/1.1 and HTTP/1.0. It accepts connections on the socket the master bound, parses the request, hands it to PHP, and writes back what PHP produced. There is no upstream: nothing is proxied, and every request is answered locally. A middleware in front of PHP can answer a request on its own, which is how [static files](/docs/static-files) are served.

This page covers the parts where the translation between HTTP and PHP is not one-to-one: what the front refuses before PHP runs, which header field lands in which `$_SERVER` key, what happens when a client sends the same field twice, how big a request body may be, and how your response is framed on the way out.

::: info
The front terminates plaintext HTTP. If you need TLS, terminate it in a proxy in front of Rapira — see [Deployment](/docs/deployment).
:::

## Request admission

The front checks each request before PHP runs. A request that fails a check is answered by the front, and PHP never sees it.

A `CONNECT` request is answered `501`. The front implements no tunnels.

An absolute-form request target is accepted, for example `GET http://host.example/admin?x=1 HTTP/1.1`. The authority in the target replaces the `Host` field, and the userinfo part of the authority is removed first, so `$_SERVER['HTTP_HOST']` cannot disagree with the target. PHP sees the origin-form path and query in `$_SERVER['REQUEST_URI']`.

`http.keepalive_timeout_secs` bounds every read from the client. It closes an idle keep-alive connection, and it also bounds the read of the request head. A request body that makes no read progress within that time is answered `408`, and the connection closes. The default is 60 seconds.

```toml
[http]
keepalive_timeout_secs = 60
```

## From a header name to a `$_SERVER` key

CGI has one rule for exposing request fields to a script: take the field name, uppercase it, replace every `-` with `_`, and prepend `HTTP_` ([RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18)). So `X-Forwarded-For` becomes `HTTP_X_FORWARDED_FOR`, and that is the key your code reads.

PHP then applies a second rewrite of its own when it registers the variable: `.` also becomes `_`. Two mappings, both collapsing different characters onto the same underscore, and the result is that three different names on the wire arrive at exactly one key:

| On the wire       | In PHP                              |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
This aliasing is a security problem. If a trusted proxy in front of Rapira sets `X-Forwarded-For`, a client that sends `X_Forwarded_For` reaches the same `$_SERVER` key — and the proxy's own header filter, which strips the spelling with dashes, never sees the underscore one. The client can set a value that your application treats as coming from the proxy.
:::

## Names that alias a CGI variable

Because of that, Rapira screens request field names before any other layer sees them. A name is accepted when every byte is in `[A-Za-z0-9-]`. `_` and `.` are the characters that alias — both collapse onto the same `$_SERVER` key as the dash spelling. The rule is an allowlist rather than a denylist of those two bytes, so a legal but unusual character like `~` is refused as well, and the screen stays correct if either mapping ever widens. `http.unsafe_field_names` decides what happens to a name it refuses:

- **`drop`** (the default) — the field is removed before PHP sees it, and each removal is logged at `warn` on the `http` target.
- **`reject`** — the request is answered `400` and nothing is served.

```toml
[http]
unsafe_field_names = "drop"
```

There is no third option that turns the screen off and no per-name exception, because the aliasing the screen prevents is a security problem — see [Configuration](/docs/configuration) for where the key sits among the rest of the settings.

If your clients legitimately send a name with an underscore in it, the fix is to rename it to the `-` spelling. The screen treats a proxy's own fields the same way, since Rapira cannot tell an underscore-spelled field written by a trusted proxy from one forged by a client, so a proxy that sets `X_Forwarded_For` has it dropped before PHP runs. A proxy in front of Rapira can do that rewrite in one line of its own configuration, and then the name is ordinary and passes untouched.

::: tip
`drop` logs every removal at `warn`, but the default log level is `error`, so those lines are invisible until you raise it. If a header is unexpectedly missing from `$_SERVER`, turn the level up and look at the `http` target first — [Logging](/docs/logging) shows how.
:::

## Fields sent more than once

HTTP lets a client repeat a field, and CGI has room for only one value per variable, so the repeats have to be folded into a single value before PHP sees anything. Rapira folds them the way the field's own grammar says it may be folded:

- **List fields** — the values are joined with `, `, which is the recombination [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) permits for a field defined as a comma-separated list. Two `Accept` lines become `text/*, image/*`.
- **`Cookie`** — also a list, but not a comma one. Its repeats are joined with `; `, the cookie-string form PHP's parser expects, so `$_COOKIE` comes out right.
- **Single-value fields** — `Authorization`, `Proxy-Authorization`, `Content-Type`, `Content-Length`, `Referer` and `From` keep the **first** line only, and the extra ones are dropped with a `warn`. Joining them would corrupt them: a second `Authorization` folded into the first lands inside the credential PHP is about to base64-decode. A repeated `Content-Length` is answered `400` before folding runs, so only the other five ever reach this rule.
- **`Host`** — more than one `Host` line is answered `400`, never folded. [RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2) makes that a MUST, and the layer terminating the connection is the only one that can give the correct answer.

Field values reach PHP as raw bytes throughout. A latin1 cookie or a signed header keeps every octet the client sent, because a UTF-8 conversion in the middle would corrupt exactly the values that must not change.

## Request bodies

A request body is read into memory before PHP runs, and `http.max_body_size_mb` caps how much of it Rapira holds. The default is 8 MiB — the same figure as PHP's own `post_max_size` default. A body over the cap is answered `413`, and because the rest of it is still on the wire, that response also closes the connection instead of trying to reuse it.

The limit is checked twice:

- Against the declared `Content-Length`, before a single byte of body is read.
- Again while the body arrives, chunk by chunk. A chunked request declares no length up front, so this second check is what bounds its memory use.

`Expect: 100-continue` is honored for HTTP/1.1 requests — Rapira writes the interim `100 Continue` and the client then sends the body it was holding back. The order matters: the `Content-Length` check runs *first*, so a client that announces an oversized body is told `413` before it uploads anything. An HTTP/1.0 request's expectation is ignored, as [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1) requires.

```toml
[http]
max_body_size_mb = 8
```

## How the response goes out

The front does not buffer the response body. It writes the response head as soon as PHP commits it, and each body frame as PHP produces it. The mode decides when PHP produces them. In Classic and Worker modes PHP holds the whole response and passes it to the front when the request ends, or earlier if the script calls `rapira_finish_request()`. In Dispatcher mode PHP passes the head and each body chunk to the front as the code writes them.

Framing is the server's job, not PHP's. A `Transfer-Encoding` your code sets is dropped. A `Content-Length` your code sets is removed from the field lines, so a stale length can never desynchronize the connection. In Classic and Worker modes the front then declares the length of the body PHP produced. In Dispatcher mode the `Content-Length` on the head you write becomes the length the reply declares: the front sends that length and counts the body against it. A body shorter than the declared length ends the connection, and a body longer than it is cut at that length.

A reply that declares no length is framed by the front. An HTTP/1.1 client gets the chunked transfer coding. An HTTP/1.0 client gets a body that the connection close delimits.

Responses that have no body by definition, `204` and `304`, get no `Content-Length` at all. The response to a `HEAD` request is treated the same way: the front sends the head with no `Content-Length` and no body bytes.

Hop-by-hop fields belong to a single connection rather than to the response, so PHP does not get to set them either ([RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1)). These are stripped from whatever your code emitted:

`Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE`, `Proxy-Connection`, plus the two framing fields `Content-Length` and `Transfer-Encoding`.

If PHP does send a `Connection` header, the fields it names are stripped as well — that is what a `Connection` value means — and that removal runs before Rapira inserts its own `Content-Length`, so a `Connection: content-length` cannot remove the framing from the response.

Everything else passes through as PHP wrote it, repeats included: `Set-Cookie`, `Vary` and `Link` may legitimately appear several times and all of them are sent. A header that cannot be represented on the wire at all is dropped with a log line rather than failing the response, so the rest of the response is still sent.

An interim (1xx) response head from PHP is dropped, and trailers from PHP are dropped as well. The front forwards neither. The `100 Continue` for an `Expect` request is not a PHP interim head: the front writes that one itself.

A truncated reply drops the connection without a clean terminator. A reply is truncated when the worker dies before the body ends, when the body is shorter than the length PHP declared, or when a fatal error or an uncaught exception ends the script after it wrote output. The client then reads an incomplete message, so it can tell the response was cut short.

An error response the front writes itself carries `cache-control: private, no-store` and `connection: close`, and has no body. A `413` for an oversized body and a `501` for `CONNECT` are such responses.

::: question Why does the front set the framing fields instead of PHP?
A response is framed by the bytes the front puts on the wire. The front takes the length the reply declares and counts the body against it. A body shorter than the declared length ends the connection, so the client cannot read the next response as the tail of this one. A `Content-Length` set as an ordinary header would bypass that count, so it is stripped.
:::

## Finishing the response early

A handler often has work left once the response is ready: a webhook to fire, a queue entry to write, a cache to warm. The client does not have to wait for it.

`rapira_finish_request()` ends the response at that point. PHP's output buffers are flushed into the response, the response is handed to the front and goes out to the client, and your handler keeps running with the client already holding the whole response. It is the same contract as `fastcgi_finish_request()`, so code written for php-fpm behaves the way it always did:

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// The client already has the response; this still runs.
$mailer->sendConfirmation($order);
$metrics->flush();
```

The signature is `rapira_finish_request(): bool`. It is declared, along with everything else Rapira exposes to PHP, in [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) — point your IDE at that file for completion and type hints.

The function is registered for the whole process and acts on the request being served, so classic mode supports it as well: the behavior is the same whether the script is resident or re-run per request. See [Execution modes](/docs/execution-modes) for what else changes between modes.

Two things to keep in mind:

- **Output after the call is not sent.** The response is closed, so an `echo` that follows is discarded — it is not queued for a later flush. Anything the client must see has to be written before the call.
- **The worker is still busy.** Finishing the response frees the *client*, not the process. This worker does not pick up the next request until your handler returns, so the work you moved after the call is work the next request still waits for — see [Process model](/docs/process-model) for how many workers there are to wait on. The call lowers client latency but adds no concurrency, so heavy work belongs in a queue.
