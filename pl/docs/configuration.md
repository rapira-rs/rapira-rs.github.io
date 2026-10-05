---
title: Konfiguracja
description: "Wszystkie klucze rapira.toml, ich typy, wartości domyślne i reguły walidacji."
---

# Konfiguracja

Rapira wymaga pliku konfiguracyjnego. Polecenie `rapira serve` przyjmuje jego ścieżkę jako jedyny argument. Dowolna nazwa pliku działa, a ta dokumentacja używa `rapira.toml`:

```bash
rapira serve /etc/rapira/rapira.toml
```

Plik ustawia adres, liczbę workerów, zasady wymiany workerów, pidfile i poziom logowania. Wartość z pliku zastępuje wbudowaną wartość domyślną.

`[http]` i `[grpc]` konfigurują osobne nasłuchy i pule workerów PHP. Skonfiguruj co najmniej jedną z tych sekcji. Opcjonalna sekcja `[observability]` konfiguruje nasłuch dla metryk i kontroli stanu. `[supervisor]` konfiguruje proces nadrzędny. `[log]` konfiguruje wyjście stderr.

Każda włączona pula HTTP lub gRPC wymaga skryptu wejściowego PHP. Ustaw `http.pool.entrypoint`, `grpc.pool.entrypoint` lub oba klucze.

## Kompletny rapira.toml

Poniższa konfiguracja włącza oba protokoły i pokazuje obsługiwane tabele. Większość brakujących kluczy używa wartości domyślnej. Każda pula wymaga `entrypoint`. Tabela `[http.static]` wymaga `http.static.root`.

Niektóre klucze muszą występować razem. Tabela `[http.static]` wymaga wpisu `"static"` w `middleware`, a wpis wymaga tabeli. Tabela `[grpc.auth]` i wpis `"auth"` w `interceptors` stosują tę samą regułę.

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
processes = 4                         # Sets the fixed worker count.
max_requests = 0                      # Replaces a worker after this request count. Zero disables the limit.
request_terminate_timeout_secs = 0    # Replaces a worker when one request exceeds this time. Zero disables the limit.

[grpc]
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"          # Required. A FileDescriptorSet with its imports.
services = ["example.v1.Echo"]        # Optional. Default: the services of the files that no other file imports.
reflection = false
default_timeout_secs = 30             # Optional. Deadline of a call without a client timeout.
max_timeout_secs = 60                 # Optional. Upper limit for a client timeout.
keepalive_interval_secs = 10          # Optional. Idle time before an HTTP/2 PING.
keepalive_timeout_secs = 10           # Optional. Closes a connection that does not answer the PING.
interceptors = ["auth"]               # Optional. Rapira uses the list order.

[grpc.auth]                           # Required when interceptors contains "auth".
tokens_file = "grpc-tokens"           # Required. One bearer token on each line.

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"                   # Required mode for gRPC.
processes = 4
max_requests = 0
request_terminate_timeout_secs = 0

[observability]                       # Optional. Starts one process without PHP for metrics and probes.
listen = "127.0.0.1:9180"             # Required.
keepalive_timeout_secs = 60           # Optional.

[observability.metrics]               # Enables GET /metrics. Set this table, the probes table, or both.

[observability.probes]                # Enables GET /livez and GET /readyz.

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

## Sekcja `[http]`

