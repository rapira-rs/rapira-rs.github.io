---
layout: home
title: Rapira
description: Rapira 是用 Rust 编写的 PHP 应用服务器。
tagline: 用 Rust 编写的 PHP 应用服务器。
pitch: RoadRunner 的维护者设计并实现 Rapira。

features:
  - title: Rust 与 PHP 直接调用
    details: "Rust 与 PHP 之间没有中间层：没有 FastCGI，没有 socket，没有 Goridge，没有 CGO，也没有任何序列化。"
  - title: 兼容 php-fpm
    details: "Classic 模式运行现有的前端控制器（例如 public/index.php），每次请求都使用新的状态。Rapira 可以替换 php-fpm。"
  - title: 执行模式
    details: "Classic → Worker → Dispatcher<br>你的应用可以使用哪些模式？"
    link: /zh/docs/execution-modes
  - title: gRPC 服务器
    details: "gRPC 插件通过 gRPC、gRPC-Web 和 Connect 提供一元调用。PHP 在 Dispatcher 模式下处理这些调用。"
    link: /zh/docs/grpc
---

<script setup>
// `ready: false` 标识 Rapira 不支持的功能。
// 组件以暗淡样式显示这些标签。
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

// 每个标签页描述服务器与 PHP 之间的一种连接方式。
// 下面的 <TextTabs> 插槽包含这些描述。
const interopTabs = [
  { name: 'FastCGI', slot: 'fastcgi', users: ['php-fpm', 'nginx', 'Angie'] },
  { name: 'Goridge', slot: 'goridge', users: ['RoadRunner'] },
  { name: 'CGO', slot: 'cgo', users: ['FrankenPHP'] },
  { name: 'C ABI', slot: 'cabi', users: ['Rapira'] },
]
</script>

<RapiraSection title="使用 hyper 的内置 HTTP 服务器" link="/zh/docs/http" link-text="HTTP 请求与响应">

PHP 不包含用于生产环境的 HTTP 服务器。它的内置服务器是开发工具。php-fpm 需要单独的 Web 服务器，例如 nginx。

Rapira 包含一个 HTTP 服务器，它使用 Rust 的 [hyper](https://hyper.rs) 库。hyper 读取每个请求，并写入 Rapira 生成的响应。

<template #footer>
<FeatureTags :items="httpFeatures" />
</template>

</RapiraSection>

<RapiraSection title="Rust 直接调用 PHP" link="/zh/docs/process-model" link-text="进程模型">

Rapira 用 Rust 编写，PHP 用 C 编写。Rust 直接调用 C 函数。因此，Rust 可以直接调用 PHP 函数。Rapira 把解释器内嵌在服务器进程中。直接绑定控制解释器的初始化和请求处理。

Rapira 不使用 FastCGI、Goridge 或 CGO。它不序列化请求，也不把请求发送到其他进程。在 Classic 模式和 Worker 模式下，Rapira 直接填充超全局变量。

<template #aside>
<TextTabs :tabs="interopTabs">
<template #fastcgi>

PHP 运行在独立进程中。Web 服务器通过 socket 发送 FastCGI 记录。PHP 进程解析每个请求，并返回序列化的响应。

</template>
<template #goridge>

PHP worker 是独立进程。它们通过管道或 socket 从服务器接收序列化的请求。Goridge 定义这些数据的格式。

</template>
<template #cgo>

服务器进程包含 PHP 解释器。但是，它的 Go 宿主不能直接调用 C 代码。CGO 处理两种语言之间的每次调用。

</template>
<template #cabi>

ABI 定义编译型语言之间如何互相调用。Rust 直接支持 C ABI。对于这些调用，Rust 和 C 使用相同的机器指令。

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
