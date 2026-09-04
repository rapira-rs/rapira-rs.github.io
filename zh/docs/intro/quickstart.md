---
title: 快速开始
description: "使用 Rapira 以 Classic 和 Worker 模式运行 PHP 应用，并将设置存入 rapira.toml。"
---

# 快速开始

本指南先以 Classic 模式启动应用，再将应用转换为 Worker 模式。然后，本指南将设置存入配置文件。 这些步骤需要可用的 `rapira` 二进制文件及其附带的 PHP。请参阅[安装](/zh/docs/intro/installation)。

## Classic 模式

任何应用都可以使用 Classic 模式。Rapira 与 php-fpm 一样，为每个请求加载入口脚本。代码不需要更改。

新建 `public/index.php`：

```php
<?php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

启动服务器。`--mode classic` 参数选择模式。位置参数指定入口脚本：

```bash
rapira serve --mode classic public/index.php
```

Rapira 默认监听 `127.0.0.1:8000`。从另一个终端发送请求：

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

worker 进程在请求之间保持运行。Rapira 创建一次 worker，并在每个 worker 中保留已初始化的 PHP 解释器。 Classic 模式在每个请求后删除脚本状态。此状态包括变量、自动加载器和框架对象。

## Worker 模式

Worker 模式使脚本保持运行。脚本初始化一次，然后在循环中等待请求。 Rapira 填充超全局变量并调用处理函数。PHP 可以读取 `$_GET` 并使用 `echo` 创建响应。 应用在每个进程中初始化一次。请参阅[执行模式](/zh/docs/execution-modes)。

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

`\Rapira\handle_request()` 等待下一个请求。此函数调用处理函数并返回 `true`。 worker 停止时，此函数返回 `false` 并结束循环。处理函数读取超全局变量，并使用 `echo` 和 `header()` 创建响应。 只能从顶层循环调用 `\Rapira\handle_request()`。此函数在其他模式下抛出 `Rapira\Exception\NotInWorkerModeError`。

Rapira 的 PHP 模块提供 `\Rapira\handle_request()`。因此，此示例不需要自动加载器。 使用 Composer 依赖的应用必须在循环前加载 `vendor/autoload.php`。

使用 `Ctrl-C` 停止 Classic 服务器。两个服务器都使用 `127.0.0.1:8000`。 Dispatcher 是默认模式。使用 `--mode worker` 参数选择 Worker 模式：

```bash
rapira serve --mode worker worker.php
```

```bash
curl '127.0.0.1:8000/?name=world'
```

多次运行 `curl` 命令。同一进程处理另一个请求时，该 worker 的计数器会增加。 Rapira 默认为每个逻辑 CPU 创建一个 worker。操作系统为每个连接选择 worker。 每个 worker 有独立的计数器。响应中的进程标识符显示处理请求的 worker。 使用 `rapira serve --mode worker --processes 1 worker.php` 创建一个 worker。请参阅[进程模型](/zh/docs/process-model)。

在 `while` 循环前创建的对象会在内存中保留到 worker 脚本重新启动。 这些对象包括 Composer 自动加载器、容器、连接、路由和模板。Rapira 只初始化一次此状态。 每次迭代只创建新的请求状态。

::: warning
worker 脚本必须重置保留在内存中的请求状态。 此状态包括静态属性、全局值和未结束的事务。请参阅 [Worker 模式](/zh/docs/worker)。
:::

处理函数可以使用 `header()`、`http_response_code()` 和 `echo`。 `rapira_finish_request()` 在处理函数结束前发送响应。请参阅 [HTTP](/zh/docs/http)。

## 配置文件

将设置存入 `rapira.toml`，而不是命令行。在应用旁创建此文件：

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
```

```bash
rapira serve --config rapira.toml
```

::: info
相对 `pool.entrypoint` 以配置文件目录为基准。当前目录不会影响此路径。 命令行参数覆盖文件值。例如，`--processes 1` 只更改 worker 数量。
:::

此文件还控制进程池伸缩、worker 替换、请求超时、日志和 pidfile。 未知键会阻止服务器启动。请参阅[配置](/zh/docs/configuration)和[命令行](/zh/docs/cli)。

## 停止服务器

按 `Ctrl-C` 开始受控停止。Rapira 停止接受新工作，完成当前请求，关闭扩展，然后退出。 再次按 `Ctrl-C` 强制退出。`SIGTERM` 的行为相同。 完整的信号表见[进程模型](/zh/docs/process-model)。

## 下一步

- [Worker 模式](/zh/docs/worker)--常驻循环的细节：状态、泄漏、回收，以及怎样在进入循环之前把一个真实应用启动起来。
- [配置](/zh/docs/configuration)--`rapira.toml` 能接受的每一个键，以及各自的默认值。
- [框架集成](/zh/docs/frameworks/)--Symfony、Laravel 和 Yii3 的集成指南。
