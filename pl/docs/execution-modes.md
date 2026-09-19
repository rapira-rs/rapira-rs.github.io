---
title: Tryby wykonania
description: "Trzy tryby wykonania Rapiry: co robią Classic, Worker i Dispatcher, jak wybrać jeden z nich i jak odczytać bieżący tryb z poziomu PHP."
faqLevel: 2
---

# Tryby wykonania

Pula HTTP uruchamia PHP w jednym z trzech trybów wykonania. [Pula gRPC](./grpc) używa trybu Dispatcher.

| Tryb | Status | Opis |
| --- | --- | --- |
| [Classic](/pl/docs/classic) | Dostępny | Skrypt wejściowy wykonuje się od zera przy każdym żądaniu, tak jak pod php-fpm. |
| [Worker](/pl/docs/worker) | Dostępny | Rezydentny skrypt startuje raz i obsługuje żądania w pętli; zmienne superglobalne są wypełniane na nowo przy każdym żądaniu. |
| Dispatcher | Dostępny | Worker pobiera każde żądanie wywołaniem API i pracuje na nim jak na zwykłej wartości, a nie na zmiennych superglobalnych. |

Nazwy trybów to wartości klucza `http.pool.mode` i przypadki enuma `Rapira\Mode`. Classic usuwa stan utworzony przez skrypt podczas żądania. Worker i Dispatcher utrzymują jedną uruchomioną aplikację przez wiele żądań. Stan aplikacji i jej zależności od API określają dostępne tryby.

## Classic <Badge type="tip" text="dostępne" />

Skrypt wejściowy wykonuje się w nowym żądaniu PHP, tak jak w php-fpm. Rapira wypełnia zmienne superglobalne i wykonuje skrypt. Następnie Rapira wysyła odpowiedź i usuwa stan żądania. Trwałe połączenia i stan rozszerzeń pozostają w procesie workera.

Istniejąca aplikacja może działać bez zmian w kodzie. Rapira osadza PHP w procesie serwera i nie używa FastCGI.

Więcej informacji znajdziesz w [trybie Classic](/pl/docs/classic).

## Worker <Badge type="tip" text="dostępne" />

Worker używa tych samych interfejsów żądania i odpowiedzi co Classic. Aplikacja odczytuje zmienne superglobalne i może używać `echo`. Worker pozostaje aktywny po żądaniu. Inicjalizuje skrypt raz, a następnie uruchamia pętlę. Dla każdego żądania Rapira wypełnia zmienne superglobalne i uruchamia handler. Obiekty spoza pętli pozostają dostępne.

Aplikacja inicjalizuje się raz na workera, a nie raz na żądanie. Może to skrócić czas wykonania żądania. Właściwości statyczne, singletony i stan globalny pozostają dla następnego żądania. Rapira może zastąpić workera po określonej liczbie żądań. Ta wymiana ogranicza wpływ wycieku pamięci.

O skrypcie workera i jego pętli przeczytasz w [trybie Worker](/pl/docs/worker), o limicie wymiany workera w [Konfiguracji](/pl/docs/configuration), a o obsłudze żądań i odpowiedzi w [HTTP](/pl/docs/http).

## Dispatcher <Badge type="tip" text="dostępne" />

W trybie Dispatcher skrypt workera pobiera każdą jednostkę przez wywołanie API. `Rapira\get_dispatcher()` zwraca dyspozytora puli. `receive(int $timeout = -1)` czeka na kolejną jednostkę. Limit używa mikrosekund, a `-1` go wyłącza. Przekroczenie limitu rzuca `Rapira\Exception\TimeoutException`. `tryReceive()` zwraca jednostkę albo `null` bez czekania. We wtyczce HTTP każda jednostka jest obiektem `Rapira\Http\Exchange`. Metoda `getRequest()` zwraca `Rapira\Http\Request` z metodą, celem, nagłówkami, treścią i adresami. Metody `writeHead()`, `writeBody()` i `sendFile()` zapisują odpowiedź.

We wtyczce gRPC każda jednostka to `Rapira\Grpc\UnaryCall`. `getMessage()` zwraca bajty protobuf. `respond()` wysyła zserializowaną odpowiedź, a `fail()` wysyła błąd gRPC. Każdy worker gRPC obsługuje jedno aktywne wywołanie naraz. Pętlę dyspozytora opisuje [gRPC](./grpc).

