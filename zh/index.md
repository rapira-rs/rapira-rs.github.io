---
layout: home
title: Rapira
description: Rapira 是用 Rust 编写的 PHP 应用服务器。
tagline: 用 Rust 编写的 PHP 应用服务器。
pitch: 深思熟虑的架构，逐行斟酌的代码，背后是多年打造 RoadRunner 的积累。

features:
  - title: 零中间层
    details: "Rust 与 PHP 之间没有任何中间层：不用 FastCGI，不走 socket，没有 Goridge，也没有 CGO，更不需要任何序列化。"
  - title: 兼容 php-fpm
    details: "支持经典 SAPI：Rapira 直接顶替 php-fpm，代码不用改，但跑得更快。"
  - title: 运行模式
    details: "Classic → Worker → Dispatcher<br>你的应用能走到哪一步？"
    link: /zh/docs/execution-modes
---

<script setup>
// HTTP 接入层提供的能力：`ready: false` 表示 Rapira 尚未提供，
// 这些标签会显示为灰色。
const httpFeatures = [
  { label: 'HTTP/1.1' },
  { label: 'Keep-alive' },
  { label: '静态文件' },
  { label: 'HTTP/2', ready: false },
  { label: 'HTTP/3', ready: false },
  { label: 'TLS 1.3', ready: false },
  { label: 'TLS 1.2', ready: false },
  { label: 'ALPN', ready: false },
  { label: 'Early Hints', ready: false },
  { label: 'Trailers', ready: false },
]

// 服务器与 PHP 之间的四种衔接方式--一种一个标签页，
// 各标签页的文字放在下面 <TextTabs> 的插槽里。
const interopTabs = [
  { name: 'FastCGI', slot: 'fastcgi', users: ['php-fpm', 'nginx', 'Angie'] },
  { name: 'Goridge', slot: 'goridge', users: ['RoadRunner'] },
  { name: 'CGO', slot: 'cgo', users: ['FrankenPHP'] },
  { name: 'C ABI', slot: 'cabi', users: ['Rapira'] },
]
</script>

<RapiraSection title="内置 HTTP 服务器，由 hyper 驱动" link="/zh/docs/http" link-text="HTTP 请求与响应">

说来矛盾，PHP 一直没有一个生产可用的自带 HTTP 服务器：内置的那个只是开发工具，php-fpm 又离不开 nginx 这样的外部 Web 服务器。

Rapira 把这个服务器补上了：它自带一个 HTTP 接入层，用 Rust 基于 [hyper](https://hyper.rs) 写成。hyper 是 Rust 的底层 HTTP 实现，它从连接上读出每个请求，再把 Rapira 产出的响应写回去。

<template #footer>
<FeatureTags :items="httpFeatures" />
</template>

</RapiraSection>

<RapiraSection title="零中间层：Rust 直接调用 PHP" link="/zh/docs/process-model" link-text="进程模型">

Rapira 用 Rust 编写，PHP 用 C 编写。Rust 原生调用 C 函数，两种语言之间的互操作没有任何开销：从 Rust 调用一个 PHP 函数，就是一次普通的函数调用。解释器内嵌在服务器进程里，Rapira 通过直接绑定驱动它--从启动引擎到处理每一个请求。

这里没有 FastCGI，没有 Goridge，也没有 CGO：请求从不序列化，也从不离开进程。在 Classic 模式和 Worker 模式下，Rapira 直接写入超全局变量。

<template #aside>
<TextTabs :tabs="interopTabs">
<template #fastcgi>

PHP 运行在独立进程中，Web 服务器通过 socket 上的二进制协议与之通信：每个请求被打包成 FastCGI 记录，发送过去，在另一端解包，响应再原路返回。

</template>
<template #goridge>

PHP worker 是独立进程，通过管道或 socket 从服务器接收请求。Goridge 就是这套交换的协议：每个请求和响应都要在一端序列化、在另一端解析。

</template>
<template #cgo>

PHP 解释器内嵌在服务器进程里，但宿主是用 Go 写的，而 Go 无法直接调用 C 代码。每次调用都要经过 CGO，这个中间层在每次跨越语言边界时都会带来开销。

</template>
<template #cabi>

ABI 是编译型语言之间的二进制契约。Rust 原生支持 C ABI：从 Rust 调用 C 函数，编译出的机器码与 C 自己的调用完全相同。

</template>
</TextTabs>
</template>

</RapiraSection>

<div class="sponsors-section">
  <h2 class="sponsors-title">赞助商</h2>
  <div class="sponsors-grid">
    <a href="https://buhta.com" class="sponsor-card sponsor-logo" target="_blank" rel="noopener">
      <img src="/sponsors/logo-buhta.svg" alt="Buhta" class="sponsor-image">
    </a>
  </div>
  <div class="sponsor-cta-link">
    <a href="/zh/sponsor">成为赞助商</a>
    <span class="separator">|</span>
    <a href="https://github.com/rapira-rs/rapira" target="_blank" rel="noopener">点个星</a>
  </div>
</div>
