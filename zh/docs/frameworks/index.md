---
title: 框架集成
description: "在 Rapira 上运行的每个框架都共通的机制：worker 循环、单请求状态与常驻状态、错误处理、静态文件和 OPcache。"
---

# 框架集成

在 Classic 模式下，框架应用无需更改。配置 Rapira 以使用现有入口脚本。
在 Worker 模式下，PHP 进程在请求之间保持活动。框架设计决定哪些应用状态可以保留在内存中。
本页介绍所有框架的通用行为。各框架指南只介绍特定行为。

::: info 验证环境

- **PHP 8.5.8**，NTS，embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4.15** 和 **8.1.2**、**Yii3** 应用模板 1.4（yii-runner-http 3.2.1）

本页的每一条结论，都来自在 Linux 上用单个 worker 进程实际跑这些应用观察到的结果。下面凡是讲框架行为的说法，都以这些实测为依据；配置键则来自 Rapira 自己的[配置](/zh/docs/configuration)参考。
:::

## Classic 模式与 Worker 模式

**Classic 模式使用现有入口脚本。**它为每个 HTTP 请求启动一个新的 PHP 请求。
在 php-fpm 下运行的框架也可以在此模式下运行。有关详细信息，请参阅 [Classic 模式](/zh/docs/classic)。
静态文件、TLS 和 OPcache 部分也适用于 Classic 模式。

**Worker 模式使进程保持活动。**脚本初始化应用，并在循环中请求工作。
应用状态保留在请求之间。有关详细信息，请参阅[执行模式](/zh/docs/execution-modes)和 [Worker 模式](/zh/docs/worker)。

一个代码库可以使用两种模式。保留 `public/index.php`。将 `worker.php` 添加到项目根目录。
使用 `--mode` 选择执行模式。使用 `SCRIPT` 参数或 `pool.entrypoint` 选择脚本。
如果 Worker 模式迁移失败，请使用 Classic 模式。

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

