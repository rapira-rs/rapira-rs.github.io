---
title: 什么是 Rapira？
description: Rapira 是一个用 Rust 编写的 PHP 应用服务器。它支持 Classic、Worker 和 Dispatcher 模式。
---

# 什么是 Rapira

Rapira 是一个用 Rust 编写的 PHP 应用服务器。

RoadRunner 维护者设计并开发 Rapira。Rapira 在服务器进程中直接调用 PHP。

Rapira 支持 HTTP 和 [gRPC](/zh/docs/grpc)。每种协议都有自己的监听器和 PHP worker 进程池。

[博客](/zh/blog/)包含项目更新。

## HTTP

Rapira 包含一个使用 [hyper](https://hyper.rs) 库的 HTTP 服务器。它接受明文 HTTP/1.1 和 HTTP/1.0 连接。Rapira 不终结 TLS。[TLS 终止代理](https://en.wikipedia.org/wiki/TLS_termination_proxy)接受客户端的 HTTPS，解密连接，然后向 Rapira 发送明文 HTTP。代理配置见[生产环境部署](/zh/docs/deployment)。

Rapira 支持三种 PHP 执行模式：

- Classic：Rapira 为每个请求初始化应用，行为与 php-fpm 相同。
- Worker：Rapira 初始化应用一次。循环处理请求，Rapira 为每个请求重新填充 PHP 超全局变量。
- Dispatcher：Rapira 初始化应用一次。脚本通过 API 调用获取请求对象。每个 worker 一次处理一个请求。

::: info
[执行模式](/zh/docs/execution-modes)页面介绍模式行为和选择标准。
:::

## gRPC

Rapira 在一个监听器上处理一元 gRPC、gRPC-Web 和 Connect 调用。PHP 应用通过 dispatcher 接收并返回二进制 protobuf 消息。master 在 worker 启动前从描述符集加载服务模式定义。

gRPC 进程池使用 Dispatcher 模式。HTTP 和 gRPC 可以使用不同的入口脚本同时运行。完整的服务、protobuf 类生成和客户端命令请参阅 [gRPC](/zh/docs/grpc)。

## 指标和健康检查

可选的 `[observability]` 表会再启动一个进程，该进程不运行 PHP。`[observability.metrics]` 子表在 `/metrics` 上启用 Prometheus 指标。`[observability.probes]` 子表启用 `/livez` 和 `/readyz` 探针。配置和端点请参阅[指标和健康检查](/zh/docs/observability)。
