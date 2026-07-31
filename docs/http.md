---
title: HTTP requests and responses
description: How Rapira turns an HTTP request into PHP superglobals and a PHP response back into bytes on the wire — field-name mapping, repeated fields, body limits, buffering, and rapira_finish_request().
---

# HTTP requests and responses

Rapira's HTTP front is built on [Pingora](https://github.com/cloudflare/pingora) and ships inside the binary. It accepts connections on the socket the master bound, parses the request, hands it to PHP, and writes back whatever PHP produced. There is no upstream: every request is answered locally, by your code.

Most of the time you never think about this layer — you write `$_GET['page']`, you `echo` something, and it works. This page is about the parts where the translation between HTTP and PHP is not one-to-one: which header field lands in which `$_SERVER` key, what happens when a client sends the same field twice, how big a request body may be, and how your response is framed on the way out.

::: info
The front terminates plaintext HTTP. If you need TLS, terminate it in a proxy in front of Rapira — see [Deployment](/docs/deployment).
:::

## From a header name to a `$_SERVER` key

CGI has one rule for exposing request fields to a script: take the field name, uppercase it, replace every `-` with `_`, and prepend `HTTP_` ([RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18)). So `X-Forwarded-For` becomes `HTTP_X_FORWARDED_FOR`, and that is the key your code reads.

PHP then applies a second rewrite of its own when it registers the variable: `.` also becomes `_`. Two mappings, both collapsing different characters onto the same underscore, and the result is that three different names on the wire arrive at exactly one key:

| On the wire       | In PHP                              |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
This is not a curiosity, it is the whole problem. If a trusted proxy in front of Rapira sets `X-Forwarded-For`, a client that sends `X_Forwarded_For` reaches the same `$_SERVER` key — and the proxy's own header filter, which strips the spelling with dashes, never sees the underscore one. The client gets to write a value your application believes came from the proxy.
:::

## Names that alias a CGI variable

Because of that, Rapira screens request field names before anything else looks at them. A name is accepted when every byte is in `[A-Za-z0-9-]`. `_` and `.` are the characters that actually alias — both collapse onto the same `$_SERVER` key a dash name owns. The rule is an allowlist rather than a denylist of those two bytes, so a legal but unusual character like `~` is refused as well, and the screen stays correct if either mapping ever widens. `http.unsafe_field_names` decides what happens to a name it refuses:

- **`drop`** (the default) — the field is removed before PHP sees it, and each removal is logged at `warn` on the `http` target.
- **`reject`** — the request is answered `400` and nothing is served, so a client cannot even try.

```toml
[http]
unsafe_field_names = "drop"
```

There is deliberately no third option that turns the screen off. Servers that shipped a plain off-switch are exactly where this collision keeps coming back, so Rapira does not offer one — see [Configuration](/docs/configuration) for where the key sits among the rest of the settings.

If your clients legitimately send a name with an underscore in it, the fix is to rename it to the `-` spelling. A proxy in front of Rapira can do that rewrite in one line of its own configuration, and then the name is ordinary and passes untouched.

::: tip
`drop` logs every removal at `warn`, but the default log level is `error`, so those lines are invisible until you raise it. If a header is mysteriously missing from `$_SERVER`, turn the level up and look at the `http` target first — [Logging](/docs/logging) shows how.
:::

## Fields sent more than once

HTTP lets a client repeat a field, and CGI has room for only one value per variable, so the repeats have to be folded into a single value before PHP sees anything. Rapira folds them the way the field's own grammar says it may be folded:

- **List fields** — the values are joined with `, `, which is the recombination [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) permits for a field defined as a comma-separated list. Two `Accept` lines become `text/*, image/*`.
- **`Cookie`** — also a list, but not a comma one. Its repeats are joined with `; `, the cookie-string form PHP's parser expects, so `$_COOKIE` comes out right.
- **Single-value fields** — `Authorization`, `Proxy-Authorization`, `Content-Type`, `Content-Length`, `Referer` and `From` keep the **first** line only, and the extra ones are dropped with a `warn`. Joining them would corrupt them: a second `Authorization` folded into the first lands inside the credential PHP is about to base64-decode, turning a working login into garbage.
- **`Host`** — more than one `Host` line is answered `400`, never folded. [RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2) makes that a MUST, and the layer terminating the connection is the only one that can give the correct answer.

Field values reach PHP as raw bytes throughout. A latin1 cookie or a signed header keeps every octet the client sent, because a well-meaning UTF-8 conversion in the middle would corrupt exactly the values that must not change.

## Request bodies

