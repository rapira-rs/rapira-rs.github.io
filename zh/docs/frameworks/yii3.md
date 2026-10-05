---
title: Yii3
description: "在 Worker 模式下运行 Yii3：使用常驻的 HttpApplicationRunner 和 StateResetter，或为每个请求创建新的 runner。"
---

# Yii3

Yii3 支持常驻进程。worker 可以初始化应用一次，并在每个响应后重置请求状态。官方 runner [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner) 使用相同的设计。本页介绍常驻 worker、每请求替代方案和集成测试结果。

::: info 验证环境
- **PHP 8.5.8**：NTS，embed SAPI
- **Rapira 0.8.0**
- **yiisoft/app** 模板 1.4，配 **yii-runner-http 3.2.1**（router-fastroute 4.x）

测试使用这套软件运行了两个 worker 脚本。测试覆盖路由、URL、请求体、session、文件上传、错误和 200 个连续请求。本页示例使用 v0.9 配置格式。
:::

## Yii3 与 Worker 模式

常驻 worker 使用两项公开 API：

- `ApplicationRunner::getContainer()` 返回应用容器。worker 不需要子类或访问私有状态。
- `Yiisoft\Di\StateResetter` 是该容器中的服务。组件注册重置回调，一次 `reset()` 调用会运行所有这些回调。

包含请求状态的应用服务也必须注册回调。在其 DI 定义中添加 `'reset' => function (): void { … }` 键。`yiisoft/session` 和 `yiisoft/router` 使用相同方法。闭包可以重置私有状态，而不创建新对象。有关状态生命周期，请参阅[框架集成](/zh/docs/frameworks/)和 [Worker 模式](/zh/docs/worker)。

常驻设计有三个步骤。创建 runner 一次。为每个请求运行它。在每个请求之后重置容器。

## 前置条件

