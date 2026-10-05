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
  nightly: 'Nightly',
  nightlyPage: 'Open the nightly release page',
}
</script>

# Download Rapira

<DownloadCard>

## Binaries {#binaries}

Each build contains the `rapira` binary and `libphp` for the selected PHP version. You do not need to install PHP.

<DownloadBuilds :labels="labels">
<template #windows-note>

::: warning
Use this build only for local development. Windows builds come from a separate repository and can be behind the Linux and macOS releases.
:::

</template>
<template #dev-note>

::: warning
Use this build only for local development. Use Linux for production.
:::

</template>
</DownloadBuilds>

</DownloadCard>

<DownloadCard>

## Docker {#docker}

The `ghcr.io/rapira-rs/rapira` image contains only Rapira and `libphp.so`. Copy its files into your application image:

```dockerfile
FROM php:8.5-cli-trixie
COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /
RUN apt-get update \
    && xargs -r apt-get install -y --no-install-recommends < /usr/local/share/rapira/debian-packages.txt \
    && rm -rf /var/lib/apt/lists/*
COPY . /app
CMD ["rapira", "serve", "/app/rapira.toml"]
```

Each tag names its PHP version, for example `php8.4`, `php8.5`, or `nightly-php8.5`. See [Docker](/docs/intro/installation#docker) for all tags.

</DownloadCard>

You can also [build Rapira from source](/docs/intro/build-from-source).
