---
title: Konfiguracja
description: "Pełny opis rapira.toml: każdy klucz sekcji [http], [pool], [supervisor] i [log] wraz z typem, wartością domyślną i regułami, które odrzucą błędną wartość."
---

# Konfiguracja

Rapira nie potrzebuje pliku konfiguracyjnego, żeby wystartować — `rapira serve --mode worker app/worker.php` dobierze wartość domyślną do wszystkiego. `rapira.toml` dodajesz wtedy, gdy te domyślne wartości przestają wystarczać: inny adres nasłuchu, ustalona liczba workerów, polityka recyklingu, pidfile, który odczyta twój system init, bardziej szczegółowy poziom logowania. Wskaż serwerowi plik, a serwer odczyta ustawienia właśnie z niego:

```bash
rapira serve --config /etc/rapira/rapira.toml
```

Plik ma cztery sekcje i każda z nich jest opcjonalna: `[http]` konfiguruje nasłuch, `[pool]` procesy workerów, `[supervisor]` proces nadrzędny, a `[log]` to, co trafia na stderr. Jedyny klucz bez wartości domyślnej to skrypt wejściowy PHP — ustaw tutaj `pool.entrypoint` albo podaj skrypt jako argument pozycyjny w wierszu poleceń.

::: info
Ustawienia układają się warstwami: flaga wiersza poleceń wygrywa z plikiem konfiguracyjnym, a plik z wbudowaną wartością domyślną. `--processes 8` bierze więc górę nad `processes = 4` z pliku, dzięki czemu konfigurację trzymaną w repozytorium wciąż da się nadpisać na jedno uruchomienie. Zmienne środowiskowe nie należą do tych warstw: poza dwiema, które dotyczą wyłącznie logów, ustawienia pochodzą tylko z pliku i z flag. Same flagi opisuje [Wiersz poleceń](/pl/docs/cli).
:::

## Kompletny rapira.toml

Wszystkie klucze, które Rapira rozumie, w jednym pliku. Nic poniżej nie jest obowiązkowe: skasuj dowolną linię, a wejdzie jej wartość domyślna. Wyjątki są cztery. `pool.entrypoint` nie ma domyślnej wartości, do której mógłby się cofnąć. `min_spare` i `max_spare` są wymagane tak długo, jak ustawione jest `scaling = "dynamic"`. `http.static.root` jest wymagany tak długo, jak w pliku stoi tabela `[http.static]`.

Dwie grupy kluczy trzeba też trzymać razem, więc częściowe skasowanie przerwie start. Tabelę `[http.static]` i wpis `"static"` w `middleware` kasuj naraz: Rapira odrzuca tabelę bez wpisu i odrzuca wpis bez tabeli. Tak samo `min_spare` i `max_spare` kasuj razem z `scaling = "dynamic"`: przy skalowaniu `static` i `ondemand` oba klucze zapasu są odrzucane.

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # optional; SERVER_NAME reported to PHP
server_port = 8000                    # optional; defaults to the listen TCP port (80 for unix:)
max_body_size_mb = 8                  # optional; larger request bodies get a 413
write_timeout_secs = 30               # optional; closes the connection when a response write stalls
keepalive_timeout_secs = 60           # optional; bounds an idle keepalive connection, one head read, one body frame
unsafe_field_names = "drop"           # optional; drop (default) | reject
middleware = ["static"]               # optional; the list order is the chain order

[http.static]                         # required when middleware lists "static"
root = "public"                       # required; the directory must exist; relative → this file's directory
forbid = [".php"]                     # optional; suffixes never served; an explicit list replaces the default

[http.sendfile]                       # optional; containment root for sendFile(), Dispatcher mode only
root = "public"                       # optional; defaults to the entrypoint's directory

[http.uploads]                        # optional; host-side multipart limits, Dispatcher mode only
dir = "/var/spool/rapira"             # optional; defaults to the system temp directory
max_file_size_mb = 2                  # optional; per file part
max_field_size_kb = 256               # optional; per field part
max_files = 20                        # optional; file parts per request
max_parts = 1024                      # optional; parts per request
max_part_headers = 32                 # optional; header fields per part

