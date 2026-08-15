---
title: 什么是 Rapira？
description: "Rapira 是一个用 Rust 编写的 PHP 应用服务器，快速而安全：直接接收 HTTP 请求，支持经典、Worker 和调度三种模式。"
---

# 什么是 Rapira

Rapira 是一个快速、安全的 PHP 应用服务器，用 Rust 编写。

我们把多年维护 RoadRunner 的经验都用在了 Rapira 的设计上：既要让它与 PHP 的配合尽可能高效、稳定，也要让开发和日常运维都不必额外费心。

Rapira 不只做 HTTP。我们计划支持 RoadRunner 所有常用插件，最新进展请关注我们的[博客](/zh/blog/)。

## HTTP

PHP 服务器的首要工作，就是处理 HTTP 请求。借助 Cloudflare 的技术，Rapira 可以直接接收请求，无需 nginx 或 Apache，并支持各种现代 HTTP 与加密标准。

在 PHP 这一侧，所有运行模式都可以使用：

- 经典模式（SAPI）——每个请求都把应用从头启动一遍，和在 php-fpm 下一样。
- Worker 模式（SAPI Worker）——应用在启动时初始化一次，之后通过 SAPI 接口在循环里一个接一个地处理请求（PHP 的超全局变量每个请求都会重新填充）。
- 调度模式——应用不会退出，请求和响应通过一套单独的 API 传递。在这个模式下，你既可以逐个顺序处理请求（像 RoadRunner 那样），也可以用[纤程](https://www.php.net/manual/language.fibers.php)并发处理。

::: info
[执行模式](/zh/docs/execution-modes)一页详细介绍了各个模式的区别，以及该怎么选。
:::
