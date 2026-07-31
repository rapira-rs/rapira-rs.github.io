---
title: HTTP 请求与响应
description: Rapira 如何把一个 HTTP 请求变成 PHP 的超全局变量，又如何把 PHP 的响应变回网络上的字节——字段名映射、重复字段、请求体上限、缓冲，以及 rapira_finish_request()。
---

# HTTP 请求与响应

Rapira 的 HTTP 接入层基于 [Pingora](https://github.com/cloudflare/pingora) 构建，并且已经打包进二进制文件。它在主进程绑定好的 socket 上接受连接，解析请求，把请求交给 PHP，再把 PHP 产出的内容写回去。这里没有上游：每个请求都在本地作答，答的人就是你的代码。

多数时候你根本不会想到这一层——写个 `$_GET['page']`，`echo` 一点东西，它就跑起来了。本页要讲的，是 HTTP 和 PHP 之间对不上号的那些地方：哪个请求头字段会落到哪个 `$_SERVER` 键上、客户端把同一个字段发两遍会怎么样、请求体最大能有多大，以及响应发出去时是怎么定界的。

::: info
接入层只处理明文 HTTP。需要 TLS 的话，请在 Rapira 前面的代理上终结它——见[生产环境部署](/zh/docs/deployment)。
:::

## 从请求头名字到 `$_SERVER` 键

CGI 把请求头字段暴露给脚本只有一条规则：把字段名转成大写，每个 `-` 换成 `_`，再加上 `HTTP_` 前缀（[RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18)）。于是 `X-Forwarded-For` 变成 `HTTP_X_FORWARDED_FOR`，你的代码读的就是这个键。

接着 PHP 在注册变量时又自己做了一次改写：`.` 同样变成 `_`。两次映射各自把不同的字符压成同一个下划线，结果就是报文里三个不同的名字，最后落在同一个键上：

| 报文里的写法      | 在 PHP 中                            |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
这不是什么冷知识，问题的要害正在这里。假设 Rapira 前面有一个可信代理会设置 `X-Forwarded-For`，那么客户端只要发 `X_Forwarded_For`，就能命中同一个 `$_SERVER` 键——而代理自己的请求头过滤只认带连字符的写法，永远看不见带下划线的那个。于是客户端就能亲手写进一个值，你的应用还以为它来自代理。
:::

## 会撞上 CGI 变量的名字

正因如此，在别的任何环节碰到这些请求头之前，Rapira 会先筛一遍字段名：每个字节都落在 `[A-Za-z0-9-]` 里，这个名字才放行。真正会造成撞名的字符是 `_` 和 `.`——它们都会压到某个连字符名字所占的那个 `$_SERVER` 键上。这条规则用的是白名单，而不是把这两个字节列进黑名单，所以像 `~` 这种合法但少见的字符同样会被拒绝；将来两套映射里任何一套放宽了范围，这道筛查也依然成立。被拒绝的名字会怎么处理，由 `http.unsafe_field_names` 决定：

- **`drop`**（默认）——字段在 PHP 看到之前就被摘掉，每摘一次都会在 `http` 目标上记一条 `warn` 日志。
- **`reject`**——请求直接以 `400` 回绝，什么都不会送到 PHP，客户端连试一下的机会都没有。

```toml
[http]
unsafe_field_names = "drop"
```

这里刻意没有第三个选项来把检查整个关掉。凡是提供了这么一个开关的服务器，正是这类撞名问题反复冒头的地方，所以 Rapira 不提供——这个配置项在整套设置中的位置，见[配置](/zh/docs/configuration)。

如果你的客户端确实要发带下划线的字段名，正确的做法是把它改成用 `-` 的写法。Rapira 前面的代理只要在自己的配置里加一行就能完成这次改写，之后这个名字就是普通名字，原样通过。

::: tip
`drop` 每摘掉一个字段都会记一条 `warn`，但默认日志级别是 `error`，不调高就看不到这些行。如果某个请求头莫名其妙没出现在 `$_SERVER` 里，先把级别调上去，盯着 `http` 目标看——具体怎么做见[日志](/zh/docs/logging)。
:::

## 发了不止一次的字段

HTTP 允许客户端重复发送同一个字段，而 CGI 一个变量只放得下一个值，所以在 PHP 看到任何东西之前，这些重复必须合并成一个值。至于怎么合，Rapira 听字段自身语法的：

- **列表型字段**——各个值用 `, ` 拼接，这正是 [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) 为“以逗号分隔的列表”类字段所允许的重组方式。两行 `Accept` 会变成 `text/*, image/*`。
- **`Cookie`**——同样是列表，但分隔符不是逗号。它的重复项用 `; ` 拼接，这正是 PHP 解析器期待的 cookie 字符串形式，`$_COOKIE` 才会解析正确。
- **单值字段**——`Authorization`、`Proxy-Authorization`、`Content-Type`、`Content-Length`、`Referer` 和 `From` 只保留**第一**行，多出来的会被丢弃并记一条 `warn`。把它们拼起来只会毁掉内容：第二个 `Authorization` 拼进第一个之后，就混进了 PHP 马上要 base64 解码的那段凭据里，本来能用的登录就此变成一堆乱码。
- **`Host`**——出现不止一行 `Host` 时一律以 `400` 作答，绝不合并。[RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2) 把这条定为 MUST，而且只有终结连接的那一层才给得出正确的答复。

字段值自始至终以原始字节交给 PHP。latin1 编码的 cookie、带签名的请求头，客户端发来的每一个字节都原封不动——中途来一次好心的 UTF-8 转换，毁掉的恰恰是那些一个字节都不能变的值。

## 请求体

PHP 开跑之前，请求体会先被整个读进内存，而 Rapira 肯为它占用多少内存，由 `http.max_body_size_mb` 封顶。默认是 8 MiB，和 PHP 自己 `post_max_size` 的默认值一样。超过上限的请求体会得到 `413`，而且由于剩下的数据还在链路上，这个响应还会顺手关掉连接，而不去尝试复用。

这个上限会查两次，别小看这一点：

- 一次是对着声明的 `Content-Length` 查，此时请求体一个字节都还没读。
- 另一次是在请求体逐块到达的过程中反复查。分块（chunked）请求事先并不声明长度，拦在它和无上限内存占用之间的，就只有这第二道检查。

对 HTTP/1.1 请求，`Expect: 100-continue` 会被兑现：Rapira 先写出中间响应 `100 Continue`，客户端再把一直攥着的请求体发过来。真正让它有意义的是顺序——`Content-Length` 检查跑在**前面**，所以客户端一旦声明了超大的请求体，还没上传就先收到 `413`。HTTP/1.0 请求带的这个期望会被忽略，[RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1) 正是这么要求的。

```toml
[http]
max_body_size_mb = 8
```

## 响应是怎么发出去的

PHP 写出的所有内容都会先缓冲起来，直到请求结束，响应头才真正上线。这点缓冲换来一件值当的事：服务器知道响应体的准确长度，于是能发出一个货真价实的 `Content-Length`。响应体没有定界，HTTP/1.1 就只能退回到用关闭连接来标记结束——连接一断响应才算完，也就意味着每个请求都得新开一条连接。有了 `Content-Length`，keep-alive 才成立，连接才能一直保持。

所以定界是服务器的活儿，不是 PHP 的。你代码里设的 `Content-Length` 或 `Transfer-Encoding` 会被丢掉，换成缓冲区里实际量出来的长度，过期的长度值因此永远没机会把连接搞得不同步。按定义就没有响应体的响应——`204` 和 `304`——则根本不带 `Content-Length`。

逐跳（hop-by-hop）字段属于某一条连接，而不属于响应本身，所以也轮不到 PHP 来设置（[RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1)）。不管你的代码输出了什么，下面这些都会被剥掉：

`Connection`、`Keep-Alive`、`Upgrade`、`Trailer`、`TE`、`Proxy-Connection`，外加两个定界字段 `Content-Length` 和 `Transfer-Encoding`。

如果 PHP 确实发了 `Connection` 头，它点名的那些字段同样会被剥掉——`Connection` 的值本来就是这个意思——而且这一步跑在 Rapira 插入自己的 `Content-Length` 之前，所以 `Connection: content-length` 抽不走响应体脚下的定界。

其余的一切都按 PHP 写的样子原样通过，重复的也一样：`Set-Cookie`、`Vary` 和 `Link` 本来就可能正当地出现好几次，它们会被全部发出。至于压根没法在报文里表示的响应头，会被丢弃并记一条日志，而不是让整个响应失败——不能因为一个坏字段就把响应体也搭进去。

## 提前结束响应

有时候，跟客户端有关的那部分活儿早就干完了，请求却还没完：响应已经准备好，但还得触发一个 webhook、往队列里写一条记录、把缓存预热一遍。让浏览器干等这些，纯粹是白白多出来的延迟，什么也换不来。

`rapira_finish_request()` 当场就把响应结束掉：缓冲的输出被冲刷出去，响应交给接入层发往客户端，而你的处理逻辑继续往下跑——此时客户端手里已经拿到了完整的响应。它和 `fastcgi_finish_request()` 是同一套契约，为 php-fpm 写的代码行为一如既往：

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// The client already has the response; this still runs.
$mailer->sendConfirmation($order);
$metrics->flush();
```

它的签名是 `rapira_finish_request(): bool`。和 Rapira 暴露给 PHP 的其他所有东西一样，它声明在 [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) 里——把 IDE 指向这个文件，补全和类型提示就白送给你了。

有两点要记住：

- **调用之后再输出，就发不出去了**。响应已经封口，后面的 `echo` 无处可去——它不会排队等着以后冲刷，而是直接被丢掉。客户端必须看到的东西，都得在调用之前写完。
- **worker 并没有闲下来**。结束响应放走的是**客户端**，不是进程。你的处理逻辑一天不返回，这个 worker 就一天不去接下一个请求，所以挪到调用之后的那些活儿，下一个请求照样得等——一共有多少个 worker 能等，见[进程模型](/zh/docs/process-model)。这是个降延迟的工具，不是搞并发的；活儿要是重，就该扔进队列。

::: question 我的代理设了 `X_Forwarded_For`，PHP 突然读不到了，怎么回事？
它被摘掉了。带下划线的名字会落到和连字符写法同一个 `$_SERVER` 键上，而 Rapira 分不清哪个是你代理设的、哪个是客户端伪造的。在代理里把它改名成 `X-Forwarded-For`——这个写法很普通，会原样通过。把日志级别调到 `warn`，就能看到这次摘除被记了下来。
:::

::: question 能不能只对某一个请求头关掉字段名检查？
不能。既没有总开关，也没有针对单个名字的例外——可选的只有 `drop` 和 `reject`。正确的做法是在 Rapira 前面那一层把字段改成用 `-` 的写法，这是真把问题解决掉，而不是把口子重新捅开。
:::

::: question 我写的 `header('Content-Length: …')` 为什么没出现在响应里？
因为定界归服务器管。Rapira 会把整个响应体缓冲下来，所以它知道真实长度，发出去的也是这个长度；你给的值不会被采信，而是直接丢掉。`Transfer-Encoding` 和那些逐跳字段也一样。
:::

::: question `rapira_finish_request()` 在经典模式下能用吗？
能用。这个函数是按进程注册的，作用于当前正在处理的那个请求，所以脚本是常驻还是每个请求重跑一遍，它的行为都一样。往上爬这架阶梯还会有哪些变化，见[执行模式](/zh/docs/execution-modes)。
:::
