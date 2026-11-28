---
title: Konfiguracja
description: "Wszystkie klucze rapira.toml, ich typy, wartości domyślne i reguły walidacji."
---

# Konfiguracja

Rapira wymaga pliku konfiguracyjnego. Polecenie `rapira serve` przyjmuje jego ścieżkę jako jedyny argument. Dowolna nazwa pliku działa, a ta dokumentacja używa `rapira.toml`:

```bash
rapira serve /etc/rapira/rapira.toml
```

Plik ustawia nasłuchy, liczbę workerów, zasady ponownego uruchamiania aplikacji, limity czasu, pidfile i poziom logowania. Wartość z pliku zastępuje wbudowaną wartość domyślną.

`[http]` i `[grpc]` konfigurują osobne nasłuchy i pule workerów PHP. Skonfiguruj co najmniej jedną z tych sekcji. Opcjonalna sekcja `[observability]` konfiguruje nasłuch dla metryk i kontroli stanu. `[server]` konfiguruje ustawienia całego serwera. `[log]` konfiguruje wyjście stderr.

Każda włączona pula HTTP lub gRPC wymaga skryptu wejściowego PHP. Ustaw `http.pool.entrypoint`, `grpc.pool.entrypoint` lub oba klucze.

## Kompletny rapira.toml

Poniższa konfiguracja włącza oba protokoły i pokazuje obsługiwane tabele. Większość brakujących kluczy używa wartości domyślnej. Każda pula wymaga `entrypoint`. Tabela `[http.static]` wymaga `http.static.root`.

Niektóre klucze muszą występować razem. Tabela `[http.static]` wymaga wpisu `"static"` w `middleware`, a wpis wymaga tabeli. Tabela `[http.compress]` wymaga `"compress"` w `middleware` (natomiast `"compress"` działa z wartościami domyślnymi, gdy tabela jest pominięta). Tabela `[grpc.auth]` i wpis `"auth"` w `interceptors` również wymagają siebie nawzajem.

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # Optional. Sets SERVER_NAME for PHP.
server_port = 8000                    # Optional. Uses the TCP listen port by default.
max_body_size_mb = 8                  # Optional. Rapira returns 413 for larger request bodies.
write_timeout_secs = 30               # Optional. Closes a connection after a response write times out.
keepalive_timeout_secs = 60           # Optional. Limits idle periods and read operations.
middleware = ["static", "compress"]   # Optional. Rapira uses the list order.

[http.static]                         # Required when middleware contains "static".
root = "public"                       # Required. Relative paths use this file's directory.
forbid = [".php"]                     # Optional. Rapira does not serve these suffixes.

[http.compress]                       # Optional when middleware contains "compress".
min_size = 1024                       # Optional. Minimum response size in bytes.
gzip_level = 4                        # Optional. Compression level 1..=9.
zstd_level = 3                        # Optional. Compression level 1..=19.

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
workers = 4                           # Sets the fixed worker thread count.
max_requests = 0                      # Recycles the app after this unit count. Zero disables the limit.
max_boot_failures = 5                 # Consecutive boot failures before exit 70. Zero allows unlimited retries.
request_terminate_timeout_secs = 0    # Watchdog wall-clock limit for one unit. Zero disables the limit.
execution_clock = "wall"              # Use "wall" or "cpu" for max_execution_time on Linux. Default: "wall".

[http.pool.env]                       # Optional. Pool environment variables for PHP.
APP_ENV = "prod"

[grpc]
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"          # Required. A path or an http(s) URL of a FileDescriptorSet with its imports.
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
workers = 4
max_requests = 0
max_boot_failures = 5
request_terminate_timeout_secs = 0
execution_clock = "wall"

[observability]                       # Optional. Starts a listener thread without PHP for metrics and probes.
listen = "127.0.0.1:9180"             # Required.
keepalive_timeout_secs = 60           # Optional.

[observability.metrics]               # Enables GET /metrics. Set this table, the probes table, or both.

[observability.probes]                # Enables GET /livez and GET /readyz.

