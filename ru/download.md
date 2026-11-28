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
// Эти подписи содержат текст интерфейса для DownloadBuilds.
const labels = {
  os: 'Операционная система',
  arch: 'Архитектура',
  php: 'Версия PHP',
  format: 'Формат',
  download: 'Скачать Rapira',
  error: 'Эта сборка сайта не содержит данных о релизах.',
  releases: 'Открыть релизы',
  nightly: 'Nightly',
  nightlyPage: 'Открыть страницу ночного релиза',
}
</script>

# Скачать Rapira

<DownloadCard>

## Бинарники {#binaries}

Каждая сборка содержит бинарник `rapira` и `libphp` выбранной версии PHP. Отдельно устанавливать PHP не нужно.

<DownloadBuilds :labels="labels">
<template #windows-note>

::: warning
Используйте эту сборку только для локальной разработки. Сборки для Windows выходят из отдельного репозитория и могут отставать от релизов для Linux и macOS.
:::

</template>
<template #dev-note>

::: warning
Используйте эту сборку только для локальной разработки. Для продакшена используйте Linux.
:::

</template>
</DownloadBuilds>

</DownloadCard>

<DownloadCard>

## Docker {#docker}

Образ `ghcr.io/rapira-rs/rapira` содержит Rapira, PHP и распространённые расширения PHP. Добавьте в образ своё приложение:

```dockerfile
FROM ghcr.io/rapira-rs/rapira:php8.5
COPY . /app
```

Каждый тег называет версию PHP, например `php8.4`, `php8.5`, `php8.6` или `nightly-php8.5`. Все теги и расширения в составе образа - в разделе [Docker](/ru/docs/intro/installation#docker).

</DownloadCard>

Rapira также можно [собрать из исходников](/ru/docs/intro/build-from-source).
