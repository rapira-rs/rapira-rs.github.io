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
<template #dev-note>

::: warning
This build is for local development only — for production, use Linux.
:::

</template>
</DownloadBuilds>

Container images are published at `ghcr.io/rapira-rs/rapira`, and a nightly channel carries a rolling `nightly` prerelease with tarballs plus `nightly-php8.4` and `nightly-php8.5` image tags. The picker above lists the release files only. See [Docker](/docs/intro/installation#docker) for more information.

You can also [build Rapira from source](/docs/intro/build-from-source).
