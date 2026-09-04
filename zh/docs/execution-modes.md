---
title: 执行模式
description: "Rapira 的三种执行模式：Classic、Worker 和 Dispatcher 各自做什么、怎么选定一种，以及如何在 PHP 里读出当前模式。"
faqLevel: 2
---

# 执行模式

Rapira 使用三种执行模式之一运行 PHP。三种模式均可用。

| 模式 | 状态 | 说明 |
| --- | --- | --- |
| [Classic](/zh/docs/classic) | 已发布 | 每个请求都把入口脚本从头跑一遍，和在 php-fpm 下一样。 |
| [Worker](/zh/docs/worker) | 已发布 | 常驻脚本只启动一次，然后在循环里处理请求；每个请求都会重新填好超全局变量。 |
| Dispatcher | 已发布 | worker 通过一次 API 调用取出每个请求，把请求当成一个值来用，而不是读超全局变量。 |

这些名字既是配置文件里 `pool.mode` 的取值，也是 PHP 中 `Rapira\Mode` 枚举的各个 case。Classic 在每个请求结束时清除脚本创建的状态。Worker 和 Dispatcher 让同一个已启动的应用处理多个请求。应用的状态和 API 依赖决定它能使用哪些模式。

## Classic <Badge type="tip" text="已发布" />

每个请求都在新的 PHP 请求中运行入口脚本，其行为与 php-fpm 相同。Rapira 填充超全局变量并运行脚本。
然后，Rapira 发送响应并删除请求状态。持久连接和扩展状态保留在 worker 进程中。

现有应用可以在不更改代码的情况下运行。Rapira 将 PHP 嵌入服务器进程，不使用 FastCGI。

更多内容见 [Classic 模式](/zh/docs/classic)。

## Worker <Badge type="tip" text="已发布" />

Worker 使用与 Classic 相同的请求和响应接口。应用读取超全局变量，并可以使用 `echo`。
worker 在请求后保持运行。它初始化脚本一次，然后进入循环。
对于每个请求，Rapira 填充超全局变量并运行处理函数。循环外的对象保持可用。

应用为每个 worker 初始化一次，而不是为每个请求初始化。这可以减少请求执行时间。
静态属性、单例和全局状态会保留到下一个请求。
Rapira 可以在指定请求数后替换 worker。此替换可限制内存泄漏的影响。

worker 脚本和它的循环见 [Worker 模式](/zh/docs/worker)，回收阈值见[配置](/zh/docs/configuration)，请求与响应的处理方式见 [HTTP](/zh/docs/http)。

## Dispatcher <Badge type="tip" text="已发布" />

在 Dispatcher 模式下，worker 脚本通过 API 调用请求每个工作单元。`Rapira\get_dispatcher()` 返回进程池的 dispatcher。
`receive(int $timeout = -1)` 等待下一个单元。超时单位为微秒，`-1` 禁用超时。
超时后会抛出 `Rapira\Exception\TimeoutException`。`tryReceive()` 不等待，直接返回单元或 `null`。
使用 HTTP 插件时，每个单元是 `Rapira\Http\Exchange`。
其 `getRequest()` 方法返回包含方法、目标、请求头、请求体和地址的 `Rapira\Http\Request`。
`writeHead()`、`writeBody()` 和 `sendFile()` 方法写入响应。

应用可以将请求对象传给函数或中间件。Rapira 在此模式下不填充超全局变量。
读取超全局变量的应用需要 Worker。也可以使用适配器复制请求数据。
通过 `pool.mode` 或 `--mode` 选择模式。

脚本控制活动工作单元的数量。顺序循环每次处理一个单元。
它调用 `receive()`，响应请求，然后再次调用 `receive()`。
并发脚本为每个请求启动一个 [Fiber](https://www.php.net/manual/en/language.fibers.php)。存在活动 fiber 时，它调用 `tryReceive()`。
没有活动 fiber 时，循环在 `receive()` 中等待。如果库不支持 fiber，请一次处理一个单元。

::: info
Dispatcher 是 `pool.mode` 的默认值。专用指南尚不可用。
[`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) 说明 `Dispatcher` 和 `Work` 接口。
[`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_http.stub.php) 说明 HTTP 类型。
[`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) 目录包含 `dispatcher-sync.php` 和 `dispatcher-async.php`。
:::

## 在运行时读出模式

`Rapira\get_mode()` 将进程模式作为 `Rapira\Mode` case 返回。case 包括 `Classic`、`Worker` 和 `Dispatcher`。
case 与初始 `pool.mode` 相同，并且在进程期间不会更改。使用 `===` 比较 case。
此函数不接受参数，也不抛出异常。入口脚本可以使用它支持多个模式：

```php
<?php
// entry.php

use Rapira\Mode;

$app = require __DIR__ . '/bootstrap.php';

match (\Rapira\get_mode()) {
    Mode::Classic => $app->handleOnce(),
    Mode::Worker => $app->runWorkerLoop(),
    Mode::Dispatcher => $app->runDispatcherLoop(),
};
```

::: question 为什么进程跑起来之后模式就不会变了？
宿主读取 `pool.mode`，并在启动解释器前固定模式。worker 的所有请求都返回相同 case。
更改模式需要重启服务器。
:::

## 模式选择

`pool.mode` 的默认值是 `dispatcher`。要显式指定模式，就写进 `rapira.toml`，或者在命令行上用 `--mode`。

```toml
[pool]
entrypoint = "public/index.php"
mode = "classic"                      # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
```

```sh
rapira serve --mode classic public/index.php
```

Rapira 向每个应用提供三种模式。应用代码和依赖项可能限制选择。
全局状态无法在请求之间保留时，请使用 Classic。使用超全局变量的代码需要适配器才能使用 Dispatcher。
部分框架集成支持 Worker。请参阅[框架集成](/zh/docs/frameworks/)。

模式适用于整个服务器实例，而不是单独路由。一个实例不能使用不同模式。
请在单独的 Classic 实例中运行不兼容的路由。

Worker 和 Dispatcher 需要持久入口脚本。Classic 不需要。
要选择 Classic，请设置 `mode = "classic"` 或传入 `--mode classic`。然后指定普通入口脚本。
服务器、二进制文件和[进程模型](/zh/docs/process-model)不变。
更多信息请参阅[配置](/zh/docs/configuration)和[命令行参考](/zh/docs/cli)。

::: tip
替换 php-fpm 时，先使用 Classic。验证应用是否正常运行。
验证初始化和请求状态后，再选择 Worker。
:::
