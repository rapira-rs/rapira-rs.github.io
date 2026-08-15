---
title: Czym jest Rapira?
description: "Rapira to szybki i bezpieczny serwer aplikacji PHP napisany w Ruście: przyjmuje żądania HTTP bezpośrednio i obsługuje tryb klasyczny, workera oraz dyspozytora."
---

# Czym jest Rapira

Rapira to szybki i bezpieczny serwer aplikacji PHP napisany w Ruście.

Projektując ją, wykorzystaliśmy lata doświadczeń z utrzymywania RoadRunnera: współpraca z PHP miała być możliwie wydajna i stabilna, a codzienna praca — i przy programowaniu, i na produkcji — nie miała kosztować zbędnego wysiłku.

Rapira nie kończy się na HTTP. W planach mamy obsługę wszystkich popularnych wtyczek RoadRunnera, a o nowościach piszemy na naszym [blogu](/pl/blog/).

## HTTP

Pierwszym zadaniem serwera PHP jest obsługa żądań HTTP. Dzięki technologii Cloudflare Rapira przyjmuje je bezpośrednio, bez nginxa czy Apache'a, i obsługuje wszystkie współczesne standardy HTTP oraz szyfrowania.

Po stronie PHP dostępne są wszystkie modele pracy:

- Klasyczny (SAPI) — każde żądanie uruchamia aplikację od zera, tak samo jak pod php-fpm.
- Worker (SAPI Worker) — aplikacja startuje raz, a potem w pętli obsługuje żądanie za żądaniem przez interfejs SAPI (superglobale PHP wypełniają się na nowo przy każdym żądaniu).
- Dyspozytor — aplikacja nie kończy pracy, a żądania i odpowiedzi przechodzą przez osobne API. W tym trybie możesz obsługiwać je pojedynczo, jedno po drugim (jak w RoadRunnerze), albo współbieżnie, korzystając z [fiberów](https://www.php.net/manual/language.fibers.php).

::: info
Na stronie [Tryby wykonania](/pl/docs/execution-modes) znajdziesz szczegółowe porównanie trybów i wskazówki, który wybrać.
:::
