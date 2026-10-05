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
}
</script>

# Скачать Rapira

[Страница релизов Rapira](https://github.com/rapira-rs/rapira/releases) содержит сборки для Linux и macOS. [Страница релизов Rapira для Windows](https://github.com/rapira-rs/rapira-windows/releases) содержит сборки для Windows. Выберите платформу. Кнопка скачивает последнюю стабильную версию.

Последний стабильный релиз для Windows - v0.8.0. Он обслуживает только HTTP и использует собственную конфигурацию и набор расширений. Следуйте [инструкциям по установке для Windows](/ru/docs/intro/installation#windows). Функции исходников Windows v0.9 отсутствуют в этой загрузке.

<DownloadBuilds :labels="labels">
<template #dev-note>

::: warning
Используйте эту сборку только для локальной разработки. Для продакшена используйте Linux.
:::

</template>
</DownloadBuilds>

Выбор платформы не показывает ночные сборки и контейнерные образы. [Ночной предрелиз](https://github.com/rapira-rs/rapira/releases/tag/nightly) содержит архивы и файл контрольных сумм. Он не содержит пакеты `.deb` и `.rpm`.

Контейнерные образы находятся в `ghcr.io/rapira-rs/rapira`. Теги `nightly-php8.4` и `nightly-php8.5` указывают на самый новый ночной образ. Все теги образов описаны в разделе [Docker](/ru/docs/intro/installation#docker).

Rapira также можно [собрать из исходников](/ru/docs/intro/build-from-source).