- **`require .../vendor/autoload.php`** 在 worker 生命周期内注册自动加载器。已加载的类保持可用。
- **`$app = new App();`** 在循环前初始化应用。Symfony 在此处保留常驻内核。
- Yii3 可以保留常驻 runner，也可以在 handler 中创建 runner。每个指南都说明所需的初始化和请求清理。
- **`$handler = static function () use ($app): void`** 定义不带参数的 handler。handler 从超全局变量读取请求。
- 使用 `use` 捕获其他依赖项。
- **`header()`、`http_response_code()` 和 `echo`** 创建响应，方式与经典脚本相同。请参阅 [HTTP](/zh/docs/http)。
- **`while (\Rapira\handle_request($handler))`** 等待请求。`handle_request()` 填充超全局变量，运行 handler 并完成请求。
- 它在请求后返回 `true`，在 worker 停止期间返回 `false`。只能从顶层循环调用。
- 在 Worker 模式之外，它会抛出 `Rapira\Exception\NotInWorkerModeError`。
- **`gc_collect_cycles();`** 在请求之间运行并回收循环引用。它不会修复内存泄漏。
- 请参阅[内存与回收](#内存与回收)。

Rapira 将 `SCRIPT_NAME` 设置为 `/worker.php`，因为它是入口脚本。
`DOCUMENT_ROOT` 包含脚本目录。`REQUEST_URI` 包含客户端路径。
Symfony 和 Yii3 使用这些值正确路由请求和生成 URL。生成的 URL 不包含 `worker.php`。
集成其他框架前，请检查它是否使用 `SCRIPT_NAME` 而不是 `REQUEST_URI` 生成 URL。

## 单请求状态与常驻状态

左边一列的东西 Rapira 每个请求都会重建，所以读它们的普通 PHP 代码照常工作。右边一列的东西在 worker 的整个生命周期里一直存在，得由 worker 脚本自己管理。

| 每个请求都是全新的 | 跨请求留下来的 |
| ------------------ | -------------- |
| `$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE`--用这次请求的数据重新填好 | Composer 自动加载器，以及通过它加载过的每一个类 |
| `php://input`--这次请求的原始请求体，旁边配好 `CONTENT_TYPE` 和 `CONTENT_LENGTH` | `static` 属性和静态变量，它们会跨请求一路累加 |
| `$_FILES`，以及它背后那些上传的临时文件 | 循环之前创建的对象--容器、内核、你的应用 |
| session 那一套：`session_start()`、进来的 cookie、出去的 `Set-Cookie` | 已经打开的资源：数据库句柄、缓存客户端、流 |
| 响应状态：状态码、响应头、`setcookie()`、输出缓冲区 | 进程本身--同一个 pid，每个 worker 一个常驻的 PHP 解释器 |
| 在 handler **内部**注册的 shutdown 函数 | worker 自己的计数器：`handled` 和 `errors` 会持续累加 |
| `max_execution_time` 的计时，每个请求重新起算 | `$_ENV`，包括循环前加载的值 |

在 Linux（以及 FreeBSD）上，Zend 的单请求计时器是存在的，`max_execution_time` 的计时会为每个请求重新起算，worker 停下来等下一个请求的那段时间从不计入其中，只有请求本身在计时。其他平台上--包括 macOS--根本不会设置单请求超时。

下面三种行为适用于常驻的 worker 进程。

::: warning 常驻对象在请求之间保持自己的状态

请求结束时，PHP 不会调用常驻对象的析构函数。PHP 会在 worker 循环结束时调用一次析构函数，或者在代码释放最后一个引用时调用它。

不要用析构函数做每个请求的清理。请在 handler 内部重置每个请求的状态。
:::

::: warning 启动阶段注册的 shutdown 函数只在 worker 退出时运行一次

对于在 handler 之外注册的 shutdown 函数，PHP 只在 worker 循环结束时运行它一次。在 handler 内部注册的函数会在当次请求结束时运行。

请在 handler 内部注册每个请求需要的 shutdown 函数，例如输出指标、处理致命错误、释放请求占用的资源。
:::

::: warning `$_ENV` 在请求之间保留

Rapira 不会为每个请求重建 `$_ENV`。代码在循环前写入的值会保留到 worker 重新运行脚本为止。
请将 `$_ENV` 视为常驻应用状态。在循环前加载环境配置。不要在 `$_ENV` 中存储请求数据。

Rapira 无需 `putenv()` 即可保留 `$_ENV` 中的值。
当代码需要进程环境行为时，请使用 `putenv()`，例如 `getenv()` 或子进程继承。
在生产环境中，请在服务 unit、容器或编排器中设置环境变量。
:::

## 错误处理

测试在一个 worker 中确认了三种故障：

- **handler 中的 `exit` 或 `die`** 会发送当前状态和输出。worker 继续接受请求。
- 框架可以使用 `exit` 返回维护响应，而不终止进程。
- **未捕获的异常**返回 `500`。框架错误处理器可以返回自己的错误页。
- 如果没有此处理器，Rapira 返回空响应体。worker 继续接受请求。
- **未捕获的 `Error`** 也返回 `500`，worker 继续运行。PHP 会记录 `Uncaught Error`。

两个错误情况会增加 worker 的 `errors` 计数器。`exit` 请求返回 `200`，只增加 `handled`。
在三种情况下，`recycles` 和 `restarts` 都保持为零。未捕获的 throwable 不会停止 worker 或影响下一个请求。
bailout 类型的致命错误会结束常驻脚本。worker 随后重新运行脚本并初始化应用。
此操作会增加 `recycles`。有关这些计数器，请参阅[进程模型](/zh/docs/process-model)。

## 静态文件

Rapira 用[静态文件中间件](/zh/docs/static-files)提供静态资源。把 `[http.static]` 里的 `root` 指向框架的 `public/` 目录，再在 `[http]` 里把中间件列出来：

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

只有路径在这个根目录下确实对应到一个文件时，中间件才会应答。它默认的 `forbid` 列表把 `.php` 文件挡在外面，所以 `public/` 里的入口脚本绝不会被当作文件发出去。其余的 URL 照旧跑入口脚本，Classic 模式和 Worker 模式下都是如此，客户端想去哪儿由 `$_SERVER['REQUEST_URI']` 告诉应用。目录 URL 同样跑入口脚本，因为这个中间件不为它提供任何索引文件。

当然，也可以让前面的 CDN 或反向代理来提供这些资源，[生产环境部署](/zh/docs/deployment)里就搭了这么一层代理。

## TLS 与代理

Rapira 的监听器只说明文 HTTP，配置里也没有 TLS 这一段。让 TLS 在你已经在跑的那层代理上终结，再由它通过环回地址或者 Unix socket 连到 Rapira。代理必须把转发字段的名字用 `-` 连接，绝不要用 `_`，因为两种写法会折叠到同一个 `$_SERVER` 键上。这套映射见 [HTTP](/zh/docs/http)，代理的具体配置见[生产环境部署](/zh/docs/deployment)。

## 内存与回收

worker 可以在 handler 中创建应用。此设计只在一个请求期间保留应用。
它保留的应用状态少于常驻 Symfony 内核，但多于 Classic 模式。
循环仍位于 worker 脚本中。确认常驻状态后，才将初始化移出 handler。
此设计在请求到达后创建容器。

此设计中的每个请求都会创建一个对象图。循环引用可能会保留旧图，直到循环回收器运行。
内存使用量会在多个请求中增加，并在 PHP 释放多个图时减少。此循环使用不一定是内存泄漏。
但是，内存峰值可能远大于一个请求的内存。

测试发现，在循环或 handler 中调用 `gc_collect_cycles()` 都无法防止此行为。
后续初始化可能会保留对旧图的引用。其他对象引用图时，回收器无法释放它。
将 `memory_limit` 设置为高于测量的峰值。还要设置 worker 替换限制：

```toml
[pool]
max_requests = 100
```

达到请求限制后，master 会替换 worker。Rapira 会稍微改变限制，以防止同时替换。
测试在多次替换期间发送了数百个请求。内存恢复到初始水平，每个请求都返回 `200`。
此设置为内存使用提供可预测的限制。

常驻式的写法--Symfony 的内核、Yii3 那个藏在 `StateResetter` 后面的容器--相比之下是平的：同样的跑法下内存一直很稳。对它们也把回收开着，作为一层保障。配置项见[配置](/zh/docs/configuration)，回收对进程池意味着什么见[进程模型](/zh/docs/process-model)。

## OPcache 与改动过的代码

Rapira 在创建 worker 之前在 master 中启动一次 PHP。OPcache 创建一个共享内存段。
每个 worker 继承相同的映射。在两种模式下，已编译脚本都会在请求和 worker 之间保持缓存。

生产环境里，`opcache.validate_timestamps = 0` 会去掉每个请求对每个文件的 stat。此设置不会使缓存失效。内存段属于 master，比任何一代 worker 都存活得更久。因此，滚动重载会继续提供旧的 opcode，部署时需要完整重启。具体步骤见[生产环境部署](/zh/docs/deployment)。

在开发期间，常驻应用不会再次读取初始化代码。此行为与 OPcache 无关。
更改 worker 脚本或已初始化服务后，请重启服务器。按 Ctrl-C，然后再次运行 `rapira serve`。

## 框架指南

- **[Symfony](/zh/docs/frameworks/symfony)**--内核只启动一次，之后一直常驻，框架自带的 `services_resetter` 会在两次请求之间把有状态的服务恢复原样。同一个 worker 文件一字不差地同时适用于 7.4 和 8.1。
- **[Laravel](/zh/docs/frameworks/laravel)**--Classic 模式：原装的 `public/index.php` 原封不动就能跑。Laravel 的 Worker 模式还在开发中--常驻的 Laravel 应用需要 Octane 实现的那套状态复原，而 Rapira 目前还没有 Octane driver。
- **[Yii3](/zh/docs/frameworks/yii3)**--`StateResetter` 在每个请求后重置常驻容器。worker 也可以为每个请求创建新 runner。

其他框架可以使用相同的基本 worker 脚本。仅当应用可在一个进程中处理多个请求时，才使用 Worker 模式。
首先，在 handler 中创建应用。此设计不要求框架支持常驻进程。
验证后，保留应用并重置其请求状态。如果两种 Worker 设计都不能工作，请使用 [Classic 模式](/zh/docs/classic)。
