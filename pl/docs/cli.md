---
title: Wiersz poleceń
description: "Wszystkie opcje polecenia rapira serve, sposób nakładania się flag na plik konfiguracyjny i reguły rozwiązywania ścieżek skryptu wejściowego."
---

# Wiersz poleceń

Rapira to jeden plik binarny z jednym podpoleceniem:

```bash
rapira serve [OPTIONS] [SCRIPT]
```

To `serve` podnosi serwer: uruchamia PHP, rejestruje wbudowane rozszerzenia i zaczyna odpowiadać na żądania. Samo `rapira` bez argumentów wypisze pomoc i zakończy działanie, a `rapira serve --help` wylistuje poniższe opcje prosto z binarki. `rapira --version` powie ci, jaką wersję masz u siebie.

Plik konfiguracyjny jest opcjonalny: jedno polecenie ze ścieżką do skryptu to już kompletny, działający serwer, a plik przydaje się dopiero wtedy, gdy flagi przestają wystarczać.

## Jak nakładają się ustawienia

Każde ustawienie Rapira ustala z maksymalnie trzech warstw, sprawdzanych w tej kolejności:

**Flagi wiersza poleceń > plik konfiguracyjny > wbudowane wartości domyślne.**

Z wiersza poleceń da się ustawić tylko cztery flagi z poniższej tabeli i argument `SCRIPT`; cała reszta pochodzi z pliku albo z wartości domyślnej.

Flaga zawsze wygrywa z tą samą wartością w `rapira.toml`, a `rapira.toml` zawsze wygrywa z wartością domyślną. Taka kolejność pozwala trzymać stabilną konfigurację w pliku i nadpisać pojedynczą wartość w wierszu poleceń na jeden przebieg — inny port na czas testów, więcej workerów na większej maszynie — bez edytowania czegokolwiek.

Czego nie ustawisz nigdzie, to spadnie do wartości domyślnych z poniższej tabeli. Ustawienia, których flagi nie wystawiają — skalowanie puli, logowanie, limity żądań — pochodzą z pliku, a pełną listę tego, co może znaleźć się w pliku konfiguracyjnym, znajdziesz w [Konfiguracji](/pl/docs/configuration).

## Opcje

| Opcja             | Domyślnie        | Co robi                                                                                          |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `--config <PATH>` | brak             | Wczytuje ustawienia z pliku `rapira.toml`.                                                       |
| `--listen <ADDR>` | `127.0.0.1:8000` | Adres nasłuchu: `host:port`, `:port` (wszystkie interfejsy) albo `unix:<path>`.                  |
| `--processes <N>` | liczba CPU       | Ile procesów workerów sforkować.                                                                 |
| `--mode <MODE>`   | `dispatcher`     | Tryb pracy: `classic`, `worker` albo `dispatcher`. Nadpisuje `pool.mode` z pliku konfiguracyjnego. |
| `SCRIPT`          | wymagany*        | Skrypt wejściowy PHP. Nadpisuje `pool.entrypoint` z pliku konfiguracyjnego.                      |

\* Wymagany, o ile plik konfiguracyjny nie ustawia `pool.entrypoint`. Gdy nie ma ani jednego, ani drugiego, `serve` zgłasza błąd i nie startuje.

**`--listen`** przyjmuje trzy postacie. `127.0.0.1:8000` (domyślna) wiąże jeden interfejs — wyłącznie pętlę zwrotną, więc nic spoza maszyny się nie połączy. `:8080` to skrót od `0.0.0.0:8080`, czyli wszystkie interfejsy IPv4 — tak zwykle wiąże się serwer w kontenerze; dla IPv6 napisz `[::]:8080`. `unix:/run/rapira.sock` wiąże zamiast tego gniazdo uniksowe, pod reverse proxy na tej samej maszynie. Literały IPv6 zapisujesz w nawiasach kwadratowych: `[::1]:8000`. Sam numer portu *nie jest* adresem i zostanie odrzucony, bo nie mówi, czy wiązać tylko pętlę zwrotną, czy wszystkie interfejsy — `--listen 8080` to błąd, napisz `--listen :8080` albo `--listen 127.0.0.1:8080`. W części hostowej musi stać literał IP, bo nazwy hostów nigdy nie są rozwiązywane: `--listen localhost:8000` to błąd, napisz `--listen 127.0.0.1:8000`.

