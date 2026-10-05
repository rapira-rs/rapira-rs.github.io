---
title: Symfony
description: "在 Worker 模式下运行 Symfony：worker 脚本、请求之间的服务重置，以及容器中的 .env 值。"
---

# Symfony

Symfony 支持常驻 worker。应用初始化内核，向其传递 `Request`，并接收 `Response`。Rapira 为每个 worker 初始化一次内核。之后，每个请求在同一个内核上调用 `handle()`。

应用代码不变。worker 脚本替换 `public/index.php`。本页介绍此文件、请求状态重置和 `.env` 值。

::: info 验证环境
- **PHP 8.5.8**：NTS、embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4**（`symfony/framework-bundle` v7.4.15），在 `dev` 和 `prod` 下测试
- **Symfony 8.1**（`symfony/framework-bundle` v8.1.2），在 `dev` 下测试

两个基础应用都使用 `symfony/skeleton` 包和一个 worker。两者都使用**同一个 `worker.php`**，没有版本条件。测试覆盖了路由、错误、请求、session、上传和 200 个连续请求。本页示例使用 v0.9 配置格式。
:::

## Worker 模式下的行为

内核在循环外初始化，并保留到 worker 脚本重新启动。自动加载器、容器、路由器、事件分发器和连接只初始化一次。有关详细信息，请参阅 [Worker 模式](/zh/docs/worker)和[执行模式](/zh/docs/execution-modes)。

对于每个请求，handler 从 Rapira 填充的超全局变量构建 `Request`。然后它调用 `handle()`、`send()` 和 `terminate()`。最后，它调用 `services_resetter` 重置带状态的服务。有关响应传输，请参阅 [HTTP](/zh/docs/http)。

session 使用原生 PHP session 函数。使用 session 的请求调用 `session_start()`，响应包含 session cookie。下一个请求读取已存储的 session。测试确认不同客户端得到不同的 session。

每个 worker 进程有一个内核。worker 之间不共享应用对象。有关 worker 数量和监管，请参阅[进程模型](/zh/docs/process-model)。

## 前置条件

安装 [Rapira](/zh/docs/intro/installation)。创建或选择 Symfony 应用。将 worker 脚本放在 `composer.json` 旁边。

为 Composer 和 `bin/console` 安装 PHP CLI。Rapira 以库的形式提供 PHP，不提供 `php` 命令。Composer 和 `bin/console` 使用系统 PHP CLI。Rapira 不使用也不更改此 CLI。

基础应用需要 `ctype` 和 `iconv` 扩展。它还替换了这两个扩展的 PHP polyfill，因此两者必须是原生扩展。系统 PHP CLI 也需要它们，用于 Composer 平台检查。每个 Rapira 发布版都包含这两个扩展。

完整的扩展列表见[安装](/zh/docs/intro/installation)。编译 PHP 时，请启用这两个扩展。请参阅[从源码构建](/zh/docs/intro/build-from-source)。

worker 还使用基础应用中的 `symfony/dotenv` 组件。如果部署环境提供所有环境变量，请删除 Dotenv 调用。如果没有其他入口点使用此组件，再删除此组件。worker 读取 `.env` 并创建内核，不使用 `symfony/runtime`。请保留 `symfony/runtime`，因为 `bin/console` 和 `public/index.php` 使用它。

## worker 脚本

将此文件保存为项目根目录中的 `worker.php`。测试在两个 Symfony 版本中都使用了此文件：

```php
<?php

declare(strict_types=1);

use App\Kernel;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

require __DIR__ . '/vendor/autoload.php';

// public/index.php uses symfony/runtime for this operation.
// The worker performs it once before the request loop.
(new Dotenv())->bootEnv(__DIR__ . '/.env');

$kernel = new Kernel($_SERVER['APP_ENV'], (bool) $_SERVER['APP_DEBUG']);
$kernel->boot();
$container = $kernel->getContainer();

$handler = static function () use ($kernel, $container): void {
    $request = Request::createFromGlobals();

    try {
        $response = $kernel->handle($request);
        $response->send();
        $kernel->terminate($request, $response);
    } finally {
        // Symfony uses the same reset between Messenger messages.
        // Each service with the kernel.reset tag removes request state.
        // The finally block also resets state when send() or terminate() throws.
        if ($container->has('services_resetter')) {
            $container->get('services_resetter')->reset();
        }
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

大部分操作使用标准 Symfony 初始化。四个部分是此 worker 特有的：

**`(new Dotenv())->bootEnv(...)`。**标准 `public/index.php` 将此操作委托给 `symfony/runtime`。worker 在创建内核前读取一次 `.env`。Rapira 在请求之间保留这些 `$_ENV` 值。

**内核在循环前初始化。**`new Kernel(...)`、`boot()` 和 `getContainer()` 在 worker 初始化期间运行。内核在 worker 初始化期间读取 `$_SERVER['APP_ENV']`。每个请求使用相同的容器。

**在 `get()` 前调用 `$container->has('services_resetter')`。**`services_resetter` 标识符在两个支持的版本中都是公开的。其实现类在 7.4 和 8.1 中使用不同的命名空间。服务标识符不需要版本条件。如果容器未定义此服务，`has()` 检查可以防止错误。

**循环和 `gc_collect_cycles()`。**`\Rapira\handle_request()` 等待请求，运行 handler，然后返回 `true`。worker 关闭期间它返回 `false`，循环结束。脚本在请求之间回收循环引用。完整契约见 [Worker 模式](/zh/docs/worker)。

如果 resetter 不足，请使用 `$container->reset()` 或 `$kernel->reboot(null)`。第一个选项删除每个已创建的服务。第二个选项删除容器并创建新容器。

运行 `$kernel->reboot(null)` 后，使用 `$kernel->getContainer()` 获取新容器。handler 不得使用旧容器。两个选项都会删除缓存的应用状态。请将它们用于查找内存泄漏，不要作为默认配置。

## `$_ENV` 与进程环境

Rapira 会保留 `$_ENV`，直到 worker 重新运行脚本。它不会为每个请求重建此超全局变量。`bootEnv()` 在循环前加载的值仍可用于后续请求。此行为也适用于 `variables_order = "GPCS"` 和 `auto_globals_jit = On`。

在第一个请求之前，`$_SERVER` 包含进程环境。Dotenv 不会替换 `$_SERVER` 或 `$_ENV` 中已有的变量。因此，环境变量优先于 `.env` 中的同名变量，在 `variables_order = "GPCS"` 下也是如此。

例如，如果应用代码必须使用 `getenv()` 读取 Dotenv 值，请添加 `usePutenv()`：

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` 将 Dotenv 值写入进程环境。Symfony `%env(...)%` 无需此调用即可读取保留的 `$_ENV` 值。Rapira 在每个进程中运行一个 NTS PHP 解释器。PHP 不会从并发线程调用 `putenv()`。

