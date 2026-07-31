---
title: Laravel
description: 在 Rapira 上跑 Laravel——常驻 worker 里每个请求重建一个全新的应用、随之而来的内存表现，以及 Octane 支持的真实状况。
---

# Laravel

Rapira 能跑 Laravel，跑法是**在一个跨请求常驻的 PHP 进程里，为每个请求重建一个全新的应用**。这个说法有意收着讲，也值得摆在最前面而不是藏起来：常驻的是 worker，不是框架。

::: info 验证环境
- **PHP 8.5.8**——NTS，embed SAPI
- **Rapira 0.6.0**
- **laravel/laravel** 骨架 + **laravel/framework v13.23.0**

本页所有内容，都是在一个加了几条测试路由的 `laravel/laravel` 骨架上、用单个 worker 实跑出来的：路由、session、文件上传、JSON 和表单请求体、缓存过的配置与路由、错误响应，以及横跨若干次 worker 回收的几百个顺序请求。
:::

## 为什么每个请求都要重建应用

Laravel 的容器天生就没打算在没人帮忙的情况下活过第二个请求。绑定被解析出来，单例攥住了当前请求，框架自己的静态属性随着请求跑起来越积越多——这一切都得在下一个请求到来之前拆干净。干这件事的东西有个名字：**Octane**。Rapira 今天还没有 Octane driver，本指南也不打算冒充一个。它给你的，是那个真正验证过能跑的写法：在 handler 里启动框架，应答请求，然后把应用扔掉。

比起 php-fpm 你还是赚的，只是没有常驻容器赚得那么多：

- **没有 FastCGI 这一跳。**PHP 嵌在 Rapira 进程里，服务器直接调用解释器——没有 socket，没有协议，也没有第二个守护进程等着接手请求；应答你的那个 worker，就是攥着解释器的那个进程。
- **进程是长命的。**你的 worker 脚本只跑一次。Composer 自动加载器和它的 classmap 在启动时注册一次，不像前端控制器那样每个请求都重新注册一遍。
- **OPcache 是热的，而且共享。**PHP 只在 master 里启动一次，早于任何 worker 被 fork 出来，所以每个 worker 继承的都是同一份编译后脚本缓存——你的代码和你的 `vendor/` 树都在里面。`config:cache` / `route:cache` 生成的文件同样只编译一次，每个请求重新执行它们并不会重新解析。这两条 artisan 缓存命令在这个写法下都验证过可用。

