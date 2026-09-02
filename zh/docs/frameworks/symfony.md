---
title: Symfony
description: "如何在 Rapira 的 Worker 模式下运行 Symfony 应用：worker 脚本、两次请求之间的服务重置，以及 .env 里的值如何进入容器。"
---

# Symfony

Symfony 的结构适合常驻 worker：一个由你启动的内核，一个你递给它的 `Request`，一个它还给你的 `Response`。在 Rapira 下，内核在 worker 起步时启动一次，之后每个请求不过是在一个已经热好的容器上调一次 `handle()`。应用本身几乎什么都不用改——要改的是那二十来行、用来顶替 `public/index.php` 的代码。本页讲的就是这个文件、两次请求之间的重置，以及 `.env` 里的值是怎么进到容器里的。

::: info 验证环境
- **PHP 8.5.8**——NTS、embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4**（`symfony/framework-bundle` v7.4.15）——`dev` 和 `prod` 下都跑了整套测试
- **Symfony 8.1**（`symfony/framework-bundle` v8.1.2）——`dev` 下跑了整套测试

两个应用都使用 `symfony/skeleton` 包创建，并在单个 worker 进程下运行。它们使用**同一个 `worker.php`**，没有任何按版本分叉的代码。测试覆盖了路由、一个 404、查询串、生成的 URL、表单提交、JSON 请求体、跨请求的 session、一次文件上传、一个未捕获的异常，以及连续 200 个请求。
:::

## Worker 模式下的行为

内核在脚本最上面、循环之外启动，随后伴随 worker 进程一直常驻：自动加载器、编译好的容器、路由器、事件分发器，以及你那些 bundle 打开的每一条连接，都只搭建一次，而不是每个请求搭一次。这正是 [Worker 模式](/zh/docs/worker)提供的；更多内容见[执行模式](/zh/docs/execution-modes)。

每个请求里，handler 做四件事，然后收尾：

1. `Request::createFromGlobals()`——在调用你的 handler 之前，Rapira 会为每个请求重新填好 `$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE` 和 `$_FILES`，所以 Symfony 那个照常使用的构造方式，读到的东西和在 php-fpm 下一模一样。
2. `$kernel->handle($request)`——路由、控制器、响应，一如往常。
3. `$response->send()`——输出就是 HTTP 响应（出站时怎么组装的，见 [HTTP](/zh/docs/http)）。
4. `$kernel->terminate($request, $response)`——响应之后的监听器照常跑。

接着，handler 通过容器里的 `services_resetter` 把带状态的服务重置掉——这与 Symfony 在两条 Messenger 消息之间执行的是同一次重置，长期存活的内核靠它甩掉单次请求攒下的东西。

session 就是原生的 PHP session，和在 php-fpm 下完全一样：每个请求调用一次 `session_start()`，cookie 随响应发出去，数据在下一个请求里读回来。客户端之间的隔离经过验证：第二个客户端带着全新的 cookie 罐进来，拿到的是它自己的 session。

一个内核住在一个 worker 进程里，而 worker 之间是彼此独立的操作系统进程——用户态里它们什么都不共享。到底有几个、又是怎么被监管的，见[进程模型](/zh/docs/process-model)。

## 前置条件

你需要[装好 Rapira](/zh/docs/intro/installation)，再加一个 Symfony 应用——`composer create-project symfony/skeleton my-app` 新建一个，或者直接用手上那个。应用不必做任何特别准备：worker 脚本放在 `composer.json` 旁边，其他一切原地不动。另外机器上还得有一个普通的 PHP CLI，Composer 和 `bin/console` 都要用它：Rapira 是把 PHP 以库（`libphp`）的形式带进来的，并不提供 `php` 命令，所以这些步骤跑的是你系统里的 PHP，Rapira 既不使用也不干涉它。

有两个扩展要留意，因为基础应用在 `composer.json` 里把它们写成了硬依赖（`ext-ctype`、`ext-iconv`），*同时*还 `replace` 掉了对应的 polyfill——所以它们必须是真正的扩展，不能是 PHP 写的替身。两个 PHP 构建都需要它们，系统里那个 CLI 也一样，否则 `composer create-project` 和 `composer install` 在平台检查那一步就会失败，那时 Rapira 根本还没上场。每个 Rapira 发布版内嵌的 PHP 两个都带：`ctype` 和 `iconv` 就在构建的 configure 参数里，完整的扩展清单在[安装](/zh/docs/intro/installation)页上。如果你改用自己的 PHP 来编译 Rapira，记得把这两个都打开——那份清单在哪里设置，见[从源码构建](/zh/docs/intro/build-from-source)。

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

