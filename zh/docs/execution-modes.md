---
title: 执行模式
description: "Rapira 的三种执行模式：Classic、Worker 和 Dispatcher 各自做什么、怎么选定一种，以及如何在 PHP 里读出当前模式。"
faqLevel: 2
---

# 执行模式

Rapira 用三种执行模式之一来运行 PHP，三种今天都已经发布。

| 模式 | 状态 | 说明 |
| --- | --- | --- |
| [Classic](/zh/docs/classic) | 已发布 | 每个请求都把入口脚本从头跑一遍，和在 php-fpm 下一样。 |
| [Worker](/zh/docs/worker) | 已发布 | 常驻脚本只启动一次，然后在循环里处理请求；每个请求都会重新填好超全局变量。 |
| Dispatcher | 已发布 | worker 通过一次 API 调用取出每个请求，把请求当成一个值来用，而不是读超全局变量。 |

这些名字既是配置文件里 `pool.mode` 的取值，也是 PHP 中 `Rapira\Mode` 枚举的各个 case。Classic 在每个请求结束时清除脚本创建的状态。Worker 和 Dispatcher 让同一个已启动的应用处理多个请求。应用的状态和 API 依赖决定它能使用哪些模式。

## Classic <Badge type="tip" text="已发布" />

每个请求都会从头运行入口脚本，和 php-fpm 完全一样。Rapira 填充超全局变量、启动入口脚本、发送响应并删除请求状态。脚本创建的内容不会留到下一个请求，因此应用状态不会泄漏。例外情况与 php-fpm 相同。持久连接和扩展级状态位于 worker 进程中，不属于某一个请求。

现有应用原封不动就能跑，因为 Rapira 直接顶替 php-fpm，你的代码一行都不用改。PHP 嵌在服务器进程里，HTTP 接入层和解释器之间不再有 FastCGI 这一跳。

更多内容见 [Classic 模式](/zh/docs/classic)。

## Worker <Badge type="tip" text="已发布" />

Worker 模式的写法和 Classic 一样：照样读超全局变量，照样用 `echo` 输出响应。区别只在于请求结束后 worker 不会被销毁。一个常驻脚本先把一切启动好，然后进入循环：服务器为每个新请求重新填好 `$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE` 之类的变量，调用你的处理逻辑，再把下一个请求交给你。自动加载器、DI 容器、配置、数据库连接，循环之外创建的一切都保持在热状态。

启动只在每个 worker 上跑一次，而不是每个请求都跑一次，而对今天的应用来说，这次启动往往是整个请求里最贵的一步。进程不再每次都从干净状态开始，所以你留在静态属性、单例或全局状态里的东西，下一个请求还在那儿。Rapira 可以在处理够一定数量的请求后回收 worker，这样应用或它的某个依赖里的缓慢泄漏，就不会在你排查期间演变成一次线上故障。

worker 脚本和它的循环见 [Worker 模式](/zh/docs/worker)，回收阈值见[配置](/zh/docs/configuration)，请求与响应的处理方式见 [HTTP](/zh/docs/http)。

## Dispatcher <Badge type="tip" text="已发布" />

Dispatcher 模式把调用方向反了过来：worker 脚本不再等着被调用，而是通过一次 API 调用向 Rapira 要下一个工作单元。`Rapira\get_dispatcher()` 返回进程池提供的那个 dispatcher。`receive(int $timeout = -1)` 等待下一个工作单元，超时以微秒计：默认值 `-1` 表示一直等下去；给出一个有限的超时值时，等待时间一到就抛出 `Rapira\Exception\TimeoutException`。`tryReceive()` 要么立刻返回下一个工作单元，要么返回 `null`，它从不等待。在 HTTP 插件上，一个工作单元就是一个 `Rapira\Http\Exchange`：它的 `getRequest()` 返回一个 `Rapira\Http\Request` 对象，带着方法、目标、请求头、请求体和两端地址；写响应则用它的 `writeHead()`、`writeBody()` 和 `sendFile()`。

