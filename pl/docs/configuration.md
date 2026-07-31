---
title: Konfiguracja
description: "Pełny opis rapira.toml: każdy klucz sekcji [http], [pool], [supervisor] i [log] wraz z typem, wartością domyślną i regułami, które odrzucą błędną wartość."
---

# Konfiguracja

Rapira nie potrzebuje pliku konfiguracyjnego, żeby wystartować — `rapira serve app/worker.php` dobierze wartość domyślną do wszystkiego. `rapira.toml` dodajesz wtedy, gdy te domyślne wartości przestają wystarczać: inny adres nasłuchu, ustalona liczba workerów, polityka recyklingu, pidfile, który odczyta twój system init, bardziej szczegółowy poziom logowania. Wskaż serwerowi plik, a serwer odczyta ustawienia właśnie z niego:

```bash
rapira serve --config /etc/rapira/rapira.toml
```

Plik ma cztery sekcje i każda z nich jest opcjonalna: `[http]` konfiguruje nasłuch, `[pool]` procesy workerów, `[supervisor]` proces nadrzędny, a `[log]` to, co trafia na stderr. Jedyny klucz bez wartości domyślnej to skrypt wejściowy PHP — ustaw tutaj `pool.entrypoint` albo podaj skrypt jako argument pozycyjny w wierszu poleceń.

::: info
Ustawienia układają się warstwami: flaga wiersza poleceń wygrywa z plikiem konfiguracyjnym, a plik z wbudowaną wartością domyślną. `--processes 8` bierze więc górę nad `processes = 4` z pliku, dzięki czemu konfigurację trzymaną w repozytorium wciąż da się nadpisać na jedno uruchomienie. Same flagi opisuje [Wiersz poleceń](/pl/docs/cli).
:::

## Kompletny rapira.toml

Wszystkie klucze, które Rapira rozumie, w jednym pliku. Nic poniżej nie jest obowiązkowe — skasuj dowolną linię, a wejdzie jej wartość domyślna. Wyjątki są dwa: `pool.entrypoint` nie ma domyślnej wartości, do której mógłby się cofnąć, a `min_spare`/`max_spare` są wymagane tak długo, jak w pliku ustawione jest `mode = "dynamic"`.

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # optional; SERVER_NAME reported to PHP
server_port = 8000                    # optional; defaults to the listen TCP port (80 for unix:)
max_body_size_mb = 8                  # optional; larger request bodies get a 413
unsafe_field_names = "drop"           # optional; drop (default) | reject

[pool]
entrypoint = "index.php"              # relative → resolved against this file's directory
processes = 4                         # worker processes to fork (max_children for mode = dynamic/ondemand)
classic = false                       # optional; default false
mode = "dynamic"                      # static (default) | dynamic | ondemand
min_spare = 1                         # dynamic only: keep at least this many idle workers
max_spare = 3                         # dynamic only: trim to at most this many idle workers (rejected under other modes)
max_requests = 0                      # recycle a worker after N requests (+jitter); 0 = unlimited
process_idle_timeout_secs = 10        # ondemand: retire an idle worker after this long
request_terminate_timeout_secs = 0    # kill a worker whose single request runs longer (wall clock); 0 = off

[supervisor]                          # optional; master-process policy
pidfile = "/run/rapira.pid"           # optional; relative paths resolve against this file's dir
process_control_timeout_secs = 30     # graceful-stop budget before QUIT → TERM → KILL

[log]                                 # optional; verbosity and record shape
level = "error"                       # error (default) | warn | info | debug | trace
format = "plain"                      # plain (default) | json