**`--processes`** domyślnie przyjmuje liczbę logicznych CPU. Przy domyślnym `pool.scaling = "static"` dokładnie tyle procesów workerów zostanie sforkowanych; jeśli plik konfiguracyjny ustawi `pool.scaling` na `dynamic` albo `ondemand`, ta sama liczba staje się sufitem, do którego te polityki się skalują. Co właściwie robią workery, a co proces master, opisuje [Model procesów](/pl/docs/process-model).

**`--mode`** wybiera tryb pracy. Domyślny jest `dispatcher`: rezydentny skrypt sam pobiera kolejne żądania od Rapiry. `worker` trzyma skrypt wejściowy rezydentnie i przy każdym żądaniu uruchamia handler. `classic` wykonuje skrypt wejściowy od zera przy każdym żądaniu, tak jak pod php-fpm. Flaga przyjmuje wartość, więc wskaże dowolny tryb bez względu na to, co ustawia plik konfiguracyjny. Więcej informacji znajdziesz w [trybie Classic](/pl/docs/classic), [trybie Worker](/pl/docs/worker) i [Trybach wykonania](/pl/docs/execution-modes).

::: info
`pool.scaling` i `pool.mode` to dwa różne klucze. `pool.scaling` wybiera politykę, która dobiera rozmiar puli. `pool.processes` podaje liczbę workerów, do której ta polityka się stosuje, a `--processes` ją nadpisuje. `pool.mode` decyduje o tym, co worker robi z żądaniem. `pool.scaling` nie ma własnej flagi. Ustaw go w pliku konfiguracyjnym.
:::

## Rozwiązywanie ścieżki skryptu wejściowego

Skrypt można podać dwa razy — argumentem pozycyjnym `SCRIPT` albo kluczem `pool.entrypoint` w pliku konfiguracyjnym — a gdy pojawią się oba, wygrywa wiersz poleceń, natomiast pozostałe ustawienia z pliku dalej obowiązują. Tak czy inaczej Rapira zamienia ścieżkę na bezwzględną, zanim serwer cokolwiek sforkuje, bo katalog roboczy demona to nie ten katalog, do którego wdrożyłeś aplikację.

Obie ścieżki względne liczą się od innej bazy:

- Względny `SCRIPT` z wiersza poleceń liczy się od **bieżącego katalogu**.
- Względny `pool.entrypoint` liczy się od **katalogu samego pliku konfiguracyjnego** — dzięki temu plik konfiguracyjny razem z leżącą obok aplikacją można przenieść, skopiować albo zamontować w dowolnym miejscu jako całość, a ścieżka nadal rozwiąże się poprawnie.

```toml
[pool]
entrypoint = "public/index.php"
```

Gdy taki wpis leży w `/etc/rapira/rapira.toml`, skryptem wejściowym jest `/etc/rapira/public/index.php` — niezależnie od katalogu, z którego uruchomiłeś polecenie.

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

Pierwsze polecenie nie ma `--listen`, więc serwer wstaje pod domyślnym adresem. Do wysłania żądania wystarczy jeszcze jedna linijka.

```bash
curl http://127.0.0.1:8000/
```

Skrypty wejściowe do poleceń `--mode classic` i `--mode worker` znajdziesz w [Szybkim starcie](/pl/docs/intro/quickstart). Skrypt wejściowy dla trybu Dispatcher weź z pliku `dispatcher-sync.php` albo `dispatcher-async.php` w katalogu [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) w repozytorium.

## Zatrzymywanie serwera

Pierwszy `SIGINT` albo `SIGTERM` — czyli `Ctrl-C` w terminalu lub sygnał od menedżera usług — pozwala dokończyć żądania będące w toku i porządnie zamyka rozszerzenia; drugi przerywa czekanie i wymusza wyjście. Sygnały trafiają do procesu master, a ich pełną tabelę, razem z przeładowaniem, znajdziesz w [Modelu procesów](/pl/docs/process-model).
