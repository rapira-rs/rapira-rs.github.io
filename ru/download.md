---
title: Скачать Rapira
description: Готовые сборки Rapira для Linux, macOS и Windows.
sidebar: false
aside: false
editLink: false
lastUpdated: false
prev: false
next: false
---

<script setup>
// Подписи для DownloadBuilds — UI-строки этой страницы.
const labels = {
  os: 'Операционная система',
  arch: 'Архитектура',
  php: 'Версия PHP',
  format: 'Формат',
  download: 'Скачать Rapira',
  error: 'Список сборок не попал в эту сборку сайта.',
  releases: 'Открыть релизы',
}
</script>

# Скачать Rapira

Готовые сборки публикуются в [релизах на GitHub](https://github.com/rapira-rs/rapira/releases). Выберите платформу — кнопка внизу скачает последнюю стабильную версию для неё.

<DownloadBuilds :labels="labels">
<template #windows-note>

::: warning
Сборки для Windows предназначены только для локальной разработки — в продакшене Rapira работает на Linux или macOS.
:::

</template>
</DownloadBuilds>

Rapira также можно [собрать из исходников](/ru/docs/build-from-source).
