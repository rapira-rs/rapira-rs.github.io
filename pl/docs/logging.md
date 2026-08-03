---
title: Logi
description: "Jak Rapira loguje — poziomy, nadpisania dla poszczególnych celów, diagnostyka PHP, logowanie z aplikacji, formaty plain i JSON oraz zmienna RUST_LOG do debugowania."
---

# Logi

Rapira zapisuje wszystko do jednego strumienia: zdarzenia z cyklu życia samego serwera, decyzje nadzorcze procesu nadrzędnego, warstwa HTTP, diagnostyka z PHP i to, co aplikacja loguje sama — wszystko na stderr i wszystko przepuszczone przez ten sam filtr. Ostrzeżenie z PHP jest wpisem w tym samym logu, a nie linijką w osobnym pliku `error_log`, i jego poziom podnosisz albo obniżasz tak samo jak każdego innego wpisu.

Domyślny poziom to `error`, więc przechodzą tylko błędy, a sprawny serwer nie zapisuje nic. Podniesienie go to jedna linijka w konfiguracji albo zmienna środowiskowa `RUST_LOG`, kiedy nie chcesz w ogóle ruszać konfiguracji.

## Poziomy i format

Logowaniem sterujesz w sekcji `[log]` swojego `rapira.toml`:

```toml
[log]
level = "error"   # error (default) | warn | info | debug | trace
format = "plain"  # plain (default) | json
```

`level` to wspólna podłoga dla wszystkich celów naraz: `error` pokazuje same błędy, `warn` dokłada ostrzeżenia i tak dalej, aż do `trace`, przy którym widać wszystko. `format` decyduje o kształcie pojedynczego wpisu — czytelne dla człowieka linijki albo jeden obiekt JSON na linijkę.

Oba klucze są opcjonalne, tak samo jak cała sekcja. Resztę pliku — nasłuchy, pulę, supervisora — opisuje [Konfiguracja](/pl/docs/configuration).

## Nadpisania dla poszczególnych celów

Jeden globalny poziom bywa zbyt zgrubny. `[log.targets]` podnosi albo obniża pojedyncze cele ponad niego, dzięki czemu diagnostyka PHP może działać na `debug`, a szczegóły z wnętrza stosu HTTP nie idą razem z nią:

```toml
[log]
level = "error"

[log.targets]
php = "debug"
pingora_core = "warn"
```

Każdy klucz nazywa jeden cel i podnosi albo obniża wyłącznie jego; cała reszta zostaje na `level`. Dopasowanie idzie **po prefiksie**, więc `php` obejmuje też `php_sys` i `php_sys::callbacks` — wystarczy najkrótszy pasujący prefiks, a podmodułów nigdy nie trzeba wymieniać po kolei.

Cele, pod którymi loguje sama Rapira:

| Cel      | Co obejmuje                                                                    |
| -------- | ------------------------------------------------------------------------------ |
| `rapira` | cykl życia serwera: start, cykl życia workerów, zamykanie                      |
| `master` | nadzór: forki, zbieranie zakończonych procesów, podstawianie nowych workerów, przeładowania, skalowanie puli |
| `http`   | warstwa HTTP: nasłuchy, obsługa pól żądania i odpowiedzi, wygaszanie           |
| `ext`    | wyniki zadań rozszerzeń                                                        |
| `php`    | wyjście i diagnostyka prosto z PHP                                             |
| `app`    | wpisy zapisywane przez aplikację przez `\Rapira\log()`                        |

Logu dostępu nie ma: Rapira nie zapisuje jednej linijki na żądanie. To, co cel `http` raportuje o polach żądania i odpowiedzi, opisuje strona [HTTP](/pl/docs/http).

Zależności logują pod własnymi ścieżkami modułów — `pingora_core`, `tokio` i reszta — i podlegają dokładnie temu samemu filtrowi. Każdy wpis niesie nazwę swojego celu, więc hałaśliwą zależność wyciszysz, przepisując tę nazwę do `[log.targets]`.

::: tip
Gdy chcesz zrozumieć, dlaczego pula zachowuje się tak, a nie inaczej, obserwuj cel `master` — podstawianie workerów, przeładowania i skalowanie puli trafiają właśnie tam. Co znaczą te zdarzenia, wyjaśnia [Model procesów](/pl/docs/process-model).
:::

## Diagnostyka PHP

Wszystko, co zgłasza PHP, trafia do celu `php`, a poziom każdej diagnostyki wynika z typu błędu — więc ten sam filtr, który steruje serwerem, decyduje też, ile wyjścia z PHP trafia do logu:

| Diagnostyka                                                                                                       | Poziom  |
| ------------------------------------------------------------------------------------------------------------------ | ------- |
| Błędy krytyczne — `E_ERROR`, `E_PARSE`, `E_CORE_ERROR`, `E_COMPILE_ERROR`, `E_USER_ERROR`, `E_RECOVERABLE_ERROR`  | `error` |
| Ostrzeżenia — `E_WARNING`, `E_CORE_WARNING`, `E_COMPILE_WARNING`, `E_USER_WARNING`                                | `warn`  |
| Powiadomienia — `E_NOTICE`, `E_USER_NOTICE`                                                                       | `info`  |
| Ostrzeżenia o wycofaniu — `E_DEPRECATED`, `E_USER_DEPRECATED`                                                     | `debug` |

Ostrzeżenia o wycofaniu siedzą na `debug` po to, żeby kilka tysięcy takich komunikatów z zależności nie przykryło zgłaszanych obok nich ostrzeżeń i błędów.

