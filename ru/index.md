---
layout: home
title: Rapira
description: Rapira - сервер приложений для PHP, написанный на Rust.
tagline: Сервер для PHP-приложений, написанный на Rust.
pitch: Продуманная архитектура и выверенный код, подкреплённые годами работы над RoadRunner.

features:
  - title: Нулевой интероп
    details: "Между Rust и PHP нет прослойки: ни FastCGI, ни сокетов, ни Goridge, ни CGO, ни какой-либо сериализации."
  - title: Совместимость с php-fpm
    details: "Поддерживается классический SAPI: Rapira встаёт на место php-fpm без правок в коде, но работает быстрее."
  - title: Режимы работы
    details: "Classic → Worker → Dispatcher<br>Какие режимы может использовать ваше приложение?"
    link: /ru/docs/execution-modes
---

<script setup>
// Что несёт HTTP-фронт: `ready: false` - ещё не реализовано в Rapira,
// такие теги рисуются приглушёнными.
const httpFeatures = [
  { label: 'HTTP/1.1' },
  { label: 'Keep-alive' },
  { label: 'Статические файлы' },
  { label: 'HTTP/2', ready: false },
  { label: 'HTTP/3', ready: false },
  { label: 'TLS 1.3', ready: false },
  { label: 'TLS 1.2', ready: false },
  { label: 'ALPN', ready: false },
  { label: 'Early Hints', ready: false },
  { label: 'Trailers', ready: false },
]

// Четыре способа связать сервер с PHP - по табу на каждый.
// Тексты табов лежат в слотах <TextTabs> ниже.
const interopTabs = [
  { name: 'FastCGI', slot: 'fastcgi', users: ['php-fpm', 'nginx', 'Angie'] },
  { name: 'Goridge', slot: 'goridge', users: ['RoadRunner'] },
  { name: 'CGO', slot: 'cgo', users: ['FrankenPHP'] },
  { name: 'C ABI', slot: 'cabi', users: ['Rapira'] },
]
</script>

<RapiraSection title="Встроенный HTTP-сервер, построенный на hyper" link="/ru/docs/http" link-text="HTTP-запросы и ответы">

Парадоксально, но у PHP нет своего production-ready HTTP-сервера. Встроенный годится только для разработки, а php-fpm не работает без внешнего веб-сервера вроде nginx.

Такой сервер даёт Rapira: собственный HTTP-фронт, написанный на Rust поверх [hyper](https://hyper.rs). Библиотека hyper - это низкоуровневая реализация HTTP для Rust: она читает каждый запрос из соединения и пишет обратно ответ, который построила Rapira.

<template #footer>
<FeatureTags :items="httpFeatures" />
</template>

</RapiraSection>

<RapiraSection title="Нулевой интероп: Rust вызывает PHP напрямую" link="/ru/docs/process-model" link-text="Модель процессов">

Rapira написана на Rust, PHP - на C. Rust вызывает функции C напрямую. Поэтому Rust может вызвать функцию PHP напрямую.
Rapira встраивает интерпретатор в процесс сервера. Прямые биндинги управляют инициализацией интерпретатора и обработкой запроса.

Здесь нет ни FastCGI, ни Goridge, ни CGO: запрос нигде не сериализуется и не покидает процесс. В режимах Classic и Worker Rapira заполняет суперглобалы напрямую.

<template #aside>
<TextTabs :tabs="interopTabs">
<template #fastcgi>

PHP работает в отдельных процессах, а веб-сервер общается с ними по сокету бинарным протоколом: каждый запрос упаковывается в FastCGI-записи, передаётся, разбирается на другой стороне - и ответ проделывает тот же путь обратно.

</template>
<template #goridge>

PHP-воркеры - отдельные процессы, которые получают запросы от сервера через пайпы или сокеты. Goridge - протокол этого обмена: каждый запрос и ответ сериализуется на одной стороне и разбирается на другой.

</template>
<template #cgo>

Интерпретатор PHP встроен в процесс сервера, но хост написан на Go, а Go не вызывает C-код напрямую. Каждый вызов проходит через CGO - прослойку с накладными расходами на каждое пересечение границы языков.

</template>
<template #cabi>

ABI - двоичный контракт между компилируемыми языками. Rust поддерживает C ABI нативно: вызов C-функции из Rust - это тот же машинный код, что и вызов из самого C.

</template>
</TextTabs>
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
