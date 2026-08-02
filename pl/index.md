---
layout: home
title: Rapira
description: Rapira to serwer aplikacji PHP napisany w Ruście.
tagline: Serwer aplikacji PHP, napisany w Ruście.
pitch: Przemyślana architektura i starannie napisany kod, za którymi stoją lata pracy nad RoadRunnerem.

features:
  - title: Zero interopu
    details: "Między Rustem a PHP nie ma żadnej warstwy pośredniej: ani FastCGI, ani socketów, ani Goridge, ani CGO, ani jakiejkolwiek serializacji."
  - title: Zgodność z php-fpm
    details: "Obsługa klasycznego SAPI: Rapira wchodzi na miejsce php-fpm bez zmian w kodzie, ale działa szybciej."
  - title: Tryby pracy
    details: "Classic → Worker → Async<br>Na co stać twoją aplikację?"
    link: /pl/docs/execution-modes
---

<script setup>
import { VPImage } from 'vitepress/theme'

// Baner Pingory po prawej stronie tekstu — dekoracja, po jednym wariancie na
// motyw. Pliki trafiają do public/ pod tymi nazwami.
const pingoraBanner = {
  light: '/pingora-banner-light.png',
  dark: '/pingora-banner-dark.png',
  alt: 'Pingora',
}

// To, co Pingora wnosi do binarki: `ready: false` oznacza to, czego Rapira
// jeszcze nie obsługuje — takie etykiety są wyszarzone.
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

<RapiraSection title="Wbudowany serwer HTTP, wzmocniony Pingorą" link="/pl/docs/http" link-text="Żądania i odpowiedzi HTTP">

Paradoksalnie, PHP nie ma własnego serwera HTTP gotowego do produkcji: wbudowany to wyłącznie narzędzie deweloperskie, a php-fpm nie działa bez zewnętrznego serwera WWW takiego jak nginx.

Teraz PHP ma taki serwer: nowoczesny, szybki, zbudowany na [Pingorze](https://github.com/cloudflare/pingora). Tym frameworkiem Cloudflare obsługuje znaczną część ruchu całego internetu.

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
  <h2 class="sponsors-title">Sponsorzy</h2>
  <div class="sponsors-grid">
    <a href="https://buhta.com" class="sponsor-card sponsor-logo" target="_blank" rel="noopener">
      <img src="/sponsors/logo-buhta.svg" alt="Buhta" class="sponsor-image">
    </a>
  </div>
  <div class="sponsor-cta-link">
    <a href="/pl/sponsor">Zostań sponsorem</a>
    <span class="separator">|</span>
    <a href="https://github.com/rapira-rs/rapira" target="_blank" rel="noopener">Zostaw gwiazdkę</a>
  </div>
</div>
