---
layout: home
title: Rapira
description: Rapira is a PHP application server written in Rust.
tagline: A PHP application server written in Rust.
pitch: The RoadRunner maintainers design and implement Rapira.

features:
  - title: Direct Rust and PHP calls
    details: "There is no layer between Rust and PHP: no FastCGI, no sockets, no Goridge, no CGO, no serialization of any kind."
  - title: php-fpm compatible
    details: "The Classic SAPI runs existing entry scripts without code changes. Rapira can replace php-fpm and reduce execution time."
  - title: Execution modes
    details: "Classic → Worker → Dispatcher<br>Which modes can your application use?"
    link: /docs/execution-modes
---

<script setup>
// `ready: false` identifies features that Rapira does not support.
// The component shows these tags with a dim style.
const httpFeatures = [
  { label: 'HTTP/1.1' },
  { label: 'Keep-alive' },
  { label: 'Static files' },
  { label: 'HTTP/2', ready: false },
  { label: 'HTTP/3', ready: false },
  { label: 'TLS 1.3', ready: false },
  { label: 'TLS 1.2', ready: false },
  { label: 'ALPN', ready: false },
  { label: 'Early Hints', ready: false },
  { label: 'Trailers', ready: false },
]

// Each tab describes one connection between a server and PHP.
// The <TextTabs> slots below contain the descriptions.
const interopTabs = [
  { name: 'FastCGI', slot: 'fastcgi', users: ['php-fpm', 'nginx', 'Angie'] },
  { name: 'Goridge', slot: 'goridge', users: ['RoadRunner'] },
  { name: 'CGO', slot: 'cgo', users: ['FrankenPHP'] },
  { name: 'C ABI', slot: 'cabi', users: ['Rapira'] },
]
</script>

<RapiraSection title="A built-in HTTP server that uses hyper" link="/docs/http" link-text="HTTP requests and responses">

PHP does not include a production HTTP server. Its built-in server is a development tool. php-fpm requires a separate web server such as nginx.

Rapira includes an HTTP server that uses the Rust [hyper](https://hyper.rs) library. Hyper reads each request and writes the response from Rapira.

<template #footer>
<FeatureTags :items="httpFeatures" />
</template>

</RapiraSection>

<RapiraSection title="Rust calls PHP directly" link="/docs/process-model" link-text="Process model">

Rapira uses Rust, and PHP uses C. Rust calls C functions directly. Therefore, Rust can call a PHP function directly.
Rapira embeds the interpreter in the server process. Direct bindings control interpreter initialization and request processing.

Rapira does not use FastCGI, Goridge, or CGO. It does not serialize requests or send them to another process.
In Classic and Worker modes, Rapira fills the superglobals directly.

<template #aside>
<TextTabs :tabs="interopTabs">
<template #fastcgi>

PHP runs in separate processes. The web server sends FastCGI records through a socket. The PHP process parses each request and returns a serialized response.

</template>
<template #goridge>

PHP workers are separate processes. They receive serialized requests from the server through pipes or sockets. Goridge defines the format of this data.

</template>
<template #cgo>

The server process contains the PHP interpreter. However, its Go host cannot call C code directly. CGO processes each call between the two languages.

</template>
<template #cabi>

An ABI defines how compiled languages call each other. Rust supports the C ABI directly. Rust and C use the same machine instructions for these calls.

</template>
</TextTabs>
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
