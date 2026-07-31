---
title: Worker 模式
description: Rapira 常驻 worker 的编程指南：应用只启动一次，随后用 handleRequest() 循环处理请求，并弄清楚两次请求之间有什么会留下来。
---

# Worker 模式

在[经典模式](/zh/docs/classic)下，PHP 干的还是它一直干的那件事：入口脚本从头跑一遍，把请求应答掉，脚本搭起来的一切随即统统丢弃。启动一个现代框架——自动加载器、容器、配置、路由、数据库连接——第一个请求要付多少，第一百万个请求还是照付。

Worker 模式是另一条路。进程不会退出：脚本把应用启动一次，然后待在循环里，一遍遍向 Rapira 要下一个请求。启动开销只在起步时付一次，之后每个请求一上来，内存里就已经躺着一个热好的应用。代价是你得开始操心状态——因为它现在比请求活得更久。

这就是 Rapira 执行阶梯上的 **SAPI Worker** 那一级，它和 Classic 一起构成了今天已经发布的部分。整架阶梯是什么样、怎么判断自己的应用能爬到哪一级，见[执行模式](/zh/docs/execution-modes)；本页则是你现在就能用的这一级的编程指南。

## 常驻循环

一个 worker 脚本分三块：开头启动起来的那些东西、负责应答单个请求的 handler，以及不断调用它、直到服务器关闭才罢休的循环。循环写在 PHP 这一侧——Rapira 把一个 handler 对象交给你，方向盘握在你手里。

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

让服务器指向它就完事了——`rapira serve` 默认跑的就是 worker 模式，经典模式才需要你主动开启：

```bash
rapira serve app/worker.php
```

其余命令行参数见[命令行](/zh/docs/cli)，它们在 `rapira.toml` 里对应的写法见[配置](/zh/docs/configuration)。

## `handleRequest()` 到底做了什么

`handleRequest(callable $handler)` 就是全部的契约，值得慢慢读一遍：

- **它会阻塞**，直到有请求派给这个 worker。停在 `handleRequest()` 上的 worker 等待期间不烧 CPU，解释器和你启动好的应用仍然留在内存里。
- **它会填好超全局变量**——`$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE` 这一家子——在你的 handler 跑起来之前，用这次请求的数据重新填一遍。读这些变量的普通 PHP 代码，行为和在 php-fpm 下一模一样。
- **它调用 handler 时不传任何参数。**请求的一切都在超全局变量里，回调的签名就是 `function (): void`。handler 还需要别的东西——容器、应用、日志器——用 `use` 捕获进去。
- **你输出的就是响应。**`echo`、`print`、`header()`、`http_response_code()`、`setcookie()`：handler 生成响应的方式和经典模式下的脚本毫无区别。请求数据和响应输出是怎么接起来的，见 [HTTP](/zh/docs/http)。
- **请求处理完它返回 `true`**，意思是接着循环；服务器开始关闭时返回 **`false`**。这正是循环条件——它一变成 false，就跳出循环，让脚本结束。

所以在 worker 模式里，一个请求就是 `while` 循环转一圈。Rapira 会在你的 handler 外面把请求收尾：跑 shutdown 函数和析构函数，刷出并重置输出缓冲，写入并关闭 session，再为下一圈重新填好超全局变量——而脚本在 handler 之外攥着的一切，原封不动。

## 一个 worker，一个 handler

`handleRequest()` 每处理完一个请求就返回。它不是那种“一直服务下去”的调用——让 worker 活着的是外面那个循环，而这个循环归你写。

由此带来的后果常常让人栽跟头：一个 worker 脚本同一时刻只驱动一个 handler。前后写两个循环，第二个在第一个退出之前永远轮不到——而第一个只有在 `handleRequest()` 返回 `false` 时才退出，那时候服务器已经在关闭了。分发到不同的代码路径，是那唯一一个 handler 内部的事，不是靠多写几个循环来表达的。

```php
while ($http->handleRequest($api)) {
}

// unreachable until shutdown
while ($http->handleRequest($web)) {
}
```

## 两次请求之间什么会留下来

在 handler **之外**创建的一切，都会伴随 worker 进程一直活着：自动加载器、DI 容器、编译好的路由、配置、已经建立的数据库和缓存连接、预热好的缓存。这正是 worker 模式的全部意义——这些开销你不用再每个请求付一遍了。

在 handler **之内**创建的一切，都是普通的单请求工作，handler 一返回、请求一收尾就被释放掉。

这条边界画在哪里，就是 worker 模式要求你做的那个设计决定。打算共享的状态放到最上面；只属于一个请求的状态留在 handler 里——或者在下一个请求到来之前重置掉。

