---
title: Czym jest Rapira?
description: Rapira to serwer aplikacji PHP napisany w języku Rust. Obsługuje tryby Classic, Worker i Dispatcher.
---

# Czym jest Rapira

Rapira to serwer aplikacji PHP napisany w języku Rust.

Opiekunowie projektu RoadRunner projektują i implementują Rapirę. Rapira wywołuje PHP bezpośrednio w procesie serwera.

Rapira obsługuje obecnie HTTP. Projekt planuje obsługę większej liczby funkcji wtyczek RoadRunnera.
Na [blogu](/pl/blog/) znajdują się aktualności projektu.

## HTTP

Rapira zawiera serwer HTTP, który używa biblioteki [hyper](https://hyper.rs). Serwer przyjmuje bezpośrednio nieszyfrowane połączenia HTTP.
Serwer nie kończy TLS. [Proxy kończące TLS](https://en.wikipedia.org/wiki/TLS_termination_proxy) przyjmuje HTTPS od klienta, odszyfrowuje połączenie i wysyła nieszyfrowany HTTP do Rapiry.
Konfigurację proxy opisuje [Wdrożenie produkcyjne](/pl/docs/deployment).

Rapira obsługuje trzy tryby wykonania PHP:

- Classic: Rapira inicjalizuje aplikację dla każdego żądania, tak jak php-fpm.
- Worker: Rapira inicjalizuje aplikację raz. Pętla obsługuje żądania, a Rapira ponownie wypełnia superglobale PHP dla każdego żądania.
- Dispatcher: Rapira inicjalizuje aplikację raz. Skrypt pobiera obiekty żądań przez wywołanie API. Może przetwarzać żądania kolejno lub współbieżnie za pomocą [włókien](https://www.php.net/manual/en/language.fibers.php).

::: info
Strona [Tryby wykonania](/pl/docs/execution-modes) opisuje działanie trybów i kryteria wyboru.
:::
