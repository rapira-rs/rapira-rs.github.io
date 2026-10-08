---
title: Laravel
description: "使用基于 Laravel Octane 的 rapira/laravel 桥接包，以 Classic、Worker 和 Dispatcher 模式运行 Laravel。"
---

# Laravel

[`rapira/laravel`](https://github.com/rapira-rs/laravel) 包将 Laravel 连接到 Rapira。一个入口脚本支持全部三种[执行模式](/zh/docs/execution-modes)。`rapira.toml` 中的 `mode` 键选择模式。应用代码不需要更改。

在 Worker 和 Dispatcher 模式下，应用只初始化一次并保留在内存中。桥接包使用 [Laravel Octane](https://laravel.com/docs/octane) worker 在请求之间重置应用状态。Octane 是此包的依赖项。不需要运行 `octane:start`，因为 Rapira 替代了 Octane 服务器。

::: info 验证环境
- **rapira/laravel 0.1.1**
- **laravel/framework v13.34.0** 和 **laravel/octane v2.20.0**
- **PHP 8.5**：embed SAPI

桥接包的测试在三种模式下分别向 Laravel 应用发送真实的 HTTP 请求。测试覆盖了路由、404 页面、路由异常、请求之间的配置隔离、session、cookie、表单数据、流式响应和文件下载。
:::

## 前置条件

- PHP 8.4 或更高版本。
- Laravel 11、12 或 13。
- Rapira 0.9 或更高版本。请参阅[安装](/zh/docs/intro/installation)。

Rapira 将 PHP 作为库提供，而不是 `php` 命令。请为 Composer 和 `artisan` 安装 PHP CLI。Rapira 不使用也不修改此 CLI。

新的 `laravel/laravel` 项目使用 SQLite，并使用基于数据库的 session、cache 和 queue 驱动，因此需要 `pdo_sqlite`。Rapira 发行版包含 `pdo_sqlite`。完整扩展列表请参阅[安装](/zh/docs/intro/installation)。如果自行编译 PHP，请启用驱动需要的扩展。请参阅[从源码构建](/zh/docs/intro/build-from-source)。

## 安装

安装此包：

```bash
composer require rapira/laravel
```

Laravel 会自动发现此包的服务提供者。将入口脚本和初始服务器配置发布到项目根目录：

```bash
php artisan vendor:publish --tag=rapira
```

该命令创建两个文件。`worker.php` 是所有模式的入口脚本：

```php
<?php

declare(strict_types=1);

use Rapira\Laravel\Runner;

require __DIR__ . '/vendor/autoload.php';

(new Runner(__DIR__))->run();
```

`Runner` 的参数是应用根目录，即包含 `bootstrap/app.php` 的目录。`rapira.toml` 配置服务器：

```toml
[http]
listen = "127.0.0.1:8000"
middleware = ["static"]

[http.static]
root = "public"

[http.pool]
entrypoint = "worker.php"
# "dispatcher"、"worker" 或 "classic"：同一个 worker.php 支持全部三种模式。
mode = "dispatcher"
```

启动服务器：

```bash
rapira serve rapira.toml
```

服务器在前台运行，应用可通过 `http://127.0.0.1:8000/` 访问。按 `Ctrl-C` 停止服务器。

相对的 `entrypoint` 以配置文件所在目录为基准。所有键和默认值请参阅[配置](/zh/docs/configuration)。

## 执行模式

`Runner` 在 worker 启动时读取模式，并运行相应的循环。要更改模式，请更改 `http.pool.mode`。保留同一个 `worker.php`。

| 模式 | 应用生命周期 | 请求来源 |
| --- | --- | --- |
| `classic` | 一个请求 | Rapira 填充的超全局变量 |
| `worker` | worker 进程 | Rapira 填充的超全局变量 |
| `dispatcher` | worker 进程 | `Rapira\Http\Exchange` 对象 |

**Classic 模式**运行与 Laravel `public/index.php` 相同的生命周期。桥接包加载 `bootstrap/app.php`，处理请求，发送响应，然后调用 `terminate()`。维护模式文件 `storage/framework/maintenance.php` 的作用与在 `public/index.php` 中相同。请求结束后不保留任何状态。请参阅 [Classic 模式](/zh/docs/classic)。

**Worker 模式**在每个 worker 进程中保留一个应用。Rapira 为每个请求填充超全局变量，桥接包使用 `Request::capture()` 构建请求。与 Classic 模式相同，响应通过 `header()` 和输出发送。请参阅 [Worker 模式](/zh/docs/worker)。

**Dispatcher 模式**在每个 worker 进程中保留一个应用。桥接包以 exchange 的形式从 HTTP [dispatcher](/zh/docs/dispatcher) 接收每个请求。它从 exchange 构建 `Illuminate\Http\Request`，并将响应写回 exchange。此模式是默认模式。

在所有模式下，每个 worker 一次处理一个请求。Octane 为每个请求重置应用，因此两个请求不能同时共享一个应用。

### Dispatcher 模式下的超全局变量

在 Dispatcher 模式下，Rapira 不填充 `$_GET`、`$_POST`、`$_COOKIE`、`$_FILES` 或 `$_SERVER` 中的请求值。桥接包也不填充它们。读取 `Request` 对象的 Laravel 代码不需要这些变量。Laravel 的 session 和 cookie 也通过 `Request` 和 `Response` 对象工作。

如果应用或某个包执行以下操作之一，请使用 Worker 模式：

- 直接读取超全局变量。
- 使用 `header()` 或 `setcookie()` 发送响应头。
- 使用原生 PHP session（`session_start()`）。

桥接包填充 `Request` 对象的服务器值，如同由 `public/index.php` 处理该请求。`SCRIPT_NAME` 为 `/index.php`，`DOCUMENT_ROOT` 为 `public/` 目录。请求头名称按照与 Worker 模式相同的规则映射到 `HTTP_*` 键。

## 请求之间的状态

在 Worker 和 Dispatcher 模式下，Octane worker 只初始化一次应用。对于每个请求，Octane 将应用克隆到一个沙箱中。然后它运行自己的监听器，这些监听器会重置已知的请求状态。例如，一个请求中的配置更改不会出现在下一个请求中。桥接包的测试在两种模式下都确认了此行为。

Octane 配置控制这些监听器。`warm` 键列出在第一个请求之前初始化的服务。`flush` 键列出在每个请求之后删除的服务。如果应用没有 `config/octane.php`，Octane 使用默认配置。要更改配置，请发布此文件：

```bash
php artisan vendor:publish --tag=octane-config
```

此文件中的 `server` 键和服务器特定设置不适用于 Rapira。请在 `rapira.toml` 中配置服务器。

Octane 不会重置静态属性、全局变量，或保留请求或容器引用的单例。应用代码和包必须能安全地在常驻 worker 中运行。请参阅 Laravel 文档中的 [Dependency injection and Octane](https://laravel.com/docs/octane#dependency-injection-and-octane)。有关保留在 worker 中的状态，请参阅[框架集成](/zh/docs/frameworks/)。

`Octane::concurrently()` 依次运行其任务。Octane 缓存存储和 `Octane::table()` 需要 Swoole，在 Rapira 上不可用。

## 路由与 URL

Rapira 不将 URL 映射到 PHP 脚本。每个请求都运行入口脚本，Laravel 根据请求路径进行路由。生成的 URL 是绝对 URL，既不含 `worker.php` 也不含 `index.php`。它们不需要覆盖 `$_SERVER`，也不需要更改路由或 URL 配置。

初始 `rapira.toml` 为 `public/` 启用[静态文件中间件](/zh/docs/static-files)。中间件响应与 `public/` 下文件匹配的请求。其他所有请求交给 Laravel。也可以由 CDN 或反向代理提供这些资源。

内置的 `/up` 路由返回 `200`。负载均衡器或容器可以使用它进行健康检查。Rapira 还可以在单独的地址上提供 `/livez` 和 `/readyz`。请参阅[指标与健康检查](/zh/docs/observability)。

Rapira 只接受明文 HTTP，因此 Laravel 将每个请求视为 `http`，请求带有 `X-Forwarded-Proto` 时也是如此。当[代理终止 TLS](/zh/docs/deployment) 时，请配置 Laravel [可信代理](https://laravel.com/docs/requests#configuring-trusted-proxies)。如果没有此配置，`url()` 会生成 `http://` 链接。

## Session、CSRF 与表单

Laravel session 使用 session cookie 和配置的 session 驱动。每个客户端获得独立的 session。CSRF 不需要 Rapira 配置，因为 token 位于 session 中。

桥接包的测试覆盖了带嵌套字段的表单数据和文件上传。在 Dispatcher 模式下，桥接包为 `POST`、`PUT`、`PATCH` 和 `DELETE` 解析表单请求体，与 `Request::createFromGlobals()` 的行为相同。

`http.max_body_size_mb` 在 PHP 运行前限制请求体，默认值为 8 MiB。对于更大的请求体，Rapira 返回 `413`，Laravel 不会收到该请求。要接受更大的上传，请增大此值。同时增大 php.ini 中的 `post_max_size` 和 `upload_max_filesize`。请参阅[请求体](/zh/docs/http#请求体)。

## 响应

桥接包支持发送所有 Laravel 响应类型：

- **缓冲响应**连同其响应头和 cookie 一起发送。
- **流式响应**（`response()->stream()`）分块发送。回调可以调用 `ob_flush()` 或 `flush()` 发送当前块。
- **文件响应**（`response()->download()` 和 `response()->file()`）连同其响应头一起发送。在 Dispatcher 模式下，桥接包将文件路径交给 Rapira，由 Rapira 读取文件。如果 Rapira 无法发送该文件，则由 PHP 流式发送。

控制器使用 `echo` 打印的输出会在响应体之前发送。

在 Classic 和 Worker 模式下，桥接包在响应后调用 [`rapira_finish_request()`](/zh/docs/http)。客户端在可终止中间件和 Octane 清理运行之前收到响应。

## 错误

Laravel 处理路由异常并返回常规的 `500` 响应。同一个 worker 处理下一个请求。

异常可能逃出 Laravel HTTP 内核，例如来自流式响应的回调。此时 Octane 通过 Laravel 异常处理器报告该异常。如果响应头尚未发送，客户端会收到纯文本的 `500` 响应。仅当 `app.debug` 为 `true` 时，响应才包含异常详情。

发生此类异常后，应用状态可能不正确。Octane 停止该 worker，桥接包结束其循环。Rapira 随后再次启动入口脚本，新的 worker 重新初始化应用。

## 上生产环境

在启动服务器前创建框架缓存：

```bash
php artisan config:cache
php artisan route:cache
```

worker 的内存使用量可能随时间增加。请设置 worker 替换限制：

```toml
[http.pool]
entrypoint = "worker.php"
mode = "dispatcher"
processes = 4
max_requests = 500
```

`max_requests` 在随机请求数后替换 worker。此请求数在此值和此值的 1.5 倍之间。它限制内存泄漏的影响，但不会修复泄漏。请参阅[进程模型](/zh/docs/process-model)。

在 Worker 和 Dispatcher 模式下，应用代码保留在内存中。部署后，向 master 发送 `SIGUSR2` 以替换 worker。如果设置了 `opcache.validate_timestamps = 0`，请改为重启 Rapira。请参阅[生产环境部署](/zh/docs/deployment)。

## 开发

在 Worker 和 Dispatcher 模式下，每个 worker 只初始化一次应用。每次更改代码后，请重启 Rapira 以加载新的 PHP 代码。

或者在开发期间使用 Classic 模式。在 `rapira.toml` 中设置 `mode = "classic"`，并保留 `entrypoint = "worker.php"`。Classic 模式为每个请求初始化应用，因此保存的更改立即生效。

::: question 可以不使用桥接包，以 Classic 模式运行 Laravel 吗？
可以。设置 `entrypoint = "public/index.php"` 和 `mode = "classic"`。这样每个请求都运行标准的 `public/index.php`，与 php-fpm 相同。Worker 和 Dispatcher 模式需要桥接包。
:::
