---
title: Tryby wykonania
description: "Trzy tryby wykonania Rapiry: co robią Classic, Worker i Dispatcher, jak wybrać jeden z nich i jak odczytać bieżący tryb z poziomu PHP."
faqLevel: 2
---

# Tryby wykonania

Rapira uruchamia PHP w jednym z trzech trybów wykonania. Wszystkie trzy są dostępne już dzisiaj.

| Tryb | Status | Opis |
| --- | --- | --- |
| [Classic](/pl/docs/classic) | Dostępny | Skrypt wejściowy wykonuje się od zera przy każdym żądaniu, tak jak pod php-fpm. |
| [Worker](/pl/docs/worker) | Dostępny | Rezydentny skrypt startuje raz i obsługuje żądania w pętli; zmienne superglobalne są wypełniane na nowo przy każdym żądaniu. |
| Dispatcher | Dostępny | Worker pobiera każde żądanie wywołaniem API i pracuje na nim jak na zwykłej wartości, a nie na zmiennych superglobalnych. |

Nazwy trybów to wartości klucza `pool.mode` i przypadki enuma `Rapira\Mode`. Classic usuwa stan utworzony przez skrypt podczas żądania. Worker i Dispatcher utrzymują jedną uruchomioną aplikację przez wiele żądań. Stan aplikacji i jej zależności od API określają dostępne tryby.

## Classic <Badge type="tip" text="dostępne" />

Skrypt wejściowy wykonuje się od zera przy każdym żądaniu, dokładnie tak jak pod php-fpm. Rapira wypełnia zmienne superglobalne, uruchamia skrypt wejściowy, wysyła odpowiedź i usuwa stan żądania. Nic z tego, co utworzył skrypt, nie przechodzi dalej, więc stan aplikacji nie wycieka do następnego żądania. Obowiązują te same wyjątki co w php-fpm. Trwałe połączenia i stan rozszerzeń żyją w procesie workera, a nie w żądaniu.

Istniejąca aplikacja działa bez zmian, bo Rapira wchodzi na miejsce php-fpm i nie ruszasz ani linijki kodu. PHP jest osadzony w procesie serwera, więc między frontem HTTP a interpreterem nie ma skoku przez FastCGI.

Więcej informacji znajdziesz w [trybie Classic](/pl/docs/classic).

## Worker <Badge type="tip" text="dostępne" />

Tryb Worker wygląda tak samo jak Classic: nadal czytasz zmienne superglobalne i nadal wypisujesz odpowiedź przez `echo`. Różnica polega na tym, że worker nie jest niszczony po zakończeniu żądania. Rezydentny skrypt raz podnosi całą aplikację, a potem kręci się w pętli: serwer przy każdym nowym żądaniu na nowo wypełnia `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` i resztę, uruchamia twój handler i podaje kolejne żądanie. Autoloader, kontener DI, konfiguracja, połączenia z bazą: wszystko, co powstało poza pętlą, zostaje rozgrzane.

Rozruch wykonuje się raz na workera, a nie raz na żądanie, a w nowoczesnej aplikacji to właśnie rozruch bywa najdroższą częścią obsługi żądania. Proces nie startuje już czysto przy każdym żądaniu, więc wszystko, co aplikacja zostawi w statycznych polach, singletonach czy stanie globalnym, nadal tam będzie przy następnym. Rapira potrafi wymienić workera po zadanej liczbie żądań, żeby powolny wyciek w aplikacji albo w którejś z jej zależności nie zamienił się w awarię, zanim znajdziesz przyczynę.

O skrypcie workera i jego pętli przeczytasz w [trybie Worker](/pl/docs/worker), o limicie wymiany workera w [Konfiguracji](/pl/docs/configuration), a o obsłudze żądań i odpowiedzi w [HTTP](/pl/docs/http).

## Dispatcher <Badge type="tip" text="dostępne" />

Tryb Dispatcher odwraca kierunek wywołań: to skrypt workera prosi Rapirę o kolejną jednostkę pracy wywołaniem API, zamiast czekać, aż ktoś go wywoła. `Rapira\get_dispatcher()` zwraca dyspozytora, którego obsługuje pula. `receive(int $timeout = -1)` czeka na kolejną jednostkę pracy, a limit czasu podaje się w mikrosekundach. Domyślne `-1` czeka bez ograniczenia, a przekroczony limit kończy się wyjątkiem `Rapira\Exception\TimeoutException`. `tryReceive()` zwraca kolejną jednostkę pracy albo `null` i nigdy nie czeka. We wtyczce HTTP jednostką pracy jest `Rapira\Http\Exchange`. Metoda `getRequest()` zwraca obiekt `Rapira\Http\Request` z metodą, celem żądania, nagłówkami, treścią i adresami obu stron, a `writeHead()`, `writeBody()` i `sendFile()` wypisują odpowiedź.

