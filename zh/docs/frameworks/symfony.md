---
title: Symfony
description: "如何在 Rapira 的 Worker 模式下运行 Symfony 应用：worker 脚本、两次请求之间的服务重置，以及 .env 里的值如何进入容器。"
---

# Symfony

Symfony 支持常驻 worker。应用初始化内核，向其传递 `Request`，并接收 `Response`。
Rapira 为每个 worker 初始化一次内核。之后，每个请求在已初始化的容器上调用 `handle()`。
应用代码不变。worker 脚本替换 `public/index.php`。
本页介绍此文件、请求状态重置和 `.env` 值。

::: info 验证环境
- **PHP 8.5.8**--NTS、embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4**（`symfony/framework-bundle` v7.4.15）--`dev` 和 `prod` 下都跑了整套测试
- **Symfony 8.1**（`symfony/framework-bundle` v8.1.2）--`dev` 下跑了整套测试

两个应用都使用 `symfony/skeleton` 包创建，并在单个 worker 进程下运行。它们使用**同一个 `worker.php`**，没有任何按版本分叉的代码。测试覆盖了路由、一个 404、查询串、生成的 URL、表单提交、JSON 请求体、跨请求的 session、一次文件上传、一个未捕获的异常，以及连续 200 个请求。
:::

## Worker 模式下的行为

内核在循环外初始化，并保留到 worker 结束。自动加载器、容器、路由器、事件分发器和连接只初始化一次。
有关详细信息，请参阅 [Worker 模式](/zh/docs/worker)和[执行模式](/zh/docs/execution-modes)。

每个请求里，handler 做四件事，然后收尾：

1. `Request::createFromGlobals()`--在调用你的 handler 之前，Rapira 会为每个请求重新填好 `$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE` 和 `$_FILES`，所以 Symfony 那个照常使用的构造方式，读到的东西和在 php-fpm 下一模一样。
2. `$kernel->handle($request)`--路由、控制器、响应，一如往常。
3. `$response->send()`--输出就是 HTTP 响应（出站时怎么组装的，见 [HTTP](/zh/docs/http)）。
4. `$kernel->terminate($request, $response)`--响应之后的监听器照常跑。

接着，handler 通过容器里的 `services_resetter` 把带状态的服务重置掉--这与 Symfony 在两条 Messenger 消息之间执行的是同一次重置，长期存活的内核靠它甩掉单次请求攒下的东西。

session 就是原生的 PHP session，和在 php-fpm 下完全一样：每个请求调用一次 `session_start()`，cookie 随响应发出去，数据在下一个请求里读回来。客户端之间的隔离经过验证：第二个客户端带着全新的 cookie 罐进来，拿到的是它自己的 session。

一个内核住在一个 worker 进程里，而 worker 之间是彼此独立的操作系统进程--用户态里它们什么都不共享。到底有几个、又是怎么被监管的，见[进程模型](/zh/docs/process-model)。

## 前置条件

安装 [Rapira](/zh/docs/intro/installation)，并创建或选择 Symfony 应用。将 worker 脚本放在 `composer.json` 旁边。
为 Composer 和 `bin/console` 安装 PHP CLI。Rapira 以库的形式提供 PHP，不提供 `php` 命令。
Composer 和 `bin/console` 使用系统 PHP CLI。Rapira 不使用或更改此 CLI。

有两个扩展要留意，因为基础应用在 `composer.json` 里把它们写成了硬依赖（`ext-ctype`、`ext-iconv`），*同时*还 `replace` 掉了对应的 polyfill--所以它们必须是真正的扩展，不能是 PHP 写的替身。两个 PHP 构建都需要它们，系统里那个 CLI 也一样，否则 `composer create-project` 和 `composer install` 在平台检查那一步就会失败，那时 Rapira 根本还没上场。每个 Rapira 发布版内嵌的 PHP 两个都带：`ctype` 和 `iconv` 就在构建的 configure 参数里，完整的扩展清单在[安装](/zh/docs/intro/installation)页上。如果你改用自己的 PHP 来编译 Rapira，记得把这两个都打开--那份清单在哪里设置，见[从源码构建](/zh/docs/intro/build-from-source)。

下面这个 worker 文件还用到了 `symfony/dotenv`，基础应用自带这个组件。如果你的部署环境本来就设好了真正的环境变量、压根没有 `.env`，那就把那一行连同这个组件一起删掉。worker 不走 `symfony/runtime`，它自己加载 `.env`、自己构造内核，但这个包还是留着，因为 `bin/console` 和 `public/index.php` 仍然要用它。

