---
layout: home
title: Rapira
description: Rapira - сервер приложений для PHP, написанный на Rust.
tagline: Сервер приложений для PHP, написанный на Rust.
pitch: Rapira проектируют и разрабатывают мейнтейнеры RoadRunner.

features:
  - title: Прямые вызовы между Rust и PHP
    details: "Между Rust и PHP нет прослойки: ни FastCGI, ни сокетов, ни Goridge, ни CGO, ни какой-либо сериализации."
  - title: Совместимость с php-fpm
    details: "Режим Classic запускает существующий входной скрипт, например public/index.php, с новым состоянием для каждого запроса. Rapira может заменить php-fpm."
  - title: Режимы работы
    details: "Classic → Worker → Dispatcher<br>Какие режимы может использовать ваше приложение?"
    link: /ru/docs/execution-modes
  - title: Сервер gRPC
    details: "Плагин gRPC обслуживает унарные вызовы через gRPC, gRPC-Web и Connect. PHP обрабатывает вызовы в режиме Dispatcher."
    link: /ru/docs/grpc
---

<script setup>
// `ready: false` отмечает функции, которые Rapira не поддерживает.
// Компонент показывает эти теги приглушённым стилем.
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

// Каждый таб описывает один способ связи между сервером и PHP.
// Слоты <TextTabs> ниже содержат описания.
const interopTabs = [
  { name: 'FastCGI', slot: 'fastcgi', users: ['php-fpm', 'nginx', 'Angie'] },
  { name: 'Goridge', slot: 'goridge', users: ['RoadRunner'] },
  { name: 'CGO', slot: 'cgo', users: ['FrankenPHP'] },
  { name: 'C ABI', slot: 'cabi', users: ['Rapira'] },
]
</script>

<RapiraSection title="Встроенный HTTP-сервер на основе hyper" link="/ru/docs/http" link-text="HTTP-запросы и ответы">

В PHP нет HTTP-сервера для production. Встроенный сервер PHP - это инструмент для разработки. php-fpm требует отдельный веб-сервер, например nginx.

Rapira содержит HTTP-сервер на основе библиотеки Rust [hyper](https://hyper.rs). Hyper читает каждый запрос и записывает ответ от Rapira.

<template #footer>
<FeatureTags :items="httpFeatures" />
</template>

</RapiraSection>

<RapiraSection title="Rust вызывает PHP напрямую" link="/ru/docs/process-model" link-text="Модель процессов">

Rapira использует Rust, а PHP использует C. Rust вызывает функции C напрямую. Поэтому Rust может вызвать функцию PHP напрямую. Rapira встраивает интерпретатор в процесс сервера. Прямые биндинги управляют инициализацией интерпретатора и обработкой запроса.

Rapira не использует FastCGI, Goridge или CGO. Она не сериализует запросы и не отправляет их в другой процесс. В режимах Classic и Worker Rapira заполняет суперглобальные переменные напрямую.

<template #aside>
<TextTabs :tabs="interopTabs">
<template #fastcgi>

PHP работает в отдельных процессах. Веб-сервер отправляет записи FastCGI через сокет. Процесс PHP разбирает каждый запрос и возвращает сериализованный ответ.

</template>
<template #goridge>

Воркеры PHP - это отдельные процессы. Они получают сериализованные запросы от сервера через пайпы или сокеты. Goridge определяет формат этих данных.

</template>
<template #cgo>

Процесс сервера содержит интерпретатор PHP. Но хост на Go не может вызывать код C напрямую. CGO обрабатывает каждый вызов между двумя языками.

</template>
<template #cabi>

ABI определяет, как компилируемые языки вызывают друг друга. Rust поддерживает C ABI напрямую. Rust и C используют одинаковые машинные инструкции для этих вызовов.

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
