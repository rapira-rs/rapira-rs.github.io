---
title: Logi
description: "Jak Rapira loguje - poziomy, nadpisania dla poszczególnych celów, diagnostyka PHP, logowanie z aplikacji, formaty plain i JSON oraz zmienna RUST_LOG do debugowania."
---

# Logi

Rapira zapisuje wszystkie wpisy do stderr. Obejmują zdarzenia serwera, decyzje procesu nadrzędnego, zdarzenia HTTP, diagnostykę PHP i komunikaty aplikacji.
Domyślnie Rapira zapisuje ostrzeżenia PHP w tym logu zamiast w osobnym miejscu `error_log`. Ten sam filtr poziomu dotyczy wszystkich wpisów.

Domyślny poziom to `error`, więc serwer zapisuje tylko błędy. Zmień konfigurację lub ustaw `RUST_LOG`, aby wybrać inny poziom.

## Poziomy i format

Sekcja `[log]` pliku `rapira.toml` steruje logowaniem:

```toml
[log]
level = "error"   # Use error, warn, info, debug, or trace. Default: error.
format = "plain"  # Use plain or json. Default: plain.
```

`level` ustawia minimalny poziom dla wszystkich celów. `error` pokazuje tylko błędy, a każdy kolejny poziom dodaje wpisy.
`trace` pokazuje wszystkie wpisy. `format` wybiera czytelne linie lub jeden obiekt JSON na linię.

Oba klucze i cała sekcja są opcjonalne. Pozostałe sekcje opisuje [Konfiguracja](/pl/docs/configuration).

## Nadpisania dla poszczególnych celów

`[log.targets]` zastępuje poziom globalny dla poszczególnych celów. Może na przykład włączyć debugowanie PHP bez debugowania HTTP:

```toml
[log]
level = "error"

[log.targets]
php = "debug"
http = "warn"
```

Każdy klucz nazywa jeden cel. Pozostałe cele używają `level`.
Klucz pasuje **po prefiksie**, więc `php` pasuje też do `php_sys` i `php_sys::callbacks`. Nie musisz wymieniać podmodułów.

Cele, pod którymi loguje sama Rapira:

| Cel      | Co obejmuje                                                                    |
| -------- | ------------------------------------------------------------------------------ |
| `rapira` | cykl życia serwera: start, cykl życia workerów, zamykanie                      |
| `master` | nadzór: forki, zbieranie zakończonych procesów, podstawianie nowych workerów, przeładowania, skalowanie puli |
| `http`   | warstwa HTTP: nasłuchy, obsługa pól żądania i odpowiedzi, wygaszanie           |
| `ext`    | wyniki zadań rozszerzeń                                                        |
| `php`    | wyjście i diagnostyka prosto z PHP                                             |
| `app`    | wpisy zapisywane przez aplikację przez `\Rapira\log()`                        |

Rapira nie zapisuje osobnej linii dostępu dla każdego żądania. Wpisy celu `http` opisuje strona [HTTP](/pl/docs/http).

Zależność zapisuje ślady pod własną ścieżką modułu. Dotyczy ich ten sam filtr prefiksu.
Każdy wpis zawiera nazwę celu. Dodaj ją do `[log.targets]`, aby zmniejszyć liczbę wpisów.

::: tip
Cel `master` zawiera wymiany workerów, przeładowania i skalowanie. Te zdarzenia opisuje [Model procesów](/pl/docs/process-model).
:::

## Diagnostyka PHP

Rapira przypisuje diagnostykę PHP do celu `php`. Typ błędu określa poziom:

| Diagnostyka                                                                                                       | Poziom  |
| ------------------------------------------------------------------------------------------------------------------ | ------- |
| Błędy krytyczne - `E_ERROR`, `E_PARSE`, `E_CORE_ERROR`, `E_COMPILE_ERROR`, `E_USER_ERROR`, `E_RECOVERABLE_ERROR`  | `error` |
| Ostrzeżenia - `E_WARNING`, `E_CORE_WARNING`, `E_COMPILE_WARNING`, `E_USER_WARNING`                                | `warn`  |
| Powiadomienia - `E_NOTICE`, `E_USER_NOTICE`                                                                       | `info`  |
| Ostrzeżenia o wycofaniu - `E_DEPRECATED`, `E_USER_DEPRECATED`                                                     | `debug` |

Ostrzeżenia o wycofaniu używają `debug`. Dzięki temu liczne komunikaty zależności nie ukrywają ostrzeżeń i błędów.

Diagnostyka wykluczona przez [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) zmienia poziom na `trace`. Na przykład:

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

Ta maska wyklucza ostrzeżenia zależności na zwykłych poziomach. Ustaw `level = "trace"`, aby je uwzględnić.
Błędy krytyczne nie zmieniają poziomu, ponieważ wyjaśniają zakończenie workera. Dlatego `error_reporting(0)` ich nie ukrywa.
PHP tworzy `E_CORE_ERROR` i `E_CORE_WARNING` przed ustawieniem maski. Maska ich nie obejmuje.

