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
// Estas etiquetas contienen el texto de interfaz de DownloadBuilds.
const labels = {
  os: 'Sistema operativo',
  arch: 'Arquitectura',
  php: 'Versión de PHP',
  format: 'Formato',
  download: 'Descargar Rapira',
  error: 'Esta compilación del sitio no contiene datos de las versiones.',
  releases: 'Abrir los releases',
}
</script>

# Descargar Rapira

La [página de releases de Rapira](https://github.com/rapira-rs/rapira/releases) contiene compilaciones para Linux y macOS. La [página de releases de Rapira para Windows](https://github.com/rapira-rs/rapira-windows/releases) contiene compilaciones para Windows. Elige una plataforma. El botón descarga la última versión estable.

La última versión estable para Windows es v0.8.0. Solo sirve HTTP y usa su propia configuración y conjunto de extensiones. Sigue las [instrucciones de instalación para Windows](/es/docs/intro/installation#windows). Las funciones del código fuente de Windows v0.9 no están en esta descarga.

<DownloadBuilds :labels="labels">
<template #dev-note>

::: warning
Usa esta compilación solo para desarrollo local. Usa Linux para producción.
:::

</template>
</DownloadBuilds>

El selector no muestra las compilaciones nightly ni las imágenes de contenedor. La [prerelease nightly](https://github.com/rapira-rs/rapira/releases/tag/nightly) contiene tarballs y un archivo de sumas de verificación. No contiene paquetes `.deb` ni `.rpm`.

Las imágenes de contenedor están en `ghcr.io/rapira-rs/rapira`. Las etiquetas `nightly-php8.4` y `nightly-php8.5` apuntan a la imagen nightly más reciente. Consulta [Docker](/es/docs/intro/installation#docker) para ver todas las etiquetas de imagen.

También puedes [compilar Rapira desde el código fuente](/es/docs/intro/build-from-source).
