---
title: Classic 模式
description: "Classic 模式运行普通的 PHP 入口脚本，每个请求都使用全新的状态。"
---

# Classic 模式

Classic 模式执行普通 PHP 入口脚本。它可以是 php-fpm 运行的同一个 `public/index.php`。Rapira 为每个 HTTP 请求启动新的 PHP 请求。它填充超全局变量并执行脚本。脚本输出成为响应。大多数应用无需更改代码即可从 php-fpm 迁移到 Classic 模式。

## 每个请求都是全新的状态

每个请求都有完整的 PHP 请求周期。此周期包括请求初始化、入口脚本执行和请求关闭。PHP 在下一个请求前删除请求状态。此状态包括全局变量、静态属性、DI 容器和 ORM identity map。

请求对象和数据不会影响后续请求。一些状态保留在 worker 进程中：持久连接、扩展状态和工作目录。不支持持久进程的应用可以使用 Classic 模式。

应用为每个请求初始化自动加载器、配置、容器和路由。请参阅[执行模式](/zh/docs/execution-modes)。

每个 worker 使用入口脚本所在目录作为工作目录。请求中的 `chdir()` 调用对同一 worker 的后续请求保持有效，直到该 worker 退出。如果请求更改了工作目录，请在请求结束前恢复它。

Rapira 不提供 php-fpm 的 `fastcgi_finish_request()` 函数。使用 `rapira_finish_request()` 在脚本结束前发送响应。请参阅 [HTTP](/zh/docs/http)。

## 模式选择

在 `rapira.toml` 的 `[http.pool]` 表里写 `mode = "classic"` 来选择 Classic 模式。只有 HTTP 进程池支持 Classic 模式。完整键列表请参阅[配置](/zh/docs/configuration)。

Classic 模式的入口脚本就是普通 PHP：

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

此脚本对应的 `rapira.toml` 是：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

运行 `rapira serve rapira.toml` 启动 Rapira。相对 `http.pool.entrypoint` 以配置文件目录为基准。该命令请参阅[命令行参考](/zh/docs/cli)。

## 入口脚本

Rapira 不将 URL 映射到 PHP 脚本。每个请求都运行配置的入口脚本。`$_SERVER['REQUEST_URI']` 包含应用路由使用的 URL。

[静态文件中间件](/zh/docs/static-files)可以为 `GET` 和 `HEAD` 请求返回文件。入口脚本处理中间件没有应答的请求。CDN 或反向代理也可以提供静态文件。反向代理示例请参阅[部署](/zh/docs/deployment)。

`SCRIPT_FILENAME` 包含入口脚本的绝对路径。`SCRIPT_NAME` 包含带前导斜杠的文件名，例如 `/index.php`。`DOCUMENT_ROOT` 包含入口脚本所在目录。

## 上传

PHP 解析 `multipart/form-data` 请求体并填充 `$_FILES`，与 php-fpm 相同。`php.ini` 中的 `upload_max_filesize` 和 `post_max_size` 设置有效。

Rapira 在 PHP 运行前对完整请求体应用 `http.max_body_size_mb`。默认值为 8 MiB。Rapira 对更大的请求体返回 `413`。如果 `php.ini` 允许更大的上传，请将 `http.max_body_size_mb` 增大到与 `post_max_size` 一致。请参阅[请求体](/zh/docs/http#请求体)。

`[http.uploads]` 表只适用于 Dispatcher 模式。Classic 配置包含此表时，Rapira 不会启动。请参阅[配置](/zh/docs/configuration#http-uploads-表)。

## OPcache

每个 PHP 请求都会删除应用状态。OPcache 在请求间保留编译后的字节码。主进程在创建 worker 前启动 PHP，因此所有 worker 使用同一个 OPcache 共享内存段。启用 OPcache 后，后续请求使用缓存的字节码，PHP 不会再次编译未更改的脚本。OPcache 设置请参阅[部署](/zh/docs/deployment)。

每个 worker 一次处理一个请求。`http.pool.processes` 设置 worker 数量，它也是最大并发请求数。请参阅[进程模型](/zh/docs/process-model)。

## 在 Classic 和 Worker 之间做选择

如果应用无法在请求间安全保留状态，请使用 Classic 模式。例如，一些应用和第三方库在静态属性中存储请求数据。从 php-fpm 迁移时，Classic 模式还可以减少应用更改。如果应用支持持久进程，请使用 [Worker](/zh/docs/worker) 模式。Worker 模式无需为每个请求初始化应用。所有三种模式请参阅[执行模式](/zh/docs/execution-modes)。

::: info
在 Classic 模式下，`Rapira\handle_request()` 抛出 `Rapira\Exception\NotInWorkerModeError`。Classic 脚本随其请求结束，无法运行请求循环。
:::
