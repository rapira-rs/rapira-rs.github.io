---
title: HTTP 请求与响应
description: "Rapira 如何将 HTTP 请求映射到 PHP 并返回 PHP 响应，包括字段、请求体上限、响应定界和 rapira_finish_request()。"
faqLevel: 2
---

# HTTP 请求与响应

HTTP 服务器将客户端连接转换为 PHP 请求，并将 PHP 响应转换为网络数据。它使用 [hyper](https://hyper.rs) 库，接受 HTTP/1.1 和 HTTP/1.0。它不会将请求代理到其他服务器。

中间件可以在 PHP 运行前响应请求。Rapira 使用中间件提供[静态文件](/zh/docs/static-files)。

::: info
HTTP 服务器接受明文 HTTP。使用代理终止 TLS。请参阅[生产环境部署](/zh/docs/deployment)。
:::

## 请求检查

HTTP 服务器在 PHP 运行前检查每个请求。检查失败时，服务器不调用 PHP。

Rapira 对 `CONNECT` 请求返回 `501`。HTTP 服务器不创建隧道。

Rapira 接受绝对形式的请求目标，例如 `GET http://host.example/admin?x=1 HTTP/1.1`。Rapira 从目标 authority 中删除用户信息。然后 authority 替换 `Host` 字段，因此 `$_SERVER['HTTP_HOST']` 与目标一致。PHP 在 `$_SERVER['REQUEST_URI']` 中收到 origin 形式的路径和查询字符串。

`http.keepalive_timeout_secs` 限制每次从客户端读取的时间。此限制适用于空闲连接和请求头。如果在限制时间内没有收到请求体数据，Rapira 返回 `408`，然后关闭连接。默认值为 60 秒。

```toml
[http]
keepalive_timeout_secs = 60
```

## 从请求头名字到 `$_SERVER` 键

CGI 将请求字段名转换为大写，将每个 `-` 替换为 `_`，并添加 `HTTP_`。请参阅 [RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18)。因此，`X-Forwarded-For` 变为 `HTTP_X_FORWARDED_FOR`。

PHP 注册变量时会再做一次转换。它还会将 `.` 替换为 `_`。因此，以下三个网络字段名映射到同一个 PHP 键：

| 报文里的写法      | 在 PHP 中                            |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
如果没有 Rapira 强制执行的字段名检查，这种名称冲突会带来安全风险。代理可以设置 `X-Forwarded-For`，而客户端发送 `X_Forwarded_For`。两个名称都映射到同一个 `$_SERVER` 键。代理针对带连字符名称的过滤器可能不会删除带下划线的名称。应用可能因此信任客户端提供的值。
:::

Rapira 还会设置 CGI 请求变量。`SERVER_NAME` 来自 `http.server_name`，默认值为 `localhost`。`SERVER_PORT` 来自 `http.server_port`，默认值为 `http.listen` 的 TCP 端口，Unix socket 时为 `80`。对于 Unix socket 上的客户端，`REMOTE_ADDR` 为 `127.0.0.1`，`REMOTE_PORT` 为 `0`。Rapira 不设置 `PATH_INFO`。

Rapira 只接受明文 HTTP。因此，`$_SERVER['HTTPS']` 始终为空，`REQUEST_SCHEME` 始终为 `http`。在 TLS 代理后面运行时，请配置应用读取代理字段。

## 会撞上 CGI 变量的名字

Rapira 在请求字段名中只接受 `A-Z`、`a-z`、`0-9` 和 `-` 这些字节。此规则拒绝 `_` 和 `.`，也拒绝 `~` 等其他字符。`http.unsafe_field_names` 设置如何处理被拒绝的名称：

- **`drop`** 是默认值。在 Classic 和 Worker 模式下，Rapira 在 PHP 收到字段前删除这些字段。它为每个请求写入一条 `warn` 记录。在 Dispatcher 模式下，`drop` 保留所有名称，因为此模式下 Rapira 不将请求字段放入 `$_SERVER`。
- **`reject`** 使 Rapira 在所有模式下返回 `400`。

```toml
[http]
unsafe_field_names = "drop"
```

不能禁用此检查，也不能为单个名称添加例外。请参阅[配置](/zh/docs/configuration)以了解完整的设置参考。

将必需字段名中的下划线改为连字符。Rapira 对来自代理的字段使用相同规则。它无法确定带下划线的字段来自客户端还是可信代理。请配置代理，在发送字段前更改字段名。

::: tip
`drop` 以 `warn` 级别写入记录，但默认日志级别为 `error`。将 `http` 目标设置为 `warn` 以查看这些记录。请参阅[日志](/zh/docs/logging)以了解更多信息。
:::

## 发了不止一次的字段

HTTP 允许重复字段，但 CGI 为每个变量提供一个值。Rapira 根据字段语法合并重复的值：

- **列表字段：** Rapira 使用逗号和空格连接值。例如，两行 `Accept` 变为 `text/*, image/*`。[RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) 允许逗号分隔字段使用此格式。
- **`Cookie`：** Rapira 使用分号和空格连接值。PHP cookie 解析器需要此格式。
- **单值字段：** Rapira 保留第一行 `Authorization`、`Proxy-Authorization`、`Content-Type`、`Referer` 或 `From`。它忽略其他行，因为合并后的值含义不同。
- **`Host`：** Rapira 对多个 `Host` 行返回 `400`。[RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2) 要求此行为。

在此处理之前，如果多行 `Content-Length` 的值不同，Rapira 返回 `400`。

PHP 以未修改的字节接收字段值。因此，Latin-1 cookie 或签名字段会保留客户端发送的每个字节。

## 请求体

Rapira 在 PHP 运行前将请求体读入内存。`http.max_body_size_mb` 限制一个请求体使用的内存。默认值为 8 MiB，与 PHP 的 `post_max_size` 默认值相同。Rapira 对更大的请求体返回 `413` 并关闭连接。它不读取剩余的请求体数据。

Rapira 检查此上限两次：

- Rapira 先在读取请求体数据前检查声明的 `Content-Length`。
- 请求体块到达时，它再次检查。第二次检查限制没有声明长度的 chunked 请求。

Rapira 为 HTTP/1.1 请求支持 `Expect: 100-continue`。它在客户端发送请求体前发送 `100 Continue`。Rapira 先检查 `Content-Length`。因此，它可以在客户端上传过大的请求体前返回 `413`。对于 HTTP/1.0，Rapira 忽略此预期，这是 [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1) 的要求。

```toml
[http]
max_body_size_mb = 8
```

## 响应传输

执行模式决定 HTTP 服务器何时从 PHP 收到响应：

- 在 Classic 和 Worker 模式下，Rapira 将完整响应保存在内存中。它在请求结束时发送响应，或在脚本调用 `rapira_finish_request()` 时发送响应。
- 在 Dispatcher 模式下，Rapira 在第一次写入响应体时或调用 `Exchange::flush()` 时发送响应头。然后，脚本每写入一个响应体块，Rapira 就发送该块。

`http.write_timeout_secs` 限制一次向客户端写入可以停滞的时间。超过此限制时，Rapira 关闭连接。默认值为 30 秒。

服务器控制响应定界。因此，PHP 给出的错误长度不会改变消息边界。服务器删除 PHP 设置的以下字段：`Content-Length`、`Transfer-Encoding`、`Connection`、`Keep-Alive`、`Upgrade`、`Trailer`、`TE` 和 `Proxy-Connection`。[RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1) 定义了这些连接特定字段。

PHP 发送 `Connection` 时，Rapira 也会删除该字段列出的每个字段。Rapira 在此步骤后添加自己的 `Content-Length`。因此，`Connection: content-length` 无法删除响应定界。

然后 Rapira 设置长度：

- 在 Classic 和 Worker 模式下，Rapira 将 `Content-Length` 设置为完整响应体的长度。
- 在 Dispatcher 模式下，Rapira 使用脚本在响应头中声明的 `Content-Length`。响应体较短时，它关闭连接，这样客户端不会将下一个响应当作当前响应的一部分。响应体较长时，它截断响应体。
- 在 Dispatcher 模式下，如果第一次 `writeBody()` 或 `sendFile()` 在头部发送前结束响应，Rapira 会计算 `Content-Length`。声明的长度优先。只有尾部字段的响应使用零长度。
- 如果头部中没有声明或计算出的长度，Rapira 在 HTTP/1.1 中使用 chunked 传输编码。在 HTTP/1.0 中，它在响应体后关闭连接。这适用于流式写入和提前调用 `Exchange::flush()`。

对于 PHP 响应，Rapira 为 `204`、`304` 和 `HEAD` 删除 `Content-Length`，并且不发送响应体。静态文件的 `HEAD` 响应保留文件长度。请参阅[静态文件](/zh/docs/static-files)。

Rapira 原样发送其他 PHP 字段，例如重复的 `Set-Cookie`、`Vary` 和 `Link` 字段。在 Classic 和 Worker 模式下，它删除无效字段并写入一条 `debug` 日志记录，但仍发送响应的其余部分。Rapira 不发送来自 PHP 的临时（`1xx`）响应头或 trailer。因此，`103 Early Hints` 不会到达客户端。

如果 worker 在响应体结束前停止，服务器会关闭连接，不发送完整的结束标记。输出开始后发生的致命错误也可能截断响应。在 Worker 模式下，输出开始后发生未捕获的 handler 异常会截断响应，但循环会继续。客户端可以检测到每个不完整的消息。

::: question 在 Classic 和 Worker 模式下，`flush()` 会提前发送输出吗？
不会。PHP 的 `flush()` 函数不向客户端发送数据。请使用 Dispatcher 模式流式发送响应。缓冲的响应体超过 1 GiB 时，Rapira 停止请求，客户端收到不完整的响应。
:::

## 错误响应

当请求没有到达 PHP，或 PHP 没有发送响应头时，HTTP 服务器发送错误响应。此响应没有响应体。它包含 `cache-control: private, no-store` 和 `connection: close`。

| 状态码 | 原因 |
| --- | --- |
| `400` | 请求有多个 `Host` 字段。HTTP/1.1 请求没有 `Host` 字段或 `Host` 字段为空。字段名不安全，并且设置了 `unsafe_field_names = "reject"`。请求体读取失败。在 Dispatcher 模式下，multipart 请求体无效。 |
| `408` | 在 `http.keepalive_timeout_secs` 内没有收到请求体数据。 |
| `413` | 请求体大于 `http.max_body_size_mb`，或 multipart 请求体超过 `[http.uploads]` 的某个上限。 |
| `500` | worker 池已停止。在 Dispatcher 模式下，Rapira 无法将上传的文件写入 `[http.uploads].dir`。 |
| `501` | 请求使用 `CONNECT`。 |
| `502` | PHP worker 在发送响应头前停止。 |
| `503` | worker 队列持续满 30 秒。 |

Rapira 发送以下状态码时不带这两个字段：

- worker 无法启动其入口脚本时发送 `503`。每次启动失败后，worker 用此状态码响应一个排队的请求。
- PHP 设置低于 `200` 的最终状态码（例如 `101`）时发送 `502`。
- Dispatcher 脚本在 Rapira 发送响应头前释放 exchange 时发送 `500`。

## Dispatcher 模式

在 Dispatcher 模式下，Rapira 不将请求字段放入 `$_SERVER`。脚本从 `Rapira\Http\Exchange` 对象读取请求，并使用该对象的方法写入响应。Rapira 在脚本收到 `multipart/form-data` 请求体前解析它。有关 API、上传和 `sendFile()`，请参阅 [Dispatcher 模式](/zh/docs/dispatcher)。

## 提前结束响应

handler 可以在响应准备完成后继续工作。例如，它可以发送 webhook、写入队列条目或更新缓存数据。客户端不需要等待此工作。

`rapira_finish_request()` 在此处结束响应。PHP 刷新输出缓冲区，并将响应传给 HTTP 服务器。handler 继续工作时，HTTP 服务器发送响应。此函数的作用与 php-fpm 的 `fastcgi_finish_request()` 函数相同。Rapira 不提供 `fastcgi_finish_request()`。请将对它的每次调用替换为 `rapira_finish_request()`：

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// 此代码在客户端收到响应后运行。
$mailer->sendConfirmation($order);
$metrics->flush();
```

签名为 `rapira_finish_request(): bool`。[`crates/sapi/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php) 声明此函数以及其他 PHP 函数和类。请配置 IDE 使用此文件提供补全和类型信息。

`rapira_finish_request()` 在 Classic 和 Worker 模式下可用。在 Dispatcher 模式下，调用会抛出 `\Error`。在此模式下，请完成 `receive()` 返回的 exchange，然后继续工作。请参阅 [Dispatcher 模式](/zh/docs/dispatcher)和[执行模式](/zh/docs/execution-modes)以了解更多信息。

此函数有以下限制：

- **Rapira 丢弃调用后的输出。** 请在调用前写入所有客户端输出。
- **worker 继续运行 handler。** 在 handler 返回前，它不能接受下一个请求。因此，此调用可以减少客户端等待时间，但不会增加并发。请将长时间操作放入队列。有关 worker 并发，请参阅[进程模型](/zh/docs/process-model)。
