---
title: Czym jest Rapira?
description: "Rapira to serwer aplikacji PHP napisany w Ruście; ta strona opisuje jej wymagania oraz dwa sposoby, w jakie uruchamia aplikację PHP."
---

# Czym jest Rapira

Rapira to serwer aplikacji PHP napisany w Ruście.

Osadza PHP we własnym procesie przez embed SAPI, ten sam interfejs, dzięki któremu program w C może hostować silnik PHP. Host wywołuje interpreter wprost: żadnego protokołu FastCGI, żadnego lokalnego gniazda ani potoku, żadnej serializacji do formatu sieciowego i z powrotem przy każdym żądaniu. Przychodzi żądanie: wypełniają się superglobale i PHP zaczyna pracę; kiedy kończy, bajty odpowiedzi idą prosto z powrotem.

Sam HTTP obsługuje warstwa oparta na [Pingorze](https://github.com/cloudflare/pingora), rustowym frameworku proxy od Cloudflare. Jest wbudowana w binarkę, więc nie musisz instalować, konfigurować ani utrzymywać przy życiu żadnego drugiego procesu.

## Czego potrzebujesz

Rapira ma trzy wymagania.

- **Tylko Linux i macOS.** Wersji dla Windowsa nie ma.
- **PHP 8.4 albo 8.5.** W archiwach z wydaniami oraz w pakietach `rapira-php8.4` / `rapira-php8.5` siedzi już pasujące środowisko PHP embed w wariancie NTS — wersję PHP wybierasz więc razem z artefaktem i nie musisz nic doinstalowywać obok.
- **NTS, nigdy ZTS.** Rapira linkuje się z PHP w wariancie non-thread-safe. Ma to znaczenie tylko wtedy, gdy sam kompilujesz Rapirę z własnym PHP — wersja thread-safe zostaje wtedy odrzucona od razu, zamiast wysypać się później.

Budowanie z własnym PHP — inny zestaw rozszerzeń, nietypowa architektura, dystrybucja na musl — opisuje strona [Budowanie ze źródeł](/pl/docs/build-from-source).

## Dwa sposoby uruchamiania aplikacji

Dziś Rapira wykonuje aplikacje PHP na dwa sposoby. Tryb workera jest domyślny, tryb klasyczny włączasz sam — flagą w wierszu poleceń albo jednym kluczem w pliku konfiguracyjnym.

**[Classic](/pl/docs/classic)** wykonuje twój front controller od zera przy każdym żądaniu, dokładnie tak jak pod php-fpm: aplikacja startuje, obsługuje żądanie, a wszystko, co po drodze zbudowała, zostaje wyrzucone. W kodzie nie musisz zmieniać nic.

**[SAPI Worker](/pl/docs/worker)** utrzymuje proces przy życiu. Rezydentny skrypt raz podnosi aplikację — autoloader, kontener, połączenia — a potem kręci się w pętli i obsługuje żądanie za żądaniem, za każdym razem z na nowo wypełnionymi superglobalami. Rozruch odbywa się raz, przy starcie, a nie przy każdym żądaniu, a stan przeżywa żądanie.

[Tryby wykonania](/pl/docs/execution-modes) opisują dokładniej różnice między nimi oraz to, jak wybrać właściwy.

## Co dalej

- **[Instalacja](/pl/docs/installation)** — pakiety i archiwa dla Linuksa i macOS; środowisko PHP siedzi już w środku.
- **[Szybki start](/pl/docs/quickstart)** — obsłuż pierwsze żądanie w obu trybach.
- **[Konfiguracja](/pl/docs/configuration)** — pełny opis `rapira.toml`.
