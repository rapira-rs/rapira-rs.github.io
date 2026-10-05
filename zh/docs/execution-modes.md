---
title: 执行模式
description: "Rapira 的三种执行模式：Classic、Worker 和 Dispatcher 各自做什么、怎么选定一种，以及如何在 PHP 里读出当前模式。"
faqLevel: 2
---

# 执行模式

HTTP 进程池使用三种执行模式之一运行 PHP。[gRPC 进程池](./grpc)使用 Dispatcher 模式。

| 模式 | 说明 |
| --- | --- |
| [Classic](/zh/docs/classic) | 入口脚本每次都在新的 PHP 请求中运行，与 php-fpm 相同。 |
| [Worker](/zh/docs/worker) | 常驻脚本在循环里处理请求。Rapira 为每个请求重新填充超全局变量。 |
| [Dispatcher](/zh/docs/dispatcher) | worker 通过 API 调用取得每个请求，并使用请求对象，而不是超全局变量。 |

这些名字既是配置文件里 `http.pool.mode` 的取值，也是 PHP 中 `Rapira\Mode` 枚举的各个 case。Classic 在每个请求结束时清除应用的请求状态。Worker 和 Dispatcher 让同一个已初始化的应用处理多个请求。应用的状态和 API 依赖决定它能使用哪些模式。

## Classic

每个请求都在新的 PHP 请求中运行入口脚本，其行为与 php-fpm 相同。Rapira 填充超全局变量，运行脚本，发送响应，然后删除请求状态。持久连接和扩展状态会保留，因为它们存在于 worker 进程中。

用 Rapira 替换 php-fpm 时，现有应用可以在不更改代码的情况下运行。Rapira 将 PHP 嵌入服务器进程，不使用 FastCGI。

更多内容见 [Classic 模式](/zh/docs/classic)。

## Worker

Worker 模式使用与 Classic 相同的请求和响应接口。应用读取超全局变量，并可以使用 `echo` 输出响应。worker 脚本初始化应用一次，然后进入循环。对于每个请求，Rapira 重新填充超全局变量并运行处理函数。脚本在循环外创建的对象保持可用。

初始化为每个 worker 运行一次，而不是为每个请求运行一次。这可以减少请求时间。但是，静态属性、单例和全局状态会保留到下一个请求。设置 [`http.pool.max_requests`](/zh/docs/configuration)，在处理一定数量的请求后替换 worker。这可以限制内存泄漏的影响。

worker 脚本和它的循环见 [Worker 模式](/zh/docs/worker)。请求与响应的处理方式见 [HTTP](/zh/docs/http)。

## Dispatcher

在 Dispatcher 模式下，worker 脚本通过 API 调用取得每个工作单元。`Rapira\get_dispatcher()` 返回进程池的 dispatcher，它的 `receive()` 方法等待下一个单元。使用 HTTP 插件时，每个单元是 `Rapira\Http\Exchange`。exchange 提供一个 `Rapira\Http\Request` 对象，并有写入响应的方法。使用 gRPC 插件时，每个单元是 `Rapira\Grpc\UnaryCall`。

应用可以将请求对象传给函数或中间件。Rapira 在此模式下不填充超全局变量。读取超全局变量的应用需要 Worker 模式，或者需要一个把请求数据复制到这些变量的适配器。`echo` 和其他 PHP 输出不会发给客户端。Rapira 把这些输出以 `info` 级别写入 `php` 目标的日志。

每个 worker 一次处理一个工作单元。再次调用 `receive()` 之前，先完成当前单元。要同时处理更多请求，请增大 `http.pool.processes`。

循环、请求与响应 API 以及异常见 [Dispatcher 模式](/zh/docs/dispatcher)。gRPC 调用 API 见 [gRPC](/zh/docs/grpc)。

## 第一个请求之前的 `$_SERVER`

在 Worker 和 Dispatcher 模式下，入口脚本在第一个请求之前启动。此时，Rapira 按照 PHP CLI 执行 `php entrypoint.php` 时的方式填充 `$_SERVER`。

| 键 | 值 |
| --- | --- |
| 每个进程环境变量 | 环境中的值 |
| `PHP_SELF`、`SCRIPT_NAME`、`SCRIPT_FILENAME`、`PATH_TRANSLATED` | 入口脚本的绝对路径 |
| `DOCUMENT_ROOT` | 空字符串 |
| `REQUEST_TIME`、`REQUEST_TIME_FLOAT` | 入口脚本的启动时间 |
| `argv` | 包含入口脚本绝对路径的列表 |
| `argc` | `1` |

当 `variables_order` 包含 `S` 时，`$_SERVER` 获得环境变量。只有当 `variables_order` 包含 `E` 时，`$_ENV` 才获得环境变量。生产值 `GPCS` 不包含 `E`。入口脚本路径会替换同名的环境变量，例如 `SCRIPT_FILENAME`。全局变量 `$argv` 和 `$argc` 包含与 `$_SERVER` 相同的值。

在 Dispatcher 模式下，`$_SERVER` 保留这些值，直到入口脚本再次启动。请求数据在请求对象中。在 Worker 模式下，Rapira 为每个请求用请求数据重新填充 `$_SERVER`。请求值不包含环境变量，`SCRIPT_NAME` 包含带前导斜杠的入口脚本名称。

## 在运行时读出模式

`Rapira\get_mode()` 将进程模式作为 `Rapira\Mode` 枚举 case 返回。case 包括 `Classic`、`Worker` 和 `Dispatcher`。case 是该 worker 所属进程池的模式，进程运行期间不会更改。此函数不接受参数，也不抛出异常。入口脚本可以使用它支持多个模式。

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
Rapira 在启动解释器之前读取进程池的模式。该 worker 中的每个请求都返回相同的 case。重载不会再次读取 `rapira.toml`。要更改模式，请重启 Rapira。
:::

## 模式选择

进程池表的 `mode` 键选择模式。默认值是 `dispatcher`。请在 `rapira.toml` 中显式设置模式。

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"                      # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
```

```sh
rapira serve rapira.toml
```

HTTP 进程池支持三种模式。gRPC 进程池只支持 `dispatcher`。`grpc.pool.mode` 使用其他值时，Rapira 在启动时报错并停止。

在 Worker 和 Dispatcher 模式下，入口脚本必须在循环中取得请求。如果脚本在取得请求之前结束，启动会失败。在默认模式下，普通的 php-fpm 入口脚本会以这种方式失败。启动失败后 Rapira 的行为见[进程模型](/zh/docs/process-model)。

应用代码和依赖项可能限制选择。全局状态不能在请求之间保留时，请使用 Classic。读取超全局变量的代码没有适配器就不能使用 Dispatcher。部分框架集成支持 Worker 模式。已有文档的集成见[框架集成](/zh/docs/frameworks/)。

模式适用于整个进程池，因此进程池中的所有路由使用相同模式。HTTP 和 gRPC 进程池可以在同一个服务器中使用不同模式。请在单独的 Classic 模式 Rapira 实例中运行不兼容的 HTTP 路由。更多信息请参阅[配置](/zh/docs/configuration)和[命令行参考](/zh/docs/cli)。

::: tip
替换 php-fpm 时，先使用 Classic。验证应用是否正常运行。确认应用正确初始化且不保留请求状态后，再选择 Worker。
:::
