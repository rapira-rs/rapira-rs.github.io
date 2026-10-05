---
title: Logi
description: "Poziomy logów Rapira, nadpisania dla poszczególnych celów, diagnostyka PHP, wpisy aplikacji, formaty i nadpisanie przez RUST_LOG."
---

# Logi

Rapira zapisuje wpisy logu do stderr. Te wpisy obejmują zdarzenia serwera, decyzje procesu nadrzędnego, zdarzenia HTTP i gRPC, diagnostykę PHP i komunikaty aplikacji. PHP wysyła swoją diagnostykę do tego logu, gdy ustawienie ini `error_log` jest puste. Puste ustawienie jest wartością domyślną.

Domyślny poziom to `error`, więc stderr zawiera tylko błędy. Zmień sekcję `[log]` lub ustaw `RUST_LOG`, aby wybrać inny poziom.

## Poziomy i format

Sekcja `[log]` pliku `rapira.toml` steruje logowaniem do stderr:

```toml
[log]
level = "error"   # Use error, warn, info, debug, or trace. Default: error.
format = "plain"  # Use plain or json. Default: plain.
```

`level` ustawia minimalny poziom dla wszystkich celów. `error` pokazuje tylko błędy, a każdy kolejny poziom dodaje więcej wpisów. `trace` pokazuje wszystkie wpisy. `format` wybiera czytelne linie lub jeden obiekt JSON na linię.

Oba klucze i cała sekcja są opcjonalne. Pozostałe sekcje pliku konfiguracyjnego opisuje [Konfiguracja](/pl/docs/configuration).

## Nadpisania dla poszczególnych celów

`[log.targets]` zastępuje poziom globalny dla poszczególnych celów. Może na przykład włączyć wpisy debug PHP i pozostawić wyłączone wpisy debug HTTP:

```toml
[log]
level = "error"

[log.targets]
php = "debug"
http = "warn"
```

Każdy klucz nazywa jeden cel. Pozostałe cele używają `level`. Klucz pasuje **po prefiksie**, więc `h2` pasuje też do ścieżek modułów `h2::codec` i `h2::proto` zależności. Nie musisz wymieniać podmodułów.

Rapira używa tych celów:

| Cel             | Co obejmuje                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `rapira`        | inicjalizacja serwera, cykl życia workerów, zamykanie                                           |
| `master`        | stan pul, błędy tworzenia procesów, ostrzeżenia o gotowości podczas przeładowania i limitach czasu żądań |
| `http`          | nasłuchy HTTP, przetwarzanie pól żądania i odpowiedzi, zamykanie                                |
| `grpc`          | nasłuchy gRPC, błędy transportu, zamykanie                                                      |
| `net`           | pętla akceptowania połączeń nasłuchów HTTP i gRPC, błędy akceptowania                           |
| `observability` | [proces metryk i sond](/pl/docs/observability): nasłuch, wygaszanie żądań, błędy               |
| `php`           | wyjście i diagnostyka z samego PHP                                                              |
| `app`           | wpisy, które aplikacja zapisuje przez `\Rapira\log()`                                           |

Rapira nie zapisuje logu dostępu z jedną linią dla każdego żądania. Wpisy pól celu `http` opisuje strona [HTTP](/pl/docs/http).

Zależność zapisuje wpisy trace pod swoją ścieżką modułu. Ten sam filtr prefiksu dotyczy tych wpisów. Każdy wpis zawiera nazwę swojego celu. Dodaj tę nazwę do `[log.targets]`, aby zmienić jej poziom.

::: tip
Cel `master` zgłasza stan pul, błędy tworzenia procesów, ostrzeżenia o gotowości podczas przeładowania i limitach czasu żądań. Nadzór nad pulami opisuje [Model procesów](/pl/docs/process-model).
:::

## Diagnostyka PHP

Rapira przypisuje diagnostykę PHP do celu `php`. Każdy typ błędu PHP odpowiada poziomowi logu:

