---
title: Wiersz poleceń
description: "Wszystkie opcje polecenia rapira serve, sposób nakładania się flag na plik konfiguracyjny i reguły rozwiązywania ścieżek skryptu wejściowego."
---

# Wiersz poleceń

Rapira to jeden plik binarny z jednym podpoleceniem:

```bash
rapira serve [OPTIONS] [SCRIPT]
```

Polecenie `serve` uruchamia PHP, rejestruje wbudowane rozszerzenia i przyjmuje żądania.
Uruchom `rapira` bez argumentów, aby wyświetlić pomoc. Uruchom `rapira serve --help`, aby wyświetlić dostępne opcje.
Uruchom `rapira --version`, aby wyświetlić zainstalowaną wersję.

Plik konfiguracyjny jest opcjonalny. Polecenie ze ścieżką skryptu może uruchomić serwer z ustawieniami domyślnymi.

## Priorytet ustawień

Rapira odczytuje ustawienia w następującej kolejności:

**Flagi wiersza poleceń > plik konfiguracyjny > wbudowane wartości domyślne.**

Tylko cztery flagi z tabeli i argument `SCRIPT` mają formę wiersza poleceń. Pozostałe ustawienia używają pliku lub wartości domyślnej.

Flaga zastępuje odpowiednią wartość w `rapira.toml`. Wartość w `rapira.toml` zastępuje wartość domyślną.
Ta kolejność umożliwia użycie wartości tymczasowej podczas jednego uruchomienia. Na przykład przetestuj inny port bez edycji pliku.

Niezdefiniowane opcje używają wartości domyślnych z tabeli. Plik kontroluje skalowanie puli, logowanie i limity żądań.
Wszystkie ustawienia pliku zawiera [Konfiguracja](/pl/docs/configuration).

## Opcje

| Opcja             | Domyślnie        | Co robi                                                                                          |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `--config <PATH>` | brak             | Wczytuje ustawienia z pliku `rapira.toml`.                                                       |
| `--listen <ADDR>` | `127.0.0.1:8000` | Adres nasłuchu: `host:port`, `:port` (wszystkie interfejsy) albo `unix:<path>`.                  |
| `--processes <N>` | liczba CPU       | Ile procesów workerów sforkować.                                                                 |
| `--mode <MODE>`   | `dispatcher`     | Tryb pracy: `classic`, `worker` albo `dispatcher`. Nadpisuje `pool.mode` z pliku konfiguracyjnego. |
| `SCRIPT`          | wymagany*        | Skrypt wejściowy PHP. Nadpisuje `pool.entrypoint` z pliku konfiguracyjnego.                      |

\* Wymagany, o ile plik konfiguracyjny nie ustawia `pool.entrypoint`. Gdy nie ma ani jednego, ani drugiego, `serve` zgłasza błąd i nie startuje.

**`--listen`** przyjmuje trzy formaty adresu. `127.0.0.1:8000` wiąże interfejs pętli zwrotnej.
Systemy zdalne nie mogą połączyć się z tym adresem. `:8080` odpowiada `0.0.0.0:8080` i wiąże wszystkie interfejsy IPv4.
Użyj `[::]:8080` dla wszystkich interfejsów IPv6. `unix:/run/rapira.sock` tworzy gniazdo uniksowe dla lokalnego reverse proxy.
Literały IPv6 umieszczaj w nawiasach kwadratowych, na przykład `[::1]:8000`.
Rapira odrzuca port bez adresu. Użyj `--listen :8080` albo `--listen 127.0.0.1:8080`.
Rapira nie rozwiązuje nazw hostów w tej opcji. Użyj `127.0.0.1:8000` zamiast `localhost:8000`.

**`--processes`** domyślnie przyjmuje liczbę logicznych CPU. Skalowanie statyczne używa jej jako dokładnej liczby workerów.
Skalowanie dynamiczne i `ondemand` używają jej jako liczby maksymalnej. Więcej informacji zawiera [Model procesów](/pl/docs/process-model).