[server]                              # Optional. Sets server-wide behavior.
pidfile = "/run/rapira.pid"           # Optional. Relative paths use this file's directory.
stop_timeout_secs = 30                # Stop deadline for connection drain and PHP shutdown.

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
| `keepalive_timeout_secs` | liczba całkowita | `60` | Limit czasu na odebranie nagłówków żądania. Obejmuje czekanie na bezczynnym połączeniu. Jest też maksymalnym czasem między dwiema ramkami treści żądania. Po przekroczeniu limitu Rapira zamyka połączenie. Jeśli przesyłanie treści żądania nie postępuje, Rapira najpierw zwraca `408`. Zakres to od 1 do `86400`. |
| `middleware` | lista tekstów | pusta | Middleware, które działa przed PHP, w kolejności listy. Wbudowane nazwy to `"static"` i `"compress"`. Rapira odrzuca powtórzone nazwy, nieznane nazwy i nieużywane tabele middleware. |

### Tabela `[http.static]`

Middleware `static` może zwrócić plik, zanim PHP otrzyma żądanie. Obsługuje `GET` i `HEAD`. PHP otrzymuje inne metody i ścieżki, które nie wskazują pliku. PHP otrzymuje też ukryte ścieżki i ścieżki katalogów. Middleware nie serwuje plików indeksu.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `root` | tekst | brak, wymagane | Serwowany katalog. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Katalog musi istnieć i być dostępny podczas inicjalizacji. |
| `forbid` | lista tekstów | `[".php"]` | Końcówki nazw plików, których middleware nie serwuje. Każdy wpis zaczyna się od kropki i ma co najmniej dwa znaki. Nie może zawierać `/` ani białych znaków. Dopasowanie nie rozróżnia wielkości liter. Jawna lista zastępuje wartość domyślną. |

Pamięć podręczną plików i inne szczegóły opisuje strona [Pliki statyczne](/pl/docs/static-files).

### Tabela `[http.compress]`

Middleware `compress` kompresuje odpowiedzi HTTP za pomocą gzip lub zstd zgodnie z nagłówkiem `Accept-Encoding`. Dodaj `"compress"` do `http.middleware`, aby włączyć je z wartościami domyślnymi; tabela jest opcjonalna.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `min_size` | liczba całkowita | `1024` | Minimalny rozmiar odpowiedzi w bajtach przed zastosowaniem kompresji. |
| `gzip_level` | liczba całkowita | `4` | Poziom kompresji gzip, od `1` do `9`. |
| `zstd_level` | liczba całkowita | `3` | Poziom kompresji zstd, od `1` do `19`. |

### Tabela `[http.sendfile]`

Katalog sendfile to katalog, który `sendFile()` może czytać. Rapira sprowadza ten katalog i żądaną ścieżkę do ścieżek kanonicznych. Odrzuca ścieżkę spoza tego katalogu. Rapira sprowadza ten katalog do ścieżki kanonicznej osobno dla każdej instancji aplikacji, przy pierwszym wywołaniu `sendFile()` w tej instancji. Dlatego katalog podąża za przełączeniem dowiązania symbolicznego przy następnym starcie aplikacji, na przykład przy przeładowaniu.

`sendFile()` jest metodą `Rapira\Http\Exchange`. Tylko tryb Dispatcher przekazuje skryptowi obiekt wymiany. Dlatego ta tabela dotyczy tylko trybu Dispatcher. Tryby Classic i Worker przyjmują ją, ale jej nie używają.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `root` | tekst | katalog `http.pool.entrypoint` | Jedyny katalog, który `sendFile()` może czytać. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. |

Jeśli katalog nie istnieje przy pierwszym wywołaniu `sendFile()` w instancji aplikacji, Rapira zapisuje ostrzeżenie w logu. `sendFile()` odrzuca wtedy każdą ścieżkę w tej instancji. Katalog utworzony później działa po następnym starcie aplikacji, na przykład po przeładowaniu. Utwórz katalog, zanim uruchomisz serwer.

### Tabela `[http.uploads]`

Tabela `[http.uploads]` ustawia limity parsowania `multipart/form-data` po stronie hosta. Tylko tryb Dispatcher parsuje treść multipart w hoście. Tryby Classic i Worker parsują ją w PHP i używają limitów z `php.ini`. Rapira odrzuca tę tabelę w tych dwóch trybach.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `dir` | tekst | katalog tymczasowy systemu | Katalog na części plikowe. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Rapira tworzy i sprawdza ten katalog. Proces serwera tworzy jeden podkatalog `rapira-spool-<pid>` i usuwa go podczas zamykania. Rapira umieszcza części plikowe w jego numerowanych podkatalogach. |
| `max_file_size_mb` | liczba całkowita | `2` | Największa pojedyncza część plikowa, w MiB. |
| `max_field_size_kb` | liczba całkowita | `256` | Największa pojedyncza część z polem, w KiB. |
| `max_files` | liczba całkowita | `20` | Dozwolona liczba części plikowych w jednym żądaniu. |
| `max_parts` | liczba całkowita | `1024` | Dozwolona liczba części plikowych i części z polami w jednym żądaniu. |
| `max_part_headers` | liczba całkowita | `32` | Dozwolona liczba pól nagłówka w jednej części. |

