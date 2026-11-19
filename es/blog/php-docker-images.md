---
title: "Imágenes de PHP NTS y ZTS de Rapira"
date: 2026-11-19
description: "Publicaremos imágenes NTS y ZTS para PHP 8.4, 8.5 y 8.6. Se reconstruirán automáticamente cuando PHP publique una versión de parche."
author: Rapira Team
image: /blog/php-docker-images/preview.jpg
---

# Imágenes de PHP NTS y ZTS de Rapira

A partir de PHP 8.6, los [Dockerfiles oficiales de PHP](https://github.com/docker-library/php/pull/1686) activan Zend Thread Safety (ZTS) en todas las imágenes. Rapira necesita una compilación sin esa protección (NTS). Pasaremos a usar nuestros propios Dockerfiles, basados en los oficiales de PHP CLI para Debian Trixie. Compilaremos ambas variantes a partir de las etiquetas firmadas de las versiones de `php-src`.

## Imágenes base de PHP

Cuando los cambios del [PR #321](https://github.com/rapira-rs/rapira/pull/321) lleguen a `main`, publicaremos seis imágenes para `linux/amd64` y `linux/arm64`. Solo contendrán PHP y sus extensiones.

| PHP | NTS | ZTS |
| --- | --- | --- |
| 8.4 | `ghcr.io/rapira-rs/php:8.4-nts` | `ghcr.io/rapira-rs/php:8.4-zts` |
| 8.5 | `ghcr.io/rapira-rs/php:8.5-nts` | `ghcr.io/rapira-rs/php:8.5-zts` |
| 8.6 | `ghcr.io/rapira-rs/php:8.6-nts` | `ghcr.io/rapira-rs/php:8.6-zts` |

Cada imagen tendrá también una etiqueta con la versión completa de PHP. Así podrás usar nuestra imagen NTS de PHP 8.6 en el Dockerfile de una aplicación:

```dockerfile
FROM ghcr.io/rapira-rs/php:8.6-nts
COPY . /app
```

## Reconstrucciones automáticas

El [flujo de trabajo `PHP rebuild`](https://github.com/rapira-rs/rapira/blob/df25fe9af110dfe137d9208cff1032742f4ddef0/.github/workflows/php-rebuild.yml) de GitHub Actions comprobará cada 15 minutos las etiquetas estables de `php-src`. Una nueva versión de parche iniciará la compilación de ambas variantes para esa versión menor de PHP. Los cambios en `dockerfiles/` en la rama `main` iniciarán la compilación de las tres versiones. Si pasan siete días desde la última compilación, el flujo reconstruirá las imágenes sin usar la caché de capas para instalar las actualizaciones de los paquetes de Debian.

Con el [Dockerfile de la raíz del repositorio](https://github.com/rapira-rs/rapira/blob/df25fe9af110dfe137d9208cff1032742f4ddef0/Dockerfile) construiremos por separado la imagen del servidor Rapira sobre la base NTS. Cuando cambie el digest de esa base, el flujo reconstruirá la última versión de Rapira para esa versión menor de PHP y actualizará las etiquetas de la imagen.