请求在这里是一个值，可以传给函数、可以包装、也可以丢给一整条中间件链。这个模式不填超全局变量，所以直接读 `$_GET` 或 `$_SERVER` 的应用需要改用 Worker 模式，或者加一个适配器，把请求对象转成应用期待的形状。模式由 `pool.mode` 或 `--mode` 决定，不由应用代码决定。

同时手上握着多少个工作单元，由脚本自己说了算。一个普通循环一次只处理一个：调用 `receive()`，应答请求，再调用 `receive()`。同一套 API 也允许脚本同时握住好几个。这样的脚本会给每个请求开一个 [Fiber](https://www.php.net/manual/en/language.fibers.php)，只要还有 fiber 在跑就用 `tryReceive()` 轮询，一个 fiber 都不剩时再停在 `receive()` 上。这样一个解释器里就能同时推进好几个请求。这里的并发是协作式的：只有正在跑的代码挂起自己的 fiber，别的请求才有机会往前走，所以某个库要是不支持 fiber，脚本就只能一次处理一个工作单元。

::: info
Dispatcher 是 `pool.mode` 的默认值。它专门的指南还没有写。目前 PHP 侧的 API 记录在 IDE 存根文件里：`Dispatcher` 和 `Work` 接口在 [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php)，HTTP 相关类型在 [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_http.stub.php)；[`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) 里还有两个能直接跑的脚本：`dispatcher-sync.php` 和 `dispatcher-async.php`。
:::

## 在运行时读出模式

`Rapira\get_mode()` 返回宿主启动这个进程时所用的模式，取值是 `Rapira\Mode` 枚举的一个 case。`Mode` 是纯枚举，三个 case：`Classic`、`Worker` 和 `Dispatcher`。它就是进程启动时的那个 `pool.mode`，在进程的一生里不会变。枚举 case 是单一对象，所以用 `===` 比较。这个函数不接受参数，也从不抛异常，因此可以放心地写在一个要服务于多种模式的入口脚本的开头：

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
宿主在启动时读取 `pool.mode`，并在启动解释器之前就把模式定死，所以一个 worker 的第一个请求和最后一个请求报出来的是同一个 case。要换模式，就得重启服务器。
:::

## 模式选择

`pool.mode` 的默认值是 `dispatcher`。要显式指定模式，就写进 `rapira.toml`，或者在命令行上用 `--mode`。

```toml
[pool]
entrypoint = "public/index.php"
mode = "classic"                      # "classic" | "worker" | "dispatcher" (the default)
```

```sh
rapira serve --mode classic public/index.php
```

三种模式对任何应用都敞开着，真正设限的是应用自己的技术栈。撑不过第二个请求的全局状态会把应用留在 Classic；直接读超全局变量的代码在补上适配器之前用不了 Dispatcher；而提供了运行时集成的框架，几乎不用额外工作就能用上 Worker 模式，哪些框架已经有成文的集成方案，见[框架集成](/zh/docs/frameworks/)。

模式是按服务器实例选的，不是按路由选的，所以同一个实例没法让一部分路由走 worker、其余走 Classic。如果应用里有一部分不是 worker 安全的，就为它单独起一个跑在 Classic 模式下的 Rapira 实例。

Worker 和 Dispatcher 模式需要一个常驻入口脚本，Classic 模式不需要。要切换回 Classic 模式，请在配置文件中设置 `mode = "classic"`，或传入 `--mode classic`。然后让 Rapira 指向原来的入口脚本。服务器、二进制文件和[进程模型](/zh/docs/process-model)保持不变。更多细节见[配置](/zh/docs/configuration)和[命令行参考](/zh/docs/cli)。

::: tip
如果你只是想替掉 php-fpm、先让一切跑起来，那就从 Classic 起步。等确认应用启动干净、也没有在请求之间留下不该留的状态，再切换到 Worker。
:::
