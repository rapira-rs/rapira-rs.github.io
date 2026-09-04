---
title: Yii3
description: "在 Rapira 的 Worker 模式下运行 Yii3 应用：常驻的 HttpApplicationRunner 配 StateResetter、每个请求新建 runner 的写法，以及路由、session、文件上传和错误处理的验证结果。"
---

# Yii3

Yii3 支持常驻进程。其 DI 容器提供 `StateResetter`，runner 提供容器的公开访问。
worker 可以初始化应用一次，并在每个响应后重置请求状态。
官方 runner [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner) 使用相同的设计。
本页介绍常驻 worker、每请求替代方案和集成测试结果。

::: info 验证环境
- **PHP 8.5.8**--NTS，embed SAPI
- **Rapira 0.8.0**
- **yiisoft/app** 模板 1.4，配 **yii-runner-http 3.2.1**（router-fastroute 4.x）

本页这两个 worker 脚本都在这套环境上跑过，并通过了全套测试：路由、生成 URL、表单和 JSON 提交、session、文件上传、错误处理，以及连续 200 个请求。
:::

## Yii3 与 Worker 模式

常驻 worker 需要两处公开 API。

`ApplicationRunner::getContainer()` 返回应用容器。worker 不需要子类或访问私有状态。
`Yiisoft\Di\StateResetter` 是该容器中的服务。组件注册用于重置请求状态的回调。
一次 `reset()` 调用会运行这些回调。

包含请求状态的应用服务也必须注册回调。在其 DI 定义中添加 `'reset' => function (): void { … }`。
`yiisoft/session` 和 `yiisoft/router` 使用相同方法。闭包可以重置私有状态，而不创建新对象。
有关状态生命周期，请参阅[框架集成](/zh/docs/frameworks/)和 [Worker 模式](/zh/docs/worker)。

于是常驻这套写法就是三步：runner 只构建一次，每个请求跑一遍，跑完把容器的状态重置掉。

## 前置条件