**`(new Dotenv())->usePutenv()->bootEnv(...)`。**普通应用里你从来不用写这句，因为 `public/index.php` 把它交给了 `symfony/runtime`。这里启动流程归 worker 自己管，所以 `.env` 也得它自己加载——只加载一次，在内核出现之前。`usePutenv()` 是必需的：少了它，应用在 `prod` 下返回 500，而 `dev` 照常工作。更多内容见 [`$_ENV` 与 `variables_order`](#env-与-variables-order)。

**内核在循环之前就构造并启动好了。**`new Kernel(...)`、`boot()` 和 `getContainer()` 都在 worker 启动时跑完，所以读 `$_SERVER['APP_ENV']` 时 Dotenv 塞进去的值还在，而第一个请求还没上门，容器就已经热好了。之后 `while` 循环里的一切，都是冲着这同一个容器干活。

**先 `$container->has('services_resetter')` 再 `get()`。**服务 id `services_resetter` 在 7.4 和 8.1 里都是 public 的，同一个文件能在两边都跑起来靠的就是这一点——它背后的那个*类*在两个大版本之间换了命名空间（7.4 里是 `Symfony\Component\DependencyInjection\ServicesResetter`，8.1 里是 `Symfony\Component\HttpKernel\DependencyInjection\ServicesResetter`），而按 id 取服务，这个差别就消失了。`has()` 这道保险能让脚本碰上一个没定义该服务的容器时不至于致命错误。

**循环和 `gc_collect_cycles()`。**`\Rapira\handle_request()` 会一直阻塞到有请求上门，跑你的 handler，然后返回 `true`；worker 开始排空时它返回 `false`，循环也就到此为止。每转一圈回收一次循环引用，这份开销就固定落在两次请求之间，而不是某个请求处理到一半的时候。完整契约见 [Worker 模式](/zh/docs/worker)。

如果 resetter 还不够用，那还有两个更重的手段：`$container->reset()` 会把所有已经实例化的服务统统清掉，`$kernel->reboot(null)` 则直接扔掉容器重建一个——之后 handler 捕获的那个 `$container` 就失效了，真走这条路的话记得用 `$kernel->getContainer()` 重新取一次。两者都会丢掉 Worker 模式带来的那份热状态，所以它们是排查泄漏时的手段，别当默认做法。

## `$_ENV` 与 `variables_order`

::: warning
只写一个光秃秃的 `bootEnv()`、不带 `usePutenv()`，那么 `APP_ENV=prod` 下的 Symfony 应用**从第一个请求起**就返回 500，之后每个请求也照样是 500，报的是 `EnvNotFoundException: Environment variable not found: "DEFAULT_URI"`。同一个应用在 `dev` 下不会出错。
:::

根源在 PHP 里。在这次验证所用的 ini 默认值下（`variables_order = "GPCS"`、`auto_globals_jit = On`），PHP 会在**每个**请求上把 `$_ENV` 的 JIT 标志重新置上。这个请求期间第一个被编译、又提到了 `$_ENV` 的文件会触发 `php_auto_globals_create_env`，于是这个超全局变量就从真实的进程环境里重新导入一遍——把 `Dotenv->bootEnv()` 在 worker 启动时放进去的东西全抹掉。探针里看到的就是这个过程：请求跑到一半，`$_ENV` 从一个装满值的数组变成了空数组。

为什么只有 `prod` 会中招：`prod` 下容器和服务文件是被第一个请求懒编译出来的，于是这次抹除正好落在 `RequestContext` 解析 `%env(DEFAULT_URI)%` *之前*——轮到解析时，已经没东西可解析了。`dev` 下的调试容器则在 `$kernel->boot()`、也就是启动阶段就急切地把环境变量查完并缓存下来，所以抹除发生时答案早已记录在案。`dev` 下的行为完全相同，只是在那里不会造成任何影响。

修法就是上面脚本里的那一行：

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` 会让 Dotenv 把这些值同时写进*真正的*进程环境，而重新导入读回来的恰恰就是那里——值也就挺过了这一劫；何况 Symfony 的 `EnvVarProcessor` 本来也会回退到 `getenv()`。Rapira 用的是预 fork 的进程模型加 NTS 版 PHP，一个进程一个解释器，所以平时那些关于 `putenv()` 线程安全的告诫在这里并不适用。

生产环境里的另一个选择是直接设真正的环境变量（systemd 的 `Environment=`、你的容器运行时、你的编排系统），把 `.env` 留作开发时的便利。无论走哪条路，值都待在请求中途的重新导入抹不掉的地方。

这一点适用于任何常驻 worker 的 PHP 运行时——只要框架是懒加载地读 `$_ENV`，就会中招。[框架集成](/zh/docs/frameworks/)页把它和另外两个常驻进程的行为放在一起讲：启动对象的析构函数和 `register_shutdown_function()` 都只在第一个请求结束时触发一次。

## 跑起来

```bash
rapira serve --mode worker worker.php
curl -i http://127.0.0.1:8000/
```

`--mode worker` 选定 Worker 模式，`127.0.0.1:8000` 是默认监听地址。`rapira serve` 停在前台运行，`Ctrl-C` 会让它把手上的请求跑完再退出。

入口脚本叫 `worker.php` 而不是 `index.php`，于是 `$_SERVER['SCRIPT_NAME']` 是 `/worker.php`。Symfony 的 `Request` 会到 URI 开头去找这个名字，找不到，就把 base URL 降级成 `""`。`getPathInfo()` 返回真实路径，路由匹配得上，`generateUrl()` 生成的路径干干净净，哪儿也不会冒出 `/worker.php` 前缀。不需要覆盖 `$_SERVER`，也不需要为此调整 `Request::setTrustedProxies()`。

## 上生产环境

设好 `APP_ENV=prod`，安装时跳过开发依赖，再在服务器起来之前把缓存预热好。`php bin/console cache:warmup` 经验证能让应用干干净净地启动，也把容器编译从第一个请求里挪了出去：

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

`max_requests` 会在处理够这么多请求之后把 worker 回收掉，好让依赖树里某处的慢速泄漏永远长不到没边；它给泄漏划了个上限，而不是修好它。`request_terminate_timeout_secs` 给单个请求设了一个墙钟时间上限，否则常驻 worker 会一直阻塞在一个挂死的请求里。用 `rapira serve --config rapira.toml` 启动。这些键连同其余的键，都在[配置](/zh/docs/configuration)页上；相对路径的 `entrypoint` 是相对配置文件自己所在的目录解析的。

## 两次请求之间会重置什么

`services_resetter` 会对每个打了 `kernel.reset` 标签的服务调用 `reset()`。具体是哪些服务，取决于你装了哪些 bundle——带缓冲的日志 handler、调试数据收集器，以及类似的单次请求累加器，都会自己打上这个标签，所以这一次调用就能覆盖到它们全部。

它管不到的是你自己攥着的状态：静态属性、记忆化的全局变量、某个库懒加载填进去的注册表、一个你从没撤销过的 `ini_set()`。在任何常驻 worker 下，这些东西都会比请求活得久，得由你自己的代码来重置。哪些会留下、哪些不会，[框架集成](/zh/docs/frameworks/)页上有一张对照表。

接上 resetter 之后，验证中看到常驻内存在连续 200 个请求里始终是平的，`dev` 和 `prod` 都一样——内核维持着一个恒定的工作集，而不是每个请求涨一点。如果你的应用里内存一直增长，那就是你自己的代码或者某个 bundle 攥着请求不放。

## 响应之后的活儿

如果你想在那些响应后监听器跑起来之前就把客户端放走，就在 `$response->send()` 和 `$kernel->terminate($request, $response)` 之间插一句 [`rapira_finish_request()`](/zh/docs/http)——响应先发出去，`terminate()` 继续在一个客户端已经不再等待的 worker 上跑。在你的 handler 返回之前，worker 本身还是忙着的，所以这是压延迟的手段，不是拿来换并发的。

## 开发时的循环

`rapira serve` 跑在前台，而你的应用只启动一次，所以**改过的 PHP 代码要等 worker 被换掉之后才会生效**。正在改代码的时候，最省事的办法是把服务器停掉再起，或者让入口脚本跑在 [Classic 模式](/zh/docs/classic)下——那里脚本每次都从头执行，存一次盘就生效一次：

```bash
rapira serve --mode classic public/index.php
```

还是同一个应用，只是跑在 Classic 模式下。它每个请求都要启动一遍，所以改动立刻生效。每个请求也会执行一次完整的启动。至于已经在跑的生产服务器，让部署上去的代码接手而不中断连接的办法是滚动重载（给 master 发 `SIGUSR2`）——除非你开了 `opcache.validate_timestamps = 0`，那时 master 的 OPcache 段比整个进程池活得久，部署就得整个重启才行；见[进程模型](/zh/docs/process-model)和[生产环境部署](/zh/docs/deployment)。

未捕获的异常由 Symfony 自己处理：框架用自己的 `500` 应答它——`dev` 下是完整的异常页面，`prod` 下是一个通用错误页——接着处理下一个请求的还是同一个 worker 进程，故障前后它的 pid 没变。异常之后留下来的是泄漏或者被弄坏的服务状态，handler 末尾那次重置正是用来清掉它的。堆栈最后落到哪儿，取决于你的日志器；基础应用默认不带日志器。真正会出现在 Rapira 那条 stderr 日志里的，是从 PHP 自己手里逃出去的东西，比如上面那个 `EnvNotFoundException`——怎么把级别调高，见[日志](/zh/docs/logging)。
