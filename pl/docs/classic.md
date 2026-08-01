---
title: Tryb klasyczny
description: "Tryb klasyczny wykonuje zwykły front controller w PHP od zera przy każdym żądaniu, tak jak robi to php-fpm, za każdym razem od czystego stanu."
---

# Tryb klasyczny

Tryb klasyczny wykonuje zwykły front controller w PHP — ten sam `public/index.php`, na który dziś kierujesz php-fpm — od zera przy każdym przychodzącym żądaniu. Rapira wchodzi na miejsce php-fpm, a aplikacja nie wymaga żadnych zmian: zmienne superglobalne są wypełnione, skrypt wykonuje się od góry do dołu, a to, co wypisze, staje się odpowiedzią.

## Świeży stan przy każdym żądaniu

Każde żądanie dostaje pełny cykl żądania PHP: inicjalizacja żądania, twój skrypt wejściowy, zamknięcie żądania. Wszystko, co skrypt zbudował po drodze — zmienne globalne, statyczne właściwości, kontener DI, identity map ORM-a — zostaje sprzątnięte, zanim zacznie się następne żądanie, dokładnie tak jak pod php-fpm.

Wyciekły uchwyt, singleton zainicjalizowany do połowy, biblioteka chowająca dane żądania w statycznym polu — nic z tego nie wpłynie na następne żądanie, bo nic, co utworzył twój skrypt, nie przeżywa żądania, w którym zostało utworzone. Wyjątki są te same co w php-fpm: trwałe połączenia i stan trzymany przez rozszerzenia żyją w procesie workera, a nie w żądaniu. Kod, którego nikt nie pisał z myślą o długo żyjącym procesie, działa tu bez zmian. Funkcja `fastcgi_finish_request()` pochodzi z binarki php-fpm i pod Rapirą nie jest dostępna; Rapira udostępnia w zamian `rapira_finish_request()` z tą samą umową — odesłać odpowiedź do klienta wcześniej i pracować dalej — opisaną na stronie [HTTP](/pl/docs/http).

Aplikacja startuje od nowa przy każdym żądaniu: autoloader, konfiguracja, kontener, trasy. Więcej informacji znajdziesz w [Trybach wykonania](/pl/docs/execution-modes).

## Jak go włączyć

Tryb wybierasz na dwa sposoby, oba dają ten sam efekt:

- `--classic` w wierszu poleceń, obok skryptu wejściowego.
- `classic = true` w sekcji `[pool]` pliku `rapira.toml`.

Flaga potrafi tryb wyłącznie *włączyć* — nie ma czegoś takiego jak `--no-classic`, więc jeśli plik konfiguracyjny ustawia `classic = true`, tryb klasyczny zostaje bez względu na to, co podasz w wierszu poleceń. Poza tym obowiązuje zwykłe pierwszeństwo: flagi wygrywają z plikiem konfiguracyjnym. Pełną listę kluczy znajdziesz w [Konfiguracji](/pl/docs/configuration).

Klasyczny skrypt wejściowy to zwykły PHP:

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Skieruj na niego Rapirę jednym albo drugim sposobem:

::: code-group

```bash [CLI]
rapira serve --classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
classic = true
```

:::

Z plikiem konfiguracyjnym serwer uruchamiasz poleceniem `rapira serve --config rapira.toml`. Względną ścieżkę w `pool.entrypoint` Rapira liczy od katalogu samego pliku konfiguracyjnego, dzięki czemu plik możesz swobodnie przenosić; względną ścieżkę skryptu podaną w wierszu poleceń liczy od katalogu bieżącego. Resztę opcji opisuje [Wiersz poleceń](/pl/docs/cli).

## Skrypt wejściowy

Rapira nie mapuje adresów URL na pliki na dysku i sama z siebie niczego z dysku nie serwuje. Każde żądanie uruchamia wskazany przez ciebie skrypt wejściowy, niezależnie od ścieżki, a sam adres trafia do `$_SERVER['REQUEST_URI']` i to aplikacja decyduje, gdzie go skierować.

Wynikają z tego wartości zmiennych CGI: `SCRIPT_FILENAME` to zawsze skrypt wejściowy, `SCRIPT_NAME` — jego nazwa pliku z ukośnikiem na początku (`/index.php`), a `DOCUMENT_ROOT` — katalog, w którym leży. Pliki statyczne potrzebują czegoś przed Rapirą: CDN-a albo reverse proxy, które stawia [Wdrożenie produkcyjne](/pl/docs/deployment).

## OPcache

Wykonanie od zera resetuje stan twojej aplikacji, a nie skompilowany bytecode. Proces nadrzędny uruchamia PHP dokładnie raz, przy starcie modułu, *zanim* sforkuje jakiegokolwiek workera — dzięki temu OPcache tworzy swój segment pamięci współdzielonej jeden jedyny raz, a każdy sforkowany worker dziedziczy dokładnie to samo mapowanie. Przy włączonym OPcache skompilowane skrypty zostają w cache'u między żądaniami i w obrębie całej puli, więc ponowne wykonanie front controllera nie oznacza ponownego parsowania.

Sama pula procesów wygląda tak samo w obu trybach: proces nadrzędny forkuje workery, a każdy worker obsługuje jedno żądanie naraz, więc współbieżność bierze się z ich liczby. Więcej o procesie nadrzędnym i jego workerach znajdziesz na stronie [model procesów](/pl/docs/process-model).

::: info
W trybie klasycznym `Rapira\create_plugin_handler()` rzuca wyjątek `Rapira\RapiraException`: *plugin handlers require worker mode*. Nie ma tu rezydentnej pętli, której można by oddać handler, bo skrypt kończy się razem z żądaniem. Skrypty workera należą do trybu [SAPI Worker](/pl/docs/worker).
:::

## Wybór między Classic a SAPI Worker

Użyj trybu klasycznego, gdy stan aplikacji nie przetrwa drugiego żądania — stary kod, framework wyciekający do statycznych pól, biblioteka z `vendor/`, na którą nie masz wpływu — albo gdy przesiadasz się z php-fpm i wolisz zmieniać po jednej rzeczy naraz. Użyj trybu [SAPI Worker](/pl/docs/worker), gdy kod zniesie proces, który nie umiera, i chcesz pozbyć się pracy startowej wykonywanej przy każdym żądaniu. Strona [Tryby wykonania](/pl/docs/execution-modes) opisuje wszystkie cztery tryby — dziś dostępne są Classic i SAPI Worker.