Każdy limit musi wynosić co najmniej 1. Rapira zwraca `413`, gdy żądanie przekracza limit.

### Tabela `[http.pool]` {#http-pool}

Wątki workerów wykonują PHP. Ta tabela określa, co wykonują, ile wątków działa oraz jak Rapira ponownie uruchamia w nich aplikacje lub je przerywa. [Model procesów](/pl/docs/process-model) wyjaśnia, jak serwer używa tych wartości.

Wtyczka `http` zarządza tą pulą workerów PHP. Nasłuch gRPC używa osobnej tabeli `[grpc.pool]`.

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `entrypoint` | tekst | brak, wymagane | Skrypt PHP, który wykonuje każdy worker. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Ścieżka musi wskazywać zwykły plik dostępny do odczytu. |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | Jak worker wykonuje skrypt wejściowy. `classic` za każdym razem uruchamia nowe żądanie PHP. `worker` zachowuje skrypt i ponownie wypełnia zmienne superglobalne. `dispatcher` zachowuje skrypt i przekazuje mu obiekt dyspozytora. Zobacz [tryby wykonania](/pl/docs/execution-modes). |
| `workers` | liczba całkowita | dostępna równoległość lub `1`, jeśli nie można jej ustalić | Liczba wątków workerów. Minimum to `1`. W kompilacji PHP NTS Rapira ogranicza liczbę do `1` z ostrzeżeniem. |
| `max_requests` | liczba całkowita | `0` | Limit jednostek pracy jednej instancji aplikacji w trybach Worker i Dispatcher. Po osiągnięciu limitu worker ponownie uruchamia aplikację w tym samym wątku. Rapira nieznacznie zmienia ten limit, aby uniknąć jednoczesnych ponownych uruchomień. Tryb Classic ignoruje ten klucz. `0` wyłącza limit. |
| `max_boot_failures` | liczba całkowita | `5` | Kolejne nieudane rozruchy w trybie Worker lub Dispatcher, po których Rapira kończy działanie z kodem `70` (gdy pula nie obsłużyła jeszcze jednostki pracy). Udany rozruch zeruje licznik. Tryb Classic ignoruje ten klucz. `0` pozwala na nieograniczoną liczbę prób. Zobacz [Model procesów](/pl/docs/process-model#pool-management). |
| `request_terminate_timeout_secs` | liczba całkowita | `0` | Limit czasu rzeczywistego watchdoga dla jednej jednostki pracy, od `0` do `86400`. Po przekroczeniu limitu watchdog przerywa PHP i wybudza zablokowany zapis odpowiedzi. Po kolejnych pięciu sekundach Rapira zapisuje raz w logu nadal zablokowanego workera i kończy działanie z kodem `124`, jeśli wszystkie workery w puli pozostają zablokowane. `0` wyłącza tę kontrolę. |
| `execution_clock` | `"wall"` \| `"cpu"` | `"wall"` | Zegar używany dla `max_execution_time` w PHP na kompilacjach dla Linuksa z zegarami na wątek. `"wall"` zlicza czas rzeczywisty jednostki pracy; `"cpu"` zlicza tylko czas CPU wątku workera, więc `sleep()` i oczekiwanie na bazę danych nie zużywają limitu. |
| `[http.pool.env]` | tabela tekst na tekst | pusta | Zmienne środowiskowe puli dla PHP. Zobacz [Tabela `[http.pool.env]`](#http-pool-env). |

### Tabela `[http.pool.env]` {#http-pool-env}

Każdy klucz jest nazwą zmiennej środowiskowej, a każda wartość musi być ciągiem znaków (string). Wartości inne niż tekstowe zatrzymują uruchamianie. Rapira nie rozwija `$VAR` ani `${VAR}` wewnątrz wartości.

```toml
[http.pool.env]
APP_ENV = "prod"
APP_DEBUG = "0"
```

Rapira sprawdza tabelę podczas uruchamiania, zanim wystartują workery. Pusta nazwa, nazwa zawierająca `=` lub znak NUL oraz wartość zawierająca znak NUL zatrzymują uruchamianie, a błąd podaje nazwę klucza.

Zmienne puli dotyczą tylko własnej puli: `[http.pool.env]` nie jest widoczna dla workerów gRPC, a `[grpc.pool.env]` nie jest widoczna dla workerów HTTP. Zmienna puli nadpisuje zmienną środowiskową uruchomienia o tej samej nazwie, podczas gdy pozostałe zmienne uruchomienia pozostają widoczne dla `getenv()` oraz dla początkowych `$_SERVER` i `$_ENV` (gdy `variables_order` zawiera `E`).

W trybach Classic i Worker każde żądanie w `$_SERVER` zawiera zmienne z `[http.pool.env]` i żadnych innych zmiennych środowiskowych procesu. Zmienna żądania o tej samej nazwie ma pierwszeństwo: na przykład przy `SERVER_SOFTWARE = "x"` żądanie otrzymuje `$_SERVER['SERVER_SOFTWARE'] === 'Rapira'`, podczas gdy `getenv('SERVER_SOFTWARE')` zwraca `'x'`. W trybie Dispatcher `$_SERVER` zachowuje wartości początkowe (w tym `[http.pool.env]`).

`getenv()` czyta najpierw lokalne dla wątku zapisy `putenv()`, potem `[http.pool.env]`, a następnie środowisko procesu z chwili uruchomienia serwera. Zapisy `putenv()` utrzymują się przez jedno żądanie w trybie Classic oraz przez jedną instancję aplikacji w trybach Worker i Dispatcher, bez modyfikowania środowiska procesu w systemie operacyjnym. `${NAME}` w `parse_ini_file()` i `parse_ini_string()` czyta tę samą warstwową tabelę. Biblioteki natywne i procesy potomne uruchomione bez jawnego argumentu środowiska dziedziczą tylko środowisko uruchomienia systemu operacyjnego; przekaż `getenv()` jako argument środowiska do `proc_open()`, aby przekazać wartości puli i `putenv()`.

Rapira parsuje `php.ini` i wykonuje start modułów PHP (`MINIT`) raz w wątku głównym, zanim wątki workerów wejdą do swoich pul. Dlatego `${VAR}` w `php.ini`, rozszerzenia odczytujące zmienne środowiskowe podczas `MINIT` oraz zmienne startowe procesu takie jak `LD_PRELOAD` czy `MIMALLOC_*` nie widzą `[http.pool.env]`.

## Sekcja `[grpc]` {#grpc}

Ta sekcja włącza wywołania gRPC, gRPC-Web i Connect na jednym nasłuchu. Kompletną usługę PHP i polecenia klienta opisuje [gRPC](/pl/docs/grpc).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `listen` | tekst | `"127.0.0.1:50051"` | Adres TCP lub ścieżka gniazda `unix:`. Używa tej samej składni adresu co `http.listen`. |
| `descriptor_set` | tekst | brak, wymagane | Ścieżka lub adres URL binarnego `google.protobuf.FileDescriptorSet`, który zawiera wszystkie importowane pliki. Wartość zaczynająca się od `http://` lub `https://` to adres URL, który Rapira pobiera przy uruchomieniu; zobacz [Wczytywanie zestawu deskryptorów gRPC z adresu URL](/pl/docs/grpc#descriptor-set-url). Zbuduj zestaw poleceniem `buf build --as-file-descriptor-set` lub `protoc --include_imports`. |
| `services` | lista tekstów | nieustawione | W pełni kwalifikowane nazwy obsługiwanych usług. Gdy klucz nie jest ustawiony, pula obsługuje usługi z plików, których nie importuje żaden inny plik zestawu. Lista nie może być pusta. |
| `reflection` | logiczny | `false` | Włącza usługi `grpc.reflection.v1` i `v1alpha`. |
| `default_timeout_secs` | liczba całkowita | nieustawione | Termin zakończenia wywołania, dla którego klient nie podał limitu czasu. Gdy klucz nie jest ustawiony, takie wywołanie nie ma terminu zakończenia. |
| `max_timeout_secs` | liczba całkowita | nieustawione | Górna granica limitu czasu klienta. Gdy klucz nie jest ustawiony, granica nie istnieje. |
| `keepalive_interval_secs` | liczba całkowita | `10` | Czas bezczynności, po którym Rapira wysyła PING keepalive HTTP/2. Nie dotyczy klientów HTTP/1.1. Zakres to od 1 do `86400`. |
| `keepalive_timeout_secs` | liczba całkowita | `10` | Czas, przez który Rapira czeka na odpowiedź na PING. Jeśli odpowiedź nie nadejdzie w tym czasie, Rapira zamyka połączenie. Zakres to od 1 do `86400`. |
| `interceptors` | lista tekstów | pusta | Interceptory, które działają przed PHP, w kolejności listy. Dostępne jest tylko `"auth"`. Rapira odrzuca powtórzone nazwy, nieznane nazwy i nazwy bez tabeli konfiguracji. Odrzuca też tabelę `[grpc.auth]`, której lista nie wymienia. |

Rapira wczytuje zestaw deskryptorów przy uruchomieniu przed startem workerów. Te błędy zatrzymują inicjalizację: zestaw, którego Rapira nie może odczytać, pobrać ani zdekodować, zestaw bez importowanych plików i zestaw bez usługi do obsługi. Zatrzymuje ją też wpis `services`, którego nie ma w zestawie, powtórzony wpis oraz wpis, który wskazuje usługę health lub refleksji. `default_timeout_secs` nie może być większe niż `max_timeout_secs`.

### Tabela `[grpc.auth]` {#grpc-auth}

Interceptor `auth` przyjmuje wywołanie tylko z prawidłowym tokenem bearer. PHP nie otrzymuje odrzuconego wywołania. Stronę klienta i usługę health opisuje [uwierzytelnianie gRPC](/pl/docs/grpc#authentication).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `tokens_file` | tekst | brak, wymagane | Plik z akceptowanymi tokenami. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Zapisz jeden token w każdej linii. Rapira usuwa białe znaki na początku i na końcu każdej linii, a następnie pomija puste linie i linie zaczynające się od `#`. Każdy token musi być [tokenem bearer według RFC 6750](https://www.rfc-editor.org/rfc/rfc6750#section-2.1). Plik musi zawierać co najmniej jeden token. |

### Tabela `[grpc.pool]` {#grpc-pool}

Ta tabela używa [kluczy i wartości domyślnych puli HTTP](#http-pool), z wymaganym `entrypoint` i `mode = "dispatcher"`. Tryby Classic i Worker są odrzucane. Liczba workerów, ponowne uruchamianie aplikacji, zegar wykonania i watchdog dotyczą tej puli niezależnie. Tabela `[grpc.pool.env]` ustawia zmienne środowiskowe dla workerów gRPC według tych samych reguł co [Tabela `[http.pool.env]`](#http-pool-env).

HTTP i gRPC mogą działać razem na ZTS PHP. Każdy nasłuch używa własnej puli i skryptu wejściowego. Rapira czyta zestaw deskryptorów i plik tokenów raz, przy starcie. Uruchom ponownie Rapirę, aby wczytać zmieniony plik lub zmieniony zestaw pod adresem URL. Przeładowanie zachowuje stare dane.

## Sekcja `[observability]` {#observability}

Ta sekcja uruchamia nasłuch w osobnym wątku (`rapira-obs`) w procesie serwera, aby serwować metryki i sondy stanu przez HTTP. Ten wątek nie wykonuje kodu PHP. Ta sekcja nie jest tabelą wtyczki, więc plik nadal wymaga `[http]` lub `[grpc]`. Punkty końcowe i metryki opisuje [Metryki i kontrole stanu](/pl/docs/observability).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `listen` | tekst | brak, wymagane | Adres nasłuchu. Używa tej samej składni co `http.listen`. Użyj adresu, którego nie używają nasłuchy `http` i `grpc`. |
| `keepalive_timeout_secs` | liczba całkowita | `60` | Limit czasu na odebranie nagłówków żądania. Obejmuje czekanie na bezczynnym połączeniu. Zakres to od 1 do `86400`. |
| `[observability.metrics]` | pusta tabela | brak | Włącza `GET /metrics` w formacie tekstowym Prometheus. |
| `[observability.probes]` | pusta tabela | brak | Włącza `GET /livez` i `GET /readyz`. |

Ustaw co najmniej jedną z tych dwóch podtabel. Podtabele nie przyjmują kluczy.

## Sekcja `[server]`

Ta sekcja określa ustawienia całego serwera dla procesu Rapiry. Plik jednostki systemd opisuje [wdrożenie produkcyjne](/pl/docs/deployment).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `pidfile` | tekst | brak | Plik na identyfikator procesu serwera. Ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Wysyłaj sygnały procesu na ten identyfikator. Zobacz [model procesów](/pl/docs/process-model). |
| `stop_timeout_secs` | liczba całkowita | `30` | Całkowity termin zakończenia zamykania w sekundach, od `1` do `86400`. |

Otwarte połączenia mają czas na zakończenie przez `stop_timeout_secs` minus pięć sekund lub przez połowę limitu zatrzymywania, jeśli wynosi on poniżej dziesięciu sekund. Domyślny budżet na obsługę bieżących połączeń to 25 sekund, co pozostawia 5 sekund na zamknięcie PHP.

## Sekcja `[log]`

Ta sekcja steruje poziomem i formatem logów stderr. Cele, formaty i poziomy diagnostyki PHP opisują [Logi](/pl/docs/logging).

| Klucz | Typ | Domyślnie | Znaczenie |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | Poziom szczegółowości, wspólny od razu dla wszystkich celów. |
| `format` | `"plain"` \| `"json"` | `"plain"` | Format rekordu. Wyjście `plain` zawiera czytelne linie i może używać kolorów. Wyjście JSON zawiera jeden obiekt na linię. |
| `[log.targets]` | tabela cel na poziom | pusta | Nadpisania poziomu logowania dla celów. Klucze dopasowują się do prefiksów celów. Listę celów opisują [Logi](/pl/docs/logging#nadpisania-dla-poszczegolnych-celow). |

Klucz `[log.targets]` może zawierać litery, cyfry, `_`, `:`, `.` i `-`. Musi zaczynać się literą, cyfrą lub `_`. Rapira odrzuca inne znaki, ponieważ filtr logów może odczytać je jako składnię. Klucz celu zawierający `:` lub `.` musi być ujęty w cudzysłów, ponieważ TOML nie zezwala na te znaki w prostym kluczu bez cudzysłowu. Na przykład:

```toml
[log.targets]
"h2::proto" = "debug"
```

`RUST_LOG` i `NO_COLOR` wpływają tylko na wyjście stderr. `RUST_LOG` zastępuje cały filtr stderr podczas jednego uruchomienia. Niepusta wartość `NO_COLOR` wyłącza kolory formatu `plain`.

## Nieznane klucze są odrzucane

Rapira akceptuje tylko udokumentowane tabele i klucze. Na przykład `[htttp]` albo `lissten = ":8000"` zatrzymuje inicjalizację. Błąd wskazuje nieznaną nazwę. Każdy klucz należy do jednej tabeli. Na przykład `max_requests` należy do `[http.pool]`, a `pidfile` należy do `[server]`. Tabela `env` puli (`[http.pool.env]` lub `[grpc.pool.env]`) jest wyjątkiem: przyjmuje każdą nazwę zmiennej środowiskowej jako klucz i odrzuca pustą nazwę, nazwę zawierającą `=` lub NUL oraz wartość zawierającą NUL.

Rapira sprawdza również wartości. Odrzuca nieobsługiwane wartości i nie zastępuje ich wartościami domyślnymi. Na przykład odrzuca `level = "verbose"` i `format = "pretty"`. Liczby workerów, rozmiary treści i limity przesyłanych plików muszą wynosić co najmniej 1. Każdy klucz `*_secs` musi mieć wartość od 1 do `86400`. Tylko `request_terminate_timeout_secs` przyjmuje też `0`.

::: warning
Rapira czyta plik konfiguracyjny tylko przy starcie. Przeładowanie przez `SIGHUP` lub `SIGUSR2` nie czyta go ponownie. Uruchom ponownie Rapirę, aby zastosować zmieniony plik.
:::

## Ścieżki względne {#relative-paths}

Ścieżki systemu plików obejmują skrypty wejściowe obu pul, `grpc.descriptor_set`, `grpc.auth.tokens_file`, `server.pidfile`, `http.static.root`, `http.sendfile.root`, `http.uploads.dir` oraz względne ścieżki nasłuchu `unix:`. Każda ścieżka względna używa katalogu pliku konfiguracyjnego jako podstawy. Na przykład ustaw `entrypoint = "app/worker.php"` w `/etc/rapira/rapira.toml`. Rapira użyje wtedy `/etc/rapira/app/worker.php`. Wartość `grpc.descriptor_set`, która zaczyna się od `http://` lub `https://`, jest adresem URL, a nie ścieżką.

::: tip
Przechowuj plik konfiguracyjny `rapira.toml` w aplikacji. Zapisuj jego ścieżki względem pliku konfiguracyjnego. Możesz przenieść katalog aplikacji. Te ścieżki się nie zmieniają.
:::
