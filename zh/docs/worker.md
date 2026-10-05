---
title: Worker 模式
description: "Rapira worker 循环、handle_request() 契约、持久状态和常见错误。"
faqLevel: 2
---

# Worker 模式

Worker 模式使 PHP 进程在请求之间保持活动。脚本初始化应用一次，然后在循环中等待请求。应用状态保留在内存中，因此 worker 脚本必须管理此状态。

在 [Classic 模式](/zh/docs/classic)下，入口脚本每次都在新的 PHP 请求中运行，Rapira 在响应后删除应用状态。此状态包括自动加载器、容器、配置、路由和数据库连接。

Worker 模式不要求特定框架。它要求应用能在一次初始化后处理多个请求。要选择模式，请参阅[执行模式](/zh/docs/execution-modes)。有关框架指南，请参阅[框架集成](/zh/docs/frameworks/)。

## 常驻循环

worker 脚本包含三个部分。第一部分初始化应用。第二部分定义单个请求的 handler。第三部分在循环中调用 `\Rapira\handle_request()`，直到 worker 停止。

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

Dispatcher 是默认模式。在 `rapira.toml` 的 `[http.pool]` 表里写 `mode = "worker"` 来选择 Worker 模式：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/worker.php"
mode = "worker"
```

```bash
rapira serve rapira.toml
```

其余的键见[配置](/zh/docs/configuration)。

## `handle_request()` 的契约

`\Rapira\handle_request(callable $handler): bool` 有以下契约：

- **等待**请求分配到此 worker。等待期间，worker 不使用 CPU。
- **填充请求数据**到 `$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE`、`$_FILES` 和 `$_REQUEST`，然后运行 handler。代码可以像在 php-fpm 中一样读取这些超全局变量。
- **调用 handler 时不传参数。**函数签名使用 `function (): void`。使用 `use` 捕获容器、日志器等依赖项。Rapira 忽略返回值。
- **handler 输出就是响应。**handler 可以使用 `echo`、`print`、`header()`、`http_response_code()` 和 `setcookie()`。有关请求和响应处理，请参阅 [HTTP](/zh/docs/http)。
- **每个请求后返回 `true`。**worker 开始停止时返回 `false`。返回 `false` 时结束循环和脚本。
- **只能从脚本的顶层循环调用。**从 handler 内部调用会抛出 `\Error`。不要从 shutdown 函数或析构函数调用。

Worker 模式中的一个请求对应 `while` 循环的一次迭代。每次调用 handler 之前，Rapira 重新填充超全局变量。调用之后，Rapira 运行请求的 shutdown 函数，刷新输出缓冲，并关闭 session。脚本在 handler 外持有的值保留在内存中。

在第一次调用 `handle_request()` 之前，`$_SERVER` 包含进程环境和入口脚本路径，与 PHP CLI 下相同。完整列表请参阅[执行模式](/zh/docs/execution-modes)。

## 每个 worker 一个循环

worker 脚本运行一个循环和一个 handler。在下面的示例中，第二个循环只在第一个循环结束后运行，而第一个循环只在停止时结束。使用一个 handler 分配所有请求。

```php
while (\Rapira\handle_request($api)) {
}

