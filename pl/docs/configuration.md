---
title: Konfiguracja
description: "Wszystkie klucze rapira.toml, ich typy, wartości domyślne i reguły walidacji."
---

# Konfiguracja

Rapira wymaga pliku konfiguracyjnego. Polecenie `rapira serve` przyjmuje jego ścieżkę jako jedyny argument. Dowolna nazwa pliku działa, a ta dokumentacja używa `rapira.toml`:

```bash
rapira serve /etc/rapira/rapira.toml
```

Plik ustawia adres, liczbę workerów, wymianę, pidfile i poziom logowania. Wartość z pliku zastępuje wartość domyślną.

`[http]` i `[grpc]` konfigurują osobne nasłuchy i pule workerów PHP. Skonfiguruj co najmniej jedną z tych sekcji. `[supervisor]` konfiguruje proces nadrzędny. `[log]` konfiguruje wyjście stderr.

Każdy włączony nasłuch wymaga skryptu wejściowego PHP. Ustaw `http.pool.entrypoint`, `grpc.pool.entrypoint` lub oba klucze.

## Kompletny rapira.toml

Poniższa konfiguracja włącza oba protokoły i pokazuje obsługiwane tabele. Większość brakujących kluczy używa wartości domyślnej. Każda pula wymaga `entrypoint`. Skalowanie dynamiczne wymaga `min_spare` i `max_spare`. Tabela `[http.static]` wymaga `http.static.root`.

Niektóre klucze muszą występować razem. Tabela `[http.static]` wymaga wpisu `"static"` w `middleware`, a wpis wymaga tabeli. Usuń `min_spare` i `max_spare`, gdy skalowanie nie jest `dynamic`. Rapira odrzuca te klucze ze skalowaniem `static` i `ondemand`.

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # Optional. Sets SERVER_NAME for PHP.
server_port = 8000                    # Optional. Uses the TCP listen port by default.
max_body_size_mb = 8                  # Optional. Rapira returns 413 for larger request bodies.
write_timeout_secs = 30               # Optional. Closes a connection after a response write times out.
keepalive_timeout_secs = 60           # Optional. Limits idle periods and read operations.
unsafe_field_names = "drop"           # Optional. Use "drop" or "reject". Default: "drop".
middleware = ["static"]               # Optional. Rapira uses the list order.

[http.static]                         # Required when middleware contains "static".
root = "public"                       # Required. Relative paths use this file's directory.
forbid = [".php"]                     # Optional. Rapira does not serve these suffixes.

[http.sendfile]                       # Optional. Sets the sendFile() root in Dispatcher mode.
root = "public"                       # Optional. Uses the entry script directory by default.

[http.uploads]                        # Optional. Sets multipart limits in Dispatcher mode.
dir = "/var/spool/rapira"             # Optional. Uses the system temporary directory by default.
max_file_size_mb = 2                  # Optional. Limits one file part.
max_field_size_kb = 256               # Optional. Limits one field part.
max_files = 20                        # Optional. Limits file parts in one request.
max_parts = 1024                      # Optional. Limits all parts in one request.
max_part_headers = 32                 # Optional. Limits fields in one part.

[http.pool]                           # The worker pool behind the http listener.
entrypoint = "index.php"              # Relative paths use this file's directory.
mode = "dispatcher"                   # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
processes = 4                         # Sets the worker count and the scaling maximum.
scaling = "dynamic"                   # Use "static", "dynamic", or "ondemand". Default: "static".
min_spare = 1                         # For dynamic scaling. Sets the minimum idle worker count.
max_spare = 3                         # For dynamic scaling. Sets the maximum idle worker count.
max_requests = 0                      # Replaces a worker after this request count. Zero disables the limit.
process_idle_timeout_secs = 10        # For ondemand scaling. Removes workers after this idle time.
request_terminate_timeout_secs = 0    # Replaces a worker when one request exceeds this time. Zero disables the limit.

[grpc]
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"          # Required. A FileDescriptorSet with its imports.
services = ["example.v1.Echo"]        # Optional. Default: the services of the files that no other file imports.
reflection = false
default_timeout_secs = 30             # Optional. Deadline of a call without a client timeout.
max_timeout_secs = 60                 # Optional. Upper limit for a client timeout.

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"                   # Required mode for gRPC.
processes = 4
scaling = "static"
max_requests = 0
process_idle_timeout_secs = 10
request_terminate_timeout_secs = 0

[supervisor]                          # Optional. Sets master process behavior.
pidfile = "/run/rapira.pid"           # Optional. Relative paths use this file's directory.
process_control_timeout_secs = 30     # Waits after SIGQUIT before SIGTERM. SIGKILL follows one second later.

[log]                                 # Optional. Sets the level and record format.
level = "error"                       # Use error, warn, info, debug, or trace. Default: error.
format = "plain"                      # Use plain or json. Default: plain.

