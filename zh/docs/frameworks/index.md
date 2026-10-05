---
title: 框架集成
description: "框架 worker 循环、请求状态、常驻状态、错误处理、静态文件和 OPcache。"
---

# 框架集成

在 Classic 模式下，框架应用无需更改即可运行。配置 Rapira 以使用现有入口脚本。在 Worker 模式下，PHP 进程在请求之间保持活动。框架设计决定哪些应用状态可以保留在内存中。本页介绍适用于所有框架的规则。各框架指南只介绍框架特定的行为。

::: info 验证环境

- **PHP 8.5.8**，NTS，embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4.15** 和 **8.1.2**、**Yii3** 应用模板 1.4（yii-runner-http 3.2.1）

测试在 Linux 上使用一个 worker 进程运行这些应用。本页的框架说明来自这些测试。本页示例使用 v0.9 配置格式。有关 Rapira 设置，请参阅[配置](/zh/docs/configuration)。
:::

## Classic 模式与 Worker 模式

**Classic 模式使用现有入口脚本。**它为每个 HTTP 请求启动一个新的 PHP 请求。在 php-fpm 下运行的框架也可以在此模式下运行。有关详细信息，请参阅 [Classic 模式](/zh/docs/classic)。下面只有静态文件、TLS 和 OPcache 部分适用于 Classic 模式。

**Worker 模式使进程保持活动。**脚本初始化应用，并在循环中请求工作。应用状态保留在请求之间。有关详细信息，请参阅[执行模式](/zh/docs/execution-modes)和 [Worker 模式](/zh/docs/worker)。

一个代码库可以使用两种模式。保留 `public/index.php`。将 `worker.php` 添加到项目根目录。`http.pool.mode` 选择执行模式，`http.pool.entrypoint` 选择脚本。如果 Worker 模式迁移失败，Classic 模式仍然可用。

每个 worker 使用入口脚本所在目录作为工作目录。因此，`worker.php` 中的相对文件路径基于项目根目录解析。`public/index.php` 中的相对文件路径基于 `public/` 解析。PHP 代码中的 `chdir()` 调用保持有效，直到 worker 进程退出。

## Worker 循环

每个框架都使用相同的基本 worker 脚本结构：

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // The worker creates this object once and reuses it.

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

脚本包含以下操作：

