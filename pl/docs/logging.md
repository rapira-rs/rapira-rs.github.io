---
title: Logi
description: Jak Rapira loguje — poziomy, nadpisania dla poszczególnych celów, diagnostyka PHP, formaty plain i JSON oraz zmienna RUST_LOG do debugowania.
---

# Logi

Wszystko, co Rapira ma do powiedzenia, płynie jednym strumieniem: zdarzenia z cyklu życia samego serwera, decyzje nadzorcze procesu nadrzędnego, warstwa HTTP i diagnostyka z PHP — wszystko na stderr i wszystko przepuszczone przez ten sam filtr. Przy tym ostatnim warto się zatrzymać: ostrzeżenia z PHP nie szukasz w osobnym pliku `error_log`, bo to zwykły wpis w tym samym logu co reszta — i tak samo jak każdy inny wpis możesz go podgłośnić albo wyciszyć.

Domyślnie jest cicho i jest to zamierzone. Bez żadnych ustawień przechodzi tylko `error`, bo logu serwera, który gada bez przerwy na produkcji, i tak nikt nie czyta. Podgłośnienie to jedna linijka w konfiguracji, a jeśli w ogóle nie chcesz jej ruszać — jest od tego zmienna środowiskowa.

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

Jeden globalny poziom to narzędzie mało precyzyjne. Kiedy tropisz problem w PHP, chcesz mieć diagnostykę PHP na `debug`, a nie utonąć przy okazji w każdym szczególe wnętrza stosu HTTP. Od tego jest `[log.targets]`:

```toml
[log]
level = "error"

[log.targets]
php = "debug"
pingora_core = "warn"
```

Każdy klucz nazywa jeden cel i podnosi albo obniża wyłącznie jego; cała reszta zostaje na `level`. Dopasowanie idzie **po prefiksie**, więc `php` obejmuje też `php_sys` i `php_sys::callbacks` — podajesz najkrótszy prefiks pokrywający to, co cię interesuje, i nigdy nie musisz wyliczać podmodułów.

Cele, pod którymi loguje sama Rapira:

| Cel      | Co obejmuje                                                                    |
| -------- | ------------------------------------------------------------------------------ |
| `rapira` | cykl życia serwera: start, cykl życia workerów, zamykanie                      |
| `master` | nadzór: forki, zbieranie zakończonych procesów, podstawianie nowych workerów, przeładowania, skalowanie puli |
| `http`   | warstwa HTTP: nasłuchy, obsługa pól żądania i odpowiedzi, wygaszanie           |
| `ext`    | wyniki zadań rozszerzeń                                                        |
| `php`    | wyjście i diagnostyka prosto z PHP                                             |

Zależności logują pod własnymi ścieżkami modułów — `pingora_core`, `tokio` i reszta — i podlegają dokładnie temu samemu filtrowi. Jeśli w logu rozgada się jakaś biblioteka, nazwę jej celu masz od razu we wpisie, gotową do przypięcia w `[log.targets]`.

::: tip
Gdy chcesz zrozumieć, dlaczego pula zachowuje się tak, a nie inaczej, obserwuj cel `master` — podstawianie workerów, przeładowania i skalowanie puli same się tam opowiadają. Co znaczą te zdarzenia, wyjaśnia [Model procesów](/pl/docs/process-model).
:::

## Diagnostyka PHP

Wszystko, co zgłasza PHP, trafia do celu `php`, a poziom każdej diagnostyki wynika z typu błędu — więc ten sam filtr, który steruje serwerem, decyduje też, ile słychać z PHP:

| Diagnostyka                                                                                                       | Poziom  |
| ------------------------------------------------------------------------------------------------------------------ | ------- |
| Błędy krytyczne — `E_ERROR`, `E_PARSE`, `E_CORE_ERROR`, `E_COMPILE_ERROR`, `E_USER_ERROR`, `E_RECOVERABLE_ERROR`  | `error` |
| Ostrzeżenia — `E_WARNING`, `E_CORE_WARNING`, `E_COMPILE_WARNING`, `E_USER_WARNING`                                | `warn`  |
| Powiadomienia — `E_NOTICE`, `E_USER_NOTICE`                                                                       | `info`  |
| Ostrzeżenia o wycofaniu — `E_DEPRECATED`, `E_USER_DEPRECATED`                                                     | `debug` |

Cała sól tej tabeli tkwi w tym, że ostrzeżenia o wycofaniu siedzą na `debug`: kilka tysięcy takich komunikatów z zależności nie przykryje dwóch ostrzeżeń, które naprawdę chciałeś zobaczyć.

Diagnostyka, którą skrypt odfiltrował maską [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php), nie znika — spada do `trace`. Zwykła maska działa więc tak, jak się spodziewasz:

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

