---
title: Tryby wykonania
description: "Trzy tryby wykonania Rapiry: co robią Classic, Worker i Dispatcher, jak wybrać jeden z nich i jak odczytać bieżący tryb z poziomu PHP."
faqLevel: 2
---

# Tryby wykonania

Rapira uruchamia PHP w jednym z trzech trybów wykonania. Wszystkie trzy tryby są dostępne.

| Tryb | Status | Opis |
| --- | --- | --- |
| [Classic](/pl/docs/classic) | Dostępny | Skrypt wejściowy wykonuje się od zera przy każdym żądaniu, tak jak pod php-fpm. |
| [Worker](/pl/docs/worker) | Dostępny | Rezydentny skrypt startuje raz i obsługuje żądania w pętli; zmienne superglobalne są wypełniane na nowo przy każdym żądaniu. |
| Dispatcher | Dostępny | Worker pobiera każde żądanie wywołaniem API i pracuje na nim jak na zwykłej wartości, a nie na zmiennych superglobalnych. |

Nazwy trybów to wartości klucza `pool.mode` i przypadki enuma `Rapira\Mode`. Classic usuwa stan utworzony przez skrypt podczas żądania. Worker i Dispatcher utrzymują jedną uruchomioną aplikację przez wiele żądań. Stan aplikacji i jej zależności od API określają dostępne tryby.

## Classic <Badge type="tip" text="dostępne" />

Skrypt wejściowy wykonuje się w nowym żądaniu PHP, tak jak w php-fpm. Rapira wypełnia zmienne superglobalne i wykonuje skrypt.
Następnie Rapira wysyła odpowiedź i usuwa stan żądania. Trwałe połączenia i stan rozszerzeń pozostają w procesie workera.

Istniejąca aplikacja może działać bez zmian w kodzie. Rapira osadza PHP w procesie serwera i nie używa FastCGI.

Więcej informacji znajdziesz w [trybie Classic](/pl/docs/classic).

## Worker <Badge type="tip" text="dostępne" />

Worker używa tych samych interfejsów żądania i odpowiedzi co Classic. Aplikacja odczytuje zmienne superglobalne i może używać `echo`.
Worker pozostaje aktywny po żądaniu. Inicjalizuje skrypt raz, a następnie uruchamia pętlę.
Dla każdego żądania Rapira wypełnia zmienne superglobalne i uruchamia handler. Obiekty spoza pętli pozostają dostępne.

Aplikacja inicjalizuje się raz na workera, a nie raz na żądanie. Może to skrócić czas wykonania żądania.
Właściwości statyczne, singletony i stan globalny pozostają dla następnego żądania.
Rapira może zastąpić workera po określonej liczbie żądań. Ta wymiana ogranicza wpływ wycieku pamięci.

O skrypcie workera i jego pętli przeczytasz w [trybie Worker](/pl/docs/worker), o limicie wymiany workera w [Konfiguracji](/pl/docs/configuration), a o obsłudze żądań i odpowiedzi w [HTTP](/pl/docs/http).

## Dispatcher <Badge type="tip" text="dostępne" />

W trybie Dispatcher skrypt workera pobiera każdą jednostkę przez wywołanie API. `Rapira\get_dispatcher()` zwraca dyspozytora puli.
`receive(int $timeout = -1)` czeka na kolejną jednostkę. Limit używa mikrosekund, a `-1` go wyłącza.
Przekroczenie limitu rzuca `Rapira\Exception\TimeoutException`. `tryReceive()` zwraca jednostkę albo `null` bez czekania.
We wtyczce HTTP każda jednostka jest obiektem `Rapira\Http\Exchange`.
Metoda `getRequest()` zwraca `Rapira\Http\Request` z metodą, celem, nagłówkami, treścią i adresami.
Metody `writeHead()`, `writeBody()` i `sendFile()` zapisują odpowiedź.

Aplikacja może przekazać obiekt żądania do funkcji lub middleware. Rapira nie wypełnia zmiennych superglobalnych w tym trybie.
Aplikacja używająca zmiennych superglobalnych potrzebuje Worker. Może też użyć adaptera do skopiowania danych.
Wybierz tryb przez `pool.mode` albo `--mode`.

Skrypt kontroluje liczbę aktywnych jednostek pracy. Pętla sekwencyjna przetwarza jedną jednostkę naraz.
Wywołuje `receive()`, odpowiada na żądanie i ponownie wywołuje `receive()`.
Skrypt współbieżny uruchamia jeden [fiber](https://www.php.net/manual/en/language.fibers.php) dla każdego żądania. Wywołuje `tryReceive()`, gdy fibery są aktywne.
Gdy żaden fiber nie jest aktywny, pętla czeka w `receive()`. Przetwarzaj jedną jednostkę, jeśli biblioteka nie obsługuje fiberów.

::: info
Dispatcher jest domyślną wartością `pool.mode`. Osobny przewodnik nie jest jeszcze dostępny.
Plik [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) opisuje interfejsy `Dispatcher` i `Work`.
Plik [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_http.stub.php) opisuje typy HTTP.
Katalog [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) zawiera `dispatcher-sync.php` i `dispatcher-async.php`.
:::

## Odczyt trybu w trakcie pracy

`Rapira\get_mode()` zwraca tryb procesu jako przypadek `Rapira\Mode`. Przypadki to `Classic`, `Worker` i `Dispatcher`.
Przypadek odpowiada początkowej wartości `pool.mode` i nie zmienia się w procesie. Porównuj przypadki przez `===`.
Funkcja nie przyjmuje argumentów ani nie rzuca wyjątków. Skrypt wejściowy może jej użyć do obsługi wielu trybów.

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
Host odczytuje `pool.mode` i ustala tryb przed uruchomieniem interpretera. Wszystkie żądania workera zwracają ten sam przypadek.
Uruchom serwer ponownie, aby zmienić tryb.
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

Rapira udostępnia wszystkie trzy tryby każdej aplikacji. Kod i zależności aplikacji mogą ograniczyć wybór.
Użyj Classic, jeśli stan globalny nie może pozostać między żądaniami. Kod używający zmiennych superglobalnych wymaga adaptera dla Dispatcher.
Niektóre integracje frameworków obsługują Worker. Więcej informacji zawiera sekcja [Frameworki](/pl/docs/frameworks/).

Tryb dotyczy całej instancji, a nie pojedynczych tras. Jedna instancja nie może używać różnych trybów.
Uruchom niezgodne trasy w osobnej instancji Classic.

Worker i Dispatcher wymagają trwałego skryptu wejściowego. Classic go nie potrzebuje.
Aby wybrać Classic, ustaw `mode = "classic"` albo podaj `--mode classic`. Następnie podaj zwykły skrypt wejściowy.
Serwer, plik binarny i [model procesów](/pl/docs/process-model) nie zmieniają się.
Więcej informacji zawiera [Konfiguracja](/pl/docs/configuration) i [opis CLI](/pl/docs/cli).

::: tip
Zacznij od Classic podczas zastępowania php-fpm. Sprawdź działanie aplikacji.
Wybierz Worker po sprawdzeniu inicjalizacji i stanu między żądaniami.
:::
