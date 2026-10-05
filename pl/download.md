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
// Te etykiety zawierają teksty interfejsu dla DownloadBuilds.
const labels = {
  os: 'System operacyjny',
  arch: 'Architektura',
  php: 'Wersja PHP',
  format: 'Format',
  download: 'Pobierz Rapirę',
  error: 'Ta kompilacja strony nie zawiera danych o wydaniach.',
  releases: 'Otwórz wydania',
}
</script>

# Pobierz Rapirę

[Strona wydań Rapiry](https://github.com/rapira-rs/rapira/releases) zawiera kompilacje dla Linuksa i macOS. [Strona wydań Rapiry dla Windowsa](https://github.com/rapira-rs/rapira-windows/releases) zawiera kompilacje dla Windowsa. Wybierz platformę. Przycisk pobierze najnowszą stabilną wersję.

Najnowsze stabilne wydanie dla Windowsa to v0.8.0. Obsługuje tylko HTTP i używa własnej konfiguracji oraz zestawu rozszerzeń. Postępuj zgodnie z [instrukcjami instalacji dla Windowsa](/pl/docs/intro/installation#windows). Funkcje źródeł Windows v0.9 nie są dostępne w tym pliku do pobrania.

<DownloadBuilds :labels="labels">
<template #dev-note>

::: warning
Używaj tej kompilacji tylko do lokalnego developmentu. Na produkcji używaj Linuksa.
:::

</template>
</DownloadBuilds>

Selektor nie pokazuje kompilacji nocnych ani obrazów kontenerów. [Nocne przedwydanie](https://github.com/rapira-rs/rapira/releases/tag/nightly) zawiera archiwa tar i plik z sumami kontrolnymi. Nie zawiera pakietów `.deb` ani `.rpm`.

Obrazy kontenerów są w `ghcr.io/rapira-rs/rapira`. Tagi `nightly-php8.4` i `nightly-php8.5` wskazują na najnowszy obraz nocny. Wszystkie tagi obrazów opisuje sekcja [Docker](/pl/docs/intro/installation#docker).

Rapirę możesz też [zbudować ze źródeł](/pl/docs/intro/build-from-source).
