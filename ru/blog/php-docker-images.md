---
title: "Образы PHP от Rapira: NTS и ZTS"
date: 2026-11-19
description: "Мы будем публиковать образы NTS и ZTS для PHP 8.4, 8.5 и 8.6. При выходе патч-релиза PHP образы будут пересобираться автоматически."
author: Rapira Team
image: /blog/php-docker-images/preview.jpg
---

# Образы PHP от Rapira: NTS и ZTS

Начиная с PHP 8.6, [официальные Dockerfile для PHP](https://github.com/docker-library/php/pull/1686) включают Zend Thread Safety (ZTS) во всех образах. Для Rapira нужна сборка без поддержки потокобезопасности (NTS). Мы перейдём на собственные Dockerfile, за основу которых возьмём официальные Dockerfile для PHP CLI на Debian Trixie. Оба варианта будем собирать по подписанным тегам релизов `php-src`.

## Базовые образы PHP

Когда изменения из [PR #321](https://github.com/rapira-rs/rapira/pull/321) попадут в `main`, мы опубликуем шесть образов для `linux/amd64` и `linux/arm64`. В них будут только PHP и его расширения.

| PHP | NTS | ZTS |
| --- | --- | --- |
| 8.4 | `ghcr.io/rapira-rs/php:8.4-nts` | `ghcr.io/rapira-rs/php:8.4-zts` |
| 8.5 | `ghcr.io/rapira-rs/php:8.5-nts` | `ghcr.io/rapira-rs/php:8.5-zts` |
| 8.6 | `ghcr.io/rapira-rs/php:8.6-nts` | `ghcr.io/rapira-rs/php:8.6-zts` |

У каждого образа также будет тег с полной версией PHP. Вот как использовать наш образ PHP 8.6 NTS в Dockerfile приложения:

```dockerfile
FROM ghcr.io/rapira-rs/php:8.6-nts
COPY . /app
```

## Автоматическая пересборка

Каждые 15 минут [процесс `PHP rebuild`](https://github.com/rapira-rs/rapira/blob/df25fe9af110dfe137d9208cff1032742f4ddef0/.github/workflows/php-rebuild.yml) в GitHub Actions будет проверять теги стабильных релизов `php-src`. При выходе патч-релиза он соберёт оба варианта для соответствующей минорной версии PHP. При изменениях в `dockerfiles/` в ветке `main` он соберёт образы для всех трёх версий. Если с последней сборки пройдёт семь дней, процесс пересоберёт образы без кеша слоёв, чтобы установить обновления пакетов Debian.

Образ сервера Rapira мы будем собирать отдельно на базе NTS с помощью [Dockerfile в корне репозитория](https://github.com/rapira-rs/rapira/blob/df25fe9af110dfe137d9208cff1032742f4ddef0/Dockerfile). При изменении дайджеста базового образа NTS процесс пересоберёт последний релиз Rapira для этой минорной версии PHP и обновит теги образа.