要是这笔交易你不想做，本页末尾的[经典模式这条退路](#退路-经典模式)压根不需要 worker 脚本。

## 开始之前

你需要装好 Rapira——见[安装](/zh/docs/installation)——以及一个已经能跑起来的 Laravel 应用。机器上还得有一个普通的 PHP CLI，Composer 和 `artisan` 都要靠它跑：Rapira 把 PHP 作为库（`libphp`）提供，并不带 `php` 命令，所以这些步骤走的是你系统里的 PHP，Rapira 既不用它，也不碰它。

第一次启动之前有件事要确认：全新的 `laravel/laravel` 骨架默认用 SQLite 数据库，session、cache 和 queue 也都走数据库驱动，也就是说它需要 `pdo_sqlite`。Rapira 发行版自带的 PHP 有这个扩展：PDO、`pdo_sqlite` 和 `sqlite3` 都在发行构建的扩展清单里，[安装](/zh/docs/installation)页面列得很清楚。如果你让 Rapira 跑在自己编译的 PHP 上，记得把这些扩展写进 configure 参数（[从源码构建](/zh/docs/build-from-source)讲了怎么做），或者干脆走不碰数据库的那条路，把 Laravel 指向文件和同步驱动——`SESSION_DRIVER=file`、`CACHE_STORE=file`、`QUEUE_CONNECTION=sync`。本页的验证用的就是这套组合。

## Worker 脚本

把这个文件放进应用根目录，和 `composer.json` 并排——里面每条路径都是相对 `__DIR__` 的，所以它必须待在 `vendor/`、`bootstrap/` 和 `storage/` 所在的地方：

```php
<?php

declare(strict_types=1);

use Illuminate\Http\Request;
use Rapira\Plugin\Http\HttpHandlerConfig;

use function Rapira\create_plugin_handler;

define('LARAVEL_START', microtime(true));

// Resident: the autoloader and opcache-compiled classes stay warm.
require __DIR__ . '/vendor/autoload.php';

$http = create_plugin_handler(new HttpHandlerConfig());

$handler = static function (): void {
    if (file_exists($maintenance = __DIR__ . '/storage/framework/maintenance.php')) {
        require $maintenance;
    }

    // A fresh application per request. `require`, not `require_once`:
    // bootstrap/app.php must run again for every request.
    $app = require __DIR__ . '/bootstrap/app.php';
    $app->handleRequest(Request::capture());
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

从头读下来，它就是被切成两半的 `public/index.php`——能只做一次的放在循环之上，不能的放进 handler 里：

- **`LARAVEL_START`** 定义在原版前端控制器定义它的同一个位置，早于其他一切。常量是进程级的，所以它属于循环之上——这也意味着它现在标记的是 *worker* 的起点，不是请求的。任何用 `microtime(true) - LARAVEL_START` 给请求计时的代码，报出来的都会是 worker 的运行时长，一路涨到 worker 被回收为止；请在 handler 里自己打一个单次请求的时间戳。
- **自动加载器只 require 一次**，在 handler 之外——这个写法真正留住的常驻状态，就只有它。它下面的一切都是单次请求的活儿。
- **维护模式检查放在 handler 里面**，因为 `php artisan down` 在 worker 活着的任何时刻都可能被执行，这个检查必须每个请求做一遍。生成出来的 `storage/framework/maintenance.php` 用 `exit` 结束请求，在这里是安全的：handler 里的 `exit` 会把响应刷给客户端，worker 照样接着服务——这一点验证过，也是 [Worker 模式](/zh/docs/worker)的通行规则。
- **`$app = require __DIR__ . '/bootstrap/app.php'`** 就是那个全新的应用，只为这一个请求而重建。
- **`$app->handleRequest(Request::capture())`** 是 Laravel 自己的一行流写法：处理请求、发送响应，再跑一遍 `terminate()`——中间件和 terminable 回调都算在内。它不会 exit，所以控制权会回到循环里。
- **循环里的 `gc_collect_cycles()`** 是 Rapira 标准的循环写法，把引用循环的回收放在两次请求之间，而不是某个请求处理到一半的时候。留着它——但别指望它能解决下一节讲的内存表现。它解决不了。

::: warning 是 `require`，不是 `require_once`
这是唯一一行绝对不能写错的代码。从第二个请求开始，`require_once` 返回的是 `true` 而不是 `Application` 实例，于是第一个请求之后的每个请求都会挂。原版 `public/index.php` 用 `require_once` 是对的——它一个进程里本来就只跑一次。而在 worker 里，`bootstrap/app.php` 必须每个请求都重新跑一遍。
:::

## 内存，以及它为什么呈锯齿状

每个请求重建一个应用，也就意味着每个请求扔掉一个，随之而来的那条内存曲线——是锯齿，不是泄漏，而且 `gc_collect_cycles()` 抹不平它——[框架集成总览](/zh/docs/frameworks/)里讲得很完整。这行调用之所以留在本页的循环里，是因为它对付其余的垃圾是个好习惯，不是因为它能治锯齿。

由此带来的两条后果，在 Laravel 上不是可选项。第一，给 `memory_limit` 留出真正的余量——要装下的是锯齿的峰值，而 PHP 的默认值对这个写法来说并不宽裕。第二，设上 `pool.max_requests = 100`——给这条上升曲线封顶的正是回收，它在横跨若干次回收、几百个顺序请求里验证过，交接毫无破绽；这是 Laravel 跑在 Rapira 上的推荐生产配置，不是留着以后再考虑的优化项。

::: warning 不要调用 `HandleExceptions::flushState()`
它看上去正是那个该调的清理函数，而在 Rapira 下它会把你的 worker 干掉。`Illuminate\Foundation\Bootstrap\HandleExceptions::flushState()` 对 PHPUnit 的错误处理器做了特殊处理，只要装了 `phpunit`——每个骨架都装了，它是默认的开发依赖——它就会抛异常（`PHPUnit\TextUI\Configuration\Registry::get(): … null returned`）。要是按别的服务器那些教程说的，把它放进循环体、在两次请求之间调用，异常就会冲出循环，worker 脚本当场死掉，Rapira 把这个 worker 标记为不健康，客户端拿到一串 `503`。这是踩过坑验证出来的。别写它。
:::

## 跑起来

`rapira serve` 默认跑的就是 worker 模式，所以让它指向这个脚本，就是命令的全部：

::: code-group

```bash [CLI]
rapira serve worker.php
```

```toml [rapira.toml]
[pool]
entrypoint = "worker.php"
processes = 4
max_requests = 100

[http]
listen = "127.0.0.1:8000"
```

:::

用配置文件时命令是 `rapira serve --config rapira.toml`，相对路径的 `entrypoint` 按配置文件自己所在的目录解析。`max_requests` 就是上一节说的那个键——所有键和它们的默认值都在[配置](/zh/docs/configuration)页面上。

上生产之前，先把框架的缓存构建出来。这两条命令在这个 worker 下都验证过，缓存前和缓存后跑的是同一套用例，两边都过：

```bash
php artisan config:cache
php artisan route:cache
```

这些文件和 bootstrap 的其余部分一样，每个请求都会被读一遍——OPcache 替你省下的是解析，不是执行。即便如此，每次部署后还是要重新跑一遍这两条命令并重载进程池，因为自动加载器和 OPcache 段正是运行中的 worker 不会重新读的东西；重载就是给 master 发一个信号（[进程模型](/zh/docs/process-model)），围绕它的部署形态，连同静态文件、TLS，以及在 Rapira 前面摆一个反向代理到底是为了什么，都在[框架集成总览](/zh/docs/frameworks/)里。

## 路由与 URL

所有 URL 都由 Rapira 跑同一个入口脚本，所以在这个 worker 下 `$_SERVER['SCRIPT_NAME']` 是 `/worker.php` 而不是 `/index.php`。Laravel 完全不在意：路径照样正确解析，没匹配上的路径拿到的是 Laravel 自己的 404 页面，`url()` 生成的绝对 URL 也很干净——协议、主机、路径，里面哪儿都没有 `worker.php`。**不需要覆盖 `$_SERVER`，也不需要改任何路由或 URL 配置**；这一点是专门验过的，因为在那些把 URL 映射成文件的服务器上，这是最先坏掉的地方。

骨架自带的 `/up` 健康检查路由照常返回 `200`，拿它给负载均衡器或者容器健康检查当探测目标，最合适不过。

## Session、CSRF 与表单

Session 是按请求走的，用文件驱动验证过：session cookie 发得出去，下一个请求带得回来，每个客户端各有各的 session。数据库驱动得先把“开始之前”里 PDO 扩展那个问题解决掉，但驱动怎么选，和 Rapira 没有半点关系。

**CSRF 这块同样和 Rapira 无关。**token 存在 session 里，而 session 已经验证过是按请求工作的——所以一个在 php-fpm 下能用的表单，没有任何跟 Rapira 有关的理由会失灵。为了 worker，你不需要排除、关闭或者重新配置任何东西。（验证用的那几条冒烟路由是不带 token 提交的，为此把它们排除在 CSRF 之外了，所以完整的 token 往返是从 session 的结果推出来的，不是实测的。）

表单提交、JSON 请求体和文件上传，都是在同一个 worker 上验证的。而当某条路由抛出异常时，Laravel 的异常处理器照常渲染 `500`——失败被圈在这个请求里，worker 接着服务下一个。

## 退路：经典模式

要是你压根不想维护一个 worker 脚本，那就别维护：

```bash
rapira serve --classic public/index.php
```

这是零改动的那条路。Rapira 会像 php-fpm 那样，每个请求都把你现成的前端控制器从头跑一遍，应用根本察觉不到区别。你放弃的是常驻进程——自动加载器又变成每个请求注册一次，和今天一样——换来的是可以直接顶替 php-fpm，外加共享的 OPcache。完整的说法见[经典模式](/zh/docs/classic)，这两级在阶梯上各处什么位置，见[执行模式](/zh/docs/execution-modes)。

::: question Rapira 什么时候支持 Octane？
今天还没有 Octane driver，本指南宁愿把这话说明白，也不想端出一个半成品。卡住的不是执行级别——Symfony 和 Yii3 就在 Laravel 这里所在的同一级 SAPI Worker 上把应用常驻着（各级分别是什么意思，见[执行模式](/zh/docs/execution-modes)）。Laravel 缺的是 Octane 那套两次请求之间的状态拆解，而那是一个得有人去写的 driver。在此之前，常驻 worker 里每个请求一个全新应用，才是真正验证过能跑的做法，本页写的也就是它。
:::

::: question 我自己把 `$app` 留着常驻不行吗？
因为那等于要你手搓一遍 Octane 的沙箱。两次请求之间要拆掉的状态，散落在容器、已解析的单例、request/session/auth 这一整条链路，以及框架自己的静态属性里——Octane 之所以存在，正是因为把它们收齐很麻烦，而漏掉一个之后的故障又都很隐蔽：一个过期的 request 对象、上一个用户的 session 被下一个人看见、被某个请求改掉却再没还原的配置。这件事我们不会只写个半成品出来。真正被我们追到底的那个坑，就在上面的内存那一节：`HandleExceptions::flushState()` 看着像是答案的一部分，实际上会把 worker 弄死。
:::

::: question 一定要调 `memory_limit` 吗？
要，余量得比你 php-fpm 那边的值更大，而且要配上 `pool.max_requests`——两者上面的[内存那一节](#内存-以及它为什么呈锯齿状)都有，背后的机制在[框架集成总览](/zh/docs/frameworks/)。
:::
