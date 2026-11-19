---
title: "Rapira 将发布 NTS 和 ZTS 两种 PHP 镜像"
date: 2026-11-19
description: "我们将为 PHP 8.4、8.5 和 8.6 提供 NTS 和 ZTS 两种镜像，并在 PHP 发布补丁版本时自动重新构建。"
author: Rapira Team
image: /blog/php-docker-images/preview.jpg
---

# Rapira 将发布 NTS 和 ZTS 两种 PHP 镜像

从 PHP 8.6 开始，[PHP 官方 Dockerfile](https://github.com/docker-library/php/pull/1686) 为所有镜像启用 Zend 线程安全（ZTS）。Rapira 需要非线程安全（NTS）版本的 PHP。我们将改用自己维护的 Dockerfile，以 PHP CLI 在 Debian Trixie 上的官方 Dockerfile 为基础，从 `php-src` 已签名的发布标签构建这两种镜像。

## PHP 基础镜像

当 [PR #321](https://github.com/rapira-rs/rapira/pull/321) 的改动进入 `main` 分支后，我们将为 `linux/amd64` 和 `linux/arm64` 两个平台发布以下六个镜像。它们只包含 PHP 及其扩展。

| PHP | NTS | ZTS |
| --- | --- | --- |
| 8.4 | `ghcr.io/rapira-rs/php:8.4-nts` | `ghcr.io/rapira-rs/php:8.4-zts` |
| 8.5 | `ghcr.io/rapira-rs/php:8.5-nts` | `ghcr.io/rapira-rs/php:8.5-zts` |
| 8.6 | `ghcr.io/rapira-rs/php:8.6-nts` | `ghcr.io/rapira-rs/php:8.6-zts` |

每个镜像还会有一个包含完整 PHP 版本号的标签。应用的 Dockerfile 可以这样使用我们的 PHP 8.6 NTS 镜像：

```dockerfile
FROM ghcr.io/rapira-rs/php:8.6-nts
COPY . /app
```

## 自动重新构建

GitHub Actions 的 [`PHP rebuild` 工作流](https://github.com/rapira-rs/rapira/blob/df25fe9af110dfe137d9208cff1032742f4ddef0/.github/workflows/php-rebuild.yml) 将每 15 分钟检查一次 `php-src` 的稳定版标签。出现新补丁版本时，工作流会重新构建对应 PHP 次版本的两种镜像。`main` 分支的 `dockerfiles/` 目录发生变化时，工作流会重新构建全部三个 PHP 次版本的镜像。如果距上次构建已满七天，工作流会在不使用层缓存的情况下重新构建镜像，以安装 Debian 软件包更新。

我们将使用[仓库根目录的 `Dockerfile`](https://github.com/rapira-rs/rapira/blob/df25fe9af110dfe137d9208cff1032742f4ddef0/Dockerfile)，以 NTS 镜像为基础单独构建 Rapira 服务器镜像。当 NTS 基础镜像的摘要发生变化时，工作流会为对应的 PHP 次版本重新构建最新发布的 Rapira 版本，并更新镜像标签。
