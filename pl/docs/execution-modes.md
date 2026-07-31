---
title: Tryby wykonania
description: "Co robią cztery tryby wykonania Rapiry — Classic, SAPI Worker, PSR Worker i Async — i co decyduje o tym, z którego może skorzystać aplikacja."
---

# Tryby wykonania

Rapira uruchamia PHP w jednym z czterech trybów wykonania. Dwa z nich są już dostępne, pozostałe dwa są w planach.

| Tryb | Status | Opis |
| --- | --- | --- |
| [Classic](/pl/docs/classic) | Dostępny | Skrypt wejściowy wykonuje się od zera przy każdym żądaniu, tak jak pod php-fpm. |
| [SAPI Worker](/pl/docs/worker) | Dostępny | Rezydentny skrypt startuje raz i obsługuje żądania w pętli; zmienne superglobalne są wypełniane na nowo przy każdym żądaniu. |
| PSR Worker | Planowany | Worker pobiera każde żądanie wywołaniem API i może pracować na wiadomości PSR-7 zamiast na zmiennych superglobalnych. |
| Async | Planowany | Worker obsługuje kilka żądań współbieżnie w jednym interpreterze, korzystając z fiberów. |

Tryby wymieniono w kolejności odpowiadającej temu, ile kontroli nad cyklem życia żądania dostaje PHP. Nazwy mówią, czy worker zostaje przy życiu między żądaniami i jakim kontraktem się posługuje. Każdy kolejny tryb ma w chwili nadejścia żądania rozgrzaną większą część procesu niż poprzedni i stawia kodowi więcej wymagań.

## Classic <Badge type="tip" text="dostępne" />

Skrypt wejściowy wykonuje się od zera przy każdym żądaniu, dokładnie tak jak pod php-fpm: zmienne superglobalne zostają wypełnione, front controller startuje, odpowiedź wychodzi, a wszystko po drodze jest sprzątane. Nic nie przechodzi dalej, więc nic nie może wyciec z jednego żądania do następnego.

Istniejąca aplikacja działa bez zmian, bo Rapira wchodzi na miejsce php-fpm i nie ruszasz ani linijki kodu. PHP jest osadzony w procesie serwera, więc między frontem HTTP a interpreterem nie ma skoku przez FastCGI.

Więcej informacji znajdziesz w [Trybie klasycznym](/pl/docs/classic).

## SAPI Worker <Badge type="tip" text="dostępne" />

Tryb SAPI Worker wygląda tak samo jak Classic — nadal czytasz zmienne superglobalne, nadal wypisujesz odpowiedź przez `echo` — z tą różnicą, że worker nie jest niszczony po zakończeniu żądania. Rezydentny skrypt raz podnosi całą aplikację, a potem kręci się w pętli: serwer przy każdym nowym żądaniu na nowo wypełnia `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` i resztę, uruchamia twój handler i podaje kolejne żądanie. Autoloader, kontener DI, konfiguracja, połączenia z bazą — wszystko, co powstało poza pętlą, zostaje rozgrzane.

Rozruch wykonuje się raz na workera, a nie raz na żądanie, a w nowoczesnej aplikacji to właśnie rozruch bywa najdroższą częścią obsługi żądania. Proces nie startuje już czysto przy każdym żądaniu, więc wszystko, co aplikacja zostawi w statycznych polach, singletonach czy stanie globalnym, nadal tam będzie przy następnym. Rapira potrafi wymienić workera po zadanej liczbie żądań, żeby powolny wyciek w aplikacji albo w którejś z jej zależności nie zamienił się w awarię, zanim znajdziesz przyczynę.

O skrypcie workera i jego pętli przeczytasz w [Trybie workera](/pl/docs/worker), o limicie wymiany workera — w [Konfiguracji](/pl/docs/configuration), a o obsłudze żądań i odpowiedzi — w [HTTP](/pl/docs/http).

## PSR Worker <Badge type="warning" text="planowane" />

Sterowanie zostaje odwrócone: zamiast czekać na wywołanie, worker sam pobiera żądanie z Rapiry wywołaniem API i decyduje, co z nim zrobić. Może wypełnić zmienne superglobalne dla zgodności albo pominąć je zupełnie i pracować na wiadomości PSR-7, którą przekazuje prosto do kernela HTTP frameworka. Obsługuje po jednym żądaniu naraz, tak samo jak SAPI Worker.

Żądanie przestaje być stanem globalnym i staje się wartością, którą możesz przekazywać dalej, opakowywać albo puścić przez stos middleware.

::: info
Tryb PSR Worker nie jest zaimplementowany. Nic z niego jeszcze nie działa, a ani konfiguracja, ani API po stronie PHP nie zostały zaprojektowane — nie ma więc jeszcze żadnych nazw funkcji ani kluczy konfiguracyjnych do pokazania.
:::

## Async <Badge type="warning" text="planowane" />

Tryb Async korzysta z tego samego API co tryb PSR Worker, tyle że worker prosi o więcej niż jedno żądanie naraz i obsługuje je współbieżnie w jednym interpreterze. Umożliwiają to fibery z PHP 8.1: żądanie, które czeka na I/O, oddaje sterowanie, a w tym czasie inne posuwa się do przodu — bez wątków i bez drugiego procesu.

Async ma najostrzejsze wymagania ze wszystkich czterech trybów, bo współbieżność w jednym interpreterze oznacza, że każda biblioteka biorąca udział w obsłudze żądania musi działać poprawnie, gdy zostanie wstrzymana w połowie pracy.

::: info
Tryb Async również nie jest zaimplementowany. Nie ma czego instalować ani konfigurować. Powyższa sekcja opisuje planowany kierunek, a nie coś, co uruchomisz dzisiaj.
:::

## Wybór trybu

Domyślnie Rapira działa w trybie SAPI Worker, a tryb Classic trzeba włączyć samodzielnie. Wszystkie cztery tryby stoją otworem przed każdą aplikacją, a wybór ogranicza wyłącznie jej własny stos. Stan globalny, który nie przetrwa drugiego żądania, zatrzymuje aplikację na trybie Classic. Biblioteka, która nie radzi sobie z fiberami, wyklucza Async. Framework z gotową integracją runtime'ową udostępnia tryb SAPI Worker niemal bez dodatkowej pracy; te z opisaną integracją znajdziesz w sekcji [Frameworki](/pl/docs/frameworks/).

Tryb wybiera się dla całej instancji serwera, a nie dla pojedynczej trasy, więc jedna instancja nie obsłuży części tras w workerze, a reszty w trybie Classic. Jeśli jakaś część aplikacji nie nadaje się do pracy w workerze, uruchom ją za osobną instancją Rapiry w trybie Classic.

Przejście na tryb workera kosztuje pracę po stronie PHP, bo worker wymaga rezydentnego skryptu wejściowego, którego Classic nie potrzebuje. Powrót nie kosztuje nic: włączasz tryb Classic flagą w wierszu poleceń albo jednym kluczem w pliku konfiguracyjnym, kierujesz Rapirę na swój zwykły front controller i masz ten sam serwer, tę samą binarkę i ten sam [model procesów](/pl/docs/process-model) pod spodem. Szczegóły znajdziesz w [Konfiguracji](/pl/docs/configuration) i [opisie wiersza poleceń](/pl/docs/cli).

::: tip
Zacznij od trybu Classic, jeśli zastępujesz php-fpm i najpierw chcesz mieć wszystko działające. Przejdź na SAPI Worker, gdy będziesz mieć pewność, że aplikacja startuje czysto i nie trzyma między żądaniami stanu, którego trzymać nie powinna.
:::
