---
title: Wiersz poleceń
description: Wszystkie opcje polecenia rapira serve, sposób nakładania się flag na plik konfiguracyjny i reguły, według których Rapira odnajduje skrypt wejściowy.
---

# Wiersz poleceń

Rapira to jeden plik binarny z jednym podpoleceniem:

```bash
rapira serve [OPTIONS] [SCRIPT]
```

To `serve` podnosi serwer: uruchamia PHP, rejestruje wbudowane rozszerzenia i zaczyna odpowiadać na żądania. Samo `rapira` bez argumentów wypisze pomoc i zakończy działanie, a `rapira serve --help` wylistuje poniższe opcje prosto z binarki. `rapira --version` powie ci, jaką wersję masz u siebie.

Pliku konfiguracyjnego nie musisz pisać *nigdy*. Jedno polecenie ze ścieżką do skryptu to już kompletny, działający serwer — plik konfiguracyjny czeka na dzień, w którym flagi przestaną ci wystarczać.

## Jak nakładają się ustawienia

Każde ustawienie Rapira ustala z maksymalnie trzech warstw, sprawdzanych w tej kolejności:

**Flagi wiersza poleceń > plik konfiguracyjny > wbudowane wartości domyślne.**

Z wiersza poleceń da się ustawić tylko cztery flagi z poniższej tabeli; cała reszta pochodzi z pliku albo z wartości domyślnej.

Flaga zawsze wygrywa z tą samą wartością w `rapira.toml`, a `rapira.toml` zawsze wygrywa z wartością domyślną. Właśnie ta kolejność sprawia, że `--config` naprawdę się przydaje: stabilną konfigurację trzymasz w pliku, a pojedynczą wartość nadpisujesz w wierszu poleceń na jeden przebieg — inny port na czas testów, więcej workerów na większej maszynie — i nie musisz niczego edytować.

Czego nie ustawisz nigdzie, to spadnie do wartości domyślnych z poniższej tabeli. Pełną listę tego, co może znaleźć się w pliku konfiguracyjnym, znajdziesz w [Konfiguracji](/pl/docs/configuration).

## Opcje

| Opcja             | Domyślnie        | Co robi                                                                                          |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `--config <PATH>` | brak             | Wczytuje ustawienia z pliku `rapira.toml`.                                                       |
| `--listen <ADDR>` | `127.0.0.1:8000` | Adres nasłuchu: `host:port`, `:port` (wszystkie interfejsy) albo `unix:<path>`.                  |
| `--processes <N>` | liczba CPU       | Ile procesów workerów sforkować.                                                                 |
| `--classic`       | wyłączone        | Uruchamia skrypt od zera przy każdym żądaniu, zamiast trzymać go rezydentnie.                    |
| `SCRIPT`          | wymagany*        | Skrypt wejściowy PHP. Nadpisuje `pool.entrypoint` z pliku konfiguracyjnego.                      |

\* Wymagany, o ile plik konfiguracyjny nie ustawia `pool.entrypoint`. Gdy nie ma ani jednego, ani drugiego, `serve` odmawia startu i mówi dlaczego.

**`--listen`** przyjmuje trzy postacie. `127.0.0.1:8000` (domyślna) wiąże jeden interfejs — wyłącznie pętlę zwrotną, więc nic spoza maszyny się nie dobije. `:8080` to skrót od `0.0.0.0:8080`, czyli wszystkie interfejsy IPv4 — tego chcesz w kontenerze; dla IPv6 napisz `[::]:8080`. `unix:/run/rapira.sock` wiąże zamiast tego gniazdo uniksowe, pod reverse proxy na tej samej maszynie. Literały IPv6 zapisujesz w nawiasach kwadratowych: `[::1]:8000`. Sam numer portu *nie jest* adresem i zostanie odrzucony — `--listen 8080` to błąd, napisz `--listen :8080`. W części hostowej musi stać literał IP, bo nazwy hostów nigdy nie są rozwiązywane: `--listen localhost:8000` to błąd, napisz `--listen 127.0.0.1:8000`.

**`--processes`** domyślnie przyjmuje liczbę logicznych CPU. Przy domyślnej puli statycznej dokładnie tyle procesów workerów zostanie sforkowanych; jeśli plik konfiguracyjny przełączy pulę na `dynamic` albo `ondemand`, ta sama liczba staje się sufitem, do którego te tryby się skalują. Co właściwie robią workery, a co proces master, opisuje [Model procesów](/pl/docs/process-model).