[pool]
entrypoint = "index.php"              # relative → resolved against this file's directory
mode = "dispatcher"                   # classic | worker | dispatcher (default)
processes = 4                         # worker processes to fork (max_children for dynamic/ondemand scaling)
scaling = "dynamic"                   # static (default) | dynamic | ondemand
min_spare = 1                         # dynamic only: keep at least this many idle workers
max_spare = 3                         # dynamic only: trim to at most this many idle workers (rejected under other scaling)
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
http = "warn"
```

Reszta tej strony omawia te klucze sekcja po sekcji.

## Sekcja `[http]`

Ta sekcja opisuje, gdzie Rapira nasłuchuje, co środowisko żądania mówi PHP o serwerze, pod którym działa, ile treści żądania serwer wczyta i jakie middleware pracuje przed PHP.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `listen` | tekst | `"127.0.0.1:8000"` | Adres nasłuchu w jednej z trzech postaci: `host:port` z literałem IP (`127.0.0.1:8000`, `[::1]:8000`), `:port` dla wszystkich interfejsów albo `unix:/run/rapira.sock` dla gniazda uniksowego. Sam port i nazwa hosta są odrzucane — z adresu musi wynikać, o który interfejs chodzi. |
| `server_name` | tekst | `"localhost"` | To, co PHP odczyta jako `$_SERVER['SERVER_NAME']`. |
| `server_port` | liczba całkowita | port z `listen`, `80` dla `unix:` | To, co PHP odczyta jako `$_SERVER['SERVER_PORT']`. Ustaw go, gdy proxy stojące przed Rapirą przyjmuje ruch na innym porcie niż ten, na którym nasłuchuje sama Rapira. |
| `max_body_size_mb` | liczba całkowita | `8` | Największa treść żądania, jaką Rapira przyjmie, w MiB (1024 × 1024 bajtów). Na cokolwiek większego odpowiada `413`. Minimum to 1. |
| `write_timeout_secs` | liczba całkowita | `30` | Jak długo pojedynczy zapis odpowiedzi może nie posuwać się do przodu. Gdy klient przestanie czytać na dłużej, Rapira zamyka połączenie. Minimum to 1, maksimum `86400`. |
| `keepalive_timeout_secs` | liczba całkowita | `60` | Jak długo połączenie może nie posuwać żądania do przodu. Ogranicza bezczynne połączenie keep-alive czekające na kolejne żądanie, jeden odczyt nagłówków żądania i jeden odczyt ramki treści. Treść, która utknie ponad limit, dostaje `408`. Minimum to 1, maksimum `86400`. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | Co się dzieje z polem żądania, którego nazwa wykracza poza `[A-Za-z0-9-]`: albo znika, zanim PHP je zobaczy, a każde usunięcie trafia do logu na poziomie `warn`, albo serwer odpowiada `400`. Uzasadnienie i stojące za tym mapowanie CGI opisują [Żądania i odpowiedzi HTTP](/pl/docs/http). |
| `middleware` | lista tekstów | pusta | Jakie middleware obsługuje żądanie przed PHP. Kolejność listy jest kolejnością łańcucha. `"static"` to na razie jedyna nazwa, jaką Rapira zna. Nazwa wymieniona dwa razy jest odrzucana, wymieniona nazwa bez własnej tabeli również, a skonfigurowana tabela pominięta na liście tak samo, więc lista jest jedynym włącznikiem każdego middleware. |

`server_name` i `server_port` kształtują wyłącznie to, co PHP widzi w `$_SERVER` — żaden z nich nie zmienia adresu, pod którym serwer nasłuchuje, bo o tym decyduje wyłącznie `listen`.

### Tabela `[http.static]`

Middleware `static` odpowiada na żądanie plikiem z katalogu na dysku, zanim żądanie dotrze do PHP. Obsługuje `GET` i `HEAD`. Każda inna metoda idzie do PHP. Ścieżka, która nie wskazuje żadnego pliku, leci dalej do PHP. Ścieżka z segmentem zaczynającym się od kropki leci dalej tak samo. URL katalogu również leci dalej: middleware nie serwuje żadnego pliku indeksu.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `root` | tekst | brak, wymagane | Katalog, z którego middleware serwuje pliki. Ścieżkę względną Rapira liczy od katalogu z plikiem konfiguracyjnym. Katalog musi istnieć przy starcie serwera, a proces serwera musi mieć prawo do wejścia w niego. Inaczej start się nie powiedzie. |
| `forbid` | lista tekstów | `[".php"]` | Końcówki nazw plików, których middleware nigdy nie zaserwuje. Każdy wpis zaczyna się od kropki, ma co najmniej dwa znaki i nie zawiera ani `/`, ani białych znaków. Dopasowanie pomija wielkość liter. Jawna lista zastępuje wartość domyślną, więc `forbid = []` serwuje spod katalogu każdy plik, źródła PHP włącznie. |

Każdy proces workera trzyma zaserwowane pliki w pamięci: najwyżej 16MiB, przy czym pojedynczy plik powyżej 256KiB nie trafia tam w ogóle. Wpis jest świeży przez jedną sekundę, więc nadpisany plik dociera do klientów sekundę po zapisie.

Więcej informacji znajdziesz na stronie [Pliki statyczne](/pl/docs/static-files).

### Tabela `[http.sendfile]`

Katalog sendfile wyznacza jedyne miejsce, z którego czyta `sendFile()`. Rapira sprowadza do postaci kanonicznej zarówno ten katalog, jak i żądaną ścieżkę, i odrzuca każdą ścieżkę wypadającą poza niego. `sendFile()` jest metodą `Rapira\Http\Exchange`, a wymianę dostaje do ręki wyłącznie skrypt w trybie Dispatcher. Ta tabela ma więc znaczenie tylko w trybie Dispatcher. Tryby Classic i Worker przyjmują ją i nigdy jej nie czytają.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `root` | tekst | katalog ze skryptem z `pool.entrypoint` | Jedyny katalog, z którego `sendFile()` może czytać. Ścieżkę względną Rapira liczy od katalogu z plikiem konfiguracyjnym. |

Katalogu, którego przy starcie serwera nie ma, nie da się sprowadzić do postaci kanonicznej, a wtedy `sendFile()` odrzuca każdą ścieżkę. Utwórz katalog, zanim uruchomisz serwer.

### Tabela `[http.uploads]`

Tabela `[http.uploads]` ogranicza parsowanie `multipart/form-data` po stronie hosta. Rapira parsuje treść multipart w hoście wyłącznie w trybie Dispatcher. Tryby Classic i Worker parsują ją w PHP, gdzie limity należą do `php.ini`, więc ta tabela w którymkolwiek z nich przerywa start.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `dir` | tekst | katalog tymczasowy systemu | Katalog buforowy na części plikowe. Ścieżkę względną Rapira liczy od katalogu z plikiem konfiguracyjnym. Rapira tworzy katalog przy starcie, sprawdza, że da się do niego pisać, i daje każdemu workerowi własny podkatalog `rapira-spool-<pid>`, który worker kasuje przy wyjściu. |
| `max_file_size_mb` | liczba całkowita | `2` | Największa pojedyncza część plikowa, w MiB. |
| `max_field_size_kb` | liczba całkowita | `256` | Największa pojedyncza część z polem, w KiB. |
| `max_files` | liczba całkowita | `20` | Ile części plikowych może nieść jedno żądanie. |
| `max_parts` | liczba całkowita | `1024` | Ile części może nieść jedno żądanie, plikowych i z polami razem. |
| `max_part_headers` | liczba całkowita | `32` | Ile pól nagłówka może nieść jedna część. |

Każdy z tych limitów musi wynosić co najmniej 1. Żądanie, które przekroczy którykolwiek z nich, dostaje `413`.

## Sekcja `[pool]`

Workery to procesy, które faktycznie wykonują PHP, a ta sekcja mówi, co wykonują, ilu ich jest i kiedy proces nadrzędny któregoś zabiera. Co proces nadrzędny robi z tymi liczbami, wyjaśnia [model procesów](/pl/docs/process-model).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `entrypoint` | tekst | brak — wymagane | Skrypt PHP, który wykonuje każdy worker. Ścieżkę względną Rapira liczy od katalogu z plikiem konfiguracyjnym. Argument `SCRIPT` w wierszu poleceń ma przed nim pierwszeństwo, a jedno z dwóch musi się pojawić — inaczej serwer w ogóle nie wystartuje. |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | Jak worker wykonuje skrypt wejściowy. `classic` uruchamia skrypt od zera przy każdym żądaniu. `worker` zostawia skrypt rezydentnym i wypełnia zmienne superglobalne na nowo przy każdym żądaniu. `dispatcher` zostawia skrypt rezydentnym i daje mu obiekt dyspozytora, z którego skrypt sam pobiera kolejne żądania. Flaga `--mode` w wierszu poleceń nadpisuje ten klucz w obie strony. Zobacz [tryby wykonania](/pl/docs/execution-modes). |
| `processes` | liczba całkowita | jeden na logiczny rdzeń CPU | Ile procesów workerów sforkować. Przy skalowaniu `dynamic` i `ondemand` to górny limit, a nie stała liczba. Minimum to 1. |
| `scaling` | `"static"` \| `"dynamic"` \| `"ondemand"` | `"static"` | Jak pula dobiera swój rozmiar. `static` trzyma przy życiu `processes` workerów bez przerwy; `dynamic` skaluje się między progami zapasu, z sufitem na `processes`; `ondemand` forkuje dopiero wtedy, gdy jest praca, i pozwala bezczynnym workerom odejść. |
| `min_spare` | liczba całkowita | brak | Tylko przy skalowaniu `dynamic` i tam wymagane: utrzymuj co najmniej tylu workerów bezczynnych i gotowych do pracy. |
| `max_spare` | liczba całkowita | brak | Tylko przy skalowaniu `dynamic` i tam wymagane: przycinaj pulę do najwyżej tylu bezczynnych workerów. Para musi spełniać `1 <= min_spare <= max_spare <= processes`; ustawienie któregokolwiek z nich przy innym skalowaniu to błąd. |
| `max_requests` | liczba całkowita | `0` | Wymień workera po obsłużeniu tylu żądań, z niewielkim rozrzutem, żeby cała pula nigdy nie wymieniała się naraz. `0` znaczy nigdy. |
| `process_idle_timeout_secs` | liczba całkowita | `10` | Czytane przy skalowaniu `ondemand`: jak długo worker może stać bezczynnie, zanim proces nadrzędny go zwolni. |
| `request_terminate_timeout_secs` | liczba całkowita | `0` | Budżet czasu rzeczywistego na pojedyncze żądanie. Worker, który po jego przekroczeniu wciąż nad nim pracuje, zostaje ubity i zastąpiony nowym. `0` wyłącza tę kontrolę. |

`mode` i `scaling` to dwie osobne osie: `mode` mówi, co worker robi ze skryptem wejściowym, a `scaling` ilu jest workerów.

Progi zapasu sprawdzane są względem obowiązującej wartości `processes`, więc flaga `--processes` w wierszu poleceń obniża też sufit, pod którym musi zmieścić się `max_spare`.

## Sekcja `[supervisor]`

Zasady dla procesu nadrzędnego — tego, który trzyma gniazdo nasłuchu, pilnuje workerów i odbiera twoje sygnały. To również z nim rozmawia system init, więc to właśnie te klucze zwykle ustawia jednostka usługi; zobacz [wdrożenie produkcyjne](/pl/docs/deployment).

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
| `[log.targets]` | tabela cel → poziom | pusta | Nadpisania dla poszczególnych celów, nakładane na `level`. Każdy klucz nazywa jeden z celów, pod którymi Rapira pisze: `php` niesie wyjście samego PHP, a `http` front HTTP. Klucz dopasowuje się po prefiksie, więc `php` obejmuje też `php_sys::callbacks` i wszystko poniżej. Pełną listę celów mają [Logi](/pl/docs/logging). |

Klucz w `[log.targets]` musi wyglądać jak ścieżka modułu: litery, cyfry oraz `_` `:` `.` `-`, a na początku litera, cyfra lub `_`. Klucze sklejają się w łańcuch filtra, więc cokolwiek spoza tego kształtu zostałoby odczytane jako składnia filtra, a nie nazwa celu — dlatego Rapira odrzuca to od razu.

`RUST_LOG` i `NO_COLOR` to jedyne zmienne środowiskowe, które Rapira odczytuje, i obie dotyczą wyłącznie logów: `RUST_LOG` zastępuje na jedno uruchomienie cały filtr, dzięki czemu szczegółowa sesja debugowania nie wymaga zmian w konfiguracji, a `NO_COLOR` odbiera kolory formatowi `plain` przy dowolnej niepustej wartości, nawet gdy stderr jest terminalem.

## Nieznane klucze są odrzucane

Rapira parsuje `rapira.toml` rygorystycznie. Każda tabela i każdy klucz w środku muszą być serwerowi znane, więc `[htttp]` albo `lissten = ":8000"` przerywa start i wprost nazywa to, czego nie rozpoznał, zamiast po cichu pominąć linię. Każdy klucz ma też dokładnie jedno miejsce: `max_requests` należy do `[pool]` i do niczego innego, `pidfile` do `[supervisor]` i do niczego innego, a wstawienie któregoś pod niewłaściwą tabelę kończy się tak samo jak literówka.

Wartości sprawdzane są tak samo. `level = "verbose"`, `format = "pretty"` i `unsafe_field_names = "allow"` to twarde błędy, a nie ciche zejście do wartości domyślnej, dzięki czemu literówka nie osłabi po cichu ustawienia bezpieczeństwa. Liczby też mają granice: `pool.processes`, `http.max_body_size_mb`, oba limity czasu z `[http]` i każdy limit z `[http.uploads]` muszą wynosić co najmniej 1, a każdy klucz `*_secs` kończy się na `86400`, czyli jednej dobie.

::: warning
Walidacja odbywa się, zanim cokolwiek wystartuje, więc nierozpoznany klucz przerywa uruchamianie, zamiast po cichu pogarszać pracę serwera. Edycja `rapira.toml` na maszynie, która akurat obsługuje ruch, nie rusza działającego procesu, ale następne uruchomienie musi się udać.
:::

## Ścieżki względne

Ścieżkę w systemie plików trzyma pięć kluczy: `pool.entrypoint`, `supervisor.pidfile`, `http.static.root`, `http.sendfile.root` i `http.uploads.dir`. Każdy z nich Rapira liczy od katalogu z plikiem konfiguracyjnym, a nie od katalogu roboczego tego, kto uruchomił serwer. Przy `/etc/rapira/rapira.toml` i `entrypoint = "app/worker.php"` skryptem jest `/etc/rapira/app/worker.php`, niezależnie od tego, skąd wywołano `rapira serve`.

Argument pozycyjny `SCRIPT` działa odwrotnie. To wartość z wiersza poleceń, więc ścieżkę względną liczy od bieżącego katalogu roboczego.

::: tip
Trzymaj `rapira.toml` razem z aplikacją, a ścieżki w nim zapisuj względem niego. Przeniesienie katalogu przenosi wtedy całą konfigurację, a nic nie zależy od tego, w jakim katalogu akurat startuje usługa.
:::
