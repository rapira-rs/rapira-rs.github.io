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
// DownloadBuilds 的标签——本页的界面文字。
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

预编译版本发布在 [GitHub releases](https://github.com/rapira-rs/rapira/releases) 页面。选好平台，下面的按钮就会下载最新的稳定版。

<DownloadBuilds :labels="labels">
<template #windows-note>

::: warning
Windows 版本仅用于本地开发——生产环境请在 Linux 上运行 Rapira。
:::

</template>
</DownloadBuilds>

你也可以[从源码构建 Rapira](/zh/docs/build-from-source)。
