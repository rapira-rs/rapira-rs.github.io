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

Образ `ghcr.io/rapira-rs/rapira` содержит только Rapira и `libphp.so`. Скопируйте его файлы в образ своего приложения:

```dockerfile
FROM php:8.5-cli-trixie
COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /
RUN apt-get update \
    && xargs -r apt-get install -y --no-install-recommends < /usr/local/share/rapira/debian-packages.txt \
    && rm -rf /var/lib/apt/lists/*
COPY . /app
CMD ["rapira", "serve", "/app/rapira.toml"]
```

Каждый тег называет версию PHP, например `php8.4`, `php8.5` или `nightly-php8.5`. Все теги - в разделе [Docker](/ru/docs/intro/installation#docker).

</DownloadCard>

Rapira также можно [собрать из исходников](/ru/docs/intro/build-from-source).