**`--classic`** wybiera szczebel, na którym pracuje aplikacja. Bez niej skrypt wejściowy ładuje się raz i zostaje w pamięci — to szczebel [SAPI Worker](/pl/docs/worker); z nią skrypt jest dołączany na nowo przy każdym żądaniu, dokładnie tak jak pod php-fpm — to szczebel [Classic](/pl/docs/classic). Jeśli nie masz pewności, który szczebel udźwignie twoja aplikacja, całą drabinę przechodzą [Tryby wykonania](/pl/docs/execution-modes).

::: info
`--classic` to przełącznik, który potrafi tylko włączać. Nie ma `--no-classic`, więc pliku konfiguracyjnego z `classic = true` nie przegadasz z wiersza poleceń — zamiast tego usuń ten klucz z pliku.
:::

## Skąd bierze się skrypt wejściowy

Skrypt można podać dwa razy — argumentem pozycyjnym `SCRIPT` albo kluczem `pool.entrypoint` w pliku konfiguracyjnym — a gdy pojawią się oba, wygrywa wiersz poleceń. Tak czy inaczej Rapira zamienia ścieżkę na bezwzględną, zanim serwer cokolwiek sforkuje, bo katalog roboczy demona to nie ten katalog, do którego wdrożyłeś aplikację.

Obie ścieżki względne liczą się od innej bazy i ta różnica jest zamierzona:

- Względny `SCRIPT` z wiersza poleceń liczy się od **bieżącego katalogu** — wpisałeś go w powłoce, która już gdzieś stoi, więc to właśnie ten katalog masz na myśli.
- Względny `pool.entrypoint` liczy się od **katalogu samego pliku konfiguracyjnego** — dzięki temu plik konfiguracyjny razem z leżącą obok aplikacją można przenieść, skopiować albo zamontować w dowolnym miejscu jako całość i nadal będą się odnajdywać.

```toml
[pool]
entrypoint = "public/index.php"
```

Gdy taki wpis leży w `/etc/rapira/rapira.toml`, skryptem wejściowym jest `/etc/rapira/public/index.php` — niezależnie od tego, w jakim katalogu akurat byłeś, uruchamiając polecenie.

## Przykłady

Garść wywołań, które pokrywają większość tego, co faktycznie będziesz wpisywać:

```bash
rapira serve app/worker.php
rapira serve --classic public/index.php
rapira serve --listen :8080 --processes 8 app/worker.php
rapira serve --listen unix:/run/rapira.sock app/worker.php
rapira serve --config /etc/rapira/rapira.toml
rapira serve --config /etc/rapira/rapira.toml --listen 127.0.0.1:9000
```

Pierwsze z nich to w zasadzie cały [Szybki start](/pl/docs/quickstart): bez `--listen` serwer wstaje pod domyślnym adresem, więc do zapukania wystarczy jeszcze jedna linijka.

```bash
curl http://127.0.0.1:8000/
```

## Zatrzymywanie serwera

Pierwszy `SIGINT` albo `SIGTERM` — czyli `Ctrl-C` w terminalu lub sygnał od menedżera usług — pozwala dokończyć żądania będące w toku i porządnie zamyka rozszerzenia; drugi przerywa czekanie i wymusza wyjście. Sygnały trafiają do procesu master, a ich pełną tabelę, razem z przeładowaniem, znajdziesz w [Modelu procesów](/pl/docs/process-model).

::: question Dlaczego `--listen 8080` jest odrzucane?
Bo sam numer portu nie mówi, które interfejsy zająć, a Rapira musiałaby zgadywać między pętlą zwrotną a wszystkim naraz. Napisz wprost, o co ci chodzi: `--listen :8080` dla wszystkich interfejsów IPv4, `--listen 127.0.0.1:8080` tylko dla pętli zwrotnej.
:::

::: question Czy plik konfiguracyjny jest w ogóle potrzebny?
Nie. Same flagi wystarczą, żeby uruchomić serwer, a wszystko, czego nie ustawisz, ma wartość domyślną. Po `--config` sięgnij wtedy, gdy potrzebujesz czegoś, czego flagi nie wystawiają — skalowania puli, logowania, limitów żądań. Wszystko to opisuje [Konfiguracja](/pl/docs/configuration).
:::

::: question Podałem `--config` i `SCRIPT`. Który skrypt się uruchomi?
Ten z wiersza poleceń. Flagi stoją wyżej od pliku, więc pozycyjny `SCRIPT` nadpisuje `pool.entrypoint`, a wszystkie pozostałe ustawienia z pliku dalej obowiązują — wygodne, gdy chcesz na jeden przebieg skierować istniejącą konfigurację na inny skrypt wejściowy.
:::
