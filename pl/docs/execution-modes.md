---
title: Tryby wykonania
description: "Działanie trybów Classic, Worker i Dispatcher, wybór trybu i odczyt trybu w trakcie pracy."
faqLevel: 2
---

# Tryby wykonania

Pula HTTP uruchamia PHP w jednym z trzech trybów wykonania. [Pula gRPC](./grpc) używa trybu Dispatcher.

| Tryb | Opis |
| --- | --- |
| [Classic](/pl/docs/classic) | Skrypt wejściowy wykonuje się w nowym żądaniu PHP za każdym razem, tak jak pod php-fpm. |
| [Worker](/pl/docs/worker) | Trwały skrypt obsługuje żądania w pętli. Rapira ponownie wypełnia zmienne superglobalne dla każdego żądania. |
| [Dispatcher](/pl/docs/dispatcher) | Worker pobiera każde żądanie przez wywołanie API i używa obiektu żądania zamiast zmiennych superglobalnych. |

Nazwy trybów to wartości klucza `http.pool.mode` i przypadki enuma `Rapira\Mode`. Classic usuwa stan żądania aplikacji po każdym żądaniu. Worker i Dispatcher utrzymują jedną zainicjalizowaną aplikację przez wiele żądań. Stan aplikacji i jej zależności od API określają, których trybów aplikacja może używać.

## Classic

Skrypt wejściowy wykonuje się w nowym żądaniu PHP za każdym razem, tak jak pod php-fpm. Rapira wypełnia zmienne superglobalne, wykonuje skrypt, wysyła odpowiedź, a następnie usuwa stan żądania. Trwałe połączenia i stan rozszerzeń pozostają, ponieważ istnieją w procesie workera.

Istniejąca aplikacja może działać bez zmian w kodzie, gdy Rapira zastępuje php-fpm. Rapira osadza PHP w procesie serwera i nie używa FastCGI.

Więcej informacji znajdziesz w [trybie Classic](/pl/docs/classic).

## Worker

Worker używa tych samych interfejsów żądania i odpowiedzi co Classic. Aplikacja odczytuje zmienne superglobalne i może używać `echo` dla odpowiedzi. Skrypt workera inicjalizuje aplikację raz, a następnie uruchamia pętlę. Dla każdego żądania Rapira ponownie wypełnia zmienne superglobalne i uruchamia handler. Obiekty, które skrypt tworzy poza pętlą, pozostają dostępne.

Inicjalizacja wykonuje się raz dla każdego workera, a nie raz dla każdego żądania. Może to skrócić czas żądania. Jednak właściwości statyczne, singletony i stan globalny pozostają dla następnego żądania. Ustaw [`http.pool.max_requests`](/pl/docs/configuration), aby wymienić workera po określonej liczbie żądań. To ogranicza wpływ wycieku pamięci.

O skrypcie workera i jego pętli przeczytasz w [trybie Worker](/pl/docs/worker). O obsłudze żądań i odpowiedzi przeczytasz w [HTTP](/pl/docs/http).

## Dispatcher

W trybie Dispatcher skrypt workera pobiera każdą jednostkę pracy przez wywołanie API. `Rapira\get_dispatcher()` zwraca dyspozytora puli, a jego metoda `receive()` czeka na kolejną jednostkę. We wtyczce HTTP każda jednostka to `Rapira\Http\Exchange`. Obiekt exchange daje obiekt `Rapira\Http\Request` i ma metody, które zapisują odpowiedź. We wtyczce gRPC każda jednostka to `Rapira\Grpc\UnaryCall`.

Aplikacja może przekazać obiekt żądania do funkcji lub middleware. Rapira nie wypełnia zmiennych superglobalnych w tym trybie. Aplikacja, która odczytuje zmienne superglobalne, potrzebuje trybu Worker albo adaptera, który kopiuje dane żądania do tych zmiennych. `echo` i inne wyjście PHP nie trafiają do klienta. Rapira zapisuje to wyjście do logu w celu `php` na poziomie `info`.

Każdy worker obsługuje jedną jednostkę pracy naraz. Zakończ bieżącą jednostkę, zanim ponownie wywołasz `receive()`. Aby obsługiwać więcej żądań jednocześnie, zwiększ `http.pool.processes`.

Pętlę, API żądania i odpowiedzi oraz wyjątki opisuje [tryb Dispatcher](/pl/docs/dispatcher). API wywołań gRPC opisuje [gRPC](/pl/docs/grpc).