::: warning
凡是全局的东西也一样是共享的，不管你是不是有意为之：静态属性、单例、某个库懒加载填进去的注册表、一个你从没撤销过的 `ini_set()`。在 php-fpm 下它们之所以是单请求级的，是因为 PHP 的请求关闭阶段会把它们重置——静态变量、全局变量和 `ini_set()` 都一样。Rapira 的 worker 特意跳过了两次请求之间的这次重置，所以它们不再是单请求级的了。
:::

## 选择插件

`create_plugin_handler()` 接收一个配置对象，而真正决定选用哪个插件的，是这个配置的*类*。`HttpHandlerConfig` 表示“这个 worker 提供 HTTP 服务”，换回来的就是一个 `HttpHandler`。

它在两种情况下会抛出 `Rapira\RapiraException`：没有插件匹配你传进来的配置类，以及脚本压根不在 worker 模式下运行——经典模式没有常驻循环，那里的 handler 除了报告“正在关闭”之外什么也做不了。

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

这五个状态说明 worker 正处在生命周期的哪个位置：**starting**——master 刚 fork 出它，它还没报到；**idle**——停着等请求，算作空闲容量；**active**——正在跑一个请求；**draining**——它已经决定退出（请求配额用完了，或者被标记为不健康），不再算作空闲容量；**free**——这个槽位上还没绑定 worker。

注意 `queued` 是接收队列此刻的深度，不是累计值；而每个计数都只属于当前这个进程：worker 启动时它们从零开始，所以顶替上来的新 worker 也是从零重新数。

拿它写一个小小的状态接口，是最顺手的用法：

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

**状态在请求之间泄漏。**这是最大的一个坑，应用在 worker 里出毛病、在 php-fpm 下却好好的，几乎总是因为它。一个越长越大的静态数组、一个被单例缓存住的请求对象、一个还攥着上个用户上下文的日志器——每一个都是只在第二个请求上才现形的 bug。在 handler 的开头或结尾显式清理，库留下的东西也一并重置。作为兜底，`pool.max_requests` 会让 worker 处理够 N 个请求后退出，由 master 换上一个全新的进程；它能把慢速泄漏的破坏圈住，但它是安全网，不是修复。

**没人认领的垃圾。**PHP 的引用计数会立刻释放掉大部分对象，但循环引用只有等循环回收器跑起来才清得掉。像上面那个标准脚本那样，每转一圈循环就调用一次 `gc_collect_cycles()`，这件事就固定在了一个可预期的时刻——发生在两次请求之间，而不是某个请求处理到一半的时候。

**永远结束不了的请求。**常驻 worker 会心安理得地卡在一个挂死的请求里出不来，而卡着的这段时间它谁也服务不了。`pool.request_terminate_timeout_secs` 给单个请求设了一个墙钟时间上限，超出就把这个 worker 杀掉。这两个键见[配置](/zh/docs/configuration)，worker 死掉之后 master 会怎么做，见[进程模型](/zh/docs/process-model)。

**未捕获的异常只影响单个请求，不影响整个 worker。**handler 里未捕获的异常会计入 `errors` 并以 `500` 应答，除非抛出之前 handler 已经把状态码提交出去了。无论哪种情况循环都照转不误：异常不会把 worker 一起带走，所以你在日志里读到的那次失败，未必真的中断了什么。致命错误则是另一回事：它会让常驻脚本直接终止，于是 worker 从头把它重新跑一遍，你的应用也随之重新启动——`recycles` 数的就是这件事。

**响应之后的活儿。**如果你想先把响应发出去、再接着干点别的——冲一下队列、写一条审计记录——`rapira_finish_request()` 干的正是这件事。说明在 [HTTP](/zh/docs/http) 页里。

## IDE 存根

Rapira 暴露给 PHP 的每一个类和函数，都声明在 [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) 里。它是这套 API 的权威声明——签名、属性类型、每个类是干什么的——同时还能当 IDE 存根用：把它丢进项目，编辑器就会给 `create_plugin_handler()`、`handleRequest()` 这些补全，而不是标红说未定义。

::: question 在 worker 模式下跑，需要专门的框架吗？
不需要——你需要的是一个经得起“只启动一次、然后处理很多请求”的应用。大多数现代框架都做得到，我们已经写成文的那几个，具体接法见[框架集成](/zh/docs/frameworks/)。
:::

::: question 循环里的 `gc_collect_cycles()` 是必须的吗？
不是必须，但作为默认习惯很好。不写它，循环引用就会一直堆着，直到 PHP 的回收器自己决定跑一趟——很可能正赶上你在应答某个请求。放在两次请求之间调用，这份开销就落在一个可预期的时刻。
:::

::: question 我的应用有丢不掉的全局状态，还能用 Rapira 吗？
能：用[经典模式](/zh/docs/classic)跑。你会失去 worker 那种“热启动”的好处，但仍然拿到一个可以直接顶替 php-fpm 的服务器；等把状态理顺了，再迁到 worker 也不迟。
:::
