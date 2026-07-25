---
layout: home
title: Rapira
description: Rapira 是用 Rust 编写的 PHP 应用服务器。
tagline: 用 Rust 编写的 PHP 应用服务器。
pitch: 这不是 vibe coding 的产物，而是深思熟虑的架构与逐行斟酌的代码，背后是多年打造 RoadRunner 的积累。

features:
  - title: 零中间层
    details: "Rust 与 PHP 之间没有任何中间层：不用 FastCGI，不走 socket，没有 Goridge，也没有 CGO，更不需要任何序列化。"
  - title: 兼容 php-fpm
    details: "支持经典 SAPI：Rapira 直接顶替 php-fpm，代码不用改，但跑得更快。"
  - title: 四种运行模式
    details: "Classic → Franken → RoadRunner → Async<br>你的应用能走到哪一步？"
---

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