[log.targets]                         # Optional. Overrides the level for each target.
php = "debug"
http = "warn"
```

Reszta tej strony omawia te klucze sekcja po sekcji.

## Sekcja `[http]`

Ta sekcja opisuje, gdzie Rapira nasłuchuje, co środowisko żądania mówi PHP o serwerze, pod którym działa, ile treści żądania serwer wczyta i jakie middleware pracuje przed PHP.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `listen` | tekst | `"127.0.0.1:8000"` | Adres nasłuchu. Użyj `host:port` z adresem IP, `:port` dla wszystkich interfejsów IPv4 albo `unix:/run/rapira.sock` dla gniazda uniksowego. `:8080` jest równe `0.0.0.0:8080`. Użyj `[::]:8080` dla wszystkich interfejsów IPv6. Literał IPv6 podaj w nawiasach kwadratowych, na przykład `[::1]:8000`. Rapira odrzuca port bez adresu i odrzuca nazwy hostów. |
| `server_name` | tekst | `"localhost"` | To, co PHP odczyta jako `$_SERVER['SERVER_NAME']`. |
| `server_port` | liczba całkowita | port z `listen`, `80` dla `unix:` | To, co PHP odczyta jako `$_SERVER['SERVER_PORT']`. Ustaw go, gdy proxy stojące przed Rapirą przyjmuje ruch na innym porcie niż ten, na którym nasłuchuje sama Rapira. |
| `max_body_size_mb` | liczba całkowita | `8` | Największa treść żądania, jaką Rapira przyjmie, w MiB (1024 × 1024 bajtów). Na cokolwiek większego odpowiada `413`. Minimum to 1. |
| `write_timeout_secs` | liczba całkowita | `30` | Jak długo pojedynczy zapis odpowiedzi może nie posuwać się do przodu. Gdy klient przestanie czytać na dłużej, Rapira zamyka połączenie. Minimum to 1, maksimum `86400`. |
| `keepalive_timeout_secs` | liczba całkowita | `60` | Jak długo połączenie może nie posuwać żądania do przodu. Ogranicza bezczynne połączenie keep-alive czekające na kolejne żądanie, jeden odczyt nagłówków żądania i jeden odczyt ramki treści. Treść, która utknie ponad limit, dostaje `408`. Minimum to 1, maksimum `86400`. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | Co się dzieje z polem żądania, którego nazwa wykracza poza `[A-Za-z0-9-]`: albo znika, zanim PHP je zobaczy, a każde usunięcie trafia do logu na poziomie `warn`, albo serwer odpowiada `400`. Uzasadnienie i stojące za tym mapowanie CGI opisują [Żądania i odpowiedzi HTTP](/pl/docs/http). |
| `middleware` | lista tekstów | pusta | Jakie middleware obsługuje żądanie przed PHP. Kolejność listy jest kolejnością łańcucha. `"static"` to na razie jedyna nazwa, jaką Rapira zna. Nazwa wymieniona dwa razy jest odrzucana, wymieniona nazwa bez własnej tabeli również, a skonfigurowana tabela pominięta na liście tak samo, więc lista jest jedynym włącznikiem każdego middleware. |

`server_name` i `server_port` kształtują wyłącznie to, co PHP widzi w `$_SERVER` - żaden z nich nie zmienia adresu, pod którym serwer nasłuchuje, bo o tym decyduje wyłącznie `listen`.

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
| `root` | tekst | katalog skryptu wejściowego (`http.pool.entrypoint`) | Jedyny katalog, z którego `sendFile()` może czytać. Ścieżkę względną Rapira liczy od katalogu z plikiem konfiguracyjnym. |

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

### Tabela `[http.pool]` {#http-pool}

Workery to procesy, które faktycznie wykonują PHP, a ta tabela mówi, co wykonują, ilu ich jest i kiedy proces nadrzędny któregoś zabiera. Co proces nadrzędny robi z tymi liczbami, wyjaśnia [model procesów](/pl/docs/process-model).

Wtyczka `http` zarządza tą pulą workerów PHP. Nasłuch gRPC używa osobnej tabeli `[grpc.pool]`.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `entrypoint` | tekst | brak - wymagane | Skrypt PHP, który wykonuje każdy worker. Ścieżkę względną Rapira liczy od katalogu z plikiem konfiguracyjnym. Musisz ustawić wartość. |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | Jak worker wykonuje skrypt wejściowy. `classic` uruchamia skrypt od zera przy każdym żądaniu. `worker` zostawia skrypt rezydentnym i wypełnia zmienne superglobalne na nowo przy każdym żądaniu. `dispatcher` zostawia skrypt rezydentnym i daje mu obiekt dyspozytora, z którego skrypt sam pobiera kolejne żądania. Zobacz [tryby wykonania](/pl/docs/execution-modes). |
| `processes` | liczba całkowita | jeden na logiczny rdzeń CPU | Ile procesów workerów sforkować. Przy skalowaniu `dynamic` i `ondemand` to górny limit, a nie stała liczba. Minimum to 1. |
| `scaling` | `"static"` \| `"dynamic"` \| `"ondemand"` | `"static"` | Jak pula dobiera swój rozmiar. `static` trzyma przy życiu `processes` workerów bez przerwy; `dynamic` skaluje się między progami zapasu, z sufitem na `processes`; `ondemand` forkuje dopiero wtedy, gdy jest praca, i pozwala bezczynnym workerom odejść. |
| `min_spare` | liczba całkowita | brak | Tylko przy skalowaniu `dynamic` i tam wymagane: utrzymuj co najmniej tylu workerów bezczynnych i gotowych do pracy. |
| `max_spare` | liczba całkowita | brak | Tylko przy skalowaniu `dynamic` i tam wymagane: przycinaj pulę do najwyżej tylu bezczynnych workerów. Para musi spełniać `1 <= min_spare <= max_spare <= processes`; ustawienie któregokolwiek z nich przy innym skalowaniu to błąd. |
| `max_requests` | liczba całkowita | `0` | Wymień workera po obsłużeniu tylu żądań, z niewielkim rozrzutem, żeby cała pula nigdy nie wymieniała się naraz. `0` znaczy nigdy. |
| `process_idle_timeout_secs` | liczba całkowita | `10` | Przy skalowaniu `ondemand` proces nadrzędny zwalnia workera po tym czasie bezczynności. |
| `request_terminate_timeout_secs` | liczba całkowita | `0` | Budżet czasu rzeczywistego na pojedyncze żądanie. Worker, który po jego przekroczeniu wciąż nad nim pracuje, zostaje ubity i zastąpiony nowym. `0` wyłącza tę kontrolę. |

`mode` i `scaling` to dwie osobne osie: `mode` mówi, co worker robi ze skryptem wejściowym, a `scaling` ilu jest workerów.

Progi zapasu sprawdzane są względem wartości `processes`.

## Sekcja `[grpc]` {#grpc}

Ta sekcja włącza unarne wywołania gRPC, gRPC-Web i Connect na jednym nasłuchu. Kompletną usługę PHP i polecenia klienta opisuje [gRPC](./grpc).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `listen` | tekst | `"127.0.0.1:50051"` | Adres TCP lub ścieżka gniazda `unix:`. Używa tej samej składni adresu co `http.listen`. |
| `descriptor_set` | tekst | brak, wymagane | Ścieżka binarnego `google.protobuf.FileDescriptorSet`, który zawiera wszystkie importowane pliki. Zbuduj go poleceniem `buf build --as-file-descriptor-set` lub `protoc --include_imports`. |
| `services` | lista tekstów | nieustawione | W pełni kwalifikowane nazwy obsługiwanych usług. Gdy klucz nie jest ustawiony, pula obsługuje usługi z plików, których nie importuje żaden inny plik zestawu. Lista nie może być pusta. |
| `reflection` | logiczny | `false` | Włącza usługi `grpc.reflection.v1` i `v1alpha`. |
| `default_timeout_secs` | liczba całkowita | nieustawione | Termin zakończenia wywołania, dla którego klient nie podał limitu czasu. Gdy klucz nie jest ustawiony, takie wywołanie nie ma terminu zakończenia. |
| `max_timeout_secs` | liczba całkowita | nieustawione | Górna granica limitu czasu klienta. Gdy klucz nie jest ustawiony, granica nie istnieje. |

Proces nadrzędny wczytuje zestaw deskryptorów przed forkowaniem workerów. Te błędy zatrzymują inicjalizację: zestaw, którego Rapira nie może odczytać lub zdekodować, zestaw bez importowanych plików i zestaw bez usługi do obsługi. Zatrzymuje ją też wpis `services`, którego nie ma w zestawie, powtórzony wpis oraz wpis, który wskazuje usługę health lub refleksji. `default_timeout_secs` nie może być większe niż `max_timeout_secs`.

### Tabela `[grpc.pool]` {#grpc-pool}

Ta tabela używa [kluczy i wartości domyślnych puli HTTP](#http-pool), z wymaganym `entrypoint` i `mode = "dispatcher"`. Tryby Classic i Worker są odrzucane. Skalowanie, limity zapasu bezczynnych workerów, wymiana workerów i nadzór nad czasem działania procesów dotyczą tej puli niezależnie.

HTTP i gRPC mogą działać razem. Każdy nasłuch używa własnej puli i skryptu wejściowego. Uruchom ponownie Rapirę, aby wczytać zmieniony zestaw deskryptorów. Przeładowanie zachowuje stary zestaw.

## Sekcja `[supervisor]`

Zasady dla procesu nadrzędnego - tego, który trzyma gniazdo nasłuchu, pilnuje workerów i odbiera twoje sygnały. To również z nim rozmawia system init, więc to właśnie te klucze zwykle ustawia jednostka usługi; zobacz [wdrożenie produkcyjne](/pl/docs/deployment).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `pidfile` | tekst | brak | Gdzie proces nadrzędny zapisuje własny pid. Ścieżkę względną liczy od katalogu z plikiem konfiguracyjnym. To właśnie na ten pid wysyłasz sygnały - pełną tabelę tego, co robi każdy z nich, ma [model procesów](/pl/docs/process-model). |
| `process_control_timeout_secs` | liczba całkowita | `30` | Jak długo proces nadrzędny czeka po `SIGQUIT` przed wysłaniem `SIGTERM`. Proces nadrzędny wysyła `SIGKILL` sekundę po `SIGTERM`. |

## Sekcja `[log]`

Ta sekcja steruje poziomem i formatem logów stderr. Cele, formaty i poziomy diagnostyki PHP opisują [Logi](/pl/docs/logging).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | Poziom szczegółowości, wspólny od razu dla wszystkich celów. |
| `format` | `"plain"` \| `"json"` | `"plain"` | Kształt rekordu: czytelne dla człowieka linie (kolorowane, gdy stderr jest terminalem) albo jeden obiekt JSON na linię dla kolektora logów. |
| `[log.targets]` | tabela cel → poziom | pusta | Nadpisania dla poszczególnych celów, nakładane na `level`. Każdy klucz nazywa jeden z celów, pod którymi Rapira pisze: `php` niesie wyjście samego PHP, a `http` i `grpc` wyjście serwerów odpowiednich protokołów. `net` zawiera wpisy pętli akceptowania połączeń. Klucz dopasowuje się po prefiksie, więc `php` obejmuje też `php_sys::callbacks` i wszystko poniżej. Pełną listę celów mają [Logi](/pl/docs/logging). |

Klucz `[log.targets]` może zawierać litery, cyfry, `_`, `:`, `.` i `-`. Musi zaczynać się literą, cyfrą lub `_`. Rapira odrzuca inne znaki, ponieważ filtr może odczytać je jako składnię. Klucz celu zawierający `:` lub `.` musi być ujęty w cudzysłów, ponieważ TOML nie zezwala na te znaki w prostym kluczu bez cudzysłowu. Na przykład:

```toml
[log.targets]
"php_sys::callbacks" = "debug"
```

`RUST_LOG` i `NO_COLOR` wpływają tylko na wyjście stderr. `RUST_LOG` zastępuje cały filtr stderr podczas jednego uruchomienia. Niepusta wartość `NO_COLOR` wyłącza kolory formatu `plain`.

## Nieznane klucze są odrzucane

Rapira akceptuje tylko udokumentowane tabele i klucze. Na przykład `[htttp]` albo `lissten = ":8000"` zatrzymuje inicjalizację. Błąd wskazuje nieznaną nazwę. Rapira jej nie ignoruje. Każdy klucz należy do jednej tabeli. Na przykład `max_requests` należy do `[http.pool]`, a `pidfile` do `[supervisor]`.

Rapira sprawdza również wartości. Odrzuca nieobsługiwane wartości zamiast używać wartości domyślnych. Na przykład odrzuca `level = "verbose"`, `format = "pretty"` i `unsafe_field_names = "allow"`. Wartości liczbowe mają granice. Liczby workerów, rozmiary treści, limity czasu HTTP i limity przesyłanych plików muszą wynosić co najmniej 1. Każdy klucz `*_secs` ma maksimum `86400`, czyli jeden dzień.

::: warning
Walidacja odbywa się, zanim cokolwiek wystartuje, więc nierozpoznany klucz przerywa uruchamianie, zamiast po cichu pogarszać pracę serwera. Edycja `rapira.toml` na maszynie, która akurat obsługuje ruch, nie rusza działającego procesu, ale następne uruchomienie musi się udać.
:::

## Ścieżki względne

Ścieżki systemu plików obejmują skrypty wejściowe obu pul, `grpc.descriptor_set`, `supervisor.pidfile`, `http.static.root`, `http.sendfile.root` i `http.uploads.dir`. Każda ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Względne ścieżki nasłuchów `unix:` także używają tego katalogu. Na przykład `entrypoint = "app/worker.php"` w `/etc/rapira/rapira.toml` daje `/etc/rapira/app/worker.php`.

::: tip
Przechowuj `rapira.toml` w aplikacji. Zapisuj ścieżki względem tego pliku. Ten układ umożliwia przenoszenie katalogu aplikacji bez zmiany ścieżek.
:::
