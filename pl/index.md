---
layout: home
title: Rapira
description: Rapira to serwer aplikacji PHP napisany w Ruście.
tagline: Serwer aplikacji PHP napisany w Ruście.
pitch: Opiekunowie RoadRunnera projektują i rozwijają Rapirę.

features:
  - title: Bezpośrednie wywołania między Rustem a PHP
    details: "Między Rustem a PHP nie ma żadnej warstwy: nie ma FastCGI, gniazd, Goridge, CGO ani żadnej serializacji."
  - title: Zgodność z php-fpm
    details: "Tryb Classic uruchamia istniejący skrypt wejściowy, na przykład public/index.php, z nowym stanem dla każdego żądania. Rapira może zastąpić php-fpm."
  - title: Tryby pracy
    details: "Classic → Worker → Dispatcher<br>Których trybów może używać twoja aplikacja?"
    link: /pl/docs/execution-modes
  - title: Serwer gRPC
    details: "Wtyczka gRPC obsługuje wywołania unarne przez gRPC, gRPC-Web i Connect. PHP obsługuje te wywołania w trybie Dispatcher."
    link: /pl/docs/grpc
---

<script setup>
// `ready: false` oznacza funkcje, których Rapira nie obsługuje.
// Komponent pokazuje te etykiety w przyciemnionym stylu.
const httpFeatures = [
  { label: 'HTTP/1.1' },
  { label: 'Keep-alive' },
  { label: 'Pliki statyczne' },
  { label: 'HTTP/2', ready: false },
  { label: 'HTTP/3', ready: false },
  { label: 'TLS 1.3', ready: false },
  { label: 'TLS 1.2', ready: false },
  { label: 'ALPN', ready: false },
  { label: 'Early Hints', ready: false },
  { label: 'Trailers', ready: false },
]

// Każda zakładka opisuje jedno połączenie między serwerem a PHP.
// Sloty <TextTabs> poniżej zawierają opisy.
const interopTabs = [
  { name: 'FastCGI', slot: 'fastcgi', users: ['php-fpm', 'nginx', 'Angie'] },
  { name: 'Goridge', slot: 'goridge', users: ['RoadRunner'] },
  { name: 'CGO', slot: 'cgo', users: ['FrankenPHP'] },
  { name: 'C ABI', slot: 'cabi', users: ['Rapira'] },
]
</script>

<RapiraSection title="Wbudowany serwer HTTP oparty na hyper" link="/pl/docs/http" link-text="Żądania i odpowiedzi HTTP">

PHP nie zawiera produkcyjnego serwera HTTP. Jego wbudowany serwer to narzędzie deweloperskie. php-fpm wymaga osobnego serwera WWW, na przykład nginx.

Rapira zawiera serwer HTTP, który używa biblioteki Rusta [hyper](https://hyper.rs). Hyper czyta każde żądanie i zapisuje odpowiedź od Rapiry.

<template #footer>
<FeatureTags :items="httpFeatures" />
</template>

</RapiraSection>

<RapiraSection title="Rust wywołuje PHP bezpośrednio" link="/pl/docs/process-model" link-text="Model procesów">

Rapira używa Rusta, a PHP używa C. Rust wywołuje funkcje C bezpośrednio. Dlatego Rust może bezpośrednio wywołać funkcję PHP. Rapira osadza interpreter w procesie serwera. Bezpośrednie wiązania sterują inicjalizacją interpretera i obsługą żądań.

Rapira nie używa FastCGI, Goridge ani CGO. Nie serializuje żądań i nie wysyła ich do innego procesu. W trybach Classic i Worker Rapira wypełnia zmienne superglobalne bezpośrednio.

<template #aside>
<TextTabs :tabs="interopTabs">
<template #fastcgi>

PHP działa w osobnych procesach. Serwer WWW wysyła rekordy FastCGI przez gniazdo. Proces PHP parsuje każde żądanie i zwraca zserializowaną odpowiedź.

</template>
<template #goridge>

Workery PHP to osobne procesy. Odbierają zserializowane żądania od serwera przez potoki lub gniazda. Goridge definiuje format tych danych.

</template>
<template #cgo>

Proces serwera zawiera interpreter PHP. Jednak jego host w Go nie może bezpośrednio wywoływać kodu C. CGO obsługuje każde wywołanie między tymi dwoma językami.

</template>
<template #cabi>

ABI określa, jak języki kompilowane wywołują się nawzajem. Rust obsługuje C ABI bezpośrednio. Rust i C używają tych samych instrukcji maszynowych dla tych wywołań.

</template>
</TextTabs>
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