Ta sekcja definiuje nasłuch i informacje o serwerze, które Rapira przekazuje do PHP. Definiuje też limity treści żądania i middleware, które działa przed PHP.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `listen` | tekst | `"127.0.0.1:8000"` | Adres nasłuchu. Użyj `host:port` z adresem IP, `:port` dla wszystkich interfejsów IPv4 albo `unix:/run/rapira.sock` dla gniazda uniksowego. Użyj `[::]:8080` dla wszystkich interfejsów IPv6. Literał IPv6 podaj w nawiasach kwadratowych, na przykład `[::1]:8000`. Rapira odrzuca nazwy hostów i port bez dwukropka, na przykład `8000`. |
| `server_name` | tekst | `"localhost"` | To, co PHP odczyta jako `$_SERVER['SERVER_NAME']`. |
| `server_port` | liczba całkowita | port z `listen`, `80` dla `unix:` | Wartość `$_SERVER['SERVER_PORT']`. Ustaw ją, gdy port proxy jest inny niż port Rapiry. |
| `max_body_size_mb` | liczba całkowita | `8` | Największa treść żądania w MiB. Na większą treść Rapira odpowiada `413`. Minimum to 1. |
| `write_timeout_secs` | liczba całkowita | `30` | Maksymalny czas bez postępu podczas zapisu odpowiedzi. Po tym czasie Rapira zamyka połączenie. Zakres to od 1 do `86400`. |
| `keepalive_timeout_secs` | liczba całkowita | `60` | Limit czasu na odebranie nagłówków żądania. Obejmuje czekanie na bezczynnym połączeniu. Jest też maksymalnym czasem między dwiema ramkami treści żądania. Po przekroczeniu limitu Rapira zamyka połączenie. Zatrzymana treść żądania najpierw dostaje `408`. Zakres to od 1 do `86400`. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | Obsługa nazwy pola spoza `[A-Za-z0-9-]`. `"reject"` zwraca `400`. W trybach Classic i Worker `"drop"` usuwa pole i zapisuje to w logu. W trybie Dispatcher `"drop"` zachowuje pole. Zobacz [Żądania i odpowiedzi HTTP](/pl/docs/http). |
| `middleware` | lista tekstów | pusta | Middleware, które działa przed PHP, w kolejności listy. Dostępne jest tylko `"static"`. Rapira odrzuca powtórzone nazwy i nazwy bez tabel konfiguracji. Odrzuca też nieużywane tabele middleware. |

### Tabela `[http.static]`

Middleware `static` może zwrócić plik, zanim PHP otrzyma żądanie. Obsługuje `GET` i `HEAD`. PHP otrzymuje inne metody i ścieżki, które nie wskazują pliku. PHP otrzymuje też ukryte ścieżki i ścieżki katalogów. Middleware nie serwuje plików indeksu.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `root` | tekst | brak, wymagane | Serwowany katalog. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Katalog musi istnieć i być dostępny podczas inicjalizacji. |
| `forbid` | lista tekstów | `[".php"]` | Końcówki nazw plików, których middleware nie serwuje. Każdy wpis zaczyna się od kropki i ma co najmniej dwa znaki. Nie może zawierać `/` ani białych znaków. Dopasowanie nie rozróżnia wielkości liter. Jawna lista zastępuje wartość domyślną. |

Pamięć podręczną plików i inne szczegóły opisuje strona [Pliki statyczne](/pl/docs/static-files).

### Tabela `[http.sendfile]`

Katalog sendfile to katalog, który `sendFile()` może czytać. Rapira sprowadza ten katalog i żądaną ścieżkę do ścieżek kanonicznych. Odrzuca ścieżkę spoza tego katalogu.

`sendFile()` jest metodą `Rapira\Http\Exchange`. Tylko tryb Dispatcher przekazuje skryptowi obiekt wymiany. Dlatego ta tabela dotyczy tylko trybu Dispatcher. Tryby Classic i Worker przyjmują ją, ale jej nie używają.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `root` | tekst | katalog `http.pool.entrypoint` | Jedyny katalog, który `sendFile()` może czytać. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. |

Jeśli katalog nie istnieje przy starcie, Rapira zapisuje ostrzeżenie w logu, a `sendFile()` odrzuca każdą ścieżkę. Utwórz katalog, zanim uruchomisz serwer.

### Tabela `[http.uploads]`