// Code reaches this loop only during shutdown.
while (\Rapira\handle_request($web)) {
}
```

## 请求之间保留的状态

在 handler **之外**创建的对象会保留到 worker 周期结束。例如自动加载器、容器、路由、配置、打开的连接和缓存数据。Rapira 不会为每个请求创建这些状态。

在 handler **之内**创建的值属于一个请求。handler 返回且代码删除最后一个引用后，PHP 释放这些值。

worker 脚本定义状态的生命周期。将应用状态放在循环之前。将请求状态放在 handler 中，或在下一个请求之前重置。

::: warning
全局状态也会保留在请求之间。例如静态属性、单例、注册表和 `ini_set()` 更改。php-fpm 在每个请求结束时丢弃这些值。Rapira worker 保留这些值。

如果应用无法重置全局状态，请使用 [Classic 模式](/zh/docs/classic)。Classic 模式是兼容的 php-fpm 替代方案。修正全局状态后，再选择 Worker 模式。
:::

## shutdown 函数

worker 周期是 worker 脚本的一次运行，从初始化到脚本结束。初始化代码注册的每个 shutdown 函数在周期结束时运行一次。handler 注册的每个 shutdown 函数在该请求结束时运行一次。

在初始化期间注册进程资源的清理。在 handler 内注册请求资源的清理。

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

周期结束时，初始化注册先按注册顺序运行。循环之后注册的函数在它们之后运行。

对象使用不同的规则。Rapira 不会在请求结束时运行所有析构函数。代码删除对象的最后一个引用后，PHP 才销毁该对象。因此，handler 返回时 PHP 销毁 handler 中的对象。初始化期间创建的全局对象保留在请求之间。它的 `__destruct()` 方法在周期结束时运行一次。

::: question 为什么初始化注册的 shutdown 函数不在第一个请求后运行？
PHP 将 shutdown 函数存储在请求状态中。请求关闭过程调用这些函数，然后释放列表。第一次调用 `handle_request()` 时，Rapira 移除并保存初始化注册，因此每个请求只有自己的注册。周期结束时，Rapira 恢复保存的列表，并添加循环之后的注册。
:::

## 只在 Worker 模式下可用

`handle_request()` 需要只有 Worker 模式才有的常驻循环。在 Classic 模式和 Dispatcher 模式下，它抛出 `Rapira\Exception\NotInWorkerModeError`。所有 Rapira 异常类都实现标记接口 `Rapira\Exception\RapiraThrowable`。一些使用错误是普通的 `\Error` 或 `\ValueError`，捕获 `RapiraThrowable` 的 `catch` 不会捕获它们。例如在 handler 内部调用 `handle_request()`。

`Rapira\get_mode()` 以 `Rapira\Mode` 的 case 返回当前进程的[模式](/zh/docs/execution-modes)。在多种模式下运行的脚本在进入循环之前读取它：

```php
if (\Rapira\get_mode() === \Rapira\Mode::Worker) {
    while (\Rapira\handle_request($handler)) {
    }
}
```

## 常见问题

**请求状态保留在请求之间。**如果应用只在 Worker 模式下失败，请检查保留的请求状态。例如不断增长的静态数组、单例中的请求对象或日志器中的旧用户数据。

在 handler 开始或结束时重置此状态。还要重置库中的请求状态。worker 处理的请求数超过 `http.pool.max_requests` 后，Rapira 替换该 worker。它限制内存泄漏的影响，但不会修复泄漏。

**未回收的循环引用。**PHP 引用计数会立即释放大多数值。只有循环回收器运行时，PHP 才会释放循环引用。示例在请求之间调用 `gc_collect_cycles()`。此调用是可选的，但可以使回收时间可预测。

**无法完成的请求。**当前请求运行时，worker 无法处理其他请求。`http.pool.request_terminate_timeout_secs` 限制一个请求的经过时间。请求超过此限制时，Rapira 停止该 worker 并启动新的 worker。有关此键和 `http.pool.max_requests`，请参阅[配置](/zh/docs/configuration)。有关停止顺序，请参阅[进程模型](/zh/docs/process-model)。

**初始化失败。**worker 脚本必须调用 `handle_request()` 并收到请求。初始化期间未捕获的异常可能在此之前结束脚本。Rapira 将此计为一次启动失败。然后 worker 最多等待 5 秒接收请求，以 `503` 回答它，并再次运行脚本。

连续五次启动失败后，Rapira 记录 `worker keeps failing to boot; flagged unhealthy`，worker 退出。master 在延迟后启动新的 worker。服务器启动时，如果进程池中没有 worker 完成启动或处理过请求，服务器改为以[退出码](/zh/docs/cli#退出码) 70 停止。有关 worker 监管，请参阅[进程模型](/zh/docs/process-model)。

**未捕获的异常影响一个请求，不影响 worker。**如果 handler 抛出异常，Rapira 先调用 `set_exception_handler()` 注册的回调。如果没有回调处理该异常，Rapira 返回 `500`，除非 handler 已经发送响应头。在这两种情况下，循环都会继续。handler 中调用 `exit()` 或 `die()` 只结束当前请求，Rapira 将输出作为响应发送。致命错误会结束 worker 脚本，Rapira 以新的初始化再次运行脚本。

**响应后的工作。**`rapira_finish_request()` 在 handler 结束前发送响应。之后，handler 可以执行更多工作，例如写入审计记录。有关详细信息，请参阅 [HTTP](/zh/docs/http)。

## IDE 存根

Rapira 在 `crates/sapi` 和 `crates/plugins` 下的存根文件中声明其 PHP 函数和类。worker API 位于 [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php)。共享异常类位于 [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira_exception.stub.php)。这些文件声明签名、属性类型和类用途。将它们添加到项目，以启用 `\Rapira\handle_request()`、`\Rapira\get_mode()` 和其他 API 的 IDE 补全。
