---
title: Worker 模式
description: "如何编写 Rapira 的 worker 脚本：常驻循环、handleRequest() 契约、两次请求之间留下什么，以及常见的坑。"
---

# Worker 模式

Worker 模式让 PHP 进程在多次请求之间保持存活：脚本把应用启动一次，然后待在循环里，一遍遍向 Rapira 要下一个请求。启动只在起步时执行一次，之后每个请求一上来，内存里已经有一个预热好的应用。状态同样比请求活得更久，所以 worker 脚本必须自己管理它。

而在[经典模式](/zh/docs/classic)下，入口脚本在每个请求上都从头跑一遍，请求应答完毕后脚本搭起来的一切随即统统丢弃，因此启动一个现代框架——自动加载器、容器、配置、路由、数据库连接——在每个请求上的开销都一样。

Worker 模式就是 **SAPI Worker** 模式，它和 Classic 一起构成了今天已经发布的部分，本页是它的编程指南。Worker 模式并不要求特定的框架，只要求应用经得起“只启动一次、随后处理很多请求”，而大多数现代框架都做得到。四种模式分别是什么、以及什么决定了一个应用能用哪一种，见[执行模式](/zh/docs/execution-modes)；针对具体框架的指南见[框架集成](/zh/docs/frameworks/)。

## 常驻循环

一个 worker 脚本分三块：开头启动起来的那些东西、负责应答单个请求的 handler，以及不断调用它、直到服务器关闭才罢休的循环。循环写在 PHP 这一侧，围绕 Rapira 返回给脚本的那个 handler 对象展开。

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

use Rapira\Plugin\Http\HttpHandlerConfig;
use function Rapira\create_plugin_handler;

$http = create_plugin_handler(new HttpHandlerConfig());
$app = new App(); // booted once, reused for every request

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

`rapira serve` 默认跑的就是 worker 模式，所以把服务器指向这个脚本就够了；经典模式才需要你主动开启：

```bash
rapira serve app/worker.php
```

其余命令行参数见[命令行](/zh/docs/cli)，它们在 `rapira.toml` 里对应的写法见[配置](/zh/docs/configuration)。

## `handleRequest()` 到底做了什么

`handleRequest(callable $handler)` 就是全部的契约：

- **它会阻塞**，直到有请求派给这个 worker。等在 `handleRequest()` 上的 worker 不消耗 CPU，同时解释器和你启动好的应用仍然留在内存里。
- **它会填好超全局变量**——`$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE` 这一家子——在你的 handler 跑起来之前，用这次请求的数据重新填一遍。读这些变量的普通 PHP 代码，行为和在 php-fpm 下一模一样。
- **它调用 handler 时不传任何参数。**请求的一切都在超全局变量里，回调的签名就是 `function (): void`。handler 还需要别的东西——容器、应用、日志器——用 `use` 捕获进去。
- **你输出的就是响应。**`echo`、`print`、`header()`、`http_response_code()`、`setcookie()`：handler 生成响应的方式和经典模式下的脚本毫无区别。请求数据和响应输出是怎么接起来的，见 [HTTP](/zh/docs/http)。
- **请求处理完它返回 `true`**，意思是接着循环；服务器开始关闭时返回 **`false`**。这正是循环条件——它一变成 false，就跳出循环，让脚本结束。

所以在 worker 模式里，一个请求就是 `while` 循环转一圈。Rapira 会在你的 handler 外面把请求收尾：跑 shutdown 函数和析构函数，刷出并重置输出缓冲，写入并关闭 session，再为下一圈重新填好超全局变量——而脚本在 handler 之外攥着的一切，原封不动。

## 每个 worker 只有一个 handler

`handleRequest()` 每处理完一个请求就返回，而不是一直服务下去，所以让 worker 活着的是外面那个循环，而这个循环得由 worker 脚本自己提供。

因此，一个 worker 脚本同一时刻只驱动一个 handler。前后写两个循环，第二个在第一个退出之前永远轮不到——而第一个只有在 `handleRequest()` 返回 `false` 时才退出，那时候服务器已经在关闭了。分发到不同的代码路径，是那唯一一个 handler 内部的事，不是靠多写几个循环来表达的。

```php
while ($http->handleRequest($api)) {
}

// unreachable until shutdown
while ($http->handleRequest($web)) {
}
```

## 两次请求之间什么会留下来

在 handler **之外**创建的一切，都会伴随 worker 进程一直活着：自动加载器、DI 容器、编译好的路由、配置、已经建立的数据库和缓存连接、预热好的缓存。这些都不会在每个请求上重建一遍。

在 handler **之内**创建的一切，都是普通的单请求工作，handler 一返回、请求一收尾就被释放掉。

这条边界画在哪里，是 worker 脚本的一个设计决定：打算共享的状态放在循环之上，只属于一个请求的状态留在 handler 里，或者在下一个请求到来之前重置掉。

::: warning
全局状态同样是共享的，不管你是不是有意为之：静态属性、单例、某个库懒加载填进去的注册表、一个从没撤销过的 `ini_set()`。在 php-fpm 下它们之所以是单请求级的，是因为 PHP 的请求关闭阶段会把它们重置——静态变量、全局变量和 `ini_set()` 都一样。Rapira 的 worker 特意跳过了两次请求之间的这次重置，所以它们会一直留着。放不下全局状态的应用改用[经典模式](/zh/docs/classic)运行：经典模式放弃了 worker 常驻内存里的那个预热应用，但它依然是 php-fpm 的直接替代品，等状态理顺之后，应用还可以再迁到 worker。
:::

