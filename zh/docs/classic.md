---
title: Classic 模式
description: "Classic 模式在每个请求上都从头执行一个普通的 PHP 入口脚本，和 php-fpm 一样，每次的状态都是全新的。"
---

# Classic 模式

Classic 模式执行普通的 PHP 入口脚本，也称为前端控制器。它就是 php-fpm 运行的 `public/index.php`。Rapira 会为每个请求从头执行此脚本。Rapira 顶替 php-fpm，应用不需要做任何改动。超全局变量会填充，脚本会从上到下执行，其输出就是响应。

## 每个请求都是全新的状态

每个请求都会完整走一遍 PHP 的请求周期：请求启动、执行入口脚本、请求关闭。脚本一路建起来的东西--全局变量、静态属性、DI 容器、ORM 的 identity map--都会在下一个请求开始之前拆干净，和在 php-fpm 下一模一样。

忘了关的句柄、只初始化了一半的单例、把请求数据顺手塞进静态属性的库--这些都不会影响到下一个请求，因为脚本创建的一切都活不过创建它的那个请求。例外和 php-fpm 完全一样：持久连接和扩展级的状态住在 worker 进程里，不属于某一个请求。那些当初没有考虑过长驻进程的代码，在这里不用改动就能跑。`fastcgi_finish_request()` 来自 php-fpm 这个可执行文件，在 Rapira 下无法使用；Rapira 提供的是契约完全相同的 `rapira_finish_request()`--提前把响应刷给客户端，之后接着干活--具体说明见 [HTTP](/zh/docs/http) 页。

每个请求都要把应用重新启动一遍：自动加载器、配置、容器、路由。更多信息见[执行模式](/zh/docs/execution-modes)。

## 怎么开启

选定这个模式有两种写法，效果完全一样：

- 命令行上加 `--mode classic`，紧挨着入口脚本。
- 在 `rapira.toml` 的 `[pool]` 段里写 `mode = "classic"`。

`--mode` 会覆盖 `pool.mode`，所以哪怕配置文件里写的是另一种模式，最终跑哪一种也由命令行说了算。其余部分依旧遵循通常的优先级：命令行参数压过配置文件。完整的键列表见[配置](/zh/docs/configuration)。

Classic 模式的入口脚本就是普通 PHP：

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

两种方式都能让 Rapira 指向它：

::: code-group

```bash [CLI]
rapira serve --mode classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
mode = "classic"
```

:::

用配置文件时，启动命令是 `rapira serve --config rapira.toml`。`pool.entrypoint` 写成相对路径时，是相对配置文件所在的目录解析的，所以这份配置搬到哪儿都能用；而命令行上的相对脚本路径，则是相对当前目录解析。其余参数见[命令行参考](/zh/docs/cli)。

## 入口脚本

Rapira 不会把 URL 映射到 PHP 脚本。不管请求的路径是什么，跑的都是你指定的那个入口脚本，URL 则通过 `$_SERVER['REQUEST_URI']` 交给应用自己去路由。唯一的例外是[静态文件中间件](/zh/docs/static-files)：开启之后，它可以用根目录下的文件应答 `GET` 和 `HEAD` 请求；凡是它没有应答的请求，照旧交给入口脚本。

CGI 变量也就顺理成章：`SCRIPT_FILENAME` 永远是入口脚本，`SCRIPT_NAME` 是它带前导斜杠的文件名（`/index.php`），`DOCUMENT_ROOT` 是它所在的目录。静态资源也可以改由 Rapira 前面的 CDN 或反向代理来提供，[部署](/zh/docs/deployment)那一页就搭了这么一个代理。

## OPcache

从头执行会重置应用状态，但不会重置编译后的字节码。master 进程在 fork worker 之前只启动一次 PHP。因此，OPcache 只创建一个共享内存段，每个 worker 都继承相同的映射。启用 OPcache 后，编译后的脚本会跨请求并在整个进程池中保持缓存。重新执行入口脚本不需要再次解析它。

进程池本身在两种模式下是一样的：master fork 出一批 worker，每个 worker 一次处理一个请求，并发能力就来自进程数量。关于 master 进程和它的 worker，更多信息见[进程模型](/zh/docs/process-model)那一页。

::: info
在 Classic 模式下调用 `Rapira\handle_request()` 会抛出 `Rapira\Exception\NotInWorkerModeError`。脚本随请求一起结束，没有循环可以接过这个 handler。Worker 脚本属于 [Worker 模式](/zh/docs/worker)。
:::

## 在 Classic 和 Worker 之间做选择

应用的状态撑不过第二个请求时，就用 Classic 模式：老代码库、往静态属性里泄漏的框架、你管不着的第三方库。正从 php-fpm 迁移过来、想一次只改一件事的时候，同样用它。代码扛得住一个不退出的进程，就用 [Worker 模式](/zh/docs/worker)，它把每个请求的启动开销去掉了。[执行模式](/zh/docs/execution-modes)那一页描述了全部三种模式。
