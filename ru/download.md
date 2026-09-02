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
// Подписи для DownloadBuilds - UI-строки этой страницы.
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

Готовые сборки публикуются в [релизах на GitHub](https://github.com/rapira-rs/rapira/releases). Выберите платформу - кнопка внизу скачает последнюю стабильную версию для неё.

<DownloadBuilds :labels="labels">
<template #dev-note>

::: warning
Эта сборка предназначена только для локальной разработки - для продакшена используйте Linux.
:::

</template>
</DownloadBuilds>

Контейнерные образы публикуются в `ghcr.io/rapira-rs/rapira`, а ночной канал держит скользящий предрелиз `nightly` с архивами и теги образов `nightly-php8.4` и `nightly-php8.5`. Выбор платформы выше перечисляет только файлы релизов. Подробнее - в разделе [Docker](/ru/docs/intro/installation#docker).

Rapira также можно [собрать из исходников](/ru/docs/intro/build-from-source).
