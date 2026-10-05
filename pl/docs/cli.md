---
title: Wiersz poleceń
description: "Polecenie rapira serve, jego argument z plikiem konfiguracyjnym, ścieżki względne, sygnały zatrzymania i kody wyjścia."
---

# Wiersz poleceń

Rapira to jeden plik binarny z jednym podpoleceniem:

```bash
rapira serve <CONFIG>
```

Polecenie `serve` uruchamia PHP, przygotowuje wtyczki i obsługuje żądania. `CONFIG` to ścieżka do pliku konfiguracyjnego i jest wymagana. Dowolna nazwa pliku działa, a ta dokumentacja używa `rapira.toml`.

Uruchom `rapira` bez argumentów, aby wyświetlić pomoc. Uruchom `rapira serve --help`, aby wyświetlić pomoc polecenia. Uruchom `rapira --version`, aby wyświetlić zainstalowaną wersję.

Plik konfiguracyjny zawiera wszystkie ustawienia serwera. Wartość w pliku zastępuje wbudowaną wartość domyślną. `RUST_LOG` i `NO_COLOR` zmieniają tylko wyjście stderr. Wszystkie klucze i formaty adresu `listen` opisuje [Konfiguracja](/pl/docs/configuration).

::: question Czy mogę ustawić tryb albo adres nasłuchu w wierszu poleceń?
Nie. `rapira serve` przyjmuje tylko plik konfiguracyjny. Ustaw `processes`, `mode` i `entrypoint` w `[http.pool]`. Ustaw `listen` w `[http]`.
:::

## Ścieżki względne

Ścieżka względna w pliku używa katalogu pliku konfiguracyjnego jako podstawy. Dotyczy to `http.pool.entrypoint`, `grpc.pool.entrypoint` i pozostałych kluczy ze ścieżkami. Na przykład `entrypoint = "public/index.php"` w `/etc/rapira/rapira.toml` wskazuje `/etc/rapira/public/index.php`. Bieżący katalog nie wpływa na te ścieżki. Względna ścieżka nasłuchu `unix:` działa inaczej: używa bieżącego katalogu polecenia `rapira serve`. Listę kluczy ze ścieżkami zawiera sekcja [Ścieżki względne](/pl/docs/configuration#sciezki-wzgledne).

## Przykład

Ten plik `rapira.toml` obsługuje HTTP w trybie Dispatcher, który jest trybem domyślnym:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/dispatcher.php"
```

Aby wybrać inny tryb, ustaw `mode = "worker"` albo `mode = "classic"` w `[http.pool]`. Tryby opisuje strona [Tryby wykonania](/pl/docs/execution-modes).

Uruchom serwer, podając ścieżkę do pliku:

```bash
rapira serve rapira.toml
rapira serve /etc/rapira/rapira.toml
```

Serwer nasłuchuje na `127.0.0.1:8000`. Wyślij żądanie tym poleceniem:

```bash
curl http://127.0.0.1:8000/
```

Skrypty wejściowe dla trybów Classic i Worker znajdziesz w [Szybkim starcie](/pl/docs/intro/quickstart). Skrypt wejściowy dla trybu Dispatcher weź z pliku `dispatcher-sync.php` w katalogu [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) w repozytorium. Przewodnik programowania opisuje strona [Tryb Dispatcher](/pl/docs/dispatcher).

## Zatrzymywanie serwera

Pierwszy `SIGTERM` albo `SIGINT` rozpoczyna kontrolowane zatrzymanie. Workery nie przyjmują nowej pracy i kończą bieżące żądania. Następnie proces nadrzędny zamyka PHP i kończy pracę. Drugi `SIGTERM` albo `SIGINT` kończy oczekiwanie i wymusza wyjście. Wysyłaj sygnały do procesu nadrzędnego. Pełną tabelę sygnałów zawiera [Model procesów](/pl/docs/process-model).

Ctrl-C w terminalu wysyła `SIGINT` do procesu nadrzędnego i do każdego workera. Następnie proces nadrzędny wysyła `SIGQUIT` do każdego workera, więc każdy worker dostaje drugi sygnał i natychmiast kończy pracę z kodem `131`. Bieżące żądania nie kończą się. Aby wykonać kontrolowane zatrzymanie, wyślij `SIGTERM` tylko do procesu nadrzędnego, na przykład `kill -TERM <master-pid>`. systemd z `KillMode=mixed` i `docker stop` także wysyłają sygnał tylko do procesu nadrzędnego.

## Kody wyjścia

| Kod | Znaczenie |
| --- | --- |
| `0` | Serwer zatrzymał się i wszystkie workery zakończyły pracę. `--help`, `--version` i `rapira` bez argumentów także kończą się kodem `0`. |
| `1` | Serwer nie uruchomił się. Na przykład konfiguracja jest nieprawidłowa, Rapira nie może odczytać pliku, nasłuch nie może się powiązać z adresem albo PHP nie może się uruchomić. Błąd jest na stderr. |
| `2` | Wiersz poleceń jest nieprawidłowy, na przykład zawiera nieznaną opcję albo brakuje `CONFIG`. |
| `70` | Proces nadrzędny uległ awarii po uruchomieniu. Na przykład łączna liczba workerów wszystkich pul przekracza 2048 albo proces nadrzędny nie może zapisać pliku pidfile. Ten kod powoduje też niezdrowy worker generacji zero, jeśli jego pula nie ma udanego żądania ani bezczynnego lub aktywnego workera. Generacja zero oznacza workery utworzone przed pierwszym przeładowaniem. Log zawiera wpis `master failed`. |
| `130` | `SIGTERM` albo `SIGINT` dotarł podczas zatrzymywania i wymusił wyjście. |
