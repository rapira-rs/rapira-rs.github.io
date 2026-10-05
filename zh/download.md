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
}
</script>

# 下载 Rapira

[Rapira 发布页](https://github.com/rapira-rs/rapira/releases)提供 Linux 和 macOS 版本。[Rapira Windows 发布页](https://github.com/rapira-rs/rapira-windows/releases)提供 Windows 版本。请选择平台。按钮会下载最新的稳定版。

Windows 的最新稳定发布是 v0.8.0。它仅提供 HTTP 服务，并使用自己的配置和扩展集。请遵循 [Windows 安装说明](/zh/docs/intro/installation#windows)。此下载不包含 Windows v0.9 源码中的功能。

<DownloadBuilds :labels="labels">
<template #dev-note>

::: warning
此版本仅用于本地开发。生产环境请使用 Linux。
:::

</template>
</DownloadBuilds>

选择器不显示 nightly 构建或容器镜像。[nightly 预发布](https://github.com/rapira-rs/rapira/releases/tag/nightly)包含压缩包和一个校验和文件。它不包含 `.deb` 或 `.rpm` 软件包。

容器镜像位于 `ghcr.io/rapira-rs/rapira`。`nightly-php8.4` 和 `nightly-php8.5` 标签指向最新的 nightly 镜像。所有镜像标签请参阅 [Docker](/zh/docs/intro/installation#docker)。

你也可以[从源码构建 Rapira](/zh/docs/intro/build-from-source)。