[log.targets]                         # optional; per-target overrides on top of level
php = "debug"
pingora_core = "warn"
```

Reszta tej strony to ten sam plik, klucz po kluczu.

## Sekcja `[http]`

Ta sekcja opisuje, gdzie Rapira nasłuchuje, co środowisko żądania mówi PHP o serwerze, pod którym działa, i ile treści żądania serwer wczyta.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `listen` | tekst | `"127.0.0.1:8000"` | Adres nasłuchu w jednej z trzech postaci: `host:port` z literałem IP (`127.0.0.1:8000`, `[::1]:8000`), `:port` dla wszystkich interfejsów albo `unix:/run/rapira.sock` dla gniazda uniksowego. Sam port i nazwa hosta są odrzucane — z adresu musi wynikać, o który interfejs chodzi. |
| `server_name` | tekst | `"localhost"` | To, co PHP odczyta jako `$_SERVER['SERVER_NAME']`. |
| `server_port` | liczba całkowita | port z `listen`, `80` dla `unix:` | To, co PHP odczyta jako `$_SERVER['SERVER_PORT']`. Ustaw go, gdy proxy stojące przed Rapirą przyjmuje ruch na innym porcie niż ten, na którym nasłuchuje sama Rapira. |
| `max_body_size_mb` | liczba całkowita | `8` | Największa treść żądania, jaką Rapira przyjmie, w MiB (1024 × 1024 bajtów). Na cokolwiek większego odpowiada `413`. Minimum to 1. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | Co się dzieje z polem żądania, którego nazwa wykracza poza `[A-Za-z0-9-]`: albo znika, zanim PHP je zobaczy, a każde usunięcie trafia do logu na poziomie `warn`, albo serwer odpowiada `400`. Uzasadnienie i stojące za tym mapowanie CGI opisują [Żądania i odpowiedzi HTTP](/pl/docs/http). |

`server_name` i `server_port` kształtują wyłącznie to, co PHP widzi w `$_SERVER` — żaden z nich nie zmienia adresu, pod którym serwer faktycznie nasłuchuje. O tym decyduje `listen` i nic poza nim.

## Sekcja `[pool]`

Workery to procesy, które faktycznie wykonują PHP, a ta sekcja mówi, co wykonują, ilu ich jest i kiedy proces nadrzędny któregoś zabiera. Co proces nadrzędny robi z tymi liczbami, wyjaśnia [model procesów](/pl/docs/process-model); tutaj są to po prostu klucze.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `entrypoint` | tekst | brak — wymagane | Skrypt PHP, który wykonuje każdy worker. Ścieżkę względną Rapira liczy od katalogu z plikiem konfiguracyjnym. Argument `SCRIPT` w wierszu poleceń ma przed nim pierwszeństwo, a jedno z dwóch musi się pojawić — inaczej serwer w ogóle nie wystartuje. |
| `processes` | liczba całkowita | jeden na logiczny rdzeń CPU | Ile procesów workerów sforkować. W trybach `dynamic` i `ondemand` to górny limit, a nie stała liczba. Minimum to 1. |
| `classic` | wartość logiczna | `false` | `false` zostawia workera przy życiu między żądaniami (szczebel SAPI Worker); `true` wykonuje skrypt wejściowy od zera przy każdym żądaniu, dokładnie tak jak php-fpm. Zobacz [tryby wykonania](/pl/docs/execution-modes). Flaga `--classic` potrafi tryb wyłącznie włączyć — `true` z pliku nie da się nadpisać z wiersza poleceń. |
| `mode` | `"static"` \| `"dynamic"` \| `"ondemand"` | `"static"` | Jak pula dobiera swój rozmiar. `static` trzyma przy życiu `processes` workerów bez przerwy; `dynamic` skaluje się między progami zapasu, z sufitem na `processes`; `ondemand` forkuje dopiero wtedy, gdy jest praca, i pozwala bezczynnym workerom odejść. |
| `min_spare` | liczba całkowita | brak | Tylko dla `dynamic` i tam wymagane: utrzymuj co najmniej tylu workerów bezczynnych i gotowych do pracy. |
| `max_spare` | liczba całkowita | brak | Tylko dla `dynamic` i tam wymagane: przycinaj pulę do najwyżej tylu bezczynnych workerów. Para musi spełniać `1 <= min_spare <= max_spare <= processes`; ustawienie któregokolwiek z nich w innym trybie to błąd, a nie podpowiedź. |
| `max_requests` | liczba całkowita | `0` | Wymień workera po obsłużeniu tylu żądań, z niewielkim rozrzutem, żeby cała pula nigdy nie wymieniała się naraz. `0` znaczy nigdy. |
| `process_idle_timeout_secs` | liczba całkowita | `10` | Czytane w trybie `ondemand`: jak długo worker może stać bezczynnie, zanim proces nadrzędny go zwolni. |
| `request_terminate_timeout_secs` | liczba całkowita | `0` | Budżet czasu rzeczywistego na pojedyncze żądanie. Worker, który po jego przekroczeniu wciąż nad nim pracuje, zostaje ubity i zastąpiony nowym. `0` wyłącza tę kontrolę. |

## Sekcja `[supervisor]`

Zasady dla procesu nadrzędnego — tego, który trzyma gniazdo nasłuchu, pilnuje workerów i odbiera twoje sygnały. To również z nim rozmawia system init, więc tę sekcję zwykle wypełniasz przy pisaniu jednostki usługi; zobacz [wdrożenie produkcyjne](/pl/docs/deployment).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `pidfile` | tekst | brak | Gdzie proces nadrzędny zapisuje własny pid. Ścieżkę względną liczy od katalogu z plikiem konfiguracyjnym. To właśnie na ten pid wysyłasz sygnały — pełną tabelę tego, co robi każdy z nich, ma [model procesów](/pl/docs/process-model). |
| `process_control_timeout_secs` | liczba całkowita | `30` | Ile czasu proces nadrzędny daje workerowi na łagodne dokończenie pracy, zanim przejdzie do QUIT → TERM → KILL. |

## Sekcja `[log]`

Rapira pisze wszystko na stderr, jednym zapisem na rekord, dzięki czemu wyjście procesu nadrzędnego i workerów nigdy nie miesza się w połowie linii. Ta sekcja decyduje, jak szczegółowy jest ten strumień i jaki kształt ma pojedynczy rekord; poszczególne cele, formaty i to, jak diagnostyka PHP mapuje się na poziomy, opisują [Logi](/pl/docs/logging).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | Poziom szczegółowości, wspólny od razu dla wszystkich celów. |
| `format` | `"plain"` \| `"json"` | `"plain"` | Kształt rekordu: czytelne dla człowieka linie (kolorowane, gdy stderr jest terminalem) albo jeden obiekt JSON na linię dla kolektora logów. |
| `[log.targets]` | tabela cel → poziom | pusta | Nadpisania dla poszczególnych celów, nakładane na `level` — na przykład `php = "debug"`, gdy cała reszta ma milczeć. Klucz dopasowuje się po prefiksie, więc `php` obejmuje też `php_sys::callbacks` i wszystko poniżej. |

Klucz w `[log.targets]` musi wyglądać jak ścieżka modułu: litery, cyfry oraz `_` `:` `.` `-`, a na początku litera, cyfra lub `_`. Klucze sklejają się w łańcuch filtra, więc cokolwiek spoza tego kształtu zostałoby odczytane jako składnia filtra, a nie nazwa celu — dlatego Rapira odrzuca to od razu.

## Nieznane klucze są odrzucane

Rapira parsuje `rapira.toml` rygorystycznie. Każda tabela i każdy klucz w środku muszą być serwerowi znane, więc `[htttp]` albo `lissten = ":8000"` przerywa start i wprost nazywa to, czego nie rozpoznał, zamiast po cichu pominąć linię. Każdy klucz ma też dokładnie jedno miejsce: `max_requests` należy do `[pool]` i do niczego innego, `pidfile` do `[supervisor]` i do niczego innego, a wstawienie któregoś pod niewłaściwą tabelę kończy się tak samo jak literówka.

Wartości sprawdzane są tak samo. `level = "verbose"`, `format = "pretty"` i `unsafe_field_names = "allow"` to twarde błędy, a nie ciche zejście do wartości domyślnej — literówka, która po cichu osłabia ustawienie bezpieczeństwa, jest gorsza niż taka, która przerywa start. Liczby też mają granice: `pool.processes` i `http.max_body_size_mb` muszą wynosić co najmniej 1, a każdy klucz `*_secs` kończy się na `86400`, czyli jednej dobie.

::: warning
Walidacja odbywa się, zanim cokolwiek wystartuje, więc nierozpoznany klucz przerywa uruchamianie, zamiast po cichu pogarszać pracę serwera. Warto o tym pamiętać, edytując `rapira.toml` na maszynie, która akurat obsługuje ruch: działającego procesu to nie rusza, ale następne uruchomienie musi się udać.
:::

## Ścieżki względne

Ścieżkę w systemie plików trzymają dwa klucze — `pool.entrypoint` i `supervisor.pidfile` — i oba Rapira liczy od katalogu z plikiem konfiguracyjnym, a nie od katalogu roboczego tego, kto uruchomił serwer. Przy `/etc/rapira/rapira.toml` i `entrypoint = "app/worker.php"` skryptem jest `/etc/rapira/app/worker.php`, niezależnie od tego, skąd wywołano `rapira serve`.

Argument pozycyjny `SCRIPT` działa odwrotnie. To wartość z wiersza poleceń, więc ścieżkę względną liczy od katalogu bieżącego — dokładnie tak, jak zrobiłby to każdy inny program, któremu podajesz nazwę pliku.

::: tip
Trzymaj `rapira.toml` razem z aplikacją, a ścieżki w nim zapisuj względem niego. Przeniesienie katalogu przenosi wtedy całą konfigurację, a nic nie zależy od tego, w jakim katalogu akurat startuje usługa.
:::

::: question Czy plik konfiguracyjny jest w ogóle potrzebny?
Nie. `rapira serve` ze skryptem i jedną czy dwiema flagami wystarcza w typowym przypadku, a wszystko, czego nie ustawisz, bierze udokumentowaną wyżej wartość domyślną. Plik zaczyna się opłacać, gdy ustawień robi się więcej, niż chce ci się pamiętać, albo gdy chcesz je recenzować i trzymać w repozytorium razem z aplikacją.
:::

::: question Czy Rapirę da się skonfigurować zmiennymi środowiskowymi?
Nie — ustawienia biorą się z pliku konfiguracyjnego i z flag wiersza poleceń, i znikąd indziej. Wyjątkiem są dwie zmienne dotyczące wyłącznie logów: `RUST_LOG`, czyli debugowe nadpisanie, które zastępuje cały filtr logów, dzięki czemu bardziej szczegółowe logowanie nie wymaga zmian w konfiguracji, oraz `NO_COLOR`, które odbiera kolory formatowi `plain` — wyłącza je dowolna niepusta wartość, nawet na terminalu. Obie opisują [Logi](/pl/docs/logging).
:::

::: question Dlaczego serwer nie chce wystartować z `mode = "dynamic"`?
Najpewniej przez progi zapasu. `dynamic` wymaga obu kluczy — `min_spare` i `max_spare` — a muszą one spełniać `1 <= min_spare <= max_spare <= processes`; pamiętaj przy tym, że flaga `--processes` obniża sufit, względem którego są sprawdzane. W trybach `static` i `ondemand` te same klucze są odrzucane wprost, co zwykle znaczy, że w linii `mode` stoi coś innego, niż zamierzałeś.
:::