## `$_SERVER` przed pierwszym żądaniem

W trybach Worker i Dispatcher skrypt wejściowy startuje przed pierwszym żądaniem. W tym momencie Rapira wypełnia `$_SERVER` tak jak PHP CLI dla `php entrypoint.php`.

| Klucz | Wartość |
| --- | --- |
| Każda zmienna środowiskowa procesu | Wartość ze środowiska |
| `PHP_SELF`, `SCRIPT_NAME`, `SCRIPT_FILENAME`, `PATH_TRANSLATED` | Bezwzględna ścieżka skryptu wejściowego |
| `DOCUMENT_ROOT` | Pusty ciąg znaków |
| `REQUEST_TIME`, `REQUEST_TIME_FLOAT` | Czas startu skryptu wejściowego |
| `argv` | Lista, która zawiera bezwzględną ścieżkę skryptu wejściowego |
| `argc` | `1` |

`$_SERVER` otrzymuje zmienne środowiskowe, gdy `variables_order` zawiera `S`. `$_ENV` otrzymuje je tylko wtedy, gdy `variables_order` zawiera `E`. Wartość produkcyjna `GPCS` nie zawiera `E`. Ścieżka skryptu wejściowego zastępuje zmienną środowiskową o tej samej nazwie, na przykład `SCRIPT_FILENAME`. Zmienne globalne `$argv` i `$argc` zawierają te same wartości co `$_SERVER`.

W trybie Dispatcher `$_SERVER` zachowuje te wartości do ponownego startu skryptu wejściowego. Dane żądania znajdują się w obiekcie żądania. W trybie Worker Rapira ponownie wypełnia `$_SERVER` danymi żądania dla każdego żądania. Wartości żądania nie zawierają zmiennych środowiskowych, a `SCRIPT_NAME` zawiera nazwę skryptu wejściowego z początkowym ukośnikiem.

## Odczyt trybu w trakcie pracy

`Rapira\get_mode()` zwraca tryb procesu jako przypadek `Rapira\Mode`. Przypadki to `Classic`, `Worker` i `Dispatcher`. Przypadek to tryb puli workera i nie zmienia się w trakcie działania procesu. Funkcja nie przyjmuje argumentów ani nie rzuca wyjątków. Skrypt wejściowy może jej użyć do obsługi wielu trybów.

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
Rapira odczytuje tryb puli, zanim uruchomi interpreter. Wszystkie żądania w tym workerze zwracają ten sam przypadek. Przeładowanie nie odczytuje ponownie `rapira.toml`. Aby zmienić tryb, uruchom ponownie Rapirę.
:::

## Wybór trybu

Klucz `mode` tabeli puli wybiera tryb. Wartość domyślna to `dispatcher`. Ustaw tryb jawnie w `rapira.toml`.

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

Pula HTTP obsługuje wszystkie trzy tryby. Pula gRPC obsługuje tylko `dispatcher`. Inna wartość `grpc.pool.mode` zatrzymuje Rapirę przy starcie z błędem.

W trybach Worker i Dispatcher skrypt wejściowy musi pobierać żądania w pętli. Jeśli skrypt zakończy się, zanim pobierze żądanie, rozruch kończy się błędem. Zwykły skrypt wejściowy php-fpm kończy się w ten sposób w trybie domyślnym. Co Rapira robi po nieudanym rozruchu, opisuje [model procesów](/pl/docs/process-model).

Kod i zależności aplikacji mogą ograniczyć wybór. Użyj Classic, jeśli stan globalny nie może pozostać między żądaniami. Kod, który odczytuje zmienne superglobalne, nie może używać Dispatcher bez adaptera. Niektóre integracje frameworków obsługują tryb Worker. Opisane integracje zawiera sekcja [Frameworki](/pl/docs/frameworks/).

Tryb dotyczy całej puli, więc wszystkie trasy w tej puli używają tego samego trybu. Pule HTTP i gRPC mogą używać różnych trybów w jednym serwerze. Uruchom niezgodne trasy HTTP w osobnej instancji Rapiry w trybie Classic. Więcej informacji zawiera [Konfiguracja](/pl/docs/configuration) i [opis CLI](/pl/docs/cli).

::: tip
Zacznij od Classic podczas zastępowania php-fpm. Sprawdź działanie aplikacji. Wybierz Worker po potwierdzeniu, że aplikacja inicjalizuje się prawidłowo i nie zachowuje stanu żądania.
:::