**`--mode`** wybiera tryb pracy. Domyślny jest `dispatcher`: rezydentny skrypt sam pobiera kolejne żądania od Rapiry. `worker` trzyma skrypt wejściowy rezydentnie i przy każdym żądaniu uruchamia handler. `classic` wykonuje skrypt wejściowy od zera przy każdym żądaniu, tak jak pod php-fpm. Flaga przyjmuje wartość, więc wskaże dowolny tryb bez względu na to, co ustawia plik konfiguracyjny. Więcej informacji znajdziesz w [trybie Classic](/pl/docs/classic), [trybie Worker](/pl/docs/worker) i [Trybach wykonania](/pl/docs/execution-modes).

::: info
`pool.scaling` i `pool.mode` to dwa różne klucze. `pool.scaling` wybiera politykę, która dobiera rozmiar puli. `pool.processes` podaje liczbę workerów, do której ta polityka się stosuje, a `--processes` ją nadpisuje. `pool.mode` decyduje o tym, co worker robi z żądaniem. `pool.scaling` nie ma własnej flagi. Ustaw go w pliku konfiguracyjnym.
:::

## Rozwiązywanie ścieżki skryptu wejściowego

Skrypt można podać dwa razy - argumentem pozycyjnym `SCRIPT` albo kluczem `pool.entrypoint` w pliku konfiguracyjnym - a gdy pojawią się oba, wygrywa wiersz poleceń, natomiast pozostałe ustawienia z pliku dalej obowiązują. Tak czy inaczej Rapira zamienia ścieżkę na bezwzględną, zanim serwer cokolwiek sforkuje, bo katalog roboczy demona to nie ten katalog, do którego wdrożyłeś aplikację.

Obie ścieżki względne liczą się od innej bazy:

- Względny `SCRIPT` z wiersza poleceń liczy się od **bieżącego katalogu**.
- Względny `pool.entrypoint` liczy się od **katalogu samego pliku konfiguracyjnego** - dzięki temu plik konfiguracyjny razem z leżącą obok aplikacją można przenieść, skopiować albo zamontować w dowolnym miejscu jako całość, a ścieżka nadal rozwiąże się poprawnie.

```toml
[pool]
entrypoint = "public/index.php"
```

Gdy taki wpis leży w `/etc/rapira/rapira.toml`, skryptem wejściowym jest `/etc/rapira/public/index.php` - niezależnie od katalogu, z którego uruchomiłeś polecenie.

## Przykłady

Typowe wywołania:

```bash
rapira serve app/dispatcher.php
rapira serve --mode worker app/worker.php
rapira serve --mode classic public/index.php
rapira serve --listen :8080 --processes 8 app/dispatcher.php
rapira serve --listen unix:/run/rapira.sock app/dispatcher.php
rapira serve --config /etc/rapira/rapira.toml
rapira serve --config /etc/rapira/rapira.toml --listen 127.0.0.1:9000
```

Pierwsze polecenie nie ustawia `--listen`. Dlatego serwer używa adresu domyślnego.
Wyślij żądanie tym poleceniem:

```bash
curl http://127.0.0.1:8000/
```

Skrypty wejściowe do poleceń `--mode classic` i `--mode worker` znajdziesz w [Szybkim starcie](/pl/docs/intro/quickstart). Skrypt wejściowy dla trybu Dispatcher weź z pliku `dispatcher-sync.php` albo `dispatcher-async.php` w katalogu [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) w repozytorium.

## Zatrzymywanie serwera

Pierwszy `SIGINT` albo `SIGTERM` pozwala dokończyć bieżące żądania. Następnie serwer zamyka rozszerzenia i kończy pracę.
Drugi sygnał kończy oczekiwanie i wymusza wyjście. Wysyłaj sygnały do procesu nadrzędnego.
Pełną tabelę sygnałów zawiera [Model procesów](/pl/docs/process-model).