Dzięki temu przy żadnym normalnym poziomie ostrzeżenia z zależności nie trafiają do logu, a `level = "trace"` i tak je przywróci, kiedy zechcesz sprawdzić, co właściwie zostało wyciszone. Warto znać dwa wyjątki. Błędy krytyczne **nigdy** nie lądują niżej, cokolwiek mówi maska: to jedyna relacja z tego, dlaczego worker poszedł na wymianę, a `error_reporting(0)` zakopane gdzieś w katalogu `vendor` nie może tego zasłonić. Poza tym `E_CORE_ERROR` i `E_CORE_WARNING` powstają, zanim skrypt zdąży w ogóle ustawić maskę, więc do nich też żadna maska się nie stosuje.

::: info
Diagnostyka idzie do logu, a nie do odpowiedzi. Rapira domyślnie ustawia [`display_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.display-errors) na `0`, a [`log_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.log-errors) na `1` — serwer nie powinien wypuszczać stack trace'ów na stronę. To *wartości domyślne*, a nie nadpisania: jeśli którąkolwiek z nich ustawia php.ini, wygrywa php.ini.
:::

## Formaty

Oba formaty lecą na stderr, jeden zapis na wpis. Właśnie ta zasada jednego zapisu sprawia, że proces nadrzędny i kilkanaście workerów piszących do tego samego deskryptora pliku nie wchodzą sobie w słowo w środku wpisu — każdy wpis idzie w całości, zamiast być składanym z kawałków.

**`plain`** wybierzesz do terminala — znacznik czasu, poziom, cel, komunikat:

```
2026-07-30T09:12:34.567890Z ERROR php: …
```

Kolory pojawiają się tylko wtedy, gdy stderr jest terminalem, i nigdy przy przekierowaniu do pliku — zapisany log zostaje więc czysty, bez sekwencji sterujących. Ustawienie [`NO_COLOR`](https://no-color.org/) na dowolną niepustą wartość gasi kolory nawet w terminalu.

**`json`** wybierzesz, gdy log zbiera kolektor — jeden obiekt na linijkę:

```
{"timestamp":…,"level":"ERROR","message":…,"target":…}
```

`timestamp` to RFC 3339 w UTC, z milisekundami. Znaki nowej linii w komunikacie są ekranowane, więc wpis zawsze zajmuje dokładnie jedną linijkę, a wielolinijkowy stack trace z PHP nigdy nie rozpada się na cztery linijki, których nic już nie sparsuje. Wpisy z wbudowanego silnika proxy niosą dodatkowe pola `log.*` z miejscem wywołania. Wyjście JSON nie jest kolorowane nigdy — w terminalu też nie.

## `RUST_LOG`

Edytowanie pliku konfiguracyjnego, żeby odpowiedzieć sobie na jedno pytanie, a potem odkręcanie tego z powrotem to kiepska pętla — jest więc zmienna środowiskowa, która pozwala ją pominąć:

```sh
RUST_LOG=info rapira serve worker.php
RUST_LOG=rapira=debug,php=info rapira serve worker.php
RUST_LOG=warn,rapira=trace rapira serve worker.php
```

Pierwsza linijka podgłaśnia wszystko do `info`. Druga to celowana para — serwer na `debug`, PHP na `info`. Trzecia wycisza zależności do `warn` i podnosi cel `rapira` — start, cykl życia workerów, zamykanie — do `trace`. Pozostałe cele dopasowują się po własnych nazwach, więc dopisz je, gdy pytanie dotyczy czegoś innego: `RUST_LOG=warn,rapira=trace,master=trace`.

::: warning
Gdy `RUST_LOG` jest ustawiona na niepustą wartość, **zastępuje** `level` i `[log.targets]` w całości — podmienia cały filtr, a nie scala go z konfiguracją. Twoje wpisy z `[log.targets]` nie leżą pod spodem jako druga warstwa: po prostu nikt do nich nie zagląda. Żeby wrócić do konfiguracji, zostaw zmienną nieustawioną (albo pustą). Na `format` nie wpływa nigdy.
:::

::: question Mam pusty log — coś się zepsuło?
Prawie na pewno nie: `level` domyślnie stoi na `error`, więc zdrowy serwer po prostu milczy. Uruchom go z `RUST_LOG=info`, a zobaczysz start, nasłuch i cykl życia workerów.
:::

::: question Jak zapisać log do pliku?
Przekieruj stderr procesu. Rapira pisze wyłącznie tam, co przy okazji znaczy, że menedżer usług zbierze log za ciebie bez żadnej konfiguracji — zobacz [Wdrożenie produkcyjne](/pl/docs/deployment).
:::

::: question Dlaczego wciąż widzę ostrzeżenie o wycofaniu, które zamaskowałem przez `error_reporting()`?
Zamaskowana diagnostyka spada do `trace`, zamiast znikać, więc wraca dopiero przy `level = "trace"`. Jeśli pracujesz na `trace` i nie chcesz jej widzieć, podnieś poziom.
:::

::: question Czy jest log dostępu?
Nie — nie ma logu z jedną linijką na żądanie. Cel `http` raportuje nasłuchy, wygaszanie i wszystko nietypowe w polach żądania czy odpowiedzi; co z nimi robi, opisuje [HTTP](/pl/docs/http).
:::