Żądanie jest tu zwykłą wartością: możesz przekazać je do funkcji, opakować albo puścić przez stos middleware. Zmienne superglobalne nie są w tym trybie wypełniane. Aplikacja, która czyta `$_GET` czy `$_SERVER` wprost, potrzebuje trybu Worker albo adaptera przepisującego obiekt żądania na kształt, jakiego oczekuje. Tryb bierze się z `pool.mode` albo z `--mode`, a nie z kodu aplikacji.

O tym, ile jednostek pracy jest naraz w obiegu, decyduje sam skrypt. Zwykła pętla obsługuje po jednej: wywołuje `receive()`, odpowiada na żądanie i wywołuje `receive()` jeszcze raz. To samo API pozwala jednak trzymać kilka jednostek naraz. Taki skrypt uruchamia po jednym [fiberze](https://www.php.net/manual/en/language.fibers.php) na żądanie. Dopóki jakieś fibery są w toku, odpytuje `tryReceive()`, a gdy nie zostanie już żaden, parkuje pętlę na `receive()`. Dzięki temu w jednym interpreterze posuwa się do przodu kilka żądań naraz. Współbieżność jest tu kooperacyjna: inne żądanie ruszy dopiero wtedy, gdy działający kod zawiesi swój fiber, więc biblioteka, która nie radzi sobie z fiberami, zostawia skrypt przy jednej jednostce pracy naraz.

::: info
Dispatcher jest domyślną wartością `pool.mode`. Osobnego przewodnika po nim jeszcze nie napisaliśmy. Na razie API po stronie PHP opisują pliki stubów dla IDE: [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) z interfejsami `Dispatcher` i `Work` oraz [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_http.stub.php) z typami HTTP. W katalogu [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) leżą do tego dwa gotowe skrypty: `dispatcher-sync.php` i `dispatcher-async.php`.
:::

## Odczyt trybu w trakcie pracy

`Rapira\get_mode()` zwraca tryb, w którym host uruchomił proces, jako przypadek enuma `Rapira\Mode`. `Mode` to czysty enum z trzema przypadkami: `Classic`, `Worker` i `Dispatcher`. Przypadek odpowiada wartości `pool.mode`, z którą proces wystartował, i nie zmienia się przez całe jego życie. Przypadki enuma to pojedyncze obiekty, więc porównujesz je przez `===`. Funkcja nie przyjmuje argumentów i nigdy nie rzuca wyjątku, więc bez obaw wywołasz ją na samej górze skryptu wejściowego obsługującego więcej niż jeden tryb.

```php
<?php
// entry.php

use Rapira\Mode;

$app = require __DIR__ . '/bootstrap.php';

match (\Rapira\get_mode()) {
    Mode::Classic => $app->handleOnce(),
    Mode::Worker => $app->runWorkerLoop(),
    Mode::Dispatcher => $app->runDispatcherLoop(),
};
```

::: question Dlaczego tryb nie zmienia się przez całe życie procesu?
Host odczytuje `pool.mode` przy starcie i ustala tryb, zanim uruchomi interpreter, więc pierwsze i ostatnie żądanie tego samego workera zgłaszają ten sam przypadek. Zmiana trybu wymaga restartu serwera.
:::

## Wybór trybu

Domyślną wartością `pool.mode` jest `dispatcher`. Tryb ustawisz jawnie w `rapira.toml` albo flagą `--mode` w wierszu poleceń.

```toml
[pool]
entrypoint = "public/index.php"
mode = "classic"                      # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
```

```sh
rapira serve --mode classic public/index.php
```

Wszystkie trzy tryby stoją otworem przed każdą aplikacją, a wybór ogranicza wyłącznie jej własny stos. Stan globalny, który nie przetrwa drugiego żądania, zatrzymuje aplikację na trybie Classic. Kod czytający zmienne superglobalne wprost odcina ją od trybu Dispatcher, dopóki luki nie wypełni adapter. Framework z gotową integracją runtime'ową udostępnia tryb Worker niemal bez dodatkowej pracy; te z opisaną integracją znajdziesz w sekcji [Frameworki](/pl/docs/frameworks/).

Tryb wybiera się dla całej instancji serwera, a nie dla pojedynczej trasy, więc jedna instancja nie obsłuży części tras w workerze, a reszty w trybie Classic. Jeśli jakaś część aplikacji nie nadaje się do pracy w workerze, uruchom ją za osobną instancją Rapiry w trybie Classic.

Worker i Dispatcher wymagają rezydentnego skryptu wejściowego. Classic go nie potrzebuje. Aby przejść na Classic, ustaw `mode = "classic"` albo podaj `--mode classic`. Następnie skieruj Rapirę na zwykły skrypt wejściowy. Serwer, plik binarny i [model procesów](/pl/docs/process-model) pozostają bez zmian. Więcej informacji znajdziesz w [Konfiguracji](/pl/docs/configuration) i [opisie wiersza poleceń](/pl/docs/cli).

::: tip
Zacznij od trybu Classic, jeśli zastępujesz php-fpm i najpierw chcesz mieć wszystko działające. Przejdź na tryb Worker, gdy będziesz mieć pewność, że aplikacja startuje czysto i nie trzyma między żądaniami stanu, którego trzymać nie powinna.
:::
