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
| `--classic`       | wyłączone        | Uruchamia skrypt od zera przy każdym żądaniu, zamiast trzymać go rezydentnie.                    |
| `SCRIPT`          | wymagany*        | Skrypt wejściowy PHP. Nadpisuje `pool.entrypoint` z pliku konfiguracyjnego.                      |

\* Wymagany, o ile plik konfiguracyjny nie ustawia `pool.entrypoint`. Gdy nie ma ani jednego, ani drugiego, `serve` zgłasza błąd i nie startuje.

**`--listen`** przyjmuje trzy postacie. `127.0.0.1:8000` (domyślna) wiąże jeden interfejs — wyłącznie pętlę zwrotną, więc nic spoza maszyny się nie połączy. `:8080` to skrót od `0.0.0.0:8080`, czyli wszystkie interfejsy IPv4 — tak zwykle wiąże się serwer w kontenerze; dla IPv6 napisz `[::]:8080`. `unix:/run/rapira.sock` wiąże zamiast tego gniazdo uniksowe, pod reverse proxy na tej samej maszynie. Literały IPv6 zapisujesz w nawiasach kwadratowych: `[::1]:8000`. Sam numer portu *nie jest* adresem i zostanie odrzucony, bo nie mówi, czy wiązać tylko pętlę zwrotną, czy wszystkie interfejsy — `--listen 8080` to błąd, napisz `--listen :8080` albo `--listen 127.0.0.1:8080`. W części hostowej musi stać literał IP, bo nazwy hostów nigdy nie są rozwiązywane: `--listen localhost:8000` to błąd, napisz `--listen 127.0.0.1:8000`.

**`--processes`** domyślnie przyjmuje liczbę logicznych CPU. Przy domyślnej puli statycznej dokładnie tyle procesów workerów zostanie sforkowanych; jeśli plik konfiguracyjny przełączy pulę na `dynamic` albo `ondemand`, ta sama liczba staje się sufitem, do którego te tryby się skalują. Co właściwie robią workery, a co proces master, opisuje [Model procesów](/pl/docs/process-model).

**`--classic`** wybiera tryb, w którym pracuje aplikacja. Bez niej skrypt wejściowy ładuje się raz i zostaje w pamięci — to tryb [SAPI Worker](/pl/docs/worker); z nią skrypt jest dołączany na nowo przy każdym żądaniu, dokładnie tak jak pod php-fpm — to tryb [Classic](/pl/docs/classic). Jeśli nie masz pewności, którego z nich może użyć twoja aplikacja, wszystkie cztery tryby opisują [Tryby wykonania](/pl/docs/execution-modes).

::: info
`--classic` to przełącznik, który potrafi tylko włączać. Nie ma `--no-classic`, więc wpisu `classic = true` w pliku konfiguracyjnym nie wyłączysz z wiersza poleceń — zamiast tego usuń ten klucz z pliku.
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
rapira serve app/worker.php
rapira serve --classic public/index.php
rapira serve --listen :8080 --processes 8 app/worker.php
rapira serve --listen unix:/run/rapira.sock app/worker.php
rapira serve --config /etc/rapira/rapira.toml
rapira serve --config /etc/rapira/rapira.toml --listen 127.0.0.1:9000
```

Pierwsze polecenie nie ma `--listen`, więc serwer wstaje pod domyślnym adresem, a do wysłania żądania wystarczy jeszcze jedna linijka. Skrypt workera, który możesz w ten sposób uruchomić, znajdziesz w [Szybkim starcie](/pl/docs/intro/quickstart).

```bash
curl http://127.0.0.1:8000/
```

## Zatrzymywanie serwera

Pierwszy `SIGINT` albo `SIGTERM` — czyli `Ctrl-C` w terminalu lub sygnał od menedżera usług — pozwala dokończyć żądania będące w toku i porządnie zamyka rozszerzenia; drugi przerywa czekanie i wymusza wyjście. Sygnały trafiają do procesu master, a ich pełną tabelę, razem z przeładowaniem, znajdziesz w [Modelu procesów](/pl/docs/process-model).
