---
title: 静态文件
description: "在请求到达 PHP 之前，直接用磁盘目录里的文件作答：[http.static] 的各个键、中间件按什么规则决定应答什么，以及每个 worker 自己的文件缓存。"
faqLevel: 2
---

# 静态文件

Rapira 在 PHP 之前运行静态文件中间件。如果路径指向根目录中的文件，中间件会响应请求。
它将其他请求传递给下一个处理程序，不做更改。

## 中间件配置

`rapira.toml` 中的两个部分会启用中间件。将 `static` 添加到 `[http].middleware` 列表。
然后添加包含文件目录的 `[http.static]` 部分。

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # Required. Relative paths use this file's directory.
forbid = [".php"]   # Optional. This list replaces the default.
```

`middleware` 按列表顺序放着整条中间件链，目前它只接受 `static` 这一个名字。

`root` 指定文件目录。它没有默认值。
相对路径使用配置文件目录。`pool.entrypoint` 使用相同规则。

`forbid` 包含中间件不提供的文件名后缀。默认值为 `[".php"]`。
显式列表会替换默认值。例如，`forbid = [".php", ".env"]` 会阻止两个后缀。

::: danger
`forbid = []` 允许所有文件，包括 PHP 源代码。
不要将此值用于公开根目录。它可能泄露应用代码和嵌入的机密信息。
:::

每个条目以点开头，至少包含两个字符，并且不包含 `/` 或空格。
无效条目会阻止服务器启动。

这个文件里的其余键在[配置](/zh/docs/configuration)那一页。

::: question 为什么 `forbid` 条目必须是后缀？
中间件将每个条目与文件名末尾比较。Rapira 仅接受至少有两个字符、以 `.` 开头且不含斜杠或空白字符的后缀。
:::

## 启动校验

服务器在接受请求前检查根目录。路径必须存在、是目录，并允许服务器用户搜索。
检查失败会阻止启动并报告路径。

两个配置部分必须一起出现。`"static"` 条目需要 `[http.static]`，该部分也需要条目。
Rapira 还会拒绝重复的中间件名称。

::: question 为什么服务器要对根目录测两次？
第一次检查读取元数据并确认目录类型。第二次解析 `.` 并检查搜索权限。
搜索权限和读取权限使用不同位。因此，第一次检查可能成功，而第二次检查失败。
请参阅 [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html)。
:::

## 提供文件的规则

只有方法是 `GET` 或 `HEAD` 时，中间件才会接手这个请求，其余方法一律交给 PHP。

剩下的由路径决定：

- 某一段以 `.` 开头的路径交给 PHP，所以 `/.env`、`/.git/config` 和 `/../outside.txt` 永远碰不到文件系统。
- `forbid` 检查跑在百分号解码之后的路径上，比较最后一段时不分大小写，所以只要 `forbid` 里有 `.php`，`/index.php`、`/index%2Ephp` 和 `/Upper.PHP` 就全都交给 PHP。
- 目录形式的 URL 交给 PHP。中间件不为它提供索引文件，带不带末尾斜杠都一样。
- 背后没有文件的路径交给 PHP。权限错误同样交给 PHP，文件系统不接受的名字也一样。
- 其余的读取失败以 `500` 作答。这类请求不会到达 PHP，失败记在 `http` 这个 target 上。

PHP 接收未更改的转发请求。请参阅 [HTTP 请求与响应](/zh/docs/http)。

::: question 为什么目录形式的 URL 不用 `index.html` 作答？
PHP 控制 URL 空间，因此目录 URL 是应用路由。自动索引文件会创建两个可能的响应。
它还会阻止入口脚本处理 `/`。
:::

::: question 中间件怎么区分“没有这个文件”和“读取失败”？
六种结果表示没有可用文件。路径可能不存在、无法访问或是目录。
路径组件可能类型错误。名称可能过长或包含 NUL 字节。
对于这些结果，请求会继续到 PHP。对于其他读取错误，中间件返回 `500`。
:::

## 响应字段

下面这些字段属于真的提供了一个文件的那种应答。中间件的 `500` 应答一个都不带。

中间件按文件扩展名设置 `Content-Type`。扩展名认不出来的文件得到 `application/octet-stream`。

响应包含 `ETag` 和 `Last-Modified`。中间件根据修改时间创建 `Last-Modified`。
它根据修改时间和长度创建 `ETag`。没有修改时间的文件不会获得这些字段。
纪元前的时间仅阻止 `ETag`。

`If-None-Match` 和 `ETag` 相符时，中间件以 `304 Not Modified` 作答。请求没有 `If-None-Match` 字段时，只要文件的修改时间不晚于 `If-Modified-Since` 的时间，中间件也以 `304 Not Modified` 作答。这条应答只带 `ETag` 和 `Last-Modified` 字段，没有响应体。

应答还带着 `Accept-Ranges: bytes`。`Range` 请求以 `206 Partial Content` 加一个 `Content-Range` 字段作答。文件满足不了的范围以 `416 Range Not Satisfiable` 作答，这类请求同样不会到达 PHP。

## 文件缓存

每个 worker 将提供过的文件保存在内存中。缓存无法配置。

缓存条目有效期为一秒。之后，下一个请求使用 `stat` 比较文件。
如果修改时间和长度相同，worker 会保留条目。它会重新读取已更改的文件。

大于 256 KiB 的文件从不入缓存，这种文件每个请求都从磁盘流式读出。

一个 worker 最多存储 16 MiB。完整缓存会继续提供当前条目。
缓存会先删除过期条目，然后才会跳过新的缓存条目。每个 worker 最多使用 16 MiB 缓存。
重启会清空缓存。

每个 worker 验证自己的条目。删除的文件最多在一秒后影响响应。
当修改时间或长度发生变化时，更改或替换的文件最多在一秒后影响响应。
如果修改时间和长度不变，权限更改不会删除条目。
删除文件可删除条目。只有修改时间或长度发生变化时，替换文件才会删除条目。
也可以重启服务器。

根目录必须使用本地存储。中间件在处理请求的线程上运行 `stat` 和 `open`。
较慢的文件系统会延迟 worker 的其他连接。

::: question 缓存怎么发现文件变了？
缓存将修改时间和长度与存储值比较。ETag 包含相同的值。
缓存无法检测保留两个值的替换。请更改每个替换文件的修改时间或长度。
:::

更多内容见[配置](/zh/docs/configuration)。
