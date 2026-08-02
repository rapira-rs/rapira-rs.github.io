---
layout: home
title: Rapira
description: Rapira — сервер приложений для PHP, написанный на Rust.
tagline: Сервер для PHP-приложений, написанный на Rust.
pitch: Продуманная архитектура и выверенный код, подкреплённые годами работы над RoadRunner.

features:
  - title: Нулевой интероп
    details: "Между Rust и PHP нет прослойки: ни FastCGI, ни сокетов, ни Goridge, ни CGO, ни какой-либо сериализации."
  - title: Совместимость с php-fpm
    details: "Поддерживается классический SAPI: Rapira встаёт на место php-fpm без правок в коде, но работает быстрее."
  - title: Режимы работы
    details: "Classic → Worker → Async<br>На что способно ваше приложение?"
    link: /ru/docs/execution-modes
---

<script setup>
import { VPImage } from 'vitepress/theme'

// Баннер Pingora справа от текста — декорация, по варианту на тему.
// Файлы кладутся в public/ под этими именами.
const pingoraBanner = {
  light: '/pingora-banner-light.png',
  dark: '/pingora-banner-dark.png',
  alt: 'Pingora',
}

// Что Pingora приносит в бинарник: `ready: false` — ещё не реализовано в Rapira,
// такие теги рисуются приглушёнными.
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

<RapiraSection title="Встроенный HTTP-сервер, усиленный Pingora" link="/ru/docs/http" link-text="HTTP-запросы и ответы">

Парадоксально, но у PHP нет своего production-ready HTTP-сервера. Встроенный годится только для разработки, а php-fpm не работает без внешнего веб-сервера вроде nginx.

Теперь такой сервер у PHP есть: современный, быстрый, построенный на [Pingora](https://github.com/cloudflare/pingora). Этим фреймворком Cloudflare обслуживает заметную часть трафика всего интернета.

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
  <h2 class="sponsors-title">Спонсоры</h2>
  <div class="sponsors-grid">
    <a href="https://buhta.com" class="sponsor-card sponsor-logo" target="_blank" rel="noopener">
      <img src="/sponsors/logo-buhta.svg" alt="Buhta" class="sponsor-image">
    </a>
  </div>
  <div class="sponsor-cta-link">
    <a href="/ru/sponsor">Стать спонсором</a>
    <span class="separator">|</span>
    <a href="https://github.com/rapira-rs/rapira" target="_blank" rel="noopener">Поставить звезду</a>
  </div>
</div>