- 安装 Rapira。请参阅[安装](/zh/docs/intro/installation)。
- 创建或选择一个 Yii3 应用。可以使用新的 [`yiisoft/app`](https://github.com/yiisoft/app) 项目。

worker 脚本是唯一新增的 PHP 文件。请把它放在项目根目录，与 `composer.json` 相邻。runner 使用项目根目录作为其 `rootPath`。

请为 Composer 安装 PHP CLI。Rapira 以库的形式提供 PHP，不提供 `php` 命令。Rapira 不使用也不更改系统的 PHP CLI。

## 常驻 worker

这是推荐的设计。把它保存为项目根目录下的 `worker.php`：

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Di\StateResetter;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

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
        // run() 出错后 worker 继续运行。
        // 在下一个请求之前重置状态。
        $container->get(StateResetter::class)->reset();
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

该脚本包含以下操作：

**`src/bootstrap.php` 初始化模板。**它加载 Composer 自动加载器，在 `.env` 存在时读取它，并调用 `Environment::prepare()`。标准的 `public/index.php` 在使用 runner 之前执行相同的操作。

**worker 创建 runner 一次。**它使用 `public/index.php` 中的 `rootPath`、`debug`、`checkEvents` 和 `environment` 参数。因此，它初始化相同的应用。

**handler 为每个请求先调用 `run()`，再调用 `reset()`。**`run()` 像入口脚本一样处理请求。`reset()` 在下一个请求之前运行已注册的重置回调。

**内存使用保持稳定。**测试在 200 个连续请求中未发现进程内存显著增加。

::: question worker 省略了模板的哪些部分？
模板传递带 `StreamTarget` 日志器的 `temporaryErrorHandler`。启用 `APP_C3` 时，它还会加载 `c3.php`。测试的 worker 省略了这两个部分。如果没有该处理器，`HttpApplicationRunner::createTemporaryErrorHandler()` 会创建带 `NullLogger` 的 `ErrorHandler`。因此，runner 不记录配置和容器创建期间的错误。要记录这些错误，请传递模板处理器。
:::

::: question 常驻的 runner 会读取当前请求吗？
会。`run()` 不保留创建 runner 时的请求。每次调用都会获取 `RequestFactory`，并从超全局变量和 `php://input` 创建 PSR-7 `ServerRequest`。Rapira 在每次调用 handler 之前填充这些值。每次调用还会注册错误处理器，调用 `runBootstrap()`，并在标志为 true 时调用 `checkEvents()`。测试在 200 次调用中确认了此序列。有关请求数据契约，请参阅 [Worker 模式](/zh/docs/worker)。
:::

## 为每个请求创建新 runner

在 handler *内部*创建 runner，以避免常驻的容器状态。这样应用对象只属于一个请求：

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/src/bootstrap.php';

$handler = static function (): void {
    // 为每个请求创建一个 runner。
    // 使用与 public/index.php 相同的参数。
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

每个请求都创建新的容器，所以 worker 不重置容器状态。静态属性、全局变量和初始化状态仍保留在 worker 中。应用代码必须重置这些状态。测试也确认了此设计。

每个请求都会初始化容器。这会增加初始化时间，并创建 PHP 稍后必须释放的对象。内存可能增加，直到 PHP 同时释放多个旧容器。此循环行为不一定是内存泄漏。请参阅[内存与回收](/zh/docs/frameworks/#内存与回收)。

设置 `http.pool.max_requests` 以定期替换 worker。有关此键，请参阅[配置](/zh/docs/configuration)。

此设计不是 [Classic 模式](/zh/docs/classic)。自动加载器、模板启动文件和请求循环常驻在 worker 中。只有应用在每个请求中是新的。

默认使用常驻 runner。它遵循框架设计，只需要一次重置调用，并且在测试中内存保持稳定。如果初始化顺序或请求设置使 `StateResetter` 回调无法完整重置，请使用每请求 runner。要在这些设计之间切换，只需更改 worker 脚本。

## 启动 Rapira

在 `worker.php` 旁边创建 `rapira.toml`：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

```bash
rapira serve rapira.toml
```

`mode = "worker"` 选择 Worker 模式。有关该命令，请参阅[命令行](/zh/docs/cli)。

在生产环境中，请使用完整的 `rapira.toml`：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "/srv/app/worker.php"
mode = "worker"
processes = 8
max_requests = 500
request_terminate_timeout_secs = 30

[log]
level = "info"
format = "json"
```

有关每个键、默认值和限制，请参阅[配置](/zh/docs/configuration)。有关 systemd 和反向代理配置，请参阅[部署](/zh/docs/deployment)。

## 静态文件

模板把 `favicon.ico`、`robots.txt` 和已发布的资源包放在 `public/` 中。Rapira 把每个请求发送到入口脚本，除非[静态文件中间件](/zh/docs/static-files)响应该请求。请在 `rapira.toml` 的 `[http]` 表中添加该中间件：

```toml
[http]
listen = "127.0.0.1:8000"
middleware = ["static"]

[http.static]
root = "public"
```

默认的 `forbid` 列表阻止 `.php` 文件，所以中间件不提供 `public/index.php`。也可以由 CDN 或反向代理提供这些资源。有关提供文件的规则，请参阅[框架集成](/zh/docs/frameworks/#静态文件)。

## 测试结果

测试使用 `yiisoft/app` 模板对两种设计执行了相同的检查。结果如下。

**路由无需覆写 `$_SERVER` 即可工作。**Rapira 把 `SCRIPT_NAME` 设置为 `/worker.php`，即入口脚本名称。FastRoute 匹配了带查询字符串的多级路径。根路径返回模板首页。未知路径返回框架的 `404` 响应。测试没有更改 `SCRIPT_NAME`、`REQUEST_URI` 或 `DOCUMENT_ROOT`。

**生成的 URL 不包含 worker 文件名。**`UrlGeneratorInterface::generate()` 返回普通的应用路径。

**Yii3 隔离每个客户端的 session。**一个客户端在请求之间保留了其计数器。第二个客户端收到了新的 session。常驻容器设计得到相同的结果。

**CSRF token 无需更改即可工作。**模板的 `CsrfTokenMiddleware` 把 token 保存在 session 中，测试确认每个客户端有一个 token。每个 POST 仍然需要其 token。如果 Worker 模式拒绝 POST，请确认表单发送了 token。不要为此错误更改 worker 脚本。

**应用接收表单数据、JSON 请求体和文件上传。**`$_POST` 包含表单字段，`php://input` 包含 JSON 请求体。上传的临时文件在请求期间可读。PSR-7 `ServerRequest` 包含所有这些值。

**action 异常返回 `500`，worker 继续运行。**`ErrorCatcher` 创建错误响应并记录异常。同一个 worker 正常处理下一个请求。有关使 worker 停止的错误，请参阅 [Worker 模式](/zh/docs/worker)。

## 回退到 Classic 模式

Yii3 使用普通入口脚本也能运行。请将 `rapira.toml` 改为 Classic 模式：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

此配置使用标准应用代码，不需要 worker 脚本。每个请求都有新的应用状态。有关更多信息，请参阅 [Classic 模式](/zh/docs/classic)。

请保留 `public/index.php` 作为第二个入口脚本。Classic 模式和 PHP 内置服务器使用它。

::: question 必须更改 `public/index.php` 中的 `cli-server` 条件吗？
不需要。此条件为 PHP 内置服务器提供静态文件并更改 `SCRIPT_NAME`。Rapira 不运行它，因为 `PHP_SAPI` 在 PHP 8.4 上是 `fastcgi`，在 PHP 8.5 上是 `rapira`。有关 SAPI 名称，请参阅[安装](/zh/docs/intro/installation)。
:::