## worker 脚本

把下面这段原样存成项目根目录下的 `worker.php`。两个大版本上通过验证的就是这个脚本，这里按当前的 worker API 做了更新：

```php
<?php

declare(strict_types=1);

use App\Kernel;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

require __DIR__ . '/vendor/autoload.php';

// public/index.php uses symfony/runtime for this operation.
// The worker performs it once before the request loop.
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');

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

大部分都是普通的 Symfony 启动代码，只有四行是这套方案特有的：

**`(new Dotenv())->usePutenv()->bootEnv(...)`。**标准 `public/index.php` 将此操作委托给 `symfony/runtime`。
worker 在创建内核前读取一次 `.env`。如果 PHP 在请求期间重建 `$_ENV`，`usePutenv()` 会保留这些值。
有关详细信息，请参阅 [`$_ENV` 与 `variables_order`](#env-与-variables-order)。

**内核在循环前初始化。**`new Kernel(...)`、`boot()` 和 `getContainer()` 在 worker 初始化期间运行。
因此，内核会在请求可能清除 Dotenv 值之前读取 `$_SERVER['APP_ENV']`。每个请求使用相同的容器。

**在 `get()` 前调用 `$container->has('services_resetter')`。**`services_resetter` 标识符在两个支持的版本中都是公开的。
其实现类在 7.4 和 8.1 中使用不同的命名空间。服务标识符不需要版本条件。
如果容器未定义服务，`has()` 检查可以防止错误。

**循环和 `gc_collect_cycles()`。**`\Rapira\handle_request()` 会一直阻塞到有请求上门，跑你的 handler，然后返回 `true`；worker 开始排空时它返回 `false`，循环也就到此为止。每转一圈回收一次循环引用，这份开销就固定落在两次请求之间，而不是某个请求处理到一半的时候。完整契约见 [Worker 模式](/zh/docs/worker)。

如果 resetter 不足，请使用 `$container->reset()` 或 `$kernel->reboot(null)`。第一个选项删除所有已创建的服务。
第二个选项删除容器并创建新容器。
运行 `$kernel->reboot(null)` 后，使用 `$kernel->getContainer()` 获取新容器。handler 不得使用旧容器。
两个选项都会删除缓存的应用状态。请将它们用于查找泄漏，不要作为默认配置。

## `$_ENV` 与 `variables_order`

::: warning
测试的基础应用使用了 `bootEnv()`，但没有使用 `usePutenv()`。
当 `variables_order = "GPCS"` 且 `auto_globals_jit = On` 时，`prod` 中的每个请求都返回 **500**。
当 `RequestContext` 在请求期间读取 `DEFAULT_URI` 时，会发生此故障。
异常为 `EnvNotFoundException: Environment variable not found: "DEFAULT_URI"`。同一应用在 `dev` 中不会失败。
:::

此结果由 PHP 导致。使用 `variables_order = "GPCS"` 和 `auto_globals_jit = On` 时，PHP 会为每个请求重置 `$_ENV` JIT 标志。
第一个使用 `$_ENV` 的已编译文件会调用 `php_auto_globals_create_env`。此函数从进程环境重新导入 `$_ENV`。
此操作会删除 `Dotenv->bootEnv()` 在初始化期间添加的值。测试发现 `$_ENV` 在请求期间变为空。

在 `prod` 中，第一个请求会编译容器和服务文件。PHP 会在 `RequestContext` 解析 `%env(DEFAULT_URI)%` 前清除 `$_ENV`。
在 `dev` 中，容器在 `$kernel->boot()` 期间解析并缓存环境值。PHP 在此操作后清除 `$_ENV`。
两个环境都会发生重置，但只有 `prod` 使用清除后的值。

使用此调用：

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` 将 Dotenv 值写入进程环境。后续导入会读取这些值。
Symfony `EnvVarProcessor` 也可以通过 `getenv()` 读取它们。
Rapira 在每个进程中运行一个 NTS PHP 解释器。因此，不会有并发 PHP 线程调用 `putenv()`。

在生产环境中，请通过 systemd、容器或编排器设置环境变量。
仅在开发期间使用 `.env`。`usePutenv()` 和部署环境都会将值写入进程环境。
因此，后续导入会保留这些值。

此行为适用于在请求期间读取 `$_ENV` 的所有常驻 PHP 运行时。
有关此行为和其他常驻进程行为，请参阅[框架集成](/zh/docs/frameworks/)。