- **`require .../vendor/autoload.php`** 注册自动加载器。自动加载器和已加载的类保持可用，直到 worker 脚本重新启动。
- **`$app = new App();`** 在循环前初始化应用。Symfony 在此处保留常驻内核。Yii3 可以保留常驻 runner，也可以在 handler 中创建 runner。每个指南都说明初始化和请求清理。
- **`$handler = static function () use ($app): void`** 定义不带参数的 handler。handler 从超全局变量读取请求数据。它通过 `use` 获取其他依赖项。
- **`header()`、`http_response_code()` 和 `echo`** 创建响应，方式与经典脚本相同。有关响应传输，请参阅 [HTTP](/zh/docs/http)。
- **`while (\Rapira\handle_request($handler))`** 等待请求。`handle_request()` 填充超全局变量，运行 handler 并完成请求。它在请求后返回 `true`，在 worker 停止时返回 `false`。只能从顶层脚本循环调用它。在 Worker 模式之外，它会抛出 `Rapira\Exception\NotInWorkerModeError`。
- **`gc_collect_cycles();`** 在请求之间回收循环引用。它不会修复内存泄漏。请参阅[内存与回收](#内存与回收)。

在 handler 内部，Rapira 将 `SCRIPT_NAME` 设置为 `/worker.php`，因为 `worker.php` 是入口脚本。`DOCUMENT_ROOT` 包含脚本目录。`REQUEST_URI` 包含客户端路径。Symfony 和 Yii3 使用这些值正确路由请求和生成 URL。生成的 URL 不包含 `worker.php`。集成其他框架前，请检查它是否使用 `SCRIPT_NAME` 而不是 `REQUEST_URI` 生成 URL。

在第一个请求之前，`$_SERVER` 包含进程环境。此时，`SCRIPT_NAME` 包含脚本的绝对路径，`DOCUMENT_ROOT` 为空。请求的 `$_SERVER` 不包含进程环境。请在循环前读取环境变量，或者在 handler 中使用 `getenv()`。不要在循环前根据 `$_SERVER` 计算 URL 前缀。请参阅[第一个请求之前的 `$_SERVER`](/zh/docs/execution-modes#第一个请求之前的-server)。

## 单请求状态与常驻状态

Rapira 为每个请求重建左列中的所有内容。普通 PHP 代码可以继续读取这些值。右列中的所有内容在请求之间保留。worker 脚本必须管理此状态。

| 每个请求的新内容 | 在请求之间保留的内容 |
| ---------------- | -------------------- |
| `$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE`：Rapira 使用请求数据重新填充它们。`$_SERVER` 不包含进程环境 | Composer 自动加载器及其加载的每个类 |
| `php://input`：原始请求体、`CONTENT_TYPE` 和 `CONTENT_LENGTH` | `static` 属性和变量，它们在请求之间保留值 |
| `$_FILES` 和上传的临时文件 | 循环前创建的对象，例如容器、内核和应用 |
| 会话数据：`session_start()`、请求 cookie 和响应 `Set-Cookie` 字段 | 打开的资源：数据库连接、缓存客户端和流 |
| 响应状态：状态码、响应头、`setcookie()` 和输出缓冲区 | 进程：相同的 pid，且每个 worker 有一个常驻 PHP 解释器 |
| 在 handler **内部**注册的 shutdown 函数 | 循环前加载的 `$_ENV` 值 |
| 为每个请求重新启动的 `max_execution_time` 计时器 | |

Rapira 为每个请求启动新的 `max_execution_time` 计时器。worker 等待请求的时间不计入此限制。

下面三种行为适用于常驻的 worker 进程。

::: warning 常驻对象在请求之间保持自己的状态

请求结束时，PHP 不会调用常驻对象的析构函数。PHP 会在 worker 循环结束时调用一次析构函数，或者在代码释放最后一个引用时调用它。

不要用析构函数做每个请求的清理。请在 handler 内部重置每个请求的状态。
:::

::: warning 初始化期间注册的 shutdown 函数在 worker 循环结束时运行一次

对于在 handler 之外注册的 shutdown 函数，PHP 只在 worker 循环结束时运行它一次。在 handler 内部注册的函数会在当次请求结束时运行。

请在 handler 内部注册每个请求的 shutdown 函数。例如，指标输出、致命错误处理和请求资源清理。
:::

::: warning `$_ENV` 在请求之间保留

Rapira 不会为每个请求重建 `$_ENV`。代码在循环前写入 `$_ENV` 的值会保留到 worker 脚本重新启动为止。在循环前加载环境配置。不要在 `$_ENV` 中存储请求数据。

更改 `$_ENV` 不会更改进程环境。当 `getenv()` 或子进程必须看到某个值时，请使用 `putenv()`。在生产环境中，请在服务 unit、容器或编排器中设置环境变量。
:::

## 错误处理

测试在一个 worker 中确认了三种故障：

- **handler 中的 `exit` 或 `die`** 会发送当前状态和输出。进程不会停止，worker 继续接受请求。例如，框架可以使用 `exit` 返回维护响应。
- **未捕获的异常**：如果异常之前 PHP 没有发送输出，则返回 `500`。如果已经有输出，则保留 PHP 已发送的状态。框架异常处理器可以返回自己的错误页。如果没有此处理器，并且 `display_errors` 关闭，则响应体为空。worker 继续接受请求。
- **未捕获的 `Error`** 结果相同。对于这两种类型，PHP 都会写入一条 `Uncaught` 日志记录。

当没有异常处理器捕获异常或 `Error` 时，worker 的 `errors` 计数器会增加。`exit` 请求只增加 `handled`。在三种情况下，`recycles` 都保持为零。

bailout 类型的致命错误会结束常驻脚本。worker 随后重新运行脚本并初始化应用。此重启会增加 `recycles`。[进程模型](/zh/docs/process-model)的状态输出显示这些计数器。

## 静态文件

Rapira 使用[静态文件中间件](/zh/docs/static-files)提供静态资源。将 `[http.static].root` 设置为框架的 `public/` 目录。将中间件添加到 `[http]`：

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

仅当路径与根目录下的文件匹配时，中间件才返回响应。默认的 `forbid` 列表阻止 `.php` 文件，因此它不会将入口脚本作为文件提供。其他 URL 运行入口脚本。目录 URL 也运行入口脚本，因为中间件不提供索引文件。`$_SERVER['REQUEST_URI']` 包含客户端路径。

CDN 或反向代理也可以提供这些资源。有关反向代理配置，请参阅[生产环境部署](/zh/docs/deployment)。

## TLS 与代理

Rapira 只接受明文 HTTP，并且没有 TLS 设置。请在代理处终止 TLS。通过环回地址或 Unix socket 连接代理。`$_SERVER['HTTPS']` 始终为空，`$_SERVER['REQUEST_SCHEME']` 始终为 `http`。请配置框架的受信任代理，使框架读取 `X-Forwarded-Proto`。如果没有此配置，框架会生成 `http://` URL。

转发字段名称使用连字符，不要使用下划线，因为这两个字符可以映射到同一个 `$_SERVER` 键。请参阅 [HTTP](/zh/docs/http)和[生产环境部署](/zh/docs/deployment)。

## 内存与回收

worker 可以在 handler 中创建应用。这样，应用只在一个请求期间保留在内存中。worker 保留的状态少于常驻 Symfony 内核，但多于 Classic 模式。确认常驻状态后，才将初始化移出 handler。

在此设计中，每个请求都会创建一个对象图。循环引用可能会保留旧图，直到循环回收器运行。内存使用量会在多个请求中增加，并在 PHP 释放多个图时减少。此模式不一定是内存泄漏。但是，内存峰值可能远大于一个请求的内存。

测试发现，在循环或 handler 中调用 `gc_collect_cycles()` 都无法防止此模式。后续初始化可能会保留对旧图的引用。其他对象引用图时，回收器无法释放它。将 `memory_limit` 设置为高于测量的峰值。还要设置 worker 替换限制：

```toml
[http.pool]
max_requests = 100
```

每个 worker 处理的请求超过 `max_requests` 后停止，master 启动替代的 worker。每个 worker 使用自己的限制，范围从 `max_requests + 1` 到 `max_requests` 加上该值的一半。因此，worker 不会同时停止。测试在多次替换期间发送了数百个请求。内存恢复到初始水平，每个请求都返回 `200`。此设置限制此模式的内存峰值。

常驻 Symfony 和 Yii3 应用在相同测试中保持稳定的内存使用。请保持启用 worker 替换，以限制意外的内存增长。有关详细信息，请参阅[配置](/zh/docs/configuration)和[进程模型](/zh/docs/process-model)。

## OPcache 与改动过的代码

Rapira 在创建 worker 之前在 master 中启动一次 PHP。OPcache 创建一个共享内存段，每个 worker 继承相同的映射。在所有模式下，已编译脚本都会在请求和 worker 之间保持缓存。

在 PHP 8.4 上，OPcache 是单独的 `opcache.so` 文件，需要在 `php.ini` 中添加 `zend_extension` 行。请参阅 [php.ini](/zh/docs/intro/installation#php-ini)。

在生产环境中，`opcache.validate_timestamps = 0` 会删除每个请求的文件检查。此设置会阻止自动缓存失效。OPcache 段属于 master，并在 worker 替换期间保留。因此，部署需要完整重启。有关步骤，请参阅[生产环境部署](/zh/docs/deployment)。

在开发期间，常驻应用不会再次读取初始化代码。此行为与 OPcache 无关。更改 worker 脚本或已初始化服务后，按 Ctrl-C。然后再次运行 `rapira serve rapira.toml`。

## 框架指南

- **[Symfony](/zh/docs/frameworks/symfony)：**内核初始化一次并保留在内存中。`services_resetter` 在请求之间重置有状态服务。一个 worker 文件支持 Symfony 7.4 和 8.1。
- **[Laravel](/zh/docs/frameworks/laravel)：**Classic 模式运行标准 `public/index.php`，无需更改。Worker 模式正在开发中：Rapira 尚未提供所需的 Octane driver。
- **[Yii3](/zh/docs/frameworks/yii3)：**`StateResetter` 在每个请求后重置常驻容器。worker 也可以为每个请求创建新 runner。

其他框架可以使用相同的基本 worker 脚本。仅当应用可以在一个进程中处理多个请求时，才使用 Worker 模式。首先，在 handler 中创建应用。此设计不要求框架支持常驻进程。

使用此设计验证应用。然后将应用保留在内存中。在每个请求后重置其请求状态。如果两种 Worker 设计都无法正常运行，请使用 [Classic 模式](/zh/docs/classic)。
