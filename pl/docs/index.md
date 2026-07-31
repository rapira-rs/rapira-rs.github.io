---
title: Czym jest Rapira?
description: Rapira to serwer aplikacji PHP napisany w Ruście. Osadza PHP bezpośrednio w procesie serwera — bez FastCGI, bez socketów, bez serializacji po drodze.
---

# Czym jest Rapira

Rapira to serwer aplikacji PHP napisany w Ruście. Zajmuje miejsce, w którym zwykle stoi php-fpm: to ona trzyma nasłuchujące gniazdo, rozmawia ze światem po HTTP i wykonuje twój kod PHP.

Cała różnica tkwi w tym, co stoi między serwerem a interpreterem — a nie stoi tam nic. Rapira osadza PHP we własnym procesie przez embed SAPI, ten sam interfejs, dzięki któremu program w C może hostować silnik PHP. Host wywołuje interpreter wprost: żadnego protokołu FastCGI, żadnego lokalnego gniazda ani potoku, żadnej serializacji do formatu sieciowego i z powrotem przy każdym żądaniu. Przychodzi żądanie: wypełniają się superglobale i PHP zaczyna pracę; kiedy kończy, bajty odpowiedzi idą prosto z powrotem.

Sam HTTP obsługuje warstwa oparta na [Pingorze](https://github.com/cloudflare/pingora), rustowym frameworku proxy, na którym Cloudflare opiera swoją infrastrukturę brzegową. Jest wbudowana w binarkę, więc nie musisz instalować, konfigurować ani utrzymywać przy życiu żadnego drugiego procesu — całym serwerem jest jedno drzewo procesów `rapira`.

## Czego potrzebujesz

Zanim pójdziesz dalej, poznaj kilka ograniczeń — od tych akurat nie ma odstępstw:

- **Tylko Linux i macOS.** Wersji dla Windowsa nie ma.
- **PHP 8.4 albo 8.5.** W archiwach z wydaniami oraz w pakietach `rapira-php8.4` / `rapira-php8.5` siedzi już pasujące środowisko PHP embed w wariancie NTS — wersję PHP wybierasz więc razem z artefaktem i nie musisz nic doinstalowywać obok.
- **NTS, nigdy ZTS.** Rapira linkuje się z PHP w wariancie non-thread-safe. Zauważysz to tylko wtedy, gdy sam kompilujesz Rapirę z własnym PHP — wersja thread-safe zostanie odrzucona od razu, zamiast wysypać się dopiero w trakcie działania.

Wolisz zbudować Rapirę z własnym PHP — inny zestaw rozszerzeń, nietypowa architektura, dystrybucja na musl? Zobacz [Budowanie ze źródeł](/pl/docs/build-from-source).

## Dwa sposoby uruchamiania aplikacji

Dziś Rapira wykonuje aplikacje PHP na dwa sposoby. Domyślnie dostajesz workera; tryb klasyczny włączasz sam — flagą w wierszu poleceń albo jednym kluczem w pliku konfiguracyjnym.

**[Classic](/pl/docs/classic)** to ten znajomy wariant. Twój front controller wykonuje się od zera przy każdym żądaniu, dokładnie tak jak pod php-fpm: aplikacja startuje, obsługuje żądanie, a wszystko, co po drodze zbudowała, ląduje w koszu. W kodzie nie musisz zmieniać nic — i właśnie dlatego to uczciwy punkt startu dla istniejącej aplikacji oraz koło ratunkowe, kiedy coś w twoim stosie nie przeżywa drugiego żądania.

**[SAPI Worker](/pl/docs/worker)** utrzymuje proces przy życiu. Rezydentny skrypt raz podnosi aplikację — autoloader, kontener, połączenia — a potem kręci się w pętli i obsługuje żądanie za żądaniem, za każdym razem z na nowo wypełnionymi superglobalami. Koszt startu płacisz raz, przy uruchomieniu, a nie przy każdym żądaniu, ale stan przeżywa teraz żądanie, a to już realna zmiana w sposobie, w jaki musisz myśleć o swoim kodzie.

To dwa pierwsze szczeble dłuższej drabiny — `Classic → SAPI Worker → PSR Worker → Async` — na której każdy kolejny stopień oddaje PHP większą kontrolę nad cyklem życia żądania. Na razie gotowe są tylko dwa pierwsze; [Tryby wykonania](/pl/docs/execution-modes) opisują całą drabinę i podpowiadają, jak rozpoznać, na który szczebel realnie wejdzie twoja aplikacja.

::: tip
To, jak wysoko aplikacja się wespnie, zależy od niej samej, a nie od ograniczeń narzuconych przez Rapirę. Globalny stan, który nie przeżywa drugiego żądania, trzyma cię na trybie Classic — ale to mówi twój kod i da się to naprawić.
:::

## Co dalej

- **[Instalacja](/pl/docs/installation)** — pakiety i archiwa dla Linuksa i macOS; środowisko PHP siedzi już w środku.
- **[Szybki start](/pl/docs/quickstart)** — obsłuż pierwsze żądanie, w obu trybach, w kilka minut.
- **[Konfiguracja](/pl/docs/configuration)** — pełny opis `rapira.toml`, gdy same flagi przestaną wystarczać.

::: question Czy muszę przepisać aplikację, żeby korzystać z Rapiry?
Nie. W trybie klasycznym zwykły front controller działa bez zmian — Rapira wchodzi na miejsce php-fpm, a twój kod nie widzi różnicy. Przesiadka na workera to osobny, opcjonalny krok, na który decydujesz się wtedy, kiedy sam zechcesz.
:::
