---
title: HTTP 请求与响应
description: "Rapira 如何把一个 HTTP 请求变成 PHP 的超全局变量，又如何把 PHP 的响应变回网络上的字节：字段名映射、重复字段、请求体上限、响应定界，以及 rapira_finish_request()。"
faqLevel: 2
---

# HTTP 请求与响应

HTTP 服务器将客户端连接转换为 PHP 请求，并将 PHP 响应转换为网络数据。 Rapira 二进制文件使用 [hyper](https://hyper.rs) 库。服务器在主进程 socket 上接受 HTTP/1.1 和 HTTP/1.0。 服务器解析请求，将请求传给 PHP，然后写入响应。它不会将请求代理到其他服务器。 中间件可以在 PHP 运行前响应请求。Rapira 用此方式提供[静态文件](/zh/docs/static-files)。

本页说明请求检查、`$_SERVER` 字段映射、重复字段、请求体限制和响应定界。

::: info
HTTP 服务器接受明文 HTTP。使用代理终止 TLS。请参阅[生产环境部署](/zh/docs/deployment)。
:::

## 请求检查

HTTP 服务器在 PHP 运行前检查每个请求。检查失败时，服务器不调用 PHP，直接返回响应。

Rapira 对 `CONNECT` 请求返回 `501`。HTTP 服务器不创建隧道。

Rapira 接受绝对形式的目标，例如 `GET http://host.example/admin?x=1 HTTP/1.1`。目标 authority 会替换 `Host` 字段。 Rapira 先删除 authority 中的用户信息。这样可以防止 `$_SERVER['HTTP_HOST']` 发生冲突。 PHP 在 `$_SERVER['REQUEST_URI']` 中收到路径和查询字符串。

`http.keepalive_timeout_secs` 限制每次客户端读取。此限制适用于空闲连接和请求头。 如果请求体读取在限制时间内没有进展，Rapira 返回 `408`，然后关闭连接。 默认值为 60 秒。

```toml
[http]
keepalive_timeout_secs = 60
```

## 从请求头名字到 `$_SERVER` 键

CGI 将请求字段名转换为大写，将每个 `-` 替换为 `_`，并添加 `HTTP_`。 请参阅 [RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18)。因此，`X-Forwarded-For` 变为 `HTTP_X_FORWARDED_FOR`。

PHP 注册变量时还会将 `.` 替换为 `_`。 因此，三个网络字段名会映射到同一个 PHP 键：

| 报文里的写法      | 在 PHP 中                            |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
如果没有 Rapira 强制执行的字段名检查，这种名称冲突会带来安全风险。代理可以设置 `X-Forwarded-For`，客户端可以发送 `X_Forwarded_For`。 两个名称都映射到同一个 `$_SERVER` 键。代理针对带连字符名称的过滤器可能不会移除带下划线的名称。 应用可能会信任客户端提供的值。
:::

## 会撞上 CGI 变量的名字

Rapira 在其他处理前检查请求字段名。它仅接受 `[A-Za-z0-9-]` 中的字节。 `_` 和 `.` 可以与 `-` 映射到同一个 `$_SERVER` 键。允许列表也会拒绝 `~` 等其他字符。 `http.unsafe_field_names` 控制如何处理被拒绝的名称：

- **`drop`**（默认）--字段在 PHP 看到之前就被摘掉，每摘一次都会在 `http` 目标上记一条 `warn` 日志。
- **`reject`**--请求以 `400` 作答，不会提供任何内容。

```toml
[http]
unsafe_field_names = "drop"
```

不能禁用此检查，也不能为单个名称添加例外。 请参阅[配置](/zh/docs/configuration)以了解所有设置。

将必需字段名中的下划线改为连字符。Rapira 对代理字段使用相同规则。 Rapira 无法确定带下划线字段的来源。请配置代理，在发送前更改字段名。

::: tip
`drop` 以 `warn` 级别记录每次删除，但默认日志级别为 `error`。 将 `http` 目标设置为 `warn` 以查看这些记录。请参阅[日志](/zh/docs/logging)。
:::

## 发了不止一次的字段

HTTP 允许重复字段，但 CGI 为每个变量提供一个值。Rapira 根据字段语法合并值：

- **列表字段：** Rapira 使用逗号和空格连接值。请参阅 [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3)。
- 例如，两行 `Accept` 变为 `text/*, image/*`。
- **`Cookie`：** Rapira 使用分号和空格连接值。PHP cookie 解析器需要此格式。
- **单值字段：** Rapira 保留第一行 `Authorization`、`Proxy-Authorization`、`Content-Type`、`Referer` 或 `From`。
- Rapira 删除其他行并写入 `warn` 记录。重复的 `Content-Length` 会收到 `400`。
- **`Host`：** Rapira 对多个 `Host` 行返回 `400`。请参阅 [RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2)。

PHP 接收未修改的字段值字节。因此，Latin-1 cookie 或签名字段会保留客户端发送的每个字节。

## 请求体

Rapira 在 PHP 运行前将请求体读入内存。`http.max_body_size_mb` 限制一个请求体使用的内存。 默认值为 8 MiB，与 PHP 的 `post_max_size` 默认值相同。 Rapira 对更大的请求体返回 `413` 并关闭连接。服务器不读取剩余数据。

这个上限会检查两次：

- Rapira 先在读取请求体前检查声明的 `Content-Length`。
- 然后检查每个请求体块。此检查限制没有声明长度的 chunked 请求。

Rapira 为 HTTP/1.1 支持 `Expect: 100-continue`。服务器在客户端发送请求体前返回 `100 Continue`。 Rapira 先检查 `Content-Length`。因此，它可以在上传过大请求体前返回 `413`。 对于 HTTP/1.0，Rapira 根据 [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1) 忽略此预期。

```toml
[http]
max_body_size_mb = 8
```

## 响应传输

HTTP 服务器不缓冲响应体。PHP 提交响应头时，服务器会将其写出。 PHP 生成每个响应体块时，服务器会将其写出。执行模式决定 PHP 何时传递数据。 在 Classic 和 Worker 模式下，PHP 通常在请求结束时传递完整响应。`rapira_finish_request()` 会提前传递。 在 Dispatcher 模式下，PHP 在代码写入时传递响应头和每个响应体块。

服务器控制响应定界。它删除 PHP 设置的 `Transfer-Encoding` 和 `Content-Length` 字段。 在 Classic 和 Worker 模式下，服务器设置完整 PHP 响应体的长度。 在 Dispatcher 模式下，服务器使用 PHP 声明的 `Content-Length`，并将其与响应体长度比较。 响应体过短时，服务器关闭连接。响应体过长时，服务器按声明长度截断。

对于未声明长度的响应，服务器在 HTTP/1.1 中使用 chunked 传输。在 HTTP/1.0 中，服务器在响应体后关闭连接。

服务器从 `204` 和 `304` 响应中删除 `Content-Length`。它还会从 `HEAD` 响应中删除此字段和响应体。

服务器删除 PHP 设置的连接特定字段。[RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1) 定义了此行为：

`Connection`、`Keep-Alive`、`Upgrade`、`Trailer`、`TE`、`Proxy-Connection`，外加两个定界字段 `Content-Length` 和 `Transfer-Encoding`。

PHP 发送 `Connection` 时，Rapira 也会删除该字段列出的其他字段。此操作在添加自己的 `Content-Length` 前执行。 因此，`Connection: content-length` 无法删除响应定界。

服务器不修改其他 PHP 字段，包括重复的 `Set-Cookie`、`Vary` 和 `Link`。 服务器删除无效网络字段并写入日志。它仍会发送响应的其余部分。

Rapira 删除 PHP 的临时响应和 trailer。HTTP 服务器为 `Expect` 请求创建 `100 Continue` 响应。

如果 worker 在响应体完成前终止，服务器会关闭连接且不发送完整的结束标记。 如果响应体短于 PHP 声明的长度，服务器也会关闭连接。 输出开始后发生致命错误可能会终止脚本并截断响应。 在 Worker 模式下，输出开始后发生未捕获的 handler 异常会截断响应，但循环会继续。 每种情况都会产生客户端可以检测到的不完整消息。

HTTP 服务器创建的错误响应没有响应体。它包含 `cache-control: private, no-store` 和 `connection: close`。 例如，请求体过大时返回 `413`，`CONNECT` 请求返回 `501`。

::: question 为什么定界字段由接入层来设，而不是 PHP？
HTTP 服务器将响应体大小与声明长度比较。响应体过短时，服务器关闭连接。 这可以防止客户端将下一个响应当作当前响应的一部分。服务器删除 PHP 的 `Content-Length`，因为该字段可能绕过计数。
:::

## 提前结束响应

处理程序可以在响应准备完成后继续工作。例如，它可以发送 webhook、写入队列或更新缓存数据。 客户端不需要等待此工作。

`rapira_finish_request()` 在此处结束响应。PHP 刷新输出缓冲区，并将响应传给 HTTP 服务器。 处理程序继续工作时，服务器发送响应。此函数与 `fastcgi_finish_request()` 有相同约定：

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// This code runs after the client receives the response.
$mailer->sendConfirmation($order);
$metrics->flush();
```

签名为 `rapira_finish_request(): bool`。 [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) 文件声明此函数和其他 PHP API。 将此文件添加到 IDE 以获得补全和类型信息。

Rapira 为整个进程注册此函数。此函数作用于当前请求。 因此，Classic 模式也支持此函数。请参阅[执行模式](/zh/docs/execution-modes)。

此函数有以下限制：

- **调用后的输出不会发送。** Rapira 在响应关闭后丢弃输出。
- 请在调用前写入所有必要输出。
- **worker 仍然繁忙。** 在处理程序返回前，它不会接受下一个请求。
- 此调用会减少客户端延迟，但不会增加并发。请将长时间任务放入队列。