Aplikacja może przekazać obiekt żądania do funkcji lub middleware. Rapira nie wypełnia zmiennych superglobalnych w tym trybie. Aplikacja używająca zmiennych superglobalnych potrzebuje Worker. Może też użyć adaptera do skopiowania danych. Wybierz tryb HTTP kluczem `http.pool.mode`. `grpc.pool.mode` musi mieć wartość `"dispatcher"`.

Skrypt kontroluje liczbę aktywnych jednostek pracy. Pętla sekwencyjna przetwarza jedną jednostkę naraz. Wywołuje `receive()`, odpowiada na żądanie i ponownie wywołuje `receive()`. Współbieżny skrypt HTTP uruchamia jeden [fiber](https://www.php.net/manual/en/language.fibers.php) dla każdego żądania. Wywołuje `tryReceive()`, gdy fibery są aktywne. Gdy żaden fiber nie jest aktywny, pętla czeka w `receive()`. Ten sposób utrzymuje kilka aktywnych żądań w jednym interpreterze. Współbieżność jest kooperacyjna. Inne żądanie wykonuje się dalej tylko wtedy, gdy działający kod zawiesi swój fiber. Przetwarzaj jedną jednostkę, jeśli biblioteka nie obsługuje fiberów.

::: info
Dispatcher jest domyślnym trybem puli. [Przewodnik gRPC](./grpc) zawiera kompletną usługę unarną. Plik [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) opisuje interfejsy `Dispatcher` i `Work`. Plik [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_http.stub.php) opisuje typy HTTP. Katalog [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) zawiera `dispatcher-sync.php` i `dispatcher-async.php`.
:::

## Odczyt trybu w trakcie pracy

`Rapira\get_mode()` zwraca tryb procesu jako przypadek `Rapira\Mode`. Przypadki to `Classic`, `Worker` i `Dispatcher`. Przypadek odpowiada początkowemu trybowi puli tego workera i nie zmienia się przez cały czas działania procesu. Porównuj przypadki przez `===`. Funkcja nie przyjmuje argumentów ani nie rzuca wyjątków. Skrypt wejściowy może jej użyć do obsługi wielu trybów.

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
Host odczytuje tryb puli i ustala go przed uruchomieniem interpretera. Wszystkie żądania workera zwracają ten sam przypadek. Uruchom serwer ponownie, aby zmienić tryb.
:::

## Wybór trybu

Domyślną wartością `http.pool.mode` jest `dispatcher`. Tryb ustawisz jawnie w `rapira.toml`.

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"                      # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
```

```sh
rapira serve rapira.toml
```

Pula HTTP obsługuje wszystkie trzy tryby. Kod i zależności aplikacji mogą ograniczyć wybór. Użyj Classic, jeśli stan globalny nie może pozostać między żądaniami. Kod używający zmiennych superglobalnych wymaga adaptera dla Dispatcher. Niektóre integracje frameworków obsługują Worker. Więcej informacji zawiera sekcja [Frameworki](/pl/docs/frameworks/).

Tryb dotyczy całej puli. Wszystkie trasy w tej puli używają tego samego trybu. Pule HTTP i gRPC mogą używać różnych trybów w jednej instancji serwera. Uruchom niezgodne trasy HTTP w osobnej instancji w trybie Classic.

Worker i Dispatcher wymagają trwałego skryptu wejściowego. Classic go nie potrzebuje. Aby wybrać Classic, ustaw `mode = "classic"`. Następnie ustaw `entrypoint` na zwykły skrypt wejściowy. Serwer, plik binarny i [model procesów](/pl/docs/process-model) nie zmieniają się. Więcej informacji zawiera [Konfiguracja](/pl/docs/configuration) i [opis CLI](/pl/docs/cli).

::: tip
Zacznij od Classic podczas zastępowania php-fpm. Sprawdź działanie aplikacji. Wybierz Worker po potwierdzeniu, że aplikacja inicjalizuje się prawidłowo i nie zachowuje stanu żądania.
:::