Tabela `[http.uploads]` ustawia limity parsowania `multipart/form-data` po stronie hosta. Tylko tryb Dispatcher parsuje treść multipart w hoście. Tryby Classic i Worker parsują ją w PHP i używają limitów z `php.ini`. Rapira odrzuca tę tabelę w tych dwóch trybach.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `dir` | tekst | katalog tymczasowy systemu | Katalog na części plikowe. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Rapira tworzy i sprawdza ten katalog. Każdy worker tworzy podkatalog `rapira-spool-<pid>` i usuwa go podczas zamykania. |
| `max_file_size_mb` | liczba całkowita | `2` | Największa pojedyncza część plikowa, w MiB. |
| `max_field_size_kb` | liczba całkowita | `256` | Największa pojedyncza część z polem, w KiB. |
| `max_files` | liczba całkowita | `20` | Dozwolona liczba części plikowych w jednym żądaniu. |
| `max_parts` | liczba całkowita | `1024` | Dozwolona liczba części plikowych i części z polami w jednym żądaniu. |
| `max_part_headers` | liczba całkowita | `32` | Dozwolona liczba pól nagłówka w jednej części. |

Każdy limit musi wynosić co najmniej 1. Rapira zwraca `413`, gdy żądanie przekracza limit.

### Tabela `[http.pool]` {#http-pool}

Workery wykonują PHP. Ta tabela określa, co wykonują, ilu ich działa i kiedy proces nadrzędny usuwa workera. [Model procesów](/pl/docs/process-model) wyjaśnia, jak proces nadrzędny używa tych wartości.

Wtyczka `http` zarządza tą pulą workerów PHP. Nasłuch gRPC używa osobnej tabeli `[grpc.pool]`.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `entrypoint` | tekst | brak, wymagane | Skrypt PHP, który wykonuje każdy worker. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Ścieżka musi wskazywać zwykły plik dostępny do odczytu. |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | Jak worker wykonuje skrypt wejściowy. `classic` za każdym razem uruchamia nowe żądanie PHP. `worker` zachowuje skrypt i ponownie wypełnia zmienne superglobalne. `dispatcher` zachowuje skrypt i przekazuje mu obiekt dyspozytora. Zobacz [tryby wykonania](/pl/docs/execution-modes). |
| `processes` | liczba całkowita | dostępna równoległość lub `1`, jeśli nie można jej ustalić | Liczba workerów. Proces nadrzędny utrzymuje tyle działających workerów. Minimum to 1. Suma `processes` we wszystkich pulach nie może przekroczyć 2048. Sekcja `[observability]` dodaje do tej sumy jeden proces. |
| `max_requests` | liczba całkowita | `0` | Limit żądań przed wymianą workera. Rapira nieznacznie zmienia ten limit, aby workery nie były wymieniane jednocześnie. `0` wyłącza limit. |
| `request_terminate_timeout_secs` | liczba całkowita | `0` | Limit czasu rzeczywistego dla jednego żądania. Rapira kończy i wymienia workera, który przekroczy ten limit. `0` wyłącza tę kontrolę. |

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
| `keepalive_interval_secs` | liczba całkowita | `10` | Czas bezczynności, po którym Rapira wysyła PING keepalive HTTP/2. Nie dotyczy klientów HTTP/1.1. Zakres to od 1 do `86400`. |
| `keepalive_timeout_secs` | liczba całkowita | `10` | Czas, przez który Rapira czeka na odpowiedź na PING. Jeśli odpowiedź nie nadejdzie w tym czasie, Rapira zamyka połączenie. Zakres to od 1 do `86400`. |
| `interceptors` | lista tekstów | pusta | Interceptory, które działają przed PHP, w kolejności listy. Dostępne jest tylko `"auth"`. Rapira odrzuca powtórzone nazwy, nieznane nazwy i nazwy bez tabeli konfiguracji. Odrzuca też tabelę `[grpc.auth]`, której lista nie wymienia. |

