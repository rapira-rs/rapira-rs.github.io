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
// Labels for DownloadBuilds — this page's UI strings.
const labels = {
  os: 'Operating system',
  arch: 'Architecture',
  php: 'PHP version',
  format: 'Format',
  download: 'Download Rapira',
  error: 'This build of the site carries no release data.',
  releases: 'Open the releases',
}
</script>

# Download Rapira

Prebuilt binaries are published on the [GitHub releases](https://github.com/rapira-rs/rapira/releases) page. Pick your platform — the button below downloads its latest stable version.

<DownloadBuilds :labels="labels">
<template #windows-note>

::: warning
Windows builds are for local development only — in production Rapira runs on Linux or macOS.
:::

</template>
</DownloadBuilds>

You can also [build Rapira from source](/docs/build-from-source).
