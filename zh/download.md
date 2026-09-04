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
// DownloadBuilds 的标签--本页的界面文字。
const labels = {
  os: '操作系统',
  arch: '架构',
  php: 'PHP 版本',
  format: '格式',
  download: '下载 Rapira',
  error: '这次站点构建没有带上版本列表。',
  releases: '打开 releases 页面',
}
</script>

# 下载 Rapira

[Rapira 发布页](https://github.com/rapira-rs/rapira/releases)提供 Linux 和 macOS 版本。[Rapira Windows 发布页](https://github.com/rapira-rs/rapira-windows/releases)提供 Windows 版本。请选择平台。按钮会下载最新的稳定版。

<DownloadBuilds :labels="labels">
<template #dev-note>

::: warning
此版本仅用于本地开发--生产环境请使用 Linux。
:::

</template>
</DownloadBuilds>

容器镜像发布在 `ghcr.io/rapira-rs/rapira`。此外还有一条 nightly 通道：滚动更新的 `nightly` 预发布带着压缩包，镜像标签则是 `nightly-php8.4` 和 `nightly-php8.5`。上面的选择器只列正式发布的文件。更多内容见 [Docker](/zh/docs/intro/installation#docker)。

你也可以[从源码构建 Rapira](/zh/docs/intro/build-from-source)。