- 装好 Rapira--见[安装](/zh/docs/intro/installation)。
- 一个 Yii3 应用：新建一个 [`yiisoft/app`](https://github.com/yiisoft/app) 项目，或者用你手上现成的那个。

PHP 那边什么都不用装：下面这个 worker 脚本是项目里唯一新增的文件，它放在项目根目录、`composer.json` 旁边，因为 runner 的 `rootPath` 就是项目根目录。机器上还得有一个普通的 PHP CLI，Composer 要靠它跑：Rapira 把 PHP 作为库（`libphp`）提供，并不带 `php` 命令，所以这些步骤走的是你系统里的 PHP，Rapira 既不用它，也不碰它。

## 常驻 worker

推荐用这一套。把它存成项目根目录下的 `worker.php`：

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Di\StateResetter;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$runner = new HttpApplicationRunner(
    rootPath: __DIR__,
    debug: Environment::appDebug(),
    checkEvents: Environment::appDebug(),
    environment: Environment::appEnv(),
);
$container = $runner->getContainer();

$handler = static function () use ($runner, $container): void {
    try {
        $runner->run();
    } finally {
        // The worker continues after an error leaves run().
        // Reset state before the next request.
        $container->get(StateResetter::class)->reset();
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

逐段看下来：

**`src/bootstrap.php` 是模板自带的启动文件**。它加载 Composer 的自动加载器，`.env` 在的话就读进来，然后调用 `Environment::prepare()`--`public/index.php` 在碰 runner 之前干的正是这些。上面那行显式的 `vendor/autoload.php` 是多余的--`require_once` 让第二次调用变成空操作--它的作用是让这个 worker 单独拿出来看也是一个读得懂的入口脚本。

**worker 使用 `public/index.php` 的参数创建一次 runner。**
它从 `App\Environment` 传递 `rootPath`、`debug`、`checkEvents` 和 `environment`。因此，它初始化相同的应用。
模板还传递带 `StreamTarget` 日志器的 `temporaryErrorHandler`。启用 `APP_C3` 时，它会加载 `c3.php`。
测试的 worker 省略了这两个部分。
临时处理器记录配置和容器创建期间的错误。
如果没有处理器，`HttpApplicationRunner::createTemporaryErrorHandler()` 会创建带 `NullLogger` 的 `ErrorHandler`。
要记录容器创建故障，请传递模板处理器。

**`getContainer()` 是公开 API**，所以你抓到的就是应用自己的容器--runner 处理每个请求用的都是它。`StateResetter` 则在 handler 内部从这个容器里取。

**每个请求先 `run()`，再 `reset()`**。`run()` 就是入口脚本调用的方法；`reset()` 会把容器里注册的重置回调挨个走一遍，赶在下一个请求到来之前，把带状态的服务拨回初始状态。

**`run()` 在每次调用时重复完整序列。**它注册错误处理器，调用 `runBootstrap()` 和 `checkEvents()`，然后处理请求。
测试在 200 次调用中确认了此序列。
仅当标志为 true 时才运行事件检查。模板从 `Environment::appDebug()` 获取此标志。

**常驻的 runner 每次都重新读取请求**。`run()` 并不在构造的时候就把请求定死。它每次被调用都会从容器里解析出 `RequestFactory`，再从 `$_SERVER`、`$_GET`、`$_POST`、`$_COOKIE`、`$_FILES` 和 `php://input` 构建一个新的 PSR-7 `ServerRequest`，而这些超全局变量，Rapira 在每次循环迭代之前都会重新填好（这份契约见 [Worker 模式](/zh/docs/worker)）。

**内存使用保持稳定。**测试在 200 个连续请求中未发现进程内存显著增加。
应用初始化一次，每个请求执行一次重置。

## 为每个请求创建新 runner

要彻底避开常驻状态，就把 runner 造在 handler *里面*。这样应用创建出来的一切都只属于一个请求：

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$handler = static function (): void {
    // Create one runner for each request.
    // Use the same arguments as public/index.php.
    $runner = new HttpApplicationRunner(
        rootPath: __DIR__,
        debug: Environment::appDebug(),
        checkEvents: Environment::appDebug(),
        environment: Environment::appEnv(),
    );
    $runner->run();
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

容器每次都是重建的，所以零件更少，没有可能写错的重置，容器里的状态也不会带到下一个请求；但 `static` 属性、全局变量以及启动文件建立起来的东西，在任何 worker 下都会常驻，得由你自己的代码来重置。这一套同样通过了全套测试。

每个请求都会初始化容器。这会增加初始化时间，并创建 PHP 稍后必须释放的对象。
内存可能增加，直到 PHP 同时释放多个旧容器。此循环行为不一定是内存泄漏。
设置 `pool.max_requests` 以定期替换 worker。
有关此行为，请参阅[框架集成](/zh/docs/frameworks/)。有关设置，请参阅[配置](/zh/docs/configuration)。

自动加载器和模板的启动文件仍然常驻，请求循环也仍然写在 worker 脚本里，所以这依然是一个 worker，只不过它在两次请求之间会丢弃应用，跟 [Classic 模式](/zh/docs/classic)不是一回事。

默认使用常驻 runner。它遵循框架设计，在测试中内存稳定，并且只需要一次重置调用。
如果初始化顺序或请求设置不能由 `StateResetter` 完全重置，请使用每请求 runner。
在这些设计之间切换只需更改 worker 脚本。

## 启动 Rapira

```bash
rapira serve --mode worker worker.php
```

`--mode worker` 选定 Worker 模式。其余参数见[命令行](/zh/docs/cli)。

上生产的话，把它写进 `rapira.toml`：

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "/srv/app/worker.php"
mode = "worker"
processes = 8
max_requests = 500
request_terminate_timeout_secs = 30

[log]
level = "info"
format = "json"
```

每个键的默认值和取值范围都在[配置](/zh/docs/configuration)那一页；systemd unit 和挡在它前面的反向代理，见[部署](/zh/docs/deployment)。

## 测试结果

两套写法都在 `yiisoft/app` 模板上跑过同一套测试。结果如下：

**路由能用，不需要覆写 `$_SERVER`**。Rapira 把 `SCRIPT_NAME` 设成入口脚本的文件名--是 `/worker.php`，不是 `/index.php`--FastRoute 照样匹配上了带查询串的多级路径。根路径 `/` 渲染出模板的首页，不存在的路径交出的是框架自己的 404。`SCRIPT_NAME`、`REQUEST_URI`、`DOCUMENT_ROOT` 一个都不用改写。

**生成出来的 URL 是干净的**。`UrlGeneratorInterface::generate()` 给出的就是普通的应用路径，worker 脚本的文件名不会渗进去。

**session 按请求走，隔离得很彻底**。带着 cookie 的客户端接连请求，计数器依次是 1、2；紧接着换一个新客户端打同一个接口，拿到的是从 1 重新开始的新 session。容器一直活着的常驻写法下，这一点同样成立。

**表单提交、JSON 请求体和文件上传都到得了**。`$_POST` 里的字段、从 `php://input` 读出来的 JSON、以及一次 multipart 上传（临时文件在请求期间读得到）--yii-runner-http 从超全局变量拼出来的那个 PSR-7 `ServerRequest`，把这些全都带上了。

**抛异常就是 500，worker 照常服务**。action 里抛出的异常会被 `ErrorCatcher` 接住，像在别处一样渲染成错误响应；异常照常进日志，紧接着的下一个请求由同一个 worker 进程正常应答。在 Rapira 里，未捕获的异常只是一次请求的失败，不是 worker 级别的失败--什么会导致 worker 退出、什么不会，见 [Worker 模式](/zh/docs/worker)。

## CSRF

应用模板的默认中间件链里就有 `CsrfTokenMiddleware`，token 存在 session 里--而 session 正是这轮测试实打实压过的那块状态：按请求走，按客户端隔离。worker 循环没有碰过 token 这条链路上的任何东西，所以这里的 POST 和别处一样，该带 token 还得带。搬到 worker 之后如果提交开始被拒，先查 token；修法也还是老一套（把 token 渲染进表单、再原样交回来），跟 worker 脚本没关系。

## 回退到 Classic 模式

Yii3 使用普通入口脚本也能运行：

```bash
rapira serve --mode classic public/index.php
```

代码原封不动，不用写 worker 脚本，每个请求的状态都是全新的。详见 [Classic 模式](/zh/docs/classic)。

worker 脚本是额外的入口点，不会替代普通入口脚本。请保留 `public/index.php`：Classic 模式运行此脚本，本地使用 PHP 内置服务器时也需要它。

模板的 `public/index.php` 里有一个 `PHP_SAPI === 'cli-server'` 分支，专门提供静态文件并改写 `SCRIPT_NAME`。它是给 PHP 内置开发服务器准备的，在 Rapira 下永远不会走到--这里的 `PHP_SAPI` 是 `rapira`（PHP 8.4 上是 `fastcgi`，见[安装](/zh/docs/intro/installation)）--所以保持原样就行。
