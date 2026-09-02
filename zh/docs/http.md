---
title: HTTP 请求与响应
description: "Rapira 如何把一个 HTTP 请求变成 PHP 的超全局变量，又如何把 PHP 的响应变回网络上的字节：字段名映射、重复字段、请求体上限、响应定界，以及 rapira_finish_request()。"
faqLevel: 2
---

# HTTP 请求与响应

HTTP 接入层是 Rapira 里负责把客户端连接变成一个 PHP 请求、再把 PHP 的响应变回网络字节的那个部件。它基于 [hyper](https://hyper.rs) 库构建，并且已经打包进二进制文件。它终结 HTTP/1.1 和 HTTP/1.0：在主进程绑定好的 socket 上接受连接，解析请求，把请求交给 PHP，再把 PHP 产出的内容写回去。这里没有上游：没有任何东西被代理出去，每个请求都在本地作答。PHP 前面的中间件也可以自己把请求应答掉，[静态文件](/zh/docs/static-files)正是这么提供的。

本页讲的是 HTTP 和 PHP 之间对不上号的那些地方：接入层在 PHP 跑起来之前会挡下什么、哪个请求头字段会落到哪个 `$_SERVER` 键上、客户端把同一个字段发两遍会怎么样、请求体最大能有多大，以及响应发出去时是怎么定界的。

::: info
接入层只处理明文 HTTP。需要 TLS 的话，请在 Rapira 前面的代理上终结它，见[生产环境部署](/zh/docs/deployment)。
:::

## 请求检查

接入层会在 PHP 跑起来之前先检查每个请求。没通过检查的请求由接入层自己作答，PHP 根本看不到它。

`CONNECT` 请求一律以 `501` 作答。接入层不实现任何隧道。

绝对形式的请求目标是接受的，例如 `GET http://host.example/admin?x=1 HTTP/1.1`。目标里的 authority 会顶掉 `Host` 字段，并且先把 authority 里的 userinfo 部分去掉，所以 `$_SERVER['HTTP_HOST']` 不可能和请求目标对不上。PHP 在 `$_SERVER['REQUEST_URI']` 里看到的是源形式的路径和查询串。

`http.keepalive_timeout_secs` 给每一次从客户端读取都设了上限。它会关掉闲置的 keep-alive 连接，也管着请求头的读取。请求体在这段时间里读不出任何进展，就以 `408` 作答，连接随即关闭。默认是 60 秒。

```toml
[http]
keepalive_timeout_secs = 60
```

## 从请求头名字到 `$_SERVER` 键

CGI 把请求头字段暴露给脚本只有一条规则：把字段名转成大写，每个 `-` 换成 `_`，再加上 `HTTP_` 前缀（[RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18)）。于是 `X-Forwarded-For` 变成 `HTTP_X_FORWARDED_FOR`，你的代码读的就是这个键。

接着 PHP 在注册变量时又自己做了一次改写：`.` 同样变成 `_`。两次映射各自把不同的字符压成同一个下划线，结果就是报文里三个不同的名字，最后落在同一个键上：

| 报文里的写法      | 在 PHP 中                            |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
这种名字冲突是一个安全问题。假设 Rapira 前面有一个可信代理会设置 `X-Forwarded-For`，那么客户端只要发 `X_Forwarded_For`，就能命中同一个 `$_SERVER` 键--而代理自己的请求头过滤只认带连字符的写法，永远看不见带下划线的那个。于是客户端可以写入一个值，而你的应用会把它当作来自代理的值。
:::

## 会撞上 CGI 变量的名字

正因如此，在其他任何一层看到这些请求头之前，Rapira 会先筛一遍字段名：每个字节都落在 `[A-Za-z0-9-]` 里，这个名字才放行。会造成撞名的字符是 `_` 和 `.`--它们都会压到与连字符写法相同的那个 `$_SERVER` 键上。这条规则用的是白名单，而不是把这两个字节列进黑名单，所以像 `~` 这种合法但少见的字符同样会被拒绝；将来两套映射里任何一套放宽了范围，这道筛查也依然成立。被拒绝的名字会怎么处理，由 `http.unsafe_field_names` 决定：

- **`drop`**（默认）--字段在 PHP 看到之前就被摘掉，每摘一次都会在 `http` 目标上记一条 `warn` 日志。
- **`reject`**--请求以 `400` 作答，不会提供任何内容。

```toml
[http]
unsafe_field_names = "drop"
```

没有第三个选项把这道筛查整个关掉，也没有针对单个名字的例外，因为它挡下的撞名本身就是一个安全问题--这个配置项在整套设置中的位置，见[配置](/zh/docs/configuration)。

如果你的客户端确实要发带下划线的字段名，正确的做法是把它改成用 `-` 的写法。代理自己设的字段也一视同仁：带下划线的字段是可信代理写的还是客户端伪造的，Rapira 分辨不出来，所以代理设的 `X_Forwarded_For` 同样会在 PHP 运行之前被摘掉。Rapira 前面的代理只要在自己的配置里加一行就能完成这次改写，之后这个名字就是普通名字，原样通过。

::: tip
`drop` 每摘掉一个字段都会记一条 `warn`，但默认日志级别是 `error`，不调高就看不到这些行。如果某个请求头意外没有出现在 `$_SERVER` 里，先把级别调上去，盯着 `http` 目标看--具体怎么做见[日志](/zh/docs/logging)。
:::

## 发了不止一次的字段

HTTP 允许客户端重复发送同一个字段，而 CGI 一个变量只放得下一个值，所以在 PHP 看到任何东西之前，这些重复必须合并成一个值。至于怎么合，Rapira 按字段自身的语法来处理：

- **列表型字段**--各个值用逗号和空格拼接，这正是 [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) 为“以逗号分隔的列表”类字段所允许的重组方式。两行 `Accept` 会变成 `text/*, image/*`。
- **`Cookie`**--同样是列表，但分隔符不是逗号。它的重复项用分号和空格拼接，这正是 PHP 解析器期待的 cookie 字符串形式，`$_COOKIE` 才会解析正确。
- **单值字段**--`Authorization`、`Proxy-Authorization`、`Content-Type`、`Content-Length`、`Referer` 和 `From` 只保留**第一**行，多出来的会被丢弃并记一条 `warn`。把它们拼起来会破坏字段值：第二个 `Authorization` 拼进第一个之后，就混进了 PHP 马上要 base64 解码的那段凭据里。重复的 `Content-Length` 在合并之前就会以 `400` 作答，真正走到这条规则的只有其余五个字段。
- **`Host`**--出现不止一行 `Host` 时一律以 `400` 作答，绝不合并。[RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2) 把这条定为 MUST，而且只有终结连接的那一层才给得出正确的答复。

字段值自始至终以原始字节交给 PHP。latin1 编码的 cookie、带签名的请求头，客户端发来的每一个字节都原封不动--中途做一次 UTF-8 转换，毁掉的恰恰是那些一个字节都不能变的值。

## 请求体

PHP 开跑之前，请求体会先被整个读进内存，而 Rapira 为它占用多少内存，由 `http.max_body_size_mb` 封顶。默认是 8 MiB，和 PHP 自己 `post_max_size` 的默认值一样。超过上限的请求体会得到 `413`，而且由于剩下的数据还在链路上，这个响应还会顺手关掉连接，而不去尝试复用。

这个上限会检查两次：

- 一次是对着声明的 `Content-Length` 查，此时请求体一个字节都还没读。
- 另一次是在请求体逐块到达的过程中反复查。分块（chunked）请求事先并不声明长度，限制它内存占用的就只有这第二道检查。

对 HTTP/1.1 请求，`Expect: 100-continue` 会被兑现：Rapira 先写出中间响应 `100 Continue`，客户端再把一直攥着的请求体发过来。这里的关键是顺序：`Content-Length` 检查跑在**前面**，所以客户端一旦声明了超大的请求体，还没上传就先收到 `413`。HTTP/1.0 请求带的这个期望会被忽略，[RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1) 正是这么要求的。

```toml
[http]
max_body_size_mb = 8
```

## 响应传输

接入层不缓冲响应体。PHP 一提交响应头，它就把响应头写出去；PHP 每产出一块响应体，它就写出一块。PHP 什么时候产出这些东西，则由模式决定。Classic 和 Worker 模式下，PHP 攥着整个响应，等请求结束时一并交给接入层；脚本调用了 `rapira_finish_request()` 的话则更早。Dispatcher 模式下，代码写多少，PHP 就把响应头和每一块响应体往接入层交多少。

定界是服务器的活儿，不是 PHP 的。你代码里设的 `Transfer-Encoding` 会被丢掉。你设的 `Content-Length` 会从字段行里摘掉，过期的长度值因此永远没机会把连接搞得不同步。在 Classic 和 Worker 模式下，接着由接入层报出 PHP 实际产出的那个长度。在 Dispatcher 模式下，你写进响应头的 `Content-Length` 就是这次响应声明的长度：接入层按这个长度发送，并对着它数响应体的字节。响应体比声明的短，连接就此断掉；比声明的长，就在这个长度上截断。

没有声明长度的响应由接入层来定界：HTTP/1.1 的客户端拿到的是分块传输编码，HTTP/1.0 的客户端拿到的响应体以连接关闭为界。

按定义就没有响应体的响应，也就是 `204` 和 `304`，则根本不带 `Content-Length`。`HEAD` 请求的响应也照此办理：接入层只发响应头，既不带 `Content-Length`，也不发一个响应体字节。

逐跳（hop-by-hop）字段属于某一条连接，而不属于响应本身，所以也轮不到 PHP 来设置（[RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1)）。不管你的代码输出了什么，下面这些都会被剥掉：

`Connection`、`Keep-Alive`、`Upgrade`、`Trailer`、`TE`、`Proxy-Connection`，外加两个定界字段 `Content-Length` 和 `Transfer-Encoding`。

如果 PHP 确实发了 `Connection` 头，它点名的那些字段同样会被剥掉--`Connection` 的值本来就是这个意思--而且这一步跑在 Rapira 插入自己的 `Content-Length` 之前，所以 `Connection: content-length` 无法把定界字段从响应里去掉。

其余的一切都按 PHP 写的样子原样通过，重复的也一样：`Set-Cookie`、`Vary` 和 `Link` 本来就可能正当地出现好几次，它们会被全部发出。至于压根没法在报文里表示的响应头，会被丢弃并记一条日志，而不是让整个响应失败，响应的其余部分照常发出。

PHP 发出的中间响应头（1xx）会被丢掉，PHP 写的 trailer 同样被丢掉，两者接入层都不转发。`Expect` 请求对应的 `100 Continue` 不算 PHP 的中间响应头：那一条是接入层自己写的。

被截断的响应会直接断开连接，不给出干净的结束标记。三种情况会让响应被截断：worker 在响应体写完之前死掉、响应体比 PHP 声明的长度短，以及脚本已经输出了内容之后遇上致命错误或未捕获的异常。客户端读到的于是是一条不完整的报文，它能据此判断出响应被切断了。

接入层自己写出的错误响应都带着 `cache-control: private, no-store` 和 `connection: close`，并且没有响应体。请求体超限时的 `413` 和 `CONNECT` 的 `501` 就属于这一类。

::: question 为什么定界字段由接入层来设，而不是 PHP？
一条响应的定界，取决于接入层真正发到线上的那些字节。接入层拿响应声明的长度，对着它数响应体的字节：响应体比声明的短，连接就断掉，客户端因此不会把下一条响应当成这一条的尾巴读进来。而以普通响应头形式设的 `Content-Length` 会绕过这次计数，所以它会被摘掉。
:::

## 提前结束响应

响应准备好之后，处理逻辑往往还有事情要做：触发一个 webhook、往队列里写一条记录、把缓存预热一遍。客户端不必等这些。

`rapira_finish_request()` 会在此处结束响应：PHP 的输出缓冲被刷进响应里，响应交给接入层发往客户端，而你的处理逻辑继续往下跑--此时客户端手里已经拿到了完整的响应。它和 `fastcgi_finish_request()` 是同一套契约，为 php-fpm 写的代码行为一如既往：

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// This code runs after the client receives the response.
$mailer->sendConfirmation($order);
$metrics->flush();
```

它的签名是 `rapira_finish_request(): bool`。和 Rapira 暴露给 PHP 的其他所有东西一样，它声明在 [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) 里--把 IDE 指向这个文件，就能得到补全和类型提示。

这个函数按整个进程注册，作用于当前正在处理的那个请求，所以 Classic 模式同样支持它：脚本是常驻还是每个请求重跑一遍，行为都一样。不同模式之间还有哪些差别，见[执行模式](/zh/docs/execution-modes)。

有两点要记住：

- **调用之后再输出，就发不出去了**。响应已经关闭，后面的 `echo` 会被直接丢掉--它不会排队等着以后冲刷。客户端必须看到的东西，都得在调用之前写完。
- **worker 并没有闲下来**。结束响应放走的是**客户端**，不是进程。在你的处理逻辑返回之前，这个 worker 不会去接下一个请求，所以挪到调用之后的那些活儿，下一个请求照样得等--一共有多少个 worker 能等，见[进程模型](/zh/docs/process-model)。这次调用降低的是客户端的延迟，并不会带来并发，所以重活儿应该交给队列。
