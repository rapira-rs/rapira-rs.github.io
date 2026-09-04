---
title: Laravel
description: "在 Rapira 上以 Classic 模式运行 Laravel，以及 Worker 模式支持的现状。"
---

# Laravel

Rapira 使用标准 `public/index.php` 脚本以 Classic 模式运行 Laravel。它为每个请求启动新的 PHP 请求，与 php-fpm 相同。 应用不需要更改。Laravel Worker 模式正在开发中。请参阅 [Worker 模式](#worker-模式)。

::: info 验证环境
- **PHP 8.5.8**--NTS，embed SAPI
- **Rapira 0.8.0**
- 基础应用 **laravel/laravel** + **laravel/framework v13.23.0**

测试使用了带有额外测试路由的 `laravel/laravel` 基础应用。Rapira 以 Classic 模式和单个 worker 进程运行该应用。测试覆盖了路由、session、文件上传、JSON 和表单请求体、缓存过的配置与路由、错误响应，以及 50 个顺序请求。
:::

## 前置条件

按照[安装](/zh/docs/intro/installation)说明安装 Rapira。你还需要一个可运行的 Laravel 应用。 为 Composer 和 `artisan` 安装 PHP CLI。Rapira 将 PHP 作为库提供，而不是 `php` 命令。 Composer 和 `artisan` 使用系统 PHP CLI。Rapira 不使用或修改此 CLI。

首次启动前检查数据库扩展。新的 `laravel/laravel` 项目使用 SQLite 存储数据库、session、cache 和 queue。 因此，它需要 `pdo_sqlite`。Rapira 发行版包含 PDO、`pdo_sqlite` 和 `sqlite3`。 完整列表请参阅[安装](/zh/docs/intro/installation)。 自行编译 PHP 时，请包含这些扩展。请参阅[从源码构建](/zh/docs/intro/build-from-source)。 也可以设置 `SESSION_DRIVER=file`、`CACHE_STORE=file` 和 `QUEUE_CONNECTION=sync`。本页测试使用这些设置。

## 启动 Rapira

Classic 模式需要显式开启，所以命令里直接把它写了出来：

::: code-group

```bash [CLI]
rapira serve --mode classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
mode = "classic"
processes = 4

[http]
listen = "127.0.0.1:8000"
```

:::

运行 `rapira serve --config rapira.toml` 以使用配置文件。 相对 `entrypoint` 使用配置文件目录。所有键和默认值请参阅[配置](/zh/docs/configuration)。

Rapira 为每个 HTTP 请求启动新的 PHP 请求。因此，框架生命周期与 php-fpm 相同。 应用没有持久状态。PHP 在主进程创建 worker 前启动。 OPcache 为应用代码和 `vendor/` 提供共享编译脚本缓存。请参阅 [Classic 模式](/zh/docs/classic)。

启动生产环境前，请创建框架缓存。以下两个命令已在 Classic 模式下验证：

```bash
php artisan config:cache
php artisan route:cache
```

## 路由与 URL

Rapira 不将 URL 映射到 PHP 脚本。每个请求都运行入口脚本。 `$_SERVER['REQUEST_URI']` 包含 Laravel 路由使用的路径。[静态文件中间件](/zh/docs/static-files)响应文件请求。 其他请求运行入口脚本。测试包括路由、Laravel 404 页面和 `url()` 生成。 生成的 URL 是绝对 URL，且不含 `index.php`。无需更改 `$_SERVER` 或 URL 配置。

`/up` 路由返回 `200`。负载均衡器或容器可以使用此路由进行健康检查。 对于静态文件，请将 `"static"` 添加到 `http.middleware`。将 `[http.static].root` 设置为 `public/` 目录。 Rapira 要求同时设置两个值。也可以使用 CDN 或反向代理。 Rapira 接受明文 HTTP，并且无论 `X-Forwarded-Proto` 如何，都将 `$_SERVER['HTTPS']` 留空。 当[代理终止 TLS](/zh/docs/deployment)时，请配置 Laravel [可信代理](https://laravel.com/docs/requests#configuring-trusted-proxies)。 如果没有此配置，`url()` 会生成 `http://` 链接。

## Session、CSRF 与表单

测试使用文件 session 驱动。每个客户端获得独立 session，并在下一个请求中发送自己的 session cookie。 CSRF 不需要 Rapira 配置，因为 token 位于 session 中。Classic 使用与 php-fpm 相同的请求生命周期。 测试还包括表单、JSON 请求体和文件上传。Laravel 对路由异常返回常规 `500` 响应。 Laravel 正常处理了下一个请求。

## Worker 模式

Laravel Worker 模式正在开发中，目前不受支持。请以 Classic 模式运行 Laravel。 目前没有 Worker 支持的发布日期。

框架生命周期需要专用集成。Laravel 在请求处理期间解析绑定，将请求存储在单例中，并更改静态状态。 必须在下一个请求前重置此状态。[Octane](https://laravel.com/docs/octane) 为支持的服务器执行重置。 Rapira 目前没有 Octane driver。

[Symfony](/zh/docs/frameworks/symfony) 和 [Yii3](/zh/docs/frameworks/yii3) 支持持久应用。Laravel 需要单独的状态重置过程。

自定义 Laravel worker 必须实现完整的 Octane 状态重置。 请求状态位于容器、已解析的单例、请求服务、会话服务、身份验证服务和静态属性中。 不完整的重置可能会向任何后续请求公开旧的请求或会话数据，包括同一用户的其他请求。没有完整的状态隔离测试时，请勿使用此 worker。