| Diagnostyka                                                                                                       | Poziom  |
| ------------------------------------------------------------------------------------------------------------------ | ------- |
| Błędy krytyczne: `E_ERROR`, `E_PARSE`, `E_CORE_ERROR`, `E_COMPILE_ERROR`, `E_USER_ERROR`, `E_RECOVERABLE_ERROR`   | `error` |
| Ostrzeżenia: `E_WARNING`, `E_CORE_WARNING`, `E_COMPILE_WARNING`, `E_USER_WARNING`                                 | `warn`  |
| Powiadomienia: `E_NOTICE`, `E_USER_NOTICE`                                                                        | `info`  |
| Ostrzeżenia o wycofaniu: `E_DEPRECATED`, `E_USER_DEPRECATED`                                                      | `debug` |

Ostrzeżenia o wycofaniu używają `debug`. Dzięki temu ostrzeżenia o wycofaniu z zależności nie ukrywają ostrzeżeń i błędów.

Rapira ustawia poziom diagnostyki na `trace`, gdy [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) ją wyklucza. Na przykład:

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

Ta maska wyklucza ostrzeżenia o wycofaniu z zależności. Ustaw `level = "trace"`, aby je zapisać.

PHP nie zapisuje zamaskowanej diagnostyki. W trybach Worker i Dispatcher Rapira zapisuje ostatnią diagnostykę PHP w stałych punktach. Tryb Worker robi to po fazie rozruchu, po każdym zadaniu i po zakończeniu skryptu wejściowego. Tryb Dispatcher robi to tylko po zakończeniu skryptu wejściowego. Dlatego Rapira zapisuje zamaskowaną diagnostykę tylko wtedy, gdy jest ona ostatnią diagnostyką przed jednym z tych punktów. Tryb Classic nie zapisuje zamaskowanej diagnostyki.

Błędy krytyczne zawsze zachowują poziom `error`, więc `error_reporting(0)` ich nie ukrywa. Maska nie obejmuje też `E_CORE_ERROR` i `E_CORE_WARNING`, ponieważ PHP zgłasza je, zanim skrypt może ustawić maskę.

::: info
Rapira wysyła diagnostykę do logu, a nie do odpowiedzi. Ustawia domyślne `display_errors` na `0` i `log_errors` na `1`. Wartość z `php.ini` zastępuje te wartości domyślne.
:::

Wyjście PHP poza odpowiedzią trafia do celu `php` na poziomie `info`. Na przykład `echo` w fazie rozruchu trybu Worker trafia do logu. W [trybie Dispatcher](/pl/docs/dispatcher) całe wyjście `echo` trafia do logu, ponieważ odpowiedzi używają API dyspozytora. Domyślny poziom `error` ukrywa te wpisy. Ustaw `php = "info"` w `[log.targets]`, aby je pokazać.

::: question Dlaczego ostrzeżenie PHP pojawia się w logu dwa razy?
W trybach Worker i Dispatcher Rapira zapisuje też ostatnią diagnostykę PHP. Jeśli ta diagnostyka nie jest zamaskowana, PHP również ją zapisuje. Dlatego log zawiera dwa wpisy z tym samym poziomem i różnymi formatami tekstu.
:::

## Logowanie z aplikacji

`\Rapira\log()` zapisuje wpis do celu `app`. Przyjmuje komunikat, opcjonalny poziom i opcjonalną tablicę kontekstu. Funkcja jest dostępna w każdym trybie wykonania:

```php
<?php

\Rapira\log('order placed');
\Rapira\log('payment declined', \Rapira\LogLevel::Warning);
\Rapira\log('cache miss', \Rapira\LogLevel::Debug, ['key' => 'user:42', 'ttl' => 300]);
```

Poziom to przypadek wyliczenia `\Rapira\LogLevel`. Każdy przypadek odpowiada poziomowi logu Rapira:

| Przypadek `LogLevel` | Poziom wpisu |
| -------------------- | ------------ |
| `Error`              | `error`      |
| `Warning`            | `warn`       |
| `Info`               | `info`       |
| `Debug`              | `debug`      |
| `Trace`              | `trace`      |

`\Rapira\log()` używa `Info`, gdy pominiesz `level`. Domyślny poziom `error` ukrywa wpisy `Info`. Ustaw `app = "info"` w `[log.targets]`, aby je zapisać.

