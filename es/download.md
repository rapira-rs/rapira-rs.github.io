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
  nightly: 'Nightly',
  nightlyPage: 'Abrir la página de la release nightly',
}
</script>

# Descargar Rapira

<DownloadCard>

## Binarios {#binaries}

Cada build contiene el binario `rapira` y `libphp` de la versión de PHP elegida. No necesitas instalar PHP.

<DownloadBuilds :labels="labels">
<template #windows-note>

::: warning
Usa este build solo para desarrollo local. Los builds para Windows salen de un repositorio aparte y pueden ir por detrás de las releases para Linux y macOS.
:::

</template>
<template #dev-note>

::: warning
Usa esta compilación solo para desarrollo local. Usa Linux para producción.
:::

</template>
</DownloadBuilds>

</DownloadCard>

<DownloadCard>

## Docker {#docker}

La imagen `ghcr.io/rapira-rs/rapira` contiene Rapira, PHP y extensiones comunes de PHP. Añade tu aplicación a la imagen:

```dockerfile
FROM ghcr.io/rapira-rs/rapira:php8.5
COPY . /app
```

Cada etiqueta indica su versión de PHP, por ejemplo `php8.4`, `php8.5`, `php8.6` o `nightly-php8.5`. Consulta [Docker](/es/docs/intro/installation#docker) para ver todas las etiquetas y las imágenes de PHP.

</DownloadCard>

También puedes [compilar Rapira desde el código fuente](/es/docs/intro/build-from-source).
