---
title: Tryb klasyczny
description: Szczebel Rapiry skrojony na miarę php-fpm — zwykły front controller wykonywany od zera przy każdym żądaniu, za każdym razem od czystego stanu.
---

# Tryb klasyczny

Od trybu klasycznego zaczyna większość aplikacji, a wielu z nich żaden inny szczebel nigdy nie będzie potrzebny. Skryptem wejściowym jest zwykły front controller w PHP — ten sam `public/index.php`, na który dziś kierujesz php-fpm — a Rapira wykonuje go od zera przy każdym przychodzącym żądaniu. Twój kod w ogóle nie musi wiedzieć, że działa w serwerze napisanym w Ruście: zmienne superglobalne są wypełnione, skrypt wykonuje się od góry do dołu, a to, co wypisze, staje się odpowiedzią.

Na tym polega cała obietnica pierwszego szczebla: Rapira wchodzi na miejsce php-fpm, a aplikacja tego nie zauważa.

## Świeży stan przy każdym żądaniu

Każde żądanie dostaje pełny cykl żądania PHP: inicjalizacja żądania, twój skrypt wejściowy, zamknięcie żądania. Wszystko, co skrypt zbudował po drodze — zmienne globalne, statyczne właściwości, kontener DI, identity map ORM-a — zostaje sprzątnięte, zanim zacznie się następne żądanie, dokładnie tak jak pod php-fpm.

Dlatego właśnie tryb klasyczny można bezpiecznie podstawić pod istniejącą aplikację. Wyciekły uchwyt, singleton zepsuty w połowie żądania, biblioteka chowająca dane żądania w statycznym polu — nic z tego nie dotrze do następnego żądania, bo nic, co utworzył twój skrypt, nie przeżywa żądania, w którym powstało. Wyjątki są te same co w php-fpm: trwałe połączenia i stan trzymany przez rozszerzenia żyją w procesie workera, a nie w żądaniu. Kod, którego nikt nie pisał z myślą o długo żyjącym procesie, czuje się tu dobrze — a takiego kodu jest dziś na produkcji naprawdę dużo.

Cena jest jedna: aplikacja startuje od nowa przy każdym żądaniu — autoloader, konfiguracja, kontener, trasy. Czy to boli, to dokładnie pytanie, wokół którego kręcą się [Tryby wykonania](/pl/docs/execution-modes).

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

## Zawsze jeden skrypt wejściowy

Rapira nie mapuje adresów URL na pliki na dysku i sama z siebie niczego z dysku nie serwuje. Każde żądanie uruchamia wskazany przez ciebie skrypt wejściowy, niezależnie od ścieżki, a sam adres trafia do `$_SERVER['REQUEST_URI']` i to aplikacja decyduje, gdzie go skierować. Efekt jest ten sam, co przy regule nginx przepisującej wszystko na `index.php` — tyle że bez reguły.

Wynikają z tego wartości zmiennych CGI: `SCRIPT_FILENAME` to zawsze skrypt wejściowy, `SCRIPT_NAME` — jego nazwa pliku z ukośnikiem na początku (`/index.php`), a `DOCUMENT_ROOT` — katalog, w którym leży. Pliki statyczne potrzebują czegoś przed Rapirą: CDN-a albo reverse proxy, które stawia [Wdrożenie produkcyjne](/pl/docs/deployment).

## Co i tak zostaje rozgrzane

„Od zera” dotyczy stanu twojej aplikacji, a nie pracy kompilatora. Proces nadrzędny uruchamia PHP dokładnie raz, przy starcie modułu, *zanim* sforkuje jakiegokolwiek workera — dzięki temu OPcache tworzy swój segment pamięci współdzielonej jeden jedyny raz, a każdy sforkowany worker dziedziczy dokładnie to samo mapowanie. Przy włączonym OPcache skompilowane skrypty zostają w cache'u między żądaniami i w obrębie całej puli, więc ponowne wykonanie front controllera nie oznacza ponownego parsowania.

Co dokładnie dzieje się przy forkowaniu — jeden proces nadrzędny, N workerów, kto co obsługuje — opisuje [model procesów](/pl/docs/process-model).

::: info
W trybie klasycznym `Rapira\create_plugin_handler()` rzuca wyjątek `Rapira\RapiraException`: *plugin handlers require worker mode*. Nie ma tu rezydentnej pętli, której można by oddać handler, bo skrypt kończy się razem z żądaniem. Skrypty workera należą do szczebla [SAPI Worker](/pl/docs/worker).
:::

## Zostać tu czy wspinać się wyżej

Zostań w trybie klasycznym, gdy stan aplikacji nie przetrwa drugiego żądania — stary kod, framework wyciekający do statycznych pól, biblioteka z `vendor/`, na którą nie masz wpływu — albo po prostu dlatego, że przesiadasz się z php-fpm i wolisz zmieniać po jednej rzeczy naraz. Wejdź na szczebel [SAPI Worker](/pl/docs/worker), gdy pozbycie się pracy startowej zacznie się opłacać, a kod zniesie proces, który nie umiera. Całą drabinę przechodzą [Tryby wykonania](/pl/docs/execution-modes) — z jej szczebli działają dziś Classic i SAPI Worker.

::: question Moja aplikacja wywołuje `fastcgi_finish_request()`. Czy to zadziała?
Nie — ta funkcja pochodzi z binarki php-fpm, a Rapira nią nie jest. Rapira udostępnia za to `rapira_finish_request()` z tą samą umową: odsyła odpowiedź do klienta wcześniej i pozwala pracować dalej. Opisuje ją strona [HTTP](/pl/docs/http).
:::

::: question Czy tryb klasyczny nadal uruchamia więcej niż jeden proces?
Tak. Pula procesów wygląda tak samo w obu trybach: proces nadrzędny forkuje workery, a każdy worker obsługuje jedno żądanie naraz, więc współbieżność bierze się z ich liczby. Zobacz [model procesów](/pl/docs/process-model).
:::

::: question Czy do wypróbowania Rapiry potrzebuję skryptu workera?
Nie — o to właśnie chodzi na tym szczeblu. Skieruj `rapira serve --classic` na front controller, który już masz, i po prostu zadziała, bez żadnych zmian. Dokładnie to robi [Szybki start](/pl/docs/quickstart).
:::