::: info
Rapira wysyła diagnostykę do logu, a nie do odpowiedzi. Domyślne wartości to `display_errors = 0` i `log_errors = 1`.
Wartości z `php.ini` zastępują te wartości domyślne.
:::

## Logowanie z aplikacji

`\Rapira\log()` zapisuje wpis z PHP do celu `app`. Przyjmuje komunikat, opcjonalny poziom i opcjonalną tablicę kontekstu, i jest dostępna w każdym trybie wykonania:

```php
<?php

\Rapira\log('order placed');
\Rapira\log('payment declined', \Rapira\LogLevel::Warning);
\Rapira\log('cache miss', \Rapira\LogLevel::Debug, ['key' => 'user:42', 'ttl' => 300]);
```

Poziom to przypadek wyliczenia `\Rapira\LogLevel`, a każdy przypadek odpowiada poziomowi, którego używa już reszta logu:

| Przypadek `LogLevel` | Poziom wpisu |
| -------------------- | ------------ |
| `Error`         | `error`      |
| `Warning`       | `warn`       |
| `Info`          | `info`       |
| `Debug`         | `debug`      |
| `Trace`         | `trace`      |

`\Rapira\log()` używa poziomu `Info`, gdy pominiesz `level`. Globalny filtr `error` odrzuca ten wpis, jeśli nie zmienisz filtra.
`[log.targets]` i `RUST_LOG` tak samo filtrują wpisy aplikacji i serwera.
Na przykład `app = "debug"` zmienia tylko cel aplikacji.

Rapira serializuje tablicę kontekstu do JSON-a i dodaje ją jako pole `context`. W JSON-ie to pole znajduje się w `fields`.
Nazwy kluczy i struktura zagnieżdżonych tablic zostają zachowane:

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

Rapira rozwija `Throwable` przed serializacją, ponieważ `json_encode()` zwraca dla niego pusty obiekt.
Wartość zawiera klasę, komunikat, kod, plik, linię i łańcuch `previous`. Nie zawiera śladu stosu:

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

`\Rapira\log()` nie rzuca wyjątków. Jeśli `jsonSerialize()` rzuci wyjątek, Rapira zapisze `null` dla tej wartości.
Pozostałe klucze zostają zachowane.

Rapira zastępuje wartości, których JSON nie może przedstawić. Należą do nich zasoby, domknięcia, `NAN`, `INF` i nieprawidłowe ciągi UTF-8.
Pozostałe pola zostają zachowane. Rapira nie ogranicza rozmiaru kontekstu.
Przekazuj identyfikatory zamiast dużych obiektów.

## Formaty

Rapira zapisuje oba formaty do stderr. Duże wpisy z różnych procesów mogą się przeplatać, gdy te procesy zapisują do tego samego potoku stderr.

Rapira nie zapisuje logów w innych miejscach. Przekieruj stderr, aby zapisać je do pliku.
Menedżer usług może zbierać stderr. Zobacz [Wdrożenie produkcyjne](/pl/docs/deployment).

**`plain`** służy do czytania w terminalu - znacznik czasu, poziom, cel, komunikat:

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

Rapira używa kolorów, gdy stderr jest terminalem. Nie używa ich, gdy stderr jest plikiem.
Ustaw [`NO_COLOR`](https://no-color.org/) na niepustą wartość, aby wyłączyć kolory terminala.

**`json`** jest dla kolektora logów - jeden obiekt na linijkę:

```text
{"timestamp":…,"level":"ERROR","fields":{"message":…},"target":…}
```

`timestamp` używa RFC 3339, UTC i milisekund. Obiekt `fields` zawiera komunikat i inne pola.
Rapira ekranuje znaki nowej linii. Dlatego każdy wpis zajmuje jedną linię.
Wyjście JSON nie używa kolorów.

## `RUST_LOG`

`RUST_LOG` ustawia filtr ze środowiska. Pozwala zmienić filtr bez edycji konfiguracji:

```sh
RUST_LOG=info rapira serve --mode worker worker.php
RUST_LOG=rapira=debug,php=info rapira serve --mode worker worker.php
RUST_LOG=warn,rapira=trace rapira serve --mode worker worker.php
```

Pierwsze polecenie ustawia wszystkie cele na `info`. Drugie ustawia `rapira` na `debug` i `php` na `info`.
Trzecie ustawia wszystkie cele na `warn`, a `rapira` na `trace`. Cel `rapira` zawiera wpisy inicjalizacji, workerów i zamykania.
Gdy potrzebujesz wpisów procesu nadrzędnego, użyj `RUST_LOG=warn,rapira=trace,master=trace`.

::: warning
Niepusta wartość `RUST_LOG` **zastępuje** `level` i `[log.targets]`. Rapira nie łączy filtrów środowiska i pliku.
Usuń zmienną lub ustaw pustą wartość, aby użyć pliku. `RUST_LOG` nie wpływa na `format`.
:::
