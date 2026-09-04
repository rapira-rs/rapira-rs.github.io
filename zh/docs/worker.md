---
title: Worker 模式
description: "Rapira worker 循环、handle_request() 契约、持久状态和常见错误。"
faqLevel: 2
---

# Worker 模式

Worker 模式使 PHP 进程在请求之间保持活动。脚本初始化应用一次，然后在循环中等待请求。
应用状态也保留在内存中，因此 worker 脚本必须管理此状态。

在 [Classic 模式](/zh/docs/classic)下，每次请求都在新的 PHP 请求中运行入口脚本。服务器在响应后删除应用状态。
此状态包括自动加载器、容器、配置、路由和数据库连接。

本页是 Worker 模式的编程指南。Worker 模式不要求特定框架。
应用必须能在一次初始化后处理多个请求。
有关模式要求，请参阅[执行模式](/zh/docs/execution-modes)。有关特定框架的指南，请参阅[框架集成](/zh/docs/frameworks/)。

## 常驻循环

worker 脚本包含三个部分。第一部分初始化应用。
第二部分定义单个请求的 handler。第三部分运行 handler，直到 worker 停止。
在 PHP 循环中使用 `\Rapira\handle_request()`。

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

Dispatcher 是默认模式。使用以下任一设置选择 Worker 模式：

- 命令行上加 `--mode worker`，紧挨着入口脚本。
- 在 `rapira.toml` 的 `[pool]` 段里写 `mode = "worker"`。

```bash
rapira serve --mode worker app/worker.php
```

其余命令行参数见[命令行](/zh/docs/cli)，它们在 `rapira.toml` 里对应的写法见[配置](/zh/docs/configuration)。

## `handle_request()` 的契约

`\Rapira\handle_request(callable $handler): bool` 有以下契约：

- **等待**请求分配到此 worker。等待期间，worker 不使用 CPU。
- worker 在内存中保留解释器和已初始化的应用。
- **填充超全局变量** `$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE` 等，然后运行 handler。
- 普通 PHP 代码可以像在 php-fpm 中一样读取这些变量。
- **调用 handler 时不传参数。**请求数据位于超全局变量中。函数签名是 `function (): void`。
- 使用 `use` 捕获容器、日志器和其他依赖项。
- **将 handler 输出用作响应。**handler 可以使用 `echo`、`print`、`header()`、`http_response_code()` 和 `setcookie()`。
- 有关请求和响应处理，请参阅 [HTTP](/zh/docs/http)。
- **请求完成后返回 `true`**，因此循环继续。worker 开始停止时返回 **`false`**。
- 返回 `false` 时结束循环和脚本。
- **只能从脚本的顶层循环调用。**不要从 shutdown 函数或析构函数调用。

Worker 模式中的一个请求对应 `while` 循环的一次迭代。Rapira 在 handler 外完成请求关闭。
服务器运行请求的 shutdown 函数，刷新输出缓冲，关闭 session，然后重新填充超全局变量。
handler 外的值保留在内存中。Rapira 不会在请求结束时运行所有析构函数。
代码删除对象的最后一个引用后，PHP 才销毁该对象。

## 每个 worker 只有一个 handler

`handle_request()` 在每个请求后返回。worker 脚本必须提供使 worker 保持活动的循环。

worker 脚本一次运行一个 handler。第二个连续循环只能在第一个循环结束后运行。
第一个循环在 `handle_request()` 返回 `false` 时结束。此时 worker 正在停止。
在一个 handler 中分配请求，不要使用多个循环。

```php
while (\Rapira\handle_request($api)) {
}

// Code reaches this loop only during shutdown.
while (\Rapira\handle_request($web)) {
}
```

## 请求之间的状态

在 handler **之外**创建的对象会保留到 worker 结束。
例如自动加载器、容器、路由、配置、打开的连接和缓存数据。Rapira 不会为每个请求重新创建这些状态。

在 handler **之内**创建的值属于一个请求。handler 返回且最后一个引用消失后，PHP 会释放这些值。

worker 脚本定义状态的生命周期。将共享状态放在循环之前。
将请求状态放在 handler 中，或在下一个请求之前重置。

::: warning
全局状态也会保留在请求之间。例如静态属性、单例、注册表和持续的 `ini_set()` 更改。
php-fpm 在请求关闭时重置这些值。Rapira worker 不会重置这些值。
如果应用无法重置全局状态，请使用 [Classic 模式](/zh/docs/classic)。Classic 模式可以替代 php-fpm。
修正共享状态后，再选择 Worker 模式。
:::

## shutdown 函数

初始化期间注册的 shutdown 函数在 worker 循环结束时运行一次。它不会在每个请求后运行。
handler 注册的 shutdown 函数在该请求结束时运行一次。

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

对象使用不同的规则。Rapira 不会在请求结束时运行所有析构函数。
代码删除对象的最后一个引用后，PHP 才销毁该对象。因此，handler 返回时会销毁其局部对象。
初始化期间创建的全局对象保留在请求之间。它的 `__destruct()` 方法在循环结束时运行一次。

::: question 为什么启动阶段注册的 shutdown 函数不会在第一个请求结束时跑？
PHP 将 shutdown 函数存储在请求状态中。请求关闭过程调用这些函数，然后释放列表。
第一次调用 `handle_request()` 时，Rapira 会移除并保存初始化注册。之后，每个请求只包含自己的注册。
循环结束时，Rapira 恢复保存的列表。然后，它添加循环后的注册。
最终关闭过程先按顺序运行初始化注册，然后运行后续注册。
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

## 常见问题

**请求之间保留的状态。**如果应用只在 Worker 模式下失败，请检查保留的请求状态。
例如不断增长的静态数组、单例中的请求对象或日志器中的旧用户数据。
在 handler 开始或结束时重置此状态。还要重置库中的请求状态。
`pool.max_requests` 在指定请求数后替换 worker。它限制内存泄漏的影响，但不会修复泄漏。

**未回收的循环引用。**PHP 引用计数会立即释放大多数值。只有循环回收器运行时，PHP 才会释放循环。
示例在请求之间调用 `gc_collect_cycles()`。此调用是可选的，但可以使回收时间可预测。

**无法完成的请求。**当前请求运行时，worker 无法处理其他请求。
`pool.request_terminate_timeout_secs` 限制一个请求的运行时间。Rapira 会终止超过此值的 worker。
有关此设置和 `pool.max_requests`，请参阅[配置](/zh/docs/configuration)。有关终止处理，请参阅[进程模型](/zh/docs/process-model)。

**未捕获的异常影响一个请求，不影响 worker。**未捕获的 handler 异常通常返回 `500`。
handler 发送响应头后，Rapira 无法更改状态。
循环继续，因此异常不会停止 worker。致命错误会结束常驻脚本。
然后，worker 重新运行脚本并初始化应用。

**响应后的工作。**`rapira_finish_request()` 在 handler 结束前发送响应。之后，handler 可以写入审计记录。
有关详细信息，请参阅 [HTTP](/zh/docs/http)。

## IDE 存根

Rapira 在 `crates/php_sys` 的存根文件中声明 PHP 函数和类。worker API 位于 [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php)。
异常类位于 [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_exception.stub.php)。这些文件定义签名、属性类型和类用途。
它们也可以用作 IDE 存根。将它们添加到项目以启用 Rapira API 补全。
