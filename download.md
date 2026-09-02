---
title: Download Rapira
description: Prebuilt Rapira binaries for Linux, macOS and Windows.
sidebar: false
aside: false
editLink: false
lastUpdated: false
prev: false
next: false
---

<script setup>
// These labels contain the UI text for DownloadBuilds.
const labels = {
  os: 'Operating system',
  arch: 'Architecture',
  php: 'PHP version',
  format: 'Format',
  download: 'Download Rapira',
  error: 'This site build does not contain release data.',
  releases: 'Open the releases',
}
</script>

# Download Rapira

The [GitHub releases](https://github.com/rapira-rs/rapira/releases) page contains prebuilt binaries. Select a platform. The button downloads the latest stable version.

<DownloadBuilds :labels="labels">
<template #dev-note>

::: warning
Use this build only for local development. Use Linux for production.
:::

</template>
</DownloadBuilds>

Container images are available at `ghcr.io/rapira-rs/rapira`. The nightly channel contains `nightly` archives and two image tags: `nightly-php8.4` and `nightly-php8.5`.
The selector lists only release files. See [Docker](/docs/intro/installation#docker) for more information.

You can also [build Rapira from source](/docs/intro/build-from-source).
