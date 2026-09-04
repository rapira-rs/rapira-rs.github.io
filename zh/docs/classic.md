---
title: Classic 模式
description: "Classic 模式在每个请求上都从头执行一个普通的 PHP 入口脚本，和 php-fpm 一样，每次的状态都是全新的。"
---

# Classic 模式

Classic 模式执行普通 PHP 入口脚本。它可以是 php-fpm 运行的 `public/index.php`。 Rapira 为每个 HTTP 请求启动新的 PHP 请求。它填充超全局变量并执行脚本。 脚本输出成为响应。Rapira 可以替换 php-fpm，应用无需更改。

## 每个请求都是全新的状态

每个请求都有完整的 PHP 请求周期。此周期包括请求初始化、入口脚本执行和请求关闭。 PHP 在下一个请求前删除请求状态。此状态包括全局变量、静态属性、DI 容器和 ORM identity map。

请求对象和数据不会影响后续请求。持久连接和 worker 进程中的扩展状态除外。 不支持持久进程的应用可以使用 Classic 模式。 Rapira 不提供 php-fpm 的 `fastcgi_finish_request()`。使用 `rapira_finish_request()` 在脚本结束前发送响应。 请参阅 [HTTP](/zh/docs/http)。

应用为每个请求初始化自动加载器、配置、容器和路由。请参阅[执行模式](/zh/docs/execution-modes)。

## Classic 模式配置

使用以下一种方式选择模式：

- 命令行上加 `--mode classic`，紧挨着入口脚本。
- 在 `rapira.toml` 的 `[pool]` 段里写 `mode = "classic"`。

`--mode` 替换配置文件中的 `pool.mode`。其他 CLI 参数也会替换相应的配置值。 完整键列表请参阅[配置](/zh/docs/configuration)。

Classic 模式的入口脚本就是普通 PHP：

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

使用 CLI 或配置文件选择模式：

::: code-group

```bash [CLI]
rapira serve --mode classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
mode = "classic"
```

:::

运行 `rapira serve --config rapira.toml` 以使用配置文件。 相对 `pool.entrypoint` 使用配置文件目录。相对 CLI 脚本路径使用当前目录。 其他选项请参阅[命令行参考](/zh/docs/cli)。

## 入口脚本

Rapira 不将 URL 映射到 PHP 脚本。每个请求都运行配置的入口脚本。 `$_SERVER['REQUEST_URI']` 包含应用路由使用的 URL。 [静态文件中间件](/zh/docs/static-files)可以为 `GET` 和 `HEAD` 请求返回文件。 入口脚本处理其他请求。

`SCRIPT_FILENAME` 始终包含入口脚本路径。`SCRIPT_NAME` 包含带前导斜杠的文件名，例如 `/index.php`。 `DOCUMENT_ROOT` 包含脚本目录。CDN 或反向代理也可以提供静态文件。 请参阅[部署](/zh/docs/deployment)。

## OPcache

每个请求会重置应用状态，但不会重置编译后的字节码。主进程在创建 worker 前启动 PHP。 OPcache 创建一个共享内存段。每个 worker 使用相同的映射。 启用 OPcache 后，进程池在请求间使用缓存脚本。PHP 不会再次解析入口脚本。

Classic 和 Worker 使用相同类型的进程池。主进程创建 worker，每个 worker 一次处理一个请求。 worker 数量决定最大并发请求数。请参阅[进程模型](/zh/docs/process-model)。

::: info
在 Classic 模式下，`Rapira\handle_request()` 抛出 `Rapira\Exception\NotInWorkerModeError`。脚本随请求结束，无法运行请求循环。 请为 worker 脚本使用 [Worker 模式](/zh/docs/worker)。
:::

## 在 Classic 和 Worker 之间做选择

如果应用无法在请求间安全保留状态，请使用 Classic。此情况包括在静态属性中存储请求数据的库。 从 php-fpm 迁移时，Classic 还可以减少应用更改。 如果应用支持持久进程，请使用 [Worker 模式](/zh/docs/worker)。Worker 删除每个请求中的应用初始化。 所有模式请参阅[执行模式](/zh/docs/execution-modes)。
