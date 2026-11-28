---
title: 下载 Rapira
description: Rapira 的 Linux、macOS 和 Windows 预编译版本。
sidebar: false
aside: false
editLink: false
lastUpdated: false
prev: false
next: false
---

<script setup>
// 这些标签是 DownloadBuilds 的界面文字。
const labels = {
  os: '操作系统',
  arch: '架构',
  php: 'PHP 版本',
  format: '格式',
  download: '下载 Rapira',
  error: '此站点构建不包含发布数据。',
  releases: '打开 releases 页面',
  nightly: 'Nightly',
  nightlyPage: '打开 nightly 发布页',
}
</script>

# 下载 Rapira

<DownloadCard>

## 二进制文件 {#binaries}

每个构建都包含 `rapira` 二进制文件和所选 PHP 版本的 `libphp`，无需另外安装 PHP。

<DownloadBuilds :labels="labels">
<template #windows-note>

::: warning
此版本仅用于本地开发。Windows 版本来自单独的仓库，可能落后于 Linux 和 macOS 的发布。
:::

</template>
<template #dev-note>

::: warning
此版本仅用于本地开发。生产环境请使用 Linux。
:::

</template>
</DownloadBuilds>

</DownloadCard>

<DownloadCard>

## Docker {#docker}

镜像 `ghcr.io/rapira-rs/rapira` 包含 Rapira、PHP 和常用的 PHP 扩展。请将你的应用添加到镜像中：

```dockerfile
FROM ghcr.io/rapira-rs/rapira:php8.5
COPY . /app
```

每个标签都标明 PHP 版本，例如 `php8.4`、`php8.5`、`php8.6` 或 `nightly-php8.5`。全部标签和随附扩展见 [Docker](/zh/docs/intro/installation#docker)。

</DownloadCard>

你也可以[从源码构建 Rapira](/zh/docs/intro/build-from-source)。
