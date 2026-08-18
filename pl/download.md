---
title: Pobierz Rapirę
description: Gotowe kompilacje Rapiry dla Linuksa, macOS i Windowsa.
sidebar: false
aside: false
editLink: false
lastUpdated: false
prev: false
next: false
---

<script setup>
// Etykiety dla DownloadBuilds — teksty interfejsu tej strony.
const labels = {
  os: 'System operacyjny',
  arch: 'Architektura',
  php: 'Wersja PHP',
  format: 'Format',
  download: 'Pobierz Rapirę',
  error: 'Ta kompilacja strony nie zawiera listy buildów.',
  releases: 'Otwórz wydania',
}
</script>

# Pobierz Rapirę

Gotowe kompilacje publikujemy w [wydaniach na GitHubie](https://github.com/rapira-rs/rapira/releases). Wybierz platformę — przycisk poniżej pobierze najnowszą stabilną wersję dla niej.

<DownloadBuilds :labels="labels">
<template #dev-note>

::: warning
Ta kompilacja służy wyłącznie do lokalnego developmentu — na produkcję użyj Linuksa.
:::

</template>
</DownloadBuilds>

Rapirę możesz też [zbudować ze źródeł](/pl/docs/intro/build-from-source).
