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
    details: "Classic → Worker → Dispatcher<br>Na co stać twoją aplikację?"
    link: /pl/docs/execution-modes
---

<script setup>
// Co niesie warstwa HTTP: `ready: false` oznacza to, czego Rapira jeszcze nie
// obsługuje - takie etykiety są wyszarzone.
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

// Cztery sposoby połączenia serwera z PHP — po zakładce na każdy.
// Teksty zakładek leżą w slotach <TextTabs> poniżej.
const interopTabs = [
  { name: 'FastCGI', slot: 'fastcgi', users: ['php-fpm', 'nginx', 'Angie'] },
  { name: 'Goridge', slot: 'goridge', users: ['RoadRunner'] },
  { name: 'CGO', slot: 'cgo', users: ['FrankenPHP'] },
  { name: 'C ABI', slot: 'cabi', users: ['Rapira'] },
]
</script>

<RapiraSection title="Wbudowany serwer HTTP oparty na hyperze" link="/pl/docs/http" link-text="Żądania i odpowiedzi HTTP">

Paradoksalnie, PHP nie ma własnego serwera HTTP gotowego do produkcji: wbudowany to wyłącznie narzędzie deweloperskie, a php-fpm nie działa bez zewnętrznego serwera WWW takiego jak nginx.

Rapira dostarcza taki serwer: własny front HTTP napisany w Ruście na bibliotece [hyper](https://hyper.rs). Hyper to niskopoziomowa implementacja HTTP dla Rusta. Czyta każde żądanie z połączenia i odsyła z powrotem odpowiedź, którą przygotowała Rapira.

<template #footer>
<FeatureTags :items="httpFeatures" />
</template>

</RapiraSection>

<RapiraSection title="Zero interopu: Rust wywołuje PHP bezpośrednio" link="/pl/docs/process-model" link-text="Model procesów">

Rapira jest napisana w Ruście, a PHP — w C. Rust wywołuje funkcje C natywnie, więc interop między tymi językami nic nie kosztuje: wywołanie funkcji PHP z Rusta to zwykłe wywołanie funkcji. Interpreter jest wbudowany w proces serwera, a Rapira steruje nim przez bezpośrednie bindingi — od startu silnika po obsługę każdego żądania.

Nie ma tu ani FastCGI, ani Goridge, ani CGO: żądanie nigdzie nie jest serializowane i nie opuszcza procesu. W trybie Classic i w trybie Worker Rapira wypełnia zmienne superglobalne bezpośrednio.

<template #aside>
<TextTabs :tabs="interopTabs">
<template #fastcgi>

PHP działa w osobnych procesach, a serwer WWW komunikuje się z nimi przez socket binarnym protokołem: każde żądanie jest pakowane w rekordy FastCGI, przesyłane i rozpakowywane po drugiej stronie, a odpowiedź pokonuje tę samą drogę z powrotem.

</template>
<template #goridge>

Workery PHP to osobne procesy, które odbierają żądania od serwera przez potoki lub sockety. Goridge to protokół tej wymiany: każde żądanie i odpowiedź są serializowane po jednej stronie i odczytywane po drugiej.

</template>
<template #cgo>

Interpreter PHP jest wbudowany w proces serwera, ale host jest napisany w Go, a Go nie potrafi wywoływać kodu C bezpośrednio. Każde wywołanie przechodzi przez CGO — warstwę, która dokłada narzut przy każdym przekroczeniu granicy języków.

</template>
<template #cabi>

ABI to binarny kontrakt między językami kompilowanymi. Rust obsługuje C ABI natywnie: wywołanie funkcji C z Rusta kompiluje się do tego samego kodu maszynowego co wywołanie z samego C.

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
