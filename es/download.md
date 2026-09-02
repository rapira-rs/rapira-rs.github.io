---
title: Descargar Rapira
description: Binarios precompilados de Rapira para Linux, macOS y Windows.
sidebar: false
aside: false
editLink: false
lastUpdated: false
prev: false
next: false
---

<script setup>
// Etiquetas para DownloadBuilds — los textos de interfaz de esta página.
const labels = {
  os: 'Sistema operativo',
  arch: 'Arquitectura',
  php: 'Versión de PHP',
  format: 'Formato',
  download: 'Descargar Rapira',
  error: 'Esta compilación del sitio no incluye la lista de builds.',
  releases: 'Abrir los releases',
}
</script>

# Descargar Rapira

Los binarios precompilados se publican en los [releases de GitHub](https://github.com/rapira-rs/rapira/releases). Elige tu plataforma: el botón de abajo descarga su última versión estable.

<DownloadBuilds :labels="labels">
<template #dev-note>

::: warning
Este build es solo para desarrollo local: para producción, usa Linux.
:::

</template>
</DownloadBuilds>

Las imágenes de contenedor se publican en `ghcr.io/rapira-rs/rapira`, y un canal nightly mantiene una prerelease `nightly` que se va renovando, con tarballs y las etiquetas de imagen `nightly-php8.4` y `nightly-php8.5`. El selector de arriba solo lista los archivos de la release. Consulta [Docker](/es/docs/intro/installation#docker) para más información.

También puedes [compilar Rapira desde el código fuente](/es/docs/intro/build-from-source).
