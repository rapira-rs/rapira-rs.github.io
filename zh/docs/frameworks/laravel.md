---
title: Laravel
description: "在 Rapira 上以经典模式运行 Laravel，以及 worker 模式支持的现状。"
---

# Laravel

Rapira 以经典模式运行 Laravel：原封不动的 `public/index.php` 前端控制器，每个请求都从头执行一遍，和 php-fpm 跑它的方式一样。应用不需要任何改动。Laravel 的 worker 模式还在开发中，现状见下面的 [Worker 模式](#worker-模式)。

::: info 验证环境
- **PHP 8.5.8**——NTS，embed SAPI
- **Rapira 0.6.0**
- **laravel/laravel** 骨架 + **laravel/framework v13.23.0**

本页所有内容，都是在一个加了几条测试路由的 `laravel/laravel` 骨架上、以经典模式用单个 worker 进程实跑出来的：路由、session、文件上传、JSON 和表单请求体、缓存过的配置与路由、错误响应，以及 50 个顺序请求。
:::

## 前置条件

你需要装好 Rapira——见[安装](/zh/docs/installation)——以及一个已经能跑起来的 Laravel 应用。机器上还得有一个普通的 PHP CLI，Composer 和 `artisan` 都要靠它跑：Rapira 把 PHP 作为库（`libphp`）提供，并不带 `php` 命令，所以这些步骤走的是你系统里的 PHP，Rapira 既不用它，也不碰它。

第一次启动之前先确认数据库相关的扩展：全新的 `laravel/laravel` 骨架默认用 SQLite 数据库，session、cache 和 queue 也都走数据库驱动，也就是说它需要 `pdo_sqlite`。Rapira 发行版自带的 PHP 有这个扩展：PDO、`pdo_sqlite` 和 `sqlite3` 都在发行构建的扩展清单里，[安装](/zh/docs/installation)页面列得很清楚。如果你让 Rapira 跑在自己编译的 PHP 上，记得把这些扩展写进 configure 参数（[从源码构建](/zh/docs/build-from-source)讲了怎么做），或者改用文件和同步驱动——`SESSION_DRIVER=file`、`CACHE_STORE=file`、`QUEUE_CONNECTION=sync`。本页的验证用的就是这套组合。

## 跑起来

经典模式需要显式开启，所以命令里直接把它写了出来：

::: code-group

```bash [CLI]
rapira serve --classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
classic = true
processes = 4

[http]
listen = "127.0.0.1:8000"
```

:::

用配置文件时命令是 `rapira serve --config rapira.toml`，相对路径的 `entrypoint` 按配置文件自己所在的目录解析。所有键和它们的默认值都在[配置](/zh/docs/configuration)页面上。

Rapira 每个请求都把前端控制器从头执行一遍，所以框架的生命周期和它在 php-fpm 下完全一样：没有常驻状态，两次请求之间也没有什么需要重置。保持热态的是 OPcache——PHP 只在 master 里启动一次，早于任何 worker 被 fork 出来，所以所有 worker 共用同一份编译后脚本缓存，你的代码和 `vendor/` 树都在里面。具体机制见[经典模式](/zh/docs/classic)。

上生产之前，先把框架的缓存构建出来；这两条命令都在经典模式下验证过，缓存前和缓存后跑的是同一套检查，两边都过：

```bash
php artisan config:cache
php artisan route:cache
```

## 路由与 URL

Rapira 不会把 URL 映射成文件：每个请求跑的都是前端控制器，路径由 `$_SERVER['REQUEST_URI']` 交给 Laravel 去路由。路由、没匹配上的路径拿到的 Laravel 自带 404 页面，以及 `url()` 生成的地址，全都验证过——生成出来的是干净的绝对 URL，里面没有 `index.php`，而且既不需要覆盖 `$_SERVER`，也不需要改任何路由或 URL 配置。

骨架自带的 `/up` 健康检查路由返回 `200`，拿它给负载均衡器或者容器健康检查当探测目标正合适。静态资源需要在 Rapira 前面加一层——CDN，或者[生产环境部署](/zh/docs/deployment)页面里配置的反向代理。Rapira 的监听器只讲明文 HTTP，无论 `X-Forwarded-Proto` 是什么值，`$_SERVER['HTTPS']` 都是空的，所以 TLS 在那个代理上终结时，要在 Laravel 里配置[可信代理](https://laravel.com/docs/requests#configuring-trusted-proxies)，否则 `url()` 生成的是 `http://` 链接。

## Session、CSRF 与表单

Session 用文件驱动验证过：session cookie 发得出去，下一个请求带得回来，每个客户端各有各的 session。CSRF 不需要任何配置——token 存在 session 里，而每个请求拿到的都是和 php-fpm 一样的全新进程语义。表单提交、JSON 请求体和文件上传，都是在同一套配置上验证的。某条路由抛出异常时，Laravel 的异常处理器照常渲染 `500`，下一个请求不受影响。

## Worker 模式

Laravel 的 worker 模式还在开发中，目前尚不支持——请以经典模式运行 Laravel。worker 支持的时间表暂时也没有。

原因在框架的生命周期。Laravel 的容器在设计上就没考虑在没人帮忙的情况下活过第二个请求：绑定被解析出来，单例捕获了当前请求，框架的静态属性随着请求跑起来越积越多，这一切都得在下一个请求到来之前拆干净。做这件拆解工作的，是 Laravel 自己为长期运行的服务器写的包 [Octane](https://laravel.com/docs/octane)（`laravel/octane`）。Octane 只能跑在它有 driver 的服务器上，而 Rapira 目前还没有 Octane driver。

卡住的不是模式本身：[Symfony](/zh/docs/frameworks/symfony) 和 [Yii3](/zh/docs/frameworks/yii3) 就在同一个 [SAPI Worker](/zh/docs/worker) 模式下把应用常驻着。缺的是 Laravel 特有的那套两次请求之间的状态处理。

你可以自己给 Laravel 写一个 worker 脚本，但让应用常驻就意味着要手工重建 Octane 的状态处理：要拆掉的状态散落在容器、已解析的单例、request/session/auth 这一整条链路，以及框架自己的静态属性里，漏掉一个，表现出来就是一个过期的 request 对象，或者上一个用户的 session 被下一个人看见。
