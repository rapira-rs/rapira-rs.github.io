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
// Etykiety dla DownloadBuilds - teksty interfejsu tej strony.
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

[Strona wydań Rapiry](https://github.com/rapira-rs/rapira/releases) zawiera kompilacje dla Linuksa i macOS. [Strona wydań Rapiry dla Windowsa](https://github.com/rapira-rs/rapira-windows/releases) zawiera kompilacje dla Windowsa. Wybierz platformę. Przycisk pobierze najnowszą stabilną wersję.

<DownloadBuilds :labels="labels">
<template #dev-note>

::: warning
Ta kompilacja służy wyłącznie do lokalnego developmentu - na produkcję użyj Linuksa.
:::

</template>
</DownloadBuilds>

Obrazy kontenerów publikujemy w `ghcr.io/rapira-rs/rapira`, a kanał nocnych kompilacji daje kroczącą wersję wstępną `nightly` z tarballami oraz tagi obrazów `nightly-php8.4` i `nightly-php8.5`. Lista powyżej obejmuje wyłącznie pliki z wydań. Więcej informacji znajdziesz w sekcji [Docker](/pl/docs/intro/installation#docker).

Rapirę możesz też [zbudować ze źródeł](/pl/docs/intro/build-from-source).