## 启动 Rapira

启动 Rapira：

```bash
rapira serve --mode worker worker.php
```

`--mode worker` 选择 Worker 模式。`127.0.0.1:8000` 是默认监听地址。
`rapira serve` 在前台运行。

打开另一个终端。发送请求：

```bash
curl -i http://127.0.0.1:8000/
```

在第一个终端中按 `Ctrl-C` 停止 Rapira。

入口脚本是 `worker.php`，因此 `$_SERVER['SCRIPT_NAME']` 包含 `/worker.php`。Symfony 在 URI 开头找不到此值。
然后，它将 base URL 设置为 `""`。`getPathInfo()` 返回请求路径，路由可以正常工作。
`generateUrl()` 创建不带 `/worker.php` 前缀的路径。不需要覆盖 `$_SERVER` 或使用 `Request::setTrustedProxies()`。

## 上生产环境

设置 `APP_ENV=prod`。安装时不包含开发依赖。
在服务器启动前创建缓存。测试确认 `php bin/console cache:warmup` 可正确初始化应用。
此命令还会在第一个请求前编译容器：

```bash
composer install --no-dev --optimize-autoloader
APP_ENV=prod php bin/console cache:warmup
```

顺手把 `DEFAULT_URI` 也检查一下。基础应用的 `config/packages/routing.yaml` 在**每个**环境里都把 `router.default_uri` 设成 `%env(DEFAULT_URI)%`，而 `.env` 里给的是 `http://localhost`，HTTP 请求之外生成的 URL（命令行命令、邮件）就是照着这个值拼出来的。把它指向你真实的源站地址。

一份用来跑它的小 `rapira.toml`：

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` 在指定请求数后替换 worker。它限制内存泄漏的影响，但不会修复泄漏。
`request_terminate_timeout_secs` 限制一个请求的运行时间。
使用 `APP_ENV=prod rapira serve --config rapira.toml` 启动服务器。
相对 `entrypoint` 使用配置文件目录。有关所有设置，请参阅[配置](/zh/docs/configuration)。

## 请求之间的状态重置

`services_resetter` 对每个带 `kernel.reset` 标签的服务调用 `reset()`。安装的 bundle 决定哪些服务带此标签。
例如带缓冲的日志 handler 和调试数据收集器。这些服务会自行注册标签。

它不会重置应用静态属性、全局值、库注册表或持续的 `ini_set()` 更改。
此状态保留在每个常驻 worker 中。请在应用代码中重置。
有关状态生命周期，请参阅[框架集成](/zh/docs/frameworks/)。

使用 resetter 的测试在 `dev` 和 `prod` 的 200 个连续请求中显示稳定内存。
如果内存增加，应用代码或 bundle 可能会保留请求状态。

## 响应后的工作

在 `$response->send()` 和 `$kernel->terminate()` 之间调用 [`rapira_finish_request()`](/zh/docs/http)，可在响应后监听器前发送响应。
worker 会继续运行 `terminate()`，直到 handler 返回。这可以减少客户端等待时间，但不会增加并发性。

## 开发时的循环

`rapira serve` 在前台运行，并初始化应用一次。因此，**请替换 worker 以加载更改后的 PHP 代码**。
开发期间，每次更改后都重启服务器。或者使用 [Classic 模式](/zh/docs/classic)：

```bash
rapira serve --mode classic public/index.php
```

还是同一个应用，只是跑在 Classic 模式下。它每个请求都要启动一遍，所以改动立刻生效。每个请求也会执行一次完整的启动。已经在跑的生产服务器可以通过滚动重载（给 master 发 `SIGUSR2`）使用新部署的代码。当前请求可以完成，但空闲 keep-alive 连接会关闭。如果启用了 `opcache.validate_timestamps = 0`，master 的 OPcache 段比整个进程池活得久，部署就需要完整重启；见[进程模型](/zh/docs/process-model)和[生产环境部署](/zh/docs/deployment)。

Symfony 处理未捕获的应用异常并返回自己的 `500` 响应。`dev` 显示异常页面。
`prod` 显示通用错误页。同一个 worker 处理下一个请求。
最终重置会删除更改后的服务状态。配置的 Symfony 日志器控制异常输出。基础应用不包含日志器。
Rapira 记录离开框架的 PHP 错误，例如上文的 `EnvNotFoundException`。有关级别设置，请参阅[日志](/zh/docs/logging)。
