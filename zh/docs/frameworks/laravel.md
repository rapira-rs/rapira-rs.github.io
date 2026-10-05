---
title: Laravel
description: "在 Rapira 上以 Classic 模式运行 Laravel，以及 Worker 模式支持的现状。"
---

# Laravel

Rapira 使用标准的 `public/index.php` 入口脚本，以 Classic 模式运行 Laravel。每个 HTTP 请求在一个新的 PHP 请求中运行，与 php-fpm 相同。应用不需要更改。Rapira 目前不支持以 [Worker 模式](#worker-模式)运行 Laravel。

::: info 验证环境
- **PHP 8.5.8**：NTS，embed SAPI
- **Rapira 0.8.0**
- 基础应用 **laravel/laravel** + **laravel/framework v13.23.0**

测试使用 `laravel/laravel` 基础应用，以 Classic 模式和一个 worker 运行，并添加了额外的路由。测试覆盖了路由、session、文件上传、请求体、缓存的配置、缓存的路由、错误，以及 50 个顺序请求。本页示例使用 v0.9 配置格式。
:::

## 前置条件

按照[安装](/zh/docs/intro/installation)说明安装 Rapira。Rapira 将 PHP 作为库提供，而不是 `php` 命令。请为 Composer 和 `artisan` 安装 PHP CLI。Rapira 不使用也不修改此 CLI。

新的 `laravel/laravel` 项目使用 SQLite，并使用基于数据库的 session、cache 和 queue 驱动，因此需要 `pdo_sqlite`。Rapira 发行版包含 `pdo_sqlite`。完整扩展列表请参阅[安装](/zh/docs/intro/installation)。如果自行编译 PHP，请启用驱动需要的扩展。请参阅[从源码构建](/zh/docs/intro/build-from-source)。

也可以设置 `SESSION_DRIVER=file`、`CACHE_STORE=file` 和 `QUEUE_CONNECTION=sync`。本页测试使用这些设置。

## 启动服务器

默认模式是 `dispatcher`，但 Laravel 的 `public/index.php` 没有 dispatcher 循环。请在 `rapira.toml` 中设置 `mode = "classic"`：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
processes = 4
```

运行 `rapira serve rapira.toml` 启动服务器。相对的 `entrypoint` 以配置文件所在目录为基准。所有键和默认值请参阅[配置](/zh/docs/configuration)。

应用在请求之间没有需要重置的持久状态。PHP 在 master 中启动一次，在 master 创建 worker 之前。因此，所有 worker 共享同一个 OPcache，用于应用代码和 `vendor/` 代码。在 PHP 8.4 上，OPcache 是单独的 `opcache.so`，需要在 [php.ini](/zh/docs/intro/installation#php-ini) 中添加 `zend_extension` 行。更多信息请参阅 [Classic 模式](/zh/docs/classic)。

启动生产环境前，请创建框架缓存。测试在 Classic 模式下验证了这两个缓存：

```bash
php artisan config:cache
php artisan route:cache
```

## 路由与 URL

Rapira 不将 URL 映射到 PHP 脚本。每个请求都运行 `public/index.php`，Laravel 根据 `$_SERVER['REQUEST_URI']` 中的路径进行路由。测试覆盖了路由、Laravel 404 页面和 `url()` 生成。生成的 URL 是绝对 URL，且不含 `index.php`。它们不需要覆盖 `$_SERVER`，也不需要更改路由或 URL 配置。

要提供 `public/` 中的静态资源，请启用[静态文件中间件](/zh/docs/static-files)。在已有的 `[http]` 表中添加 `middleware`，并添加 `[http.static]` 表。Rapira 需要这两项设置：

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

中间件响应与 `public/` 下文件匹配的请求。其他所有请求交给 Laravel。也可以由 CDN 或反向代理提供这些资源。

内置的 `/up` 路由返回 `200`。负载均衡器或容器可以使用它进行健康检查。Rapira 还可以在单独的地址上提供 `/livez` 和 `/readyz`。请参阅[指标与健康检查](/zh/docs/observability)。

Rapira 只接受明文 HTTP，并将 `$_SERVER['HTTPS']` 留空，请求带有 `X-Forwarded-Proto` 时也是如此。当[代理终止 TLS](/zh/docs/deployment) 时，请配置 Laravel [可信代理](https://laravel.com/docs/requests#configuring-trusted-proxies)。如果没有此配置，`url()` 会生成 `http://` 链接。

## Session、CSRF 与表单

测试使用文件 session 驱动。每个客户端获得独立的 session，并在下一个请求中发送自己的 session cookie。CSRF 不需要 Rapira 配置，因为 token 位于 session 中。

测试还覆盖了表单数据、JSON 请求体和文件上传。`http.max_body_size_mb` 在 PHP 运行前限制请求体，默认值为 8 MiB。对于更大的请求体，Rapira 返回 `413`，Laravel 不会收到该请求。要接受更大的上传，请增大此值。同时增大 php.ini 中的 `post_max_size` 和 `upload_max_filesize`。请参阅[请求体](/zh/docs/http#请求体)。

Laravel 对路由异常返回常规的 `500` 响应。下一个请求正常运行，没有重复该异常。

## Worker 模式

Rapira 目前不支持以 Worker 模式运行 Laravel。请以 Classic 模式运行 Laravel。

Laravel 将请求状态保存在容器、已解析的单例和静态属性中。worker 必须在下一个请求前重置此状态。[Octane](https://laravel.com/docs/octane) 为它支持的服务器执行此重置，但 Rapira 没有 Octane driver。[Symfony](/zh/docs/frameworks/symfony) 和 [Yii3](/zh/docs/frameworks/yii3) 应用可以以 Worker 模式运行。

::: warning
没有完整状态重置的自定义 Laravel worker 可能会把一个请求的请求数据、session 数据或身份验证数据发送给之后的请求。没有完整的状态隔离测试时，请勿使用自定义 worker。
:::
