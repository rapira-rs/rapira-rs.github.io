---
title: Worker 模式
description: "如何编写 Rapira 的 worker 脚本：常驻循环、handle_request() 契约、两次请求之间留下什么，以及常见的坑。"
faqLevel: 2
---

# Worker 模式

Worker 模式让 PHP 进程在多次请求之间保持存活：脚本把应用启动一次，然后待在循环里，一遍遍向 Rapira 要下一个请求。启动只在起步时执行一次，之后每个请求一上来，内存里已经有一个预热好的应用。状态同样比请求活得更久，所以 worker 脚本必须自己管理它。

而在 [Classic 模式](/zh/docs/classic)下，入口脚本在每个请求上都从头跑一遍，请求应答完毕后脚本搭起来的一切随即统统丢弃，因此启动一个现代框架（自动加载器、容器、配置、路由、数据库连接）在每个请求上的开销都一样。

本页是 Worker 模式的编程指南。Worker 模式并不要求特定的框架，只要求应用经得起“只启动一次、随后处理很多请求”，而大多数现代框架都做得到。三种模式分别是什么、以及什么决定了一个应用能用哪一种，见[执行模式](/zh/docs/execution-modes)；针对具体框架的指南见[框架集成](/zh/docs/frameworks/)。

## 常驻循环

一个 worker 脚本分三块：开头启动起来的那些东西、负责应答单个请求的 handler，以及不断调用它、直到 worker 开始排空才罢休的循环。循环写在 PHP 这一侧，围绕自由函数 `\Rapira\handle_request()` 展开。

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // The worker creates this object once and reuses it.

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

默认模式是 Dispatcher。选定 Worker 模式有两种写法，效果完全一样：

- 命令行上加 `--mode worker`，紧挨着入口脚本。
- 在 `rapira.toml` 的 `[pool]` 段里写 `mode = "worker"`。

```bash
rapira serve --mode worker app/worker.php
```

其余命令行参数见[命令行](/zh/docs/cli)，它们在 `rapira.toml` 里对应的写法见[配置](/zh/docs/configuration)。

## `handle_request()` 的契约

`\Rapira\handle_request(callable $handler): bool` 就是全部的契约：

- **它会阻塞**，直到有请求派给这个 worker。等在 `handle_request()` 上的 worker 不消耗 CPU，同时解释器和你启动好的应用仍然留在内存里。
- **它会填好超全局变量**（`$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE` 这一家子）：在你的 handler 跑起来之前，用这次请求的数据重新填一遍。读这些变量的普通 PHP 代码，行为和在 php-fpm 下一模一样。
- **它调用 handler 时不传任何参数。**请求的一切都在超全局变量里，回调的签名就是 `function (): void`。handler 还需要别的东西（容器、应用、日志器）就用 `use` 捕获进去。
- **你输出的就是响应。**`echo`、`print`、`header()`、`http_response_code()`、`setcookie()`：handler 生成响应的方式和 Classic 模式下的脚本毫无区别。请求数据和响应输出是怎么接起来的，见 [HTTP](/zh/docs/http)。
- **请求处理完它返回 `true`**，意思是接着循环；worker 开始排空时返回 **`false`**。这正是循环条件：它一变成 false，就跳出循环，让脚本结束。
- **它只能出现在启动脚本的顶层。**只在脚本自己的循环里调用它，别处一概不要：在 shutdown 函数或析构函数里调用它，行为是未定义的。

所以在 Worker 模式里，一个请求就是 `while` 循环转一圈。Rapira 会在你的 handler 外面把请求收尾：跑完这次请求注册的 shutdown 函数，刷出并重置输出缓冲，写入并关闭 session，再为下一圈重新填好超全局变量。脚本在 handler 之外攥着的一切，原封不动。Rapira 不会在请求结束时统一跑一遍析构：一个对象要等最后一个引用消失才销毁。

## 每个 worker 只有一个 handler

`handle_request()` 每处理完一个请求就返回，而不是一直服务下去，所以让 worker 活着的是外面那个循环，而这个循环得由 worker 脚本自己提供。

因此，一个 worker 脚本同一时刻只驱动一个 handler。前后写两个循环，第二个在第一个退出之前永远轮不到，而第一个只有在 `handle_request()` 返回 `false` 时才退出，那时候 worker 已经在排空了。分发到不同的代码路径，是那唯一一个 handler 内部的事，不是靠多写几个循环来表达的。

```php
while (\Rapira\handle_request($api)) {
}

// Code reaches this loop only during shutdown.
while (\Rapira\handle_request($web)) {
}
```

## 两次请求之间什么会留下来

在 handler **之外**创建的一切，都会伴随 worker 进程一直活着：自动加载器、DI 容器、编译好的路由、配置、已经建立的数据库和缓存连接、预热好的缓存。这些都不会在每个请求上重建一遍。

在 handler **之内**创建的一切，都是普通的单请求工作，handler 一返回、最后一个引用一消失就被释放掉。

这条边界画在哪里，是 worker 脚本的一个设计决定：打算共享的状态放在循环之上，只属于一个请求的状态留在 handler 里，或者在下一个请求到来之前重置掉。