在生产环境中，请通过 systemd、容器运行时或编排器设置环境变量。仅在开发期间使用 `.env`。

## 启动 Rapira

在 `worker.php` 旁边创建 `rapira.toml`：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

启动 Rapira：

```bash
rapira serve rapira.toml
```

`mode = "worker"` 选择 Worker 模式。`rapira serve` 在前台运行。

打开另一个终端。发送请求：

```bash
curl -i http://127.0.0.1:8000/
```

在第一个终端中按 `Ctrl-C` 停止 Rapira。

入口脚本是 `worker.php`，因此 `$_SERVER['SCRIPT_NAME']` 包含 `/worker.php`。Symfony 在 URI 开头找不到此值。然后，它将 base URL 设置为 `""`。`getPathInfo()` 返回请求路径，路由可以正常工作。`generateUrl()` 创建不带 `/worker.php` 前缀的路径。不需要覆盖 `$_SERVER` 或使用 `Request::setTrustedProxies()`。

## 上生产环境

设置 `APP_ENV=prod`。安装时不包含开发依赖。在服务器启动前创建缓存。测试确认 `php bin/console cache:warmup` 可正确初始化应用。此命令还会在第一个请求前编译容器：

```bash
composer install --no-dev --optimize-autoloader
APP_ENV=prod php bin/console cache:warmup
```

配置时请检查 `DEFAULT_URI`。基础应用在每个环境中都将 `router.default_uri` 设置为 `%env(DEFAULT_URI)%`。默认值是 `http://localhost`。控制台命令和邮件代码使用此值在 HTTP 请求之外创建 URL。请将它设置为应用的源站地址。

使用以下最小 `rapira.toml`：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` 在随机请求数后替换 worker。此请求数在此值和此值的 1.5 倍之间。它限制内存泄漏的影响，但不会修复泄漏。当一个请求的运行时间超过 `request_terminate_timeout_secs` 时，Rapira 会停止该 worker。新 worker 会再次初始化内核。相对 `entrypoint` 以配置文件所在目录为基准。有关所有设置，请参阅[配置](/zh/docs/configuration)。

使用 `APP_ENV=prod` 启动服务器：

```bash
APP_ENV=prod rapira serve rapira.toml
```

部署后，向 master 发送 `SIGUSR2` 以替换 worker。如果设置了 `opcache.validate_timestamps = 0`，请改为重启 Rapira。请参阅[生产环境部署](/zh/docs/deployment)。

## 请求之间的状态重置

`services_resetter` 对每个带 `kernel.reset` 标签的服务调用 `reset()`。安装的 bundle 决定哪些服务带此标签。例如带缓冲的日志 handler 和调试数据收集器。这些服务会自行注册标签。

它不会重置应用静态属性、全局值、库注册表或持续的 `ini_set()` 更改。此状态保留在每个常驻 worker 中。请在应用代码中重置。有关状态生命周期表，请参阅[框架集成](/zh/docs/frameworks/)。

使用 resetter 的测试在 `dev` 和 `prod` 的 200 个连续请求中显示稳定的进程内存。如果内存增加，应用代码或 bundle 可能会保留请求状态。

## 响应后的工作

在 `$response->send()` 和 `$kernel->terminate()` 之间调用 [`rapira_finish_request()`](/zh/docs/http)，可在响应后监听器运行前发送响应。worker 会继续运行 `terminate()`，直到 handler 返回。这可以减少客户端等待时间，但不会增加并发性。

## 开发

在 Worker 模式下，每个 worker 只初始化一次应用。每次更改代码后，请重启 Rapira 以加载新的 PHP 代码。或者在开发期间使用 [Classic 模式](/zh/docs/classic)。Classic 模式为每个请求运行入口脚本。请将 `rapira.toml` 改为 Classic 模式：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

```bash
rapira serve rapira.toml
```

在 Classic 模式下，同一个应用为每个请求初始化。因此，保存的更改立即生效。

## 错误和日志

Symfony 处理未捕获的应用异常并返回自己的 `500` 响应。`dev` 显示异常页面，`prod` 显示通用错误页面。同一个 worker 处理下一个请求。异常发生后，最终重置会删除已更改的服务状态。

配置的 Symfony 日志器控制异常输出。基础应用不包含日志器。Rapira 记录 Symfony 未处理的 PHP 错误。有关级别设置，请参阅[日志](/zh/docs/logging)。
