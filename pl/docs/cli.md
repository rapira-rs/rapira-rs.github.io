---
title: Wiersz poleceń
description: "Polecenie rapira serve, jego argument z plikiem konfiguracyjnym i reguły rozwiązywania ścieżek skryptu wejściowego."
---

# Wiersz poleceń

Rapira to jeden plik binarny z jednym podpoleceniem:

```bash
rapira serve <CONFIG>
```

Polecenie `serve` uruchamia PHP, rejestruje wbudowane rozszerzenia i przyjmuje żądania. `CONFIG` to ścieżka do pliku konfiguracyjnego. Jest wymagana. Dowolna nazwa pliku działa, a ta dokumentacja używa `rapira.toml`. Uruchom `rapira` bez argumentów, aby wyświetlić pomoc. Uruchom `rapira serve --help`, aby wyświetlić pomoc polecenia. Uruchom `rapira --version`, aby wyświetlić zainstalowaną wersję.

Plik konfiguracyjny zawiera wszystkie ustawienia serwera. Wartość w pliku zastępuje wbudowaną wartość domyślną. `RUST_LOG` i `NO_COLOR` zmieniają tylko wyjście stderr. Wszystkie klucze i formaty adresu `listen` opisuje [Konfiguracja](/pl/docs/configuration).

## Rozwiązywanie ścieżki skryptu wejściowego

`http.pool.entrypoint` wskazuje skrypt wejściowy PHP. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Rapira przekształca ścieżkę na bezwzględną przed utworzeniem workerów. Dlatego późniejsze zmiany katalogu roboczego nie wpływają na ścieżkę.

```toml
[http.pool]
entrypoint = "public/index.php"
```

To ustawienie w `/etc/rapira/rapira.toml` wskazuje `/etc/rapira/public/index.php`. Bieżący katalog nie wpływa na wynik.

## Przykłady

Każdy przykład to kompletny plik `rapira.toml`. Tryb Dispatcher jest domyślny:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/dispatcher.php"
mode = "dispatcher"
```

Tryb Worker:

```toml
[http]
listen = ":8080"

[http.pool]
entrypoint = "app/worker.php"
mode = "worker"
```

Tryb Classic:

```toml
[http]
listen = "unix:/run/rapira.sock"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

Uruchom serwer, podając ścieżkę do pliku:

```bash
rapira serve rapira.toml
rapira serve /etc/rapira/rapira.toml
```

Pierwszy przykład nasłuchuje na `127.0.0.1:8000`. Wyślij żądanie tym poleceniem:

```bash
curl http://127.0.0.1:8000/
```

Skrypty wejściowe dla trybów Classic i Worker znajdziesz w [Szybkim starcie](/pl/docs/intro/quickstart). Skrypt wejściowy dla trybu Dispatcher weź z pliku `dispatcher-sync.php` albo `dispatcher-async.php` w katalogu [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) w repozytorium.

## Zatrzymywanie serwera

Pierwszy `SIGINT` albo `SIGTERM` pozwala dokończyć bieżące żądania. Następnie serwer zamyka rozszerzenia i kończy pracę. Drugi sygnał kończy oczekiwanie i wymusza wyjście. Wysyłaj sygnały do procesu nadrzędnego. Pełną tabelę sygnałów zawiera [Model procesów](/pl/docs/process-model).