A request body is read into memory before PHP runs, and `http.max_body_size_mb` caps how much of it Rapira is willing to hold. The default is 8 MiB — the same figure as PHP's own `post_max_size` default. A body over the cap is answered `413`, and because the rest of it is still on the wire, that response also closes the connection instead of trying to reuse it.

The limit is checked twice, which matters more than it sounds:

- Against the declared `Content-Length`, before a single byte of body is read.
- Again while the body arrives, chunk by chunk. A chunked request declares no length up front, so this second check is the only thing standing between it and unbounded memory.

`Expect: 100-continue` is honored for HTTP/1.1 requests — Rapira writes the interim `100 Continue` and the client then sends the body it was holding back. The order is what makes this worth having: the `Content-Length` check runs *first*, so a client that announces an oversized body is told `413` before it uploads anything. An HTTP/1.0 request's expectation is ignored, as [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1) requires.

```toml
[http]
max_body_size_mb = 8
```

## How the response goes out

Everything PHP writes is buffered until the request finishes, and only then does the response head go on the wire. That buys one thing that is worth the buffer: the server knows the exact body length, so it can send a real `Content-Length`. Without a framed body, HTTP/1.1 has to fall back to close-delimiting — the connection ends the response, which means a new connection for every single request. With a `Content-Length`, keep-alive works and the connection stays up.

Framing is therefore the server's job, not PHP's. A `Content-Length` or `Transfer-Encoding` your code sets is dropped and replaced by what the buffered body actually measures, so a stale length can never desynchronize the connection. Responses that have no body by definition — `204` and `304` — get no `Content-Length` at all.

Hop-by-hop fields belong to a single connection rather than to the response, so PHP does not get to set them either ([RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1)). These are stripped from whatever your code emitted:

`Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE`, `Proxy-Connection`, plus the two framing fields `Content-Length` and `Transfer-Encoding`.

If PHP does send a `Connection` header, the fields it names are stripped as well — that is what a `Connection` value means — and that removal runs before Rapira inserts its own `Content-Length`, so a `Connection: content-length` cannot strip the framing out from under the body.

Everything else passes through as PHP wrote it, repeats included: `Set-Cookie`, `Vary` and `Link` may legitimately appear several times and all of them are sent. A header that cannot be represented on the wire at all is dropped with a log line rather than failing the response — one bad field must not cost you the body.

## Finishing the response early

Sometimes the client's part of the work is done long before the request is. The response is ready, but there is a webhook to fire, a queue entry to write, a cache to warm. Making the browser wait for that is pure latency with nothing to show for it.

`rapira_finish_request()` ends the response there and then. The buffered output is flushed, the response is handed to the front and goes out to the client, and your handler keeps running with the client already holding the whole response. It is the same contract as `fastcgi_finish_request()`, so code written for php-fpm behaves the way it always did:

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// The client already has the response; this still runs.
$mailer->sendConfirmation($order);
$metrics->flush();
```

The signature is `rapira_finish_request(): bool`. It is declared, along with everything else Rapira exposes to PHP, in [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) — point your IDE at that file and you get completion and type hints for free.

Two things to keep in mind:

- **Output after the call is not sent.** The response is sealed, so an `echo` that follows goes nowhere — it is not queued for a later flush, it is simply dropped. Anything the client must see has to be written before the call.
- **The worker is still busy.** Finishing the response frees the *client*, not the process. This worker does not pick up the next request until your handler actually returns, so the work you moved after the call is work the next request still waits for — see [Process model](/docs/process-model) for how many workers there are to wait on. It is a latency tool, not a concurrency one; if the work is heavy, it belongs in a queue.

::: question My proxy sets `X_Forwarded_For` and PHP suddenly can't see it. What happened?
It was dropped, because an underscore name lands on the same `$_SERVER` key as the dash-spelled one and Rapira cannot tell your proxy's header from a client's forgery. Rename it to `X-Forwarded-For` in the proxy — that spelling is ordinary and passes untouched. Raise the log level to `warn` and you will see the drop being logged.
:::

::: question Can I turn the field-name screen off just for one header?
No. There is no off-switch and no per-name exception — the only settings are `drop` and `reject`. Rename the field to its `-` spelling in the layer in front of Rapira instead; that solves it properly rather than reopening the hole.
:::

::: question Why doesn't my `header('Content-Length: …')` show up in the response?
Because framing belongs to the server. Rapira buffers the whole body, so it knows the real length and sends that; your value is dropped rather than trusted. The same goes for `Transfer-Encoding` and the hop-by-hop fields.
:::

::: question Does `rapira_finish_request()` work in classic mode?
Yes — the function is registered for the whole process and acts on the request being served, so it behaves the same whether the script is resident or re-run per request. See [Execution modes](/docs/execution-modes) for what else changes as you climb the ladder.
:::
