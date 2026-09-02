---
title: 什么是 Rapira？
description: "Rapira 是一个用 Rust 编写的 PHP 应用服务器，快速而安全：直接接收 HTTP 请求，支持 Classic、Worker 和 Dispatcher 三种模式。"
---

# 什么是 Rapira

Rapira 是一个快速、安全的 PHP 应用服务器，用 Rust 编写。

我们把多年维护 RoadRunner 的经验都用在了 Rapira 的设计上：既要让它与 PHP 的配合尽可能高效、稳定，也要让开发和日常运维都不必额外费心。

Rapira 不只做 HTTP。我们计划支持 RoadRunner 所有常用插件，最新进展请关注我们的[博客](/zh/blog/)。

## HTTP

Rapira 自带 HTTP 接入层，基于 [hyper](https://hyper.rs) 库构建。它直接接受明文 HTTP 连接，所以前面不必再摆任何东西，请求就能到达你的 PHP 应用。接入层不终结 TLS：需要 TLS 的话，请在 Rapira 前面的代理上终结它，这套配置见[生产环境部署](/zh/docs/deployment)。

在 PHP 这一侧，所有运行模式都可以使用：

- Classic：每个请求都把应用从头启动一遍，和在 php-fpm 下一样。
- Worker：应用在启动时初始化一次，之后在循环里一个接一个地处理请求。PHP 的超全局变量由 Rapira 为每个请求重新填好。
- Dispatcher：应用只启动一次，然后一直活着。脚本通过一次 API 调用取出每个请求，把请求当成一个值来用，而不是读超全局变量。脚本可以一次只处理一个请求，也可以借助[纤程](https://www.php.net/manual/en/language.fibers.php)同时处理好几个。

::: info
[执行模式](/zh/docs/execution-modes)一页详细介绍了各个模式的区别，以及该怎么选。
:::
