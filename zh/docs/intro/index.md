---
title: 什么是 Rapira？
description: Rapira 是一个用 Rust 编写的 PHP 应用服务器。它支持 Classic、Worker 和 Dispatcher 模式。
---

# 什么是 Rapira

Rapira 是一个用 Rust 编写的 PHP 应用服务器。

RoadRunner 维护者设计并开发 Rapira。Rapira 在服务器进程中直接调用 PHP。

Rapira 目前支持 HTTP。项目计划支持更多 RoadRunner 插件功能。
[博客](/zh/blog/)包含项目更新。

## HTTP

Rapira 包含一个使用 [hyper](https://hyper.rs) 库的 HTTP 服务器。它直接接受明文 HTTP 连接。
该服务器不终结 TLS。[TLS 终止代理](https://en.wikipedia.org/wiki/TLS_termination_proxy)接受客户端的 HTTPS，解密连接，然后向 Rapira 发送明文 HTTP。
代理配置见[生产环境部署](/zh/docs/deployment)。

Rapira 支持三种 PHP 执行模式：

- Classic：Rapira 为每个请求初始化应用，行为与 php-fpm 相同。
- Worker：Rapira 初始化应用一次。循环处理请求，Rapira 为每个请求重新填充 PHP 超全局变量。
- Dispatcher：Rapira 初始化应用一次。脚本通过 API 调用获取请求对象。它可以按顺序处理请求，也可以使用[纤程](https://www.php.net/manual/en/language.fibers.php)并发处理请求。

::: info
[执行模式](/zh/docs/execution-modes)页面介绍模式行为和选择标准。
:::
