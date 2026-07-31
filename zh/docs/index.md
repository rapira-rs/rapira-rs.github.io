---
title: 什么是 Rapira？
description: "Rapira 是用 Rust 编写的 PHP 应用服务器；本页介绍它的运行前提，以及它执行 PHP 应用的两种方式。"
---

# 什么是 Rapira

Rapira 是用 Rust 编写的 PHP 应用服务器。

它通过 PHP 的 embed SAPI 把解释器嵌进自己的进程，这正是让 C 程序托管 PHP 引擎的那个接口。宿主直接调用解释器：没有 FastCGI 协议，没有本地 socket 或管道，也不必在每个请求上把数据序列化成某种传输格式再还原回来。请求一到，超全局变量填好，PHP 就开始执行；执行完毕，响应字节直接发出去。

HTTP 本身由一个基于 [Pingora](https://github.com/cloudflare/pingora) 构建的接入层处理，Pingora 是 Cloudflare 用 Rust 编写的代理框架。它已经打包进二进制文件，所以不用再安装、配置和守护第二个进程。

## 运行前提

Rapira 有三项要求。

- **只支持 Linux 和 macOS。** 没有 Windows 版本。
- **PHP 8.4 或 8.5。** 发行压缩包以及 `rapira-php8.4` / `rapira-php8.5` 软件包里都自带了对应版本的 NTS PHP embed 运行时，你选哪个产物，跑的就是哪个版本，不需要另外再装一份 PHP。
- **只用 NTS，绝不用 ZTS。** Rapira 链接的是非线程安全的 PHP。这一点只在你拿自己的 PHP 编译 Rapira 时才有影响：线程安全的构建会被直接拒绝，而不是拖到后面才出问题。

要用自己的 PHP 构建——换一套扩展、跑在特殊架构上，或者用基于 musl 的发行版——参见[从源码构建](/zh/docs/build-from-source)。

## 运行应用的两种方式

今天的 Rapira 提供两种执行 PHP 应用的方式。worker 模式是默认的；经典模式需要主动开启——命令行加个参数，或者配置文件里改一个键。

**[经典模式](/zh/docs/classic)**在每个请求上都把你的前端控制器从头执行一遍，和在 php-fpm 下一模一样：应用启动、处理请求，然后把它构建出来的一切全部丢弃。代码一行都不用改。

**[SAPI Worker](/zh/docs/worker)** 则让进程一直活着。一个常驻脚本只启动一次应用——自动加载器、容器、各种连接——之后就进入循环，每次填好超全局变量，一个接一个地处理请求。启动工作只在进程起来时做一次，不再摊到每个请求上，状态也比请求活得更久。

[执行模式](/zh/docs/execution-modes)进一步说明了两者的区别，以及该怎么选。

## 接下来看什么

- **[安装](/zh/docs/installation)**——面向 Linux 和 macOS 的软件包与压缩包，PHP 运行时就打包在里面。
- **[快速开始](/zh/docs/quickstart)**——用两种模式各跑通第一个请求。
- **[配置](/zh/docs/configuration)**——完整的 `rapira.toml` 参考。
