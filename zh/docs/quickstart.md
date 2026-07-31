---
title: 快速开始
description: "用 Rapira 以经典模式和 worker 模式提供 PHP 应用，并把设置搬进 rapira.toml 文件。"
---

# 快速开始

本页介绍如何用经典模式返回一个页面、把同一个应用改造成常驻 worker，以及把设置搬进配置文件。前提是你手上已经有一个能用的 `rapira` 可执行文件，以及它自带的 PHP；详见[安装](/zh/docs/installation)。

## 经典模式

经典模式对任何应用都可用：每来一个请求，Rapira 就重新 include 一次入口脚本，跟 php-fpm 跑前端控制器完全一样。代码一行都不用改。

新建 `public/index.php`：

```php
<?php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

启动服务器——模式由 `--classic` 选定，后面的位置参数就是入口脚本：

```bash
rapira serve --classic public/index.php
```

不另行指定的话，Rapira 监听 `127.0.0.1:8000`。换一个终端：

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

请求之间进程并没有被丢掉——Rapira 只 fork 一次 worker，每个 worker 里都常驻着一个启动好的 PHP 解释器。被丢掉的是脚本自己的状态：变量、自动加载器、框架搭起来的那一整套。

## Worker 模式

SAPI Worker 模式会让脚本一直活着：它只启动一次，随后在循环里不断向 Rapira 要下一个请求；Rapira 重新填好超全局变量，再调用你的处理函数。PHP 代码的模样还是熟悉的那套——照样读 `$_GET`，照样 `echo` 出响应——区别在于启动工作每个进程只做一次，而不是每个请求都做一次。详见[执行模式](/zh/docs/execution-modes)。

在项目根目录新建 `worker.php`：

```php
<?php
use Rapira\Plugin\Http\HttpHandlerConfig;
use function Rapira\create_plugin_handler;

$http = create_plugin_handler(new HttpHandlerConfig());

// Outside the loop, so it survives every request this worker serves.
$handled = 0;

$handler = static function () use (&$handled): void {
    $handled++;
    header('Content-Type: text/plain');
    echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
    echo "worker " . getmypid() . " handled {$handled} request(s)\n";
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

`create_plugin_handler()` 返回负责处理 HTTP 的 handler，具体是哪一个由传给它的 `HttpHandlerConfig` 决定。之后 `handleRequest()` 会一直阻塞到请求到来，用你的回调处理它，再返回 `true`；服务器开始关闭时它返回 `false`，循环也就到此为止。

`create_plugin_handler()`、`HttpHandlerConfig` 和各个 handler 类都来自 Rapira 启动解释器时注册的那个 PHP 模块，所以上面这段脚本不用自动加载器也能跑。带有 Composer 依赖的应用会在进入循环之前加载自己的 `vendor/autoload.php`。

先把经典模式那个服务器停掉——在它的终端里按 `Ctrl-C`——因为两者都要监听 `127.0.0.1:8000`。Worker 模式本来就是默认模式，这次不用加任何参数：

```bash
rapira serve worker.php
```

```bash
curl '127.0.0.1:8000/?name=world'
```

多跑几次这条 `curl`，计数会不断增加：请求始终由同一个进程处理。默认情况下 Rapira 会按 CPU 核数每核 fork 一个 worker，请求落到哪个 worker 上由内核决定，而每个 worker 各记各的数；输出里的 pid 会告诉你这次是谁应答的。想让计数保持为一条连续的序列，就改用 `rapira serve --processes 1 worker.php` 启动。进程池是怎么被管起来的，见[进程模型](/zh/docs/process-model)。

在 `while` 循环之前搭好的一切，都会在 worker 的整个生命周期里留在内存中：Composer 自动加载器、DI 容器、数据库和缓存连接、编译好的路由和模板——这些都只在启动时构建一次，而不是每个请求都重建一遍。每轮循环真正重新产生的，只有属于单个请求的那部分状态。

::: warning
在请求之间存活下来的状态，必须由 worker 脚本自己重置。上一个请求留下的静态属性、全局变量、没结束的事务，下一个请求照样看得见。该盯住哪些地方、怎么让 worker 保持干净，都在 [Worker 模式](/zh/docs/worker)里。
:::

处理函数里照常可以用这些函数：`header()`、`http_response_code()`、`echo`，再加上 `rapira_finish_request()`——它能提前把响应刷出去，然后接着干剩下的活。详见 [HTTP](/zh/docs/http)。

## 配置文件

设置可以写进 `rapira.toml` 文件，而不必放在命令行上。在代码旁边放一个文件，起步已经够用：

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
processes = 4
```

```bash
rapira serve --config rapira.toml
```

::: info
`pool.entrypoint` 写成相对路径时，是相对配置文件所在的目录解析的，所以不管你在哪个目录下执行，同一份文件都能用。命令行参数的优先级仍然高于文件——`rapira serve --config rapira.toml --processes 1` 会保留其余设置，只 fork 一个 worker。
:::

文件还接受进程池的伸缩模式、worker 回收、请求超时、日志以及 supervisor 的 pidfile。不认识的键会被直接拒绝而不是忽略，所以拼错一个字母会让启动失败，而不是悄无声息地不起作用。完整的参考见[配置](/zh/docs/configuration)，命令行参数见[命令行](/zh/docs/cli)。

## 停止服务器

按下 `Ctrl-C`，Rapira 会开始收尾：不再接新的活，让已经在处理的请求跑完，关掉扩展，然后退出。再按一次 `Ctrl-C` 会跳过等待，直接强制退出，卡住的请求因此不会一直占着服务器。`SIGTERM` 的行为完全一样，服务管理器发起的重启因此天然就是优雅的。完整的信号对照表，包括如何在不断开连接的前提下重载，都在[进程模型](/zh/docs/process-model)里。

## 下一步

- [Worker 模式](/zh/docs/worker)——常驻循环的细节：状态、泄漏、回收，以及怎样在进入循环之前把一个真实应用启动起来。
- [配置](/zh/docs/configuration)——`rapira.toml` 能接受的每一个键，以及各自的默认值。
- [框架集成](/zh/docs/frameworks/)——Symfony、Laravel 和 Yii3 的集成指南。
