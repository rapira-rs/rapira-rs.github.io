---
title: "NTS and ZTS PHP images from Rapira"
date: 2026-11-19
description: "We will publish NTS and ZTS images for PHP 8.4, 8.5, and 8.6. New PHP patch releases will trigger automatic rebuilds."
author: Rapira Team
image: /blog/php-docker-images/preview.jpg
---

# NTS and ZTS PHP images from Rapira

Starting with PHP 8.6, the [official PHP Dockerfiles](https://github.com/docker-library/php/pull/1686) enable Zend Thread Safety (ZTS) in every image. Rapira needs a non-thread-safe (NTS) build. We will switch to our own Dockerfiles based on the official PHP CLI Dockerfiles for Debian Trixie. We will build both variants from signed `php-src` release tags.

## PHP base images

When [PR #321](https://github.com/rapira-rs/rapira/pull/321) reaches `main`, we will publish six images for `linux/amd64` and `linux/arm64`. They will contain only PHP and its extensions.

| PHP | NTS | ZTS |
| --- | --- | --- |
| 8.4 | `ghcr.io/rapira-rs/php:8.4-nts` | `ghcr.io/rapira-rs/php:8.4-zts` |
| 8.5 | `ghcr.io/rapira-rs/php:8.5-nts` | `ghcr.io/rapira-rs/php:8.5-zts` |
| 8.6 | `ghcr.io/rapira-rs/php:8.6-nts` | `ghcr.io/rapira-rs/php:8.6-zts` |

Each image will also have a tag with the full PHP version. Here is how to use our PHP 8.6 NTS image in an application Dockerfile:

```dockerfile
FROM ghcr.io/rapira-rs/php:8.6-nts
COPY . /app
```

## Automatic rebuilds

The [`PHP rebuild` workflow](https://github.com/rapira-rs/rapira/blob/df25fe9af110dfe137d9208cff1032742f4ddef0/.github/workflows/php-rebuild.yml) in GitHub Actions will check for stable `php-src` tags every 15 minutes. A new patch will trigger builds of both variants for that PHP minor. Changes to `dockerfiles/` on `main` will trigger builds for all three versions. After seven days without a build, the workflow will rebuild the images without cached layers to install Debian package updates.

Our [root `Dockerfile`](https://github.com/rapira-rs/rapira/blob/df25fe9af110dfe137d9208cff1032742f4ddef0/Dockerfile) will build the Rapira server image separately on the NTS base. When the NTS base digest changes, the workflow will rebuild the latest Rapira release for that PHP minor and update its image tags.
