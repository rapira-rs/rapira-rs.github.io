---
title: Wiersz poleceń
description: "Polecenie rapira serve, jego argument z plikiem konfiguracyjnym, ścieżki względne, sygnały zatrzymania i kody wyjścia."
---

# Wiersz poleceń

Rapira to jeden plik binarny z jednym podpoleceniem:

```bash
rapira serve <CONFIG>
```

Polecenie `serve` uruchamia PHP, przygotowuje wtyczki i obsługuje żądania na pierwszym planie. `CONFIG` to ścieżka do pliku konfiguracyjnego i jest wymagana. Dowolna nazwa pliku działa, a ta dokumentacja używa `rapira.toml`.

Uruchom `rapira` bez argumentów, aby wyświetlić pomoc. Uruchom `rapira serve --help`, aby wyświetlić pomoc polecenia. Uruchom `rapira --version`, aby wyświetlić zainstalowaną wersję.

Plik konfiguracyjny zawiera wszystkie ustawienia serwera. Wartość w pliku zastępuje wbudowaną wartość domyślną. `RUST_LOG` i `NO_COLOR` zmieniają tylko wyjście stderr. Wszystkie klucze i formaty adresu `listen` opisuje [Konfiguracja](/pl/docs/configuration).

::: question Czy mogę ustawić tryb albo adres nasłuchu w wierszu poleceń?
Nie. `rapira serve` przyjmuje tylko plik konfiguracyjny. Ustaw `workers`, `mode` i `entrypoint` w `[http.pool]`. Ustaw `listen` w `[http]`.
:::

## Ścieżki względne

Ścieżka względna w pliku konfiguracyjnym używa katalogu pliku konfiguracyjnego jako podstawy. Dotyczy to `http.pool.entrypoint`, `grpc.pool.entrypoint`, względnych ścieżek nasłuchu `unix:` i wszystkich pozostałych kluczy ze ścieżkami. Na przykład `entrypoint = "public/index.php"` w `/etc/rapira/rapira.toml` wskazuje `/etc/rapira/public/index.php`. Bieżący katalog nie wpływa na te ścieżki. Listę kluczy ze ścieżkami zawiera sekcja [Ścieżki względne](/pl/docs/configuration#relative-paths).

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

Pierwszy sygnał `SIGTERM`, `SIGINT` lub `SIGQUIT` rozpoczyna kontrolowane zatrzymanie. Rapira zamyka nasłuchy, obsługuje otwarte połączenia do końca w ramach `[server].stop_timeout_secs`, zamyka PHP i kończy działanie. Naciśnięcie `Ctrl-C` w terminalu wysyła `SIGINT` i wykonuje to samo kontrolowane zatrzymanie.

Drugi sygnał `SIGTERM` lub `SIGINT` podczas zamykania połączeń wymusza natychmiastowe wyjście z kodem `130`. Pełną tabelę sygnałów zawiera [Model procesów](/pl/docs/process-model).

## Kody wyjścia {#exit-codes}

| Kod | Znaczenie |
| --- | --- |
| `0` | Serwer zatrzymał się czysto. `--help`, `--version` i `rapira` bez argumentów także kończą się kodem `0`. |
| `1` | Błąd uruchomienia lub działania, na przykład nieprawidłowa konfiguracja, nieczytelny plik, błąd powiązania adresu, błąd konfiguracji PHP lub `SIGRTMAX` albo awaria nasłuchu. Błąd jest na stderr. |
| `2` | Wiersz poleceń jest nieprawidłowy, na przykład zawiera nieznaną opcję albo brakuje `CONFIG`. |
| `70` | Rezydentny worker osiągnął `max_boot_failures`, zanim jego pula obsłużyła jednostkę. |
| `101` | Wątek workera PHP wywołał panikę. |
| `124` | Wszystkie workery w jednej puli pozostały zablokowane po 5-sekundowym okresie dodatkowym watchdog po przekroczeniu `request_terminate_timeout_secs`. |
| `130` | Drugi sygnał `SIGTERM` lub `SIGINT` dotarł podczas zatrzymywania i wymusił wyjście. |
