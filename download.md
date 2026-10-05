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

The [Rapira releases page](https://github.com/rapira-rs/rapira/releases) contains Linux and macOS builds. The [Rapira Windows releases page](https://github.com/rapira-rs/rapira-windows/releases) contains Windows builds. Select a platform. The button downloads the latest stable version.

The latest stable Windows release is v0.8.0. It serves HTTP only and uses its own configuration and extension set. Follow the [Windows installation instructions](/docs/intro/installation#windows). The v0.9 Windows source features are not in this download.

<DownloadBuilds :labels="labels">
<template #dev-note>

::: warning
Use this build only for local development. Use Linux for production.
:::

</template>
</DownloadBuilds>

The selector does not show nightly builds or container images. The [nightly prerelease](https://github.com/rapira-rs/rapira/releases/tag/nightly) contains tarballs and a checksum file. It does not contain `.deb` or `.rpm` packages.

Container images are at `ghcr.io/rapira-rs/rapira`. The `nightly-php8.4` and `nightly-php8.5` tags point to the newest nightly image. See [Docker](/docs/intro/installation#docker) for all image tags.

You can also [build Rapira from source](/docs/intro/build-from-source).