## 选择插件

`create_plugin_handler()` 接收一个配置对象，而真正决定选用哪个插件的，是这个配置的*类*。`HttpHandlerConfig` 表示这个 worker 提供 HTTP 服务，换回来的就是一个 `HttpHandler`。

它在两种情况下会抛出 `Rapira\RapiraException`：没有插件匹配你传进来的配置类，以及脚本压根不在 worker 模式下运行——经典模式没有常驻循环，即便真的返回一个 handler，它也只能报告“正在关闭”。

配置本身还带着一份对目标插件的描述，放在 `$http->config->info` 里——一个带 `name` 和 `description` 的 `Rapira\PluginInfo`（HTTP 插件对应的是 `http` 和 `HTTP request handler`）：

```php
$http = create_plugin_handler(new HttpHandlerConfig());

echo $http->config->info->name;        // http
echo $http->config->info->description; // HTTP request handler
```

## 用 `getInfo()` 观察 worker

`$http->getInfo()` 返回一个 `Rapira\Plugin\Http\RuntimeInfo`——当前这个 worker 自己的实时计数，读的是调用那一刻的值：

| 字段       | 含义                                                                            |
| ---------- | ------------------------------------------------------------------------------ |
| `state`    | `starting`、`idle`、`active`、`draining` 或 `free`——见下文                      |
| `pid`      | 当前 worker 的进程 id                                                           |
| `queued`   | 此刻还在这个 worker 接收队列里排队的请求数                                      |
| `handled`  | 这个 worker 已经处理完的请求数                                                  |
| `errors`   | 其中以错误告终的有多少                                                          |
| `recycles` | PHP 中途退出后，这个 worker 重建自身状态的次数                                  |
| `restarts` | worker 的 PHP 线程本身被重建的次数                                              |

这五个状态说明 worker 正处在生命周期的哪个位置：**starting**——master 刚 fork 出它，它还没报到；**idle**——停着等请求，算作空闲容量；**active**——正在跑一个请求；**draining**——它正在退场（请求配额用完了，或者被标记为不健康），不再算作空闲容量；**free**——这个槽位上还没绑定 worker。

注意 `queued` 是接收队列此刻的深度，不是累计值；而每个计数都只属于当前这个进程：worker 启动时它们从零开始，所以顶替上来的新 worker 也是从零重新数。

这些计数可以撑起一个小小的状态接口：

```php
$handler = static function () use ($http): void {
    $info = $http->getInfo();
    header('Content-Type: application/json');
    echo json_encode([
        'pid' => $info->pid,
        'state' => $info->state,
        'queued' => $info->queued,
        'handled' => $info->handled,
        'errors' => $info->errors,
    ]);
};
```

## 常见的坑

**状态在请求之间泄漏。**应用在 worker 里出毛病、在 php-fpm 下却好好的，通常就是状态在请求之间泄漏了。一个越长越大的静态数组、一个被单例缓存住的请求对象、一个还攥着上个用户上下文的日志器——每一个都是只在第二个请求上才现形的 bug。在 handler 的开头或结尾显式清理，库留下的东西也一并重置。`pool.max_requests` 会让 worker 处理够 N 个请求后退出，由 master 换上一个全新的进程，这能圈住慢速泄漏的破坏，但并不修复它。

**没被回收的循环引用。**PHP 的引用计数会立刻释放掉大部分对象，但循环引用只有等循环回收器跑起来才清得掉。像上面那个脚本那样每转一圈循环就调用一次 `gc_collect_cycles()` 并不是必需的，但它把回收固定在一个可预期的时刻——发生在两次请求之间，而不是某个请求处理到一半的时候。

**永远结束不了的请求。**卡在挂死请求里的 worker 会一直待在那里，这段时间它也处理不了别的请求。`pool.request_terminate_timeout_secs` 给单个请求设了一个墙钟时间上限，超出就把这个 worker 杀掉。这个键和 `pool.max_requests` 见[配置](/zh/docs/configuration)，worker 死掉之后 master 会怎么做，见[进程模型](/zh/docs/process-model)。

**未捕获的异常只影响单个请求，不影响整个 worker。**handler 里未捕获的异常会计入 `errors` 并以 `500` 应答，除非抛出之前 handler 已经把状态码提交出去了。无论哪种情况循环都照转不误，异常不会把 worker 一起带走。致命错误则是另一回事：它会让常驻脚本直接终止，于是 worker 从头把它重新跑一遍，你的应用也随之重新启动——`recycles` 数的就是这件事。

**响应之后的活儿。**如果你想先把响应发出去、再接着干点别的——冲一下队列、写一条审计记录——`rapira_finish_request()` 干的正是这件事。说明在 [HTTP](/zh/docs/http) 页里。

## IDE 存根

Rapira 暴露给 PHP 的每一个类和函数，都声明在 [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) 里。它是这套 API 的权威声明——签名、属性类型、每个类是干什么的——同时还能当 IDE 存根用：把它丢进项目，编辑器就会给 `create_plugin_handler()`、`handleRequest()` 这些补全，而不是标红说未定义。