Diagnostyka, którą skrypt odfiltrował maską [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php), nie znika — spada do `trace`. Zwykła maska działa więc tak, jak się spodziewasz:

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

Dzięki temu przy żadnym normalnym poziomie ostrzeżenia z zależności nie trafiają do logu, a `level = "trace"` i tak je przywróci, kiedy zechcesz sprawdzić, co właściwie zostało wyciszone. Wyjątki są dwa. Błędy krytyczne **nigdy** nie lądują niżej, cokolwiek mówi maska, bo tylko one tłumaczą, dlaczego worker poszedł na wymianę — `error_reporting(0)` w katalogu `vendor` ich nie ukryje. `E_CORE_ERROR` i `E_CORE_WARNING` powstają, zanim skrypt zdąży w ogóle ustawić maskę, więc do nich też żadna maska się nie stosuje.

::: info
Diagnostyka idzie do logu, a nie do odpowiedzi: Rapira domyślnie ustawia [`display_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.display-errors) na `0`, a [`log_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.log-errors) na `1`. To *wartości domyślne*, a nie nadpisania: jeśli którąkolwiek z nich ustawia php.ini, wygrywa php.ini.
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

Pominięcie argumentu zapisuje wpis na poziomie `Info`. Ponieważ są to te same poziomy co wszędzie indziej, `[log.targets]` i `RUST_LOG` filtrują wpisy aplikacji dokładnie tak samo jak wpisy samego serwera — `app = "debug"` w `[log.targets]` podnosi wpisy aplikacji, nie ruszając niczego dookoła.

Tablica kontekstu jest serializowana do JSON-a i dołączana do wpisu jako pole `context`. Klucze zostają takie, jak je zapisano, a zagnieżdżone tablice zachowują swoją strukturę:

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

`Throwable` w kontekście jest rozwijany przed serializacją, bo `json_encode()` widzi wyjątek jako pusty obiekt — jego stan leży w prywatnych właściwościach `Exception` i `Error`. Rozwinięcie niesie nazwę klasy, komunikat, kod, plik i linię oraz idzie łańcuchem `previous`; ślad stosu nie jest dołączany:

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

Decydując, co włożyć do kontekstu, warto znać dwa ograniczenia. Wartość, której JSON nie potrafi wyrazić — zasób, domknięcie, `NAN` lub `INF`, ciąg niebędący poprawnym UTF-8 — zostaje zastąpiona wypełniaczem, a nie kosztuje cię całego wpisu, więc sąsiednie klucze docierają. A kontekst nie ma ograniczenia rozmiaru: duża tablica albo długi ciąg są serializowane w całości i dają odpowiednio duży wpis, więc przekazuj identyfikatory, a nie obiekty, które oznaczają.

## Formaty

Oba formaty lecą na stderr, jeden zapis na wpis. Właśnie ta zasada jednego zapisu sprawia, że proces nadrzędny i kilkanaście workerów piszących do tego samego deskryptora pliku nie mieszają się nawzajem w środku wpisu — każdy wpis idzie w całości, zamiast być składanym z kawałków.

Rapira nie zapisuje nigdzie indziej, więc to przekierowanie stderr procesu umieszcza log w pliku, a menedżer usług zbiera go bez żadnej konfiguracji. Więcej informacji znajdziesz na stronie [Wdrożenie produkcyjne](/pl/docs/deployment).

**`plain`** służy do czytania w terminalu — znacznik czasu, poziom, cel, komunikat:

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

Kolory pojawiają się tylko wtedy, gdy stderr jest terminalem, i nigdy przy przekierowaniu do pliku — zapisany log zostaje więc czysty, bez sekwencji sterujących. Ustawienie [`NO_COLOR`](https://no-color.org/) na dowolną niepustą wartość gasi kolory nawet w terminalu.

**`json`** jest dla kolektora logów — jeden obiekt na linijkę:

```text
{"timestamp":…,"level":"ERROR","message":…,"target":…}
```

`timestamp` to RFC 3339 w UTC, z milisekundami. Znaki nowej linii w komunikacie są ekranowane, więc wpis zawsze zajmuje dokładnie jedną linijkę, łącznie z wielolinijkowym stack trace'em z PHP. Wpisy z wbudowanego silnika proxy niosą dodatkowe pola `log.*` z miejscem wywołania. Wyjście JSON nie jest kolorowane nigdy — w terminalu też nie.

## `RUST_LOG`

`RUST_LOG` ustawia filtr logów ze środowiska, więc jednorazowa sesja debugowania nie wymaga edycji konfiguracji:

```sh
RUST_LOG=info rapira serve worker.php
RUST_LOG=rapira=debug,php=info rapira serve worker.php
RUST_LOG=warn,rapira=trace rapira serve worker.php
```

Pierwsza linijka podgłaśnia wszystko do `info`. Druga to celowana para — cel `rapira` na `debug`, PHP na `info`. Trzecia wycisza zależności do `warn` i podnosi cel `rapira` — start, cykl życia workerów, zamykanie — do `trace`. Pozostałe cele dopasowują się po własnych nazwach, więc dopisz je, gdy pytanie dotyczy czegoś innego: `RUST_LOG=warn,rapira=trace,master=trace`.

::: warning
Gdy `RUST_LOG` jest ustawiona na niepustą wartość, **zastępuje** `level` i `[log.targets]` w całości — podmienia cały filtr, a nie scala go z konfiguracją. Twoje wpisy z `[log.targets]` nie leżą pod spodem jako druga warstwa: po prostu nikt do nich nie zagląda. Żeby wrócić do konfiguracji, zostaw zmienną nieustawioną (albo pustą). Na `format` nie wpływa nigdy.
:::
