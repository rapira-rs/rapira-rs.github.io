---
title: 快速开始
description: "以 Classic 和 Worker 模式运行 PHP 应用。将设置存入 rapira.toml。"
---

# 快速开始

以 Classic 模式启动应用。然后将应用转换为 Worker 模式。将设置存入配置文件。这些步骤需要 `rapira` 二进制文件及其附带的 PHP。更多信息请参阅[安装](/zh/docs/intro/installation)。

## Classic 模式

任何应用都可以使用 Classic 模式。Rapira 与 php-fpm 一样，为每个请求再次加载入口脚本。代码不需要更改。

新建 `public/index.php`：

```php
<?php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

在 `public` 目录旁创建 `rapira.toml`。`mode` 键选择 Classic 模式，`entrypoint` 指定入口脚本：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

使用文件路径启动服务器：

```bash
rapira serve rapira.toml
```

Rapira 监听 `127.0.0.1:8000`。从另一个终端发送请求：

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

worker 进程在请求之间保持运行。Rapira 创建一次 worker，并在每个 worker 中保留已初始化的 PHP 解释器。Classic 模式在每个请求后删除脚本状态。此状态包括变量、自动加载器和框架对象。

## Worker 模式

Worker 模式使脚本保持运行。脚本初始化一次，然后在循环中等待请求。对于每个请求，Rapira 再次填充超全局变量并调用处理函数。PHP 仍可以读取 `$_GET` 并使用 `echo` 创建响应。更多信息请参阅[执行模式](/zh/docs/execution-modes)。

在项目根目录新建 `worker.php`：

```php
<?php

// This value remains available for each request in this worker.
$handled = 0;

$handler = static function () use (&$handled): void {
    $handled++;
    header('Content-Type: text/plain');
    echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
    echo "worker " . getmypid() . " handled {$handled} request(s)\n";
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

`\Rapira\handle_request()` 等待下一个请求。此函数调用处理函数并返回 `true`。worker 停止时，`\Rapira\handle_request()` 返回 `false`。此值结束循环。

处理函数读取超全局变量，并使用 `echo` 和 `header()` 创建输出。只能从顶层脚本循环调用 `\Rapira\handle_request()`。此函数在其他模式下抛出 `Rapira\Exception\NotInWorkerModeError`。

Rapira 注册的 PHP 模块提供 `\Rapira\handle_request()`。因此，此示例不需要自动加载器。使用 Composer 依赖的应用必须在循环前加载 `vendor/autoload.php`。

使用 `Ctrl-C` 停止 Classic 服务器，因为两个服务器都监听 `127.0.0.1:8000`。将 `rapira.toml` 改成 Worker 模式：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

```bash
rapira serve rapira.toml
```

```bash
curl '127.0.0.1:8000/?name=world'
```

多次运行 `curl` 命令。同一进程处理另一个请求时，该 worker 的计数器会增加。Rapira 默认为每个逻辑 CPU 创建一个 worker。操作系统为每个连接选择 worker。每个 worker 有独立的计数器。输出中的进程标识符显示返回响应的 worker。

在 `[http.pool]` 中设置 `processes = 1` 以创建一个 worker。进程池的监管请参阅[进程模型](/zh/docs/process-model)。

在 `while` 循环前创建的对象会在内存中保留到 worker 脚本重新启动。这些对象包括 Composer 自动加载器、容器、连接、路由和模板。Rapira 只初始化一次此状态，而不是为每个请求初始化。每次迭代中只有请求状态是新的。

::: warning
worker 脚本必须重置保留在内存中的请求状态。此状态包括静态属性、全局值和未结束的事务。更多信息请参阅 [Worker 模式](/zh/docs/worker)。
:::

处理函数可以调用 `rapira_finish_request()`，在处理函数结束前发送响应。更多信息请参阅 [HTTP](/zh/docs/http)。

## 配置文件

配置文件保存所有设置。`rapira serve` 命令只接受此文件的路径。将 worker 数量加入此文件：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
```

```bash
rapira serve rapira.toml
```

::: info
相对 `http.pool.entrypoint` 以配置文件目录为基准。当前目录不会影响此路径。
:::

此文件还控制 worker 替换、请求超时、日志和 supervisor pidfile。如果文件包含未知键，服务器不会启动。所有配置文件设置请参阅[配置](/zh/docs/configuration)，命令请参阅[命令行](/zh/docs/cli)。

## 停止服务器

按 `Ctrl-C` 停止服务器。终端向 master 和每个 worker 发送 `SIGINT`，因此当前请求立即停止。要让当前请求完成，只向 master 进程发送 `SIGTERM`，例如 `kill -TERM <master-pid>`。完整的信号表请参阅[进程模型](/zh/docs/process-model)。

## 下一步

- [Worker 模式](/zh/docs/worker)介绍常驻循环、状态、内存泄漏、worker 替换和应用初始化。
- [配置](/zh/docs/configuration)列出 `rapira.toml` 的每个键及其默认值。
- [框架集成](/zh/docs/frameworks/)提供 Symfony、Laravel 和 Yii3 的集成指南。