::: warning
全局状态同样是共享的，不管你是不是有意为之：静态属性、单例、某个库懒加载填进去的注册表、一个从没撤销过的 `ini_set()`。在 php-fpm 下它们之所以是单请求级的，是因为 PHP 的请求关闭阶段会把它们重置，静态变量、全局变量和 `ini_set()` 都一样。Rapira 的 worker 特意跳过了两次请求之间的这次重置，所以它们会一直留着。放不下全局状态的应用改用 [Classic 模式](/zh/docs/classic)运行：Classic 模式放弃了 worker 常驻内存里的那个预热应用，但它依然是 php-fpm 的直接替代品，等状态理顺之后，应用还可以再迁到 worker。
:::

## shutdown 函数

脚本在启动阶段、也就是循环之外注册的 shutdown 函数只跑一次，时机是 worker 的生命周期结束时（正常情况下就是 worker 退出时），而不是每个请求结束时。handler 在某个请求期间注册的 shutdown 函数，在这个请求结束时跑一次，之后不再跑。

进程级资源的清理在启动阶段注册，单个请求自己那些资源的清理放进 handler 里注册。

```php
register_shutdown_function(static function (): void {
    // Runs once when the worker cycle ends.
});

$handler = static function (): void {
    register_shutdown_function(static function (): void {
        // Runs at the end of this request.
    });
};

while (\Rapira\handle_request($handler)) {
}
```

生命周期结束时，启动阶段注册的那批先跑，顺序就是注册顺序；循环之后才注册的函数排在它们后面。

对象走的是另一套规则。Rapira 不会在请求结束时统一跑一遍析构：一个对象要等最后一个引用消失才销毁。所以只被 handler 里的局部变量持有的对象，在 handler 返回时销毁；被启动阶段的全局变量持有的对象会跨请求留在内存里，它的 `__destruct()` 只在生命周期结束时跑一次。

::: question 为什么启动阶段注册的 shutdown 函数不会在第一个请求结束时跑？
在 PHP 里，shutdown 函数列表本身就是单请求级的状态：请求关闭阶段依次调用列表里的函数，然后把列表释放掉。Rapira 在第一次调用 `handle_request()` 时就把启动阶段的那批注册从列表里取走自己存着，于是每个请求关闭时，列表里只剩这个请求自己注册的东西。等生命周期结束，Rapira 再把启动阶段的列表放回去，并把循环之后注册的函数接在后面，所以最后那一次关闭会按注册顺序先跑启动阶段的条目，再跑后面这些。
:::

## 只在 Worker 模式下可用

`handle_request()` 依赖只有 Worker 模式才有的那个常驻循环。在 Classic 模式和 Dispatcher 模式下，它抛出 `Rapira\Exception\NotInWorkerModeError`。Rapira 抛出的每个类都实现了标记接口 `Rapira\Exception\RapiraThrowable`，所以一个 `catch` 就能全兜住。

`Rapira\get_mode()` 返回当前进程的[模式](/zh/docs/execution-modes)，取值是 `Rapira\Mode` 的一个 case。要在不止一种模式下跑的脚本，进入循环之前先读一下它：

```php
if (\Rapira\get_mode() === \Rapira\Mode::Worker) {
    while (\Rapira\handle_request($handler)) {
    }
}
```

## 常见的坑

**状态在请求之间泄漏。**应用在 worker 里出毛病、在 php-fpm 下却好好的，通常就是状态在请求之间泄漏了。一个越长越大的静态数组、一个被单例缓存住的请求对象、一个还攥着上个用户上下文的日志器，每一个都是只在第二个请求上才现形的 bug。在 handler 的开头或结尾显式清理，库留下的东西也一并重置。`pool.max_requests` 会让 worker 处理够 N 个请求后退出，由 master 换上一个全新的进程，这能圈住慢速泄漏的破坏，但并不修复它。

**没被回收的循环引用。**PHP 的引用计数会立刻释放掉大部分对象，但循环引用只有等循环回收器跑起来才清得掉。像上面那个脚本那样每转一圈循环就调用一次 `gc_collect_cycles()` 并不是必需的，但它把回收固定在一个可预期的时刻：发生在两次请求之间，而不是某个请求处理到一半的时候。

**永远结束不了的请求。**卡在挂死请求里的 worker 会一直待在那里，这段时间它也处理不了别的请求。`pool.request_terminate_timeout_secs` 给单个请求设了一个墙钟时间上限，超出就把这个 worker 杀掉。这个键和 `pool.max_requests` 见[配置](/zh/docs/configuration)，worker 死掉之后 master 会怎么做，见[进程模型](/zh/docs/process-model)。

**未捕获的异常只影响单个请求，不影响整个 worker。**handler 里未捕获的异常以 `500` 作答，除非抛出之前 handler 已经把响应头发出去了。无论哪种情况循环都照转不误，异常不会把 worker 一起带走。致命错误则是另一回事：它会把常驻脚本整个终止掉，于是 worker 从头把脚本重新跑一遍，你的应用也随之重新启动。

**响应之后的活儿。**如果你想先把响应发出去、再接着干点别的，比如冲一下队列、写一条审计记录，`rapira_finish_request()` 干的正是这件事。说明在 [HTTP](/zh/docs/http) 页里。

## IDE 存根

Rapira 暴露给 PHP 的函数和类，都声明在 `crates/php_sys` 下的存根文件里。worker 这一套在 [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) 里，异常类在 [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_exception.stub.php) 里。它们是这套 API 的权威声明：签名、属性类型、每个类是干什么的。它们同时还能当 IDE 存根用：把它们丢进项目，编辑器就会给 `\Rapira\handle_request()`、`\Rapira\get_mode()` 这些补全，而不是标红说未定义。
