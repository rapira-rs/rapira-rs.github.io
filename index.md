---
layout: home
title: Rapira
description: Rapira is a PHP application server written in Rust.
tagline: A post-modern PHP application server, written in Rust.
pitch: A considered architecture and carefully written code, with years of RoadRunner behind them.

features:
  - title: Zero interop
    details: "There is no layer between Rust and PHP: no FastCGI, no sockets, no Goridge, no CGO, no serialization of any kind."
  - title: php-fpm compatible
    details: "The classic SAPI is supported: Rapira drops in where php-fpm was with no code changes, but runs faster."
  - title: Execution modes
    details: "Classic → Worker → Async<br>How far can your app go?"
    link: /docs/execution-modes
---

<script setup>
import { VPImage } from 'vitepress/theme'

// The Pingora banner to the right of the text — decoration, one variant per
// theme. The files live in public/ under these names.
const pingoraBanner = {
  light: '/pingora-banner-light.png',
  dark: '/pingora-banner-dark.png',
  alt: 'Pingora',
}

// What Pingora brings into the binary: `ready: false` marks what Rapira does
// not serve yet — those tags are drawn dimmed.
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

<RapiraSection title="A built-in HTTP server, powered by Pingora" link="/docs/http" link-text="HTTP requests and responses">

Paradoxically, PHP has never had a production-ready HTTP server of its own. The built-in one is a development tool, and php-fpm does not work without an external web server such as nginx.

Now PHP has that server: modern, fast, built on [Pingora](https://github.com/cloudflare/pingora). Cloudflare uses this framework to serve a sizable share of all internet traffic.

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
  <h2 class="sponsors-title">Sponsored by</h2>
  <div class="sponsors-grid">
    <a href="https://buhta.com" class="sponsor-card sponsor-logo" target="_blank" rel="noopener">
      <img src="/sponsors/logo-buhta.svg" alt="Buhta" class="sponsor-image">
    </a>
  </div>
  <div class="sponsor-cta-link">
    <a href="/sponsor">Become a Sponsor</a>
    <span class="separator">|</span>
    <a href="https://github.com/rapira-rs/rapira" target="_blank" rel="noopener">Give us a star</a>
  </div>
</div>
