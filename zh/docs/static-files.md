---
title: 静态文件
description: "在请求到达 PHP 之前提供文件，包括 [http.static] 的键、中间件规则和每个 worker 的文件缓存。"
faqLevel: 2
---

# 静态文件

静态文件中间件在请求到达 PHP 之前，从一个目录提供文件。如果请求解析到根目录下的一个文件，中间件会响应这个请求。它将其他所有请求原样发送给 PHP。

## 启用中间件

`rapira.toml` 中的两个部分会启用中间件。将 `static` 添加到 `[http]` 的中间件列表。然后添加一个 `[http.static]` 表，用它设置文件目录。

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # 必填。相对路径以本文件所在目录为基准。
forbid = [".php"]   # 可选。此列表替换默认值。
```

`middleware` 按列表顺序存放中间件链。目前它只接受 `static` 这一个名称。

`root` 指定包含要提供的文件的目录。它没有默认值，因此该表必须设置它。相对路径以配置文件所在目录为基准，与 `http.pool.entrypoint` 相同。

`forbid` 包含中间件不提供的文件名后缀。默认值为 `[".php"]`。显式列表会替换默认值。例如，`forbid = [".php", ".env"]` 会阻止这两个后缀。

::: danger
值 `forbid = []` 允许根目录下的所有文件，包括 PHP 源文件。不要将此值用于公开的根目录。它可能泄露应用代码和嵌入的机密信息。
:::

每个条目以点开头，至少包含两个字符。它不能包含 `/` 或空白字符。无效条目会使服务器初始化停止。

配置文件的其他键请参阅[配置](/zh/docs/configuration)。

## 初始化校验

服务器在接受请求之前检查根目录。根目录必须存在，并且必须是目录。服务器账户必须对它有搜索权限。检查失败会阻止初始化，并报告该路径。

两个配置部分必须一起出现。`"static"` 中间件条目需要 `[http.static]` 表，该表也需要这个条目。Rapira 还会拒绝重复的和未知的中间件名称。

::: question 为什么服务器要对根目录测试两次？
第一次测试读取根目录的元数据。它确认路径存在并且是目录。第二次测试在根目录内解析 `.`。它检查文件访问所需的搜索权限。

目录的搜索权限和读取权限使用不同的位。因此，第一次测试可能通过，而第二次测试失败。所需权限请参阅 [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html)。
:::

## 提供文件的规则

只有当方法是 `GET` 或 `HEAD` 时，中间件才处理请求。其他所有方法都交给 PHP。

中间件使用以下路径规则：

- 某一段以 `.` 开头的路径交给 PHP。因此，`/.env`、`/.git/config` 和 `/../outside.txt` 不会访问文件。
- `forbid` 检查作用于百分号解码后的路径，并且不区分大小写。当 `.php` 被禁止时，`/index.php`、`/index%2Ephp` 和 `/Upper.PHP` 都交给 PHP。
- 如果路径中的百分号编码解码后不是 UTF-8，该路径交给 PHP。例如，`/%FF.css` 交给 PHP。
- 目录 URL 交给 PHP。中间件不提供索引文件。
- 文件不存在、权限错误或无效文件名都交给 PHP。无效文件名是指名称过长或包含 NUL 字节。
- 其他读取失败返回 `500`。PHP 不会收到该请求，Rapira 在 `http` target 上记录该失败。

交给 PHP 的请求不做任何更改。PHP 从请求中读取哪些内容，请参阅 [HTTP 请求与响应](/zh/docs/http)。

::: question 为什么目录 URL 不用 `index.html` 响应？
PHP 控制 URL 空间，因此目录 URL 是应用路由。自动索引文件会产生两个可能的响应。文件系统可能返回一个响应，而应用路由器返回另一个响应。入口脚本将收不到对 `/` 的请求。
:::

## 响应字段

以下字段出现在提供文件的响应中。中间件的 `500` 响应不包含这些字段。

中间件根据文件扩展名设置 `Content-Type`。没有已知扩展名的文件得到 `application/octet-stream`。

响应包含 `ETag` 和 `Last-Modified` 字段。中间件根据文件修改时间创建 `Last-Modified`。它根据修改时间和文件长度创建 `ETag`。没有修改时间的文件不会得到这两个字段。

当 `If-None-Match` 与 `ETag` 匹配时，中间件返回 `304 Not Modified`。请求没有 `If-None-Match` 时，如果文件修改时间不晚于 `If-Modified-Since` 的时间，请求得到 `304 Not Modified`。此响应只包含 `ETag` 和 `Last-Modified`，没有响应体。

响应还包含 `Accept-Ranges: bytes`。`Range` 请求可以返回 `206 Partial Content` 和一个 `Content-Range` 字段。对于无效的范围或多于一个的范围，Rapira 返回 `416 Range Not Satisfiable`。PHP 不会收到该请求。

`If-Match` 或 `If-Unmodified-Since` 条件不满足时，返回 `412 Precondition Failed`。

中间件不设置 `Cache-Control`。如果客户端需要这个字段，请在反向代理中设置它。

## 文件缓存

每个 worker 进程将它提供的文件保存在内存中。缓存无法配置。它使用以下固定值：

- 缓存条目的有效期为一秒。
- 缓存不存储大于 256 KiB 的文件。这种文件在每个请求中都从磁盘流式读取。
- 每个 worker 最多存储 16 MiB。因此，`http.pool.processes` 中的每个进程最多可以使用 16 MiB 缓存内存。

一秒之后，对文件的下一个请求会对它运行 `stat`。如果修改时间和长度相同，worker 保留该条目。否则，它重新读取文件。Rapira 最多在一秒后停止提供已删除的文件。

已满的缓存继续提供它的条目。它先删除过期条目。如果缓存仍然已满，它不存储新文件。

新的 worker 进程以空缓存启动。因此，重载、worker 替换或重启会清空缓存。

根目录必须使用本地存储。中间件在处理请求的线程上运行 `stat` 和 `open`。较慢的文件系统会延迟该 worker 中的其他连接。

::: question 为什么缓存没有发现我修改过的文件？
缓存只比较文件的修改时间和长度。`ETag` 包含相同的值。如果替换后两个值都不变，缓存检测不到。权限更改也会保留条目。要删除条目，请删除文件、更改其修改时间，或[重载](/zh/docs/process-model#信号)服务器。
:::