Rapira koduje tablicę kontekstu jako tekst JSON i dodaje go jako pole `context`. W wyjściu JSON `fields.context` jest ciągiem znaków, a nie zagnieżdżonym obiektem. Tekst JSON zachowuje nazwy kluczy i strukturę zagnieżdżonych tablic. Zdekoduj ten ciąg w kolektorze logów, aby odczytać klucze:

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

Rapira rozwija `Throwable`, który jest wartością najwyższego poziomu kontekstu. Robi to, ponieważ `json_encode()` zwraca pusty obiekt dla `Throwable`. Rapira nie rozwija `Throwable` w zagnieżdżonej tablicy, więc taki `Throwable` jest kodowany jako pusty obiekt. Rozwinięta wartość zawiera klasę, komunikat, kod, plik i linię. Zawiera też do czterech wyjątków `previous`. Nie zawiera śladu stosu:

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

`\Rapira\log()` nie rzuca wyjątków. Jeśli wywołanie `jsonSerialize()` w kontekście rzuci wyjątek, Rapira zapisze `null` dla tej wartości. Pozostałe klucze zostają zachowane.

::: question Jak Rapira serializuje duże konteksty logów?
Rapira koduje kontekst z flagą `JSON_PARTIAL_OUTPUT_ON_ERROR`. Zasób lub nieprawidłowy ciąg UTF-8 zmienia się w `null`. `NAN` i `INF` zmieniają się w `0`. Pozostałe pola zostają we wpisie.

Rapira nie skraca tablic ani ciągów znaków. Przekazuj identyfikatory zamiast dużych obiektów.
:::

## Formaty

Rapira zapisuje oba formaty do stderr. Duże wpisy z różnych procesów mogą się przeplatać, gdy te procesy zapisują do tego samego potoku stderr.

Przekieruj stderr, aby zapisać logi do pliku. Menedżer usług może zbierać stderr. Więcej informacji zawiera [Wdrożenie produkcyjne](/pl/docs/deployment).

**`plain`** to czytelne wyjście terminala. Zawiera znacznik czasu, poziom, cel i komunikat:

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

Rapira używa kolorów tylko wtedy, gdy stderr jest terminalem. Ustaw [`NO_COLOR`](https://no-color.org/) na dowolną niepustą wartość, aby wyłączyć kolory terminala.

**`json`** daje jeden obiekt na linię dla kolektora logów:

```text
{"timestamp":…,"level":"ERROR","fields":{"message":…},"target":…}
```

`timestamp` używa RFC 3339 w UTC z mikrosekundami. Obiekt `fields` zawiera komunikat i inne pola wpisu. Może na przykład zawierać pole `context` aplikacji. Rapira ekranuje znaki nowej linii w komunikatach, na przykład w śladach stosu PHP. Dlatego każdy wpis zajmuje dokładnie jedną linię. Wyjście JSON nie używa kolorów.

## `RUST_LOG`

`RUST_LOG` ustawia filtr logów stderr ze środowiska. Poniższe polecenia zmieniają filtr i nie zmieniają pliku konfiguracyjnego:

```sh
RUST_LOG=info rapira serve rapira.toml
RUST_LOG=error,rapira=debug,php=info rapira serve rapira.toml
RUST_LOG=warn,rapira=trace,master=trace rapira serve rapira.toml
```

Pierwsze polecenie ustawia wszystkie cele na `info`. Drugie ustawia `rapira` na `debug`, `php` na `info`, a wszystkie inne cele na `error`. Trzecie ustawia wszystkie cele na `warn`, a `rapira` i `master` na `trace`.

Cel, do którego wartość nie pasuje, nie zapisuje żadnych wpisów. Na przykład `RUST_LOG=php=info` ukrywa wszystkie błędy z celów `master` i `http`. Dodaj poziom bez nazwy celu, na przykład `error`, aby zachować wpisy z pozostałych celów.

::: warning
Niepusta wartość `RUST_LOG` **zastępuje** `level` i `[log.targets]`. Rapira nie łączy filtrów środowiska i pliku. Usuń zmienną, aby użyć ustawień z pliku konfiguracyjnego. Możesz też ustawić pustą wartość zmiennej. `RUST_LOG` nie wpływa na `format`.
:::
