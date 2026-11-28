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
  nightly: 'Nightly',
  nightlyPage: 'Otwórz stronę wydania nocnego',
}
</script>

# Pobierz Rapirę

<DownloadCard>

## Pliki binarne {#binaries}

Każdy build zawiera plik binarny `rapira` i `libphp` wybranej wersji PHP. Nie musisz instalować PHP.

<DownloadBuilds :labels="labels">
<template #windows-note>

::: warning
Używaj tej kompilacji tylko do lokalnego developmentu. Buildy dla Windowsa powstają w osobnym repozytorium i mogą być w tyle za wydaniami dla Linuksa i macOS.
:::

</template>
<template #dev-note>

::: warning
Używaj tej kompilacji tylko do lokalnego developmentu. Na produkcji używaj Linuksa.
:::

</template>
</DownloadBuilds>

</DownloadCard>

<DownloadCard>

## Docker {#docker}

Obraz `ghcr.io/rapira-rs/rapira` zawiera Rapirę, PHP i popularne rozszerzenia PHP. Dodaj swoją aplikację do obrazu:

```dockerfile
FROM ghcr.io/rapira-rs/rapira:php8.5
COPY . /app
```

Każdy tag wskazuje wersję PHP, na przykład `php8.4`, `php8.5`, `php8.6` lub `nightly-php8.5`. Wszystkie tagi i dołączone rozszerzenia opisuje sekcja [Docker](/pl/docs/intro/installation#docker).

</DownloadCard>

Rapirę możesz też [zbudować ze źródeł](/pl/docs/intro/build-from-source).
