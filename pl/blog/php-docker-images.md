---
title: "Obrazy PHP od Rapiry: NTS i ZTS"
date: 2026-11-19
description: "Opublikujemy obrazy PHP 8.4, 8.5 i 8.6 w wariantach NTS i ZTS. Nowe wydanie poprawkowe PHP uruchomi automatyczną przebudowę obrazów."
author: Rapira Team
image: /blog/php-docker-images/preview.jpg
---

# Obrazy PHP od Rapiry: NTS i ZTS

Od wersji PHP 8.6 [oficjalne pliki Dockerfile projektu PHP](https://github.com/docker-library/php/pull/1686) włączają Zend Thread Safety (ZTS) we wszystkich obrazach. Rapira wymaga kompilacji bez tego mechanizmu (NTS). Przejdziemy na własne pliki Dockerfile oparte na oficjalnych plikach dla PHP CLI w systemie Debian Trixie. Oba warianty będziemy budować z kodu oznaczonego podpisanymi tagami wydań `php-src`.

## Obrazy bazowe PHP

Gdy zmiany z [PR #321](https://github.com/rapira-rs/rapira/pull/321) trafią do gałęzi `main`, opublikujemy sześć obrazów dla platform `linux/amd64` i `linux/arm64`. Będą zawierać tylko PHP i jego rozszerzenia.

| PHP | NTS | ZTS |
| --- | --- | --- |
| 8.4 | `ghcr.io/rapira-rs/php:8.4-nts` | `ghcr.io/rapira-rs/php:8.4-zts` |
| 8.5 | `ghcr.io/rapira-rs/php:8.5-nts` | `ghcr.io/rapira-rs/php:8.5-zts` |
| 8.6 | `ghcr.io/rapira-rs/php:8.6-nts` | `ghcr.io/rapira-rs/php:8.6-zts` |

Każdy obraz otrzyma też tag z pełną wersją PHP. Tak możesz użyć naszego obrazu PHP 8.6 NTS w pliku Dockerfile aplikacji:

```dockerfile
FROM ghcr.io/rapira-rs/php:8.6-nts
COPY . /app
```

## Automatyczna przebudowa

[Proces `PHP rebuild`](https://github.com/rapira-rs/rapira/blob/df25fe9af110dfe137d9208cff1032742f4ddef0/.github/workflows/php-rebuild.yml) w GitHub Actions będzie co 15 minut sprawdzać tagi stabilnych wydań `php-src`. Nowe wydanie poprawkowe uruchomi budowę obu wariantów dla danej wersji PHP. Zmiany w `dockerfiles/` na gałęzi `main` uruchomią budowę obrazów dla wszystkich trzech wersji. Jeśli przez siedem dni nie powstanie nowy obraz, proces zbuduje obrazy ponownie bez użycia warstw z pamięci podręcznej, aby zainstalować aktualizacje pakietów Debiana.

Za pomocą [pliku Dockerfile w głównym katalogu repozytorium](https://github.com/rapira-rs/rapira/blob/df25fe9af110dfe137d9208cff1032742f4ddef0/Dockerfile) zbudujemy osobny obraz serwera Rapira na bazie NTS. Gdy zmieni się skrót obrazu bazowego NTS, proces przebuduje najnowsze wydanie Rapiry dla danej wersji PHP i zaktualizuje tagi obrazu.