Proces nadrzędny wczytuje zestaw deskryptorów przed forkowaniem workerów. Te błędy zatrzymują inicjalizację: zestaw, którego Rapira nie może odczytać lub zdekodować, zestaw bez importowanych plików i zestaw bez usługi do obsługi. Zatrzymuje ją też wpis `services`, którego nie ma w zestawie, powtórzony wpis oraz wpis, który wskazuje usługę health lub refleksji. `default_timeout_secs` nie może być większe niż `max_timeout_secs`.

### Tabela `[grpc.auth]` {#grpc-auth}

Interceptor `auth` przyjmuje wywołanie tylko z prawidłowym tokenem bearer. PHP nie otrzymuje odrzuconego wywołania. Stronę klienta i usługę health opisuje [uwierzytelnianie gRPC](/pl/docs/grpc#uwierzytelnianie).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `tokens_file` | tekst | brak, wymagane | Plik z akceptowanymi tokenami. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Zapisz jeden token w każdej linii. Rapira pomija puste linie i linie, które zaczynają się od `#`. Każdy token musi być [tokenem bearer według RFC 6750](https://www.rfc-editor.org/rfc/rfc6750#section-2.1). Plik musi zawierać co najmniej jeden token. |

### Tabela `[grpc.pool]` {#grpc-pool}

Ta tabela używa [kluczy i wartości domyślnych puli HTTP](#http-pool), z wymaganym `entrypoint` i `mode = "dispatcher"`. Tryby Classic i Worker są odrzucane. Liczba workerów, wymiana workerów i nadzór nad czasem działania procesów dotyczą tej puli niezależnie.

HTTP i gRPC mogą działać razem. Każdy nasłuch używa własnej puli i skryptu wejściowego. Proces nadrzędny wczytuje zestaw deskryptorów i plik tokenów raz, przy starcie. Uruchom ponownie Rapirę, aby wczytać zmieniony plik. Przeładowanie zachowuje stare pliki.

## Sekcja `[observability]` {#observability}

Ta sekcja uruchamia jeszcze jeden proces, który serwuje metryki i sondy stanu przez HTTP. Ten proces nie wykonuje kodu PHP. Ta sekcja nie jest tabelą wtyczki, więc plik nadal wymaga `[http]` lub `[grpc]`. Punkty końcowe i metryki opisuje [Metryki i kontrole stanu](/pl/docs/observability).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `listen` | tekst | brak, wymagane | Adres nasłuchu. Używa tej samej składni co `http.listen`. Użyj adresu, którego nie używają nasłuchy `http` i `grpc`. |
| `keepalive_timeout_secs` | liczba całkowita | `60` | Limit czasu na odebranie nagłówków żądania. Obejmuje czekanie na bezczynnym połączeniu. Zakres to od 1 do `86400`. |
| `[observability.metrics]` | pusta tabela | brak | Włącza `GET /metrics` w formacie tekstowym Prometheus. |
| `[observability.probes]` | pusta tabela | brak | Włącza `GET /livez` i `GET /readyz`. |

Ustaw co najmniej jedną z tych dwóch podtabel. Podtabele nie przyjmują kluczy.

## Sekcja `[supervisor]`

Ta sekcja określa zasady procesu nadrzędnego. Proces nadrzędny trzyma gniazda nasłuchu, nadzoruje workery i odbiera sygnały. System init steruje procesem nadrzędnym. Plik jednostki opisuje [wdrożenie produkcyjne](/pl/docs/deployment).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `pidfile` | tekst | brak | Plik na identyfikator procesu nadrzędnego. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Wysyłaj sygnały procesu na ten identyfikator. Zobacz [model procesów](/pl/docs/process-model). |
| `process_control_timeout_secs` | liczba całkowita | `30` | Jak długo proces nadrzędny czeka po `SIGQUIT` przed wysłaniem `SIGTERM`. Proces nadrzędny wysyła `SIGKILL` sekundę po `SIGTERM`. |

Połączenia mają krótszy czas na zakończenie: limit sterowania pomniejszony o mniejszą z wartości: pięć sekund lub połowę limitu. Domyślnie jest to 25 sekund. Ten czas obowiązuje podczas zatrzymywania i przeładowania.

## Sekcja `[log]`

Ta sekcja steruje poziomem i formatem logów stderr. Cele, formaty i poziomy diagnostyki PHP opisują [Logi](/pl/docs/logging).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | Poziom szczegółowości, wspólny od razu dla wszystkich celów. |
| `format` | `"plain"` \| `"json"` | `"plain"` | Format rekordu. Wyjście `plain` zawiera czytelne linie i może używać kolorów. Wyjście JSON zawiera jeden obiekt na linię. |
| `[log.targets]` | tabela cel → poziom | pusta | Nadpisania poziomu logowania dla celów. Klucze dopasowują się do prefiksów celów. Listę celów opisują [Logi](/pl/docs/logging#nadpisania-dla-poszczegolnych-celow). |

Klucz `[log.targets]` może zawierać litery, cyfry, `_`, `:`, `.` i `-`. Musi zaczynać się literą, cyfrą lub `_`. Rapira odrzuca inne znaki, ponieważ filtr logów może odczytać je jako składnię. Klucz celu zawierający `:` lub `.` musi być ujęty w cudzysłów, ponieważ TOML nie zezwala na te znaki w prostym kluczu bez cudzysłowu. Na przykład:

```toml
[log.targets]
"h2::proto" = "debug"
```

`RUST_LOG` i `NO_COLOR` wpływają tylko na wyjście stderr. `RUST_LOG` zastępuje cały filtr stderr podczas jednego uruchomienia. Niepusta wartość `NO_COLOR` wyłącza kolory formatu `plain`.

## Nieznane klucze są odrzucane

Rapira akceptuje tylko udokumentowane tabele i klucze. Na przykład `[htttp]` albo `lissten = ":8000"` zatrzymuje inicjalizację. Błąd wskazuje nieznaną nazwę. Każdy klucz należy do jednej tabeli. Na przykład `max_requests` należy do `[http.pool]`, a `pidfile` do `[supervisor]`.

Rapira sprawdza również wartości. Odrzuca nieobsługiwane wartości i nie zastępuje ich wartościami domyślnymi. Na przykład odrzuca `level = "verbose"`, `format = "pretty"` i `unsafe_field_names = "allow"`. Liczby workerów, rozmiary treści i limity przesyłanych plików muszą wynosić co najmniej 1. Każdy klucz `*_secs` musi mieć wartość od 1 do `86400`. Tylko `request_terminate_timeout_secs` przyjmuje też `0`.

::: warning
Rapira czyta plik konfiguracyjny tylko przy starcie. Przeładowanie przez `SIGHUP` lub `SIGUSR2` nie czyta go ponownie. Uruchom ponownie Rapirę, aby zastosować zmieniony plik.
:::

## Ścieżki względne

Ścieżki systemu plików obejmują skrypty wejściowe obu pul, `grpc.descriptor_set`, `grpc.auth.tokens_file`, `supervisor.pidfile`, `http.static.root`, `http.sendfile.root` i `http.uploads.dir`. Każda ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Na przykład ustaw `entrypoint = "app/worker.php"` w `/etc/rapira/rapira.toml`. Rapira użyje wtedy `/etc/rapira/app/worker.php`.

Względna ścieżka nasłuchu `unix:` używa katalogu roboczego procesu Rapiry jako podstawy. Dla gniazda uniksowego użyj ścieżki bezwzględnej.

::: tip
Przechowuj plik konfiguracyjny `rapira.toml` w aplikacji. Zapisuj jego ścieżki względem pliku konfiguracyjnego. Możesz przenieść katalog aplikacji. Te ścieżki się nie zmieniają.
:::
