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
    details: "Classic → Worker → Async<br>你的应用能走到哪一步？"
    link: /zh/docs/execution-modes
---

<script setup>
import { VPImage } from 'vitepress/theme'

// 文字右侧的 Pingora 横幅——纯装饰，明暗主题各一张，
// 文件按下面的名字放进 public/。
const pingoraBanner = {
  light: '/pingora-banner-light.png',
  dark: '/pingora-banner-dark.png',
  alt: 'Pingora',
}

// Pingora 带进二进制的能力：`ready: false` 表示 Rapira 尚未提供，
// 这些标签会显示为灰色。
const httpFeatures = [
  { label: 'HTTP/1.1' },
  { label: 'HTTP/2', ready: false },
  { label: 'HTTP/3', ready: false },
  { label: 'Keep-alive' },
  { label: 'Early Hints' },
  { label: 'Trailers', ready: false },
  { label: 'TLS 1.3', ready: false },
  { label: 'TLS 1.2', ready: false },
  { label: 'ALPN', ready: false },
]
</script>

<RapiraSection title="内置 HTTP 服务器，由 Pingora 驱动" link="/zh/docs/http" link-text="HTTP 请求与响应">

说来矛盾，PHP 一直没有一个生产可用的自带 HTTP 服务器：内置的那个只是开发工具，php-fpm 又离不开 nginx 这样的外部 Web 服务器。

现在有了：一个现代、快速、基于 [Pingora](https://github.com/cloudflare/pingora) 构建的服务器。Cloudflare 正是用这个框架承载着全网相当可观的一部分流量。

<template #aside>
<div class="rapira-section-art">
<VPImage :image="pingoraBanner" draggable="false" />
</div>
</template>

<template #footer>
<FeatureTags :items="httpFeatures" />
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
