---
title: Wdrożenie produkcyjne
description: Produkcyjna jednostka systemd, układ konfiguracji, reverse proxy, proces przeładowania, logi w JSON-ie, kontrole stanu, metryki i wymiana workerów.
---

# Wdrożenie produkcyjne

Wdrożenie produkcyjne musi utrzymać dostępność Rapiry po ponownym uruchomieniu i po zmianach kodu. Uruchamia Rapirę podczas inicjalizacji systemu i uruchamia ją ponownie po awarii. Przeładowuje też kod bez utraty żądań i zachowuje logi. Ta strona opisuje jednostkę systemd, reverse proxy, kontrole stanu, metryki i trwałe ustawienia workerów.

Rapira nie definiuje układu wdrożenia. Nie wymaga określonej ścieżki konfiguracji ani supervisora procesów. Ta strona definiuje konwencję używaną przez pozostałą dokumentację. Najpierw zainstaluj plik binarny zgodnie z [Instalacją](/pl/docs/intro/installation).

Rapira jest też dostępna jako obraz `ghcr.io/rapira-rs/rapira`. Obraz zawiera PHP, a ty dodajesz do niego swoją aplikację. Uruchom kontener z opcją `--init`, aby proces init usuwał zakończone procesy potomne. Kontener używa polityki restartów środowiska uruchomieniowego zamiast systemd. Pozostałe ustawienia nie zmieniają się. Więcej informacji zawiera sekcja [Docker](/pl/docs/intro/installation#docker).

## Jednostka systemd

Rapira może zastąpić php-fpm. Jeden proces serwera zarządza wszystkimi nasłuchami i wątkami workerów PHP. Każda pula uruchamia stałą liczbę workerów, którą ustawia `workers`. Systemd monitoruje ten pojedynczy proces serwera. Oddzielny menedżer procesów nie jest potrzebny.

Pakiety `.deb` i `.rpm` instalują plik wykonywalny i osadzone PHP. Nie instalują jednostki usługi ani `php.ini`. Te pliki zawierają ustawienia określonej witryny. Aktualizacje pakietów nie mogą ich zastępować. Listę zainstalowanych plików zawiera [Instalacja](/pl/docs/intro/installation).

Utwórz `/etc/systemd/system/rapira.service`:

```ini
[Unit]
Description=Rapira PHP application server
After=network.target

[Service]
Type=exec
WorkingDirectory=/srv/app
ExecStart=/usr/bin/rapira serve /etc/rapira/rapira.toml
ExecReload=/bin/kill -USR2 $MAINPID
Restart=on-failure
RuntimeDirectory=rapira
Environment=PHPRC=/etc/rapira

[Install]
WantedBy=multi-user.target
```

Przeładuj konfigurację systemd:

```bash
sudo systemctl daemon-reload
```

Włącz Rapirę z opcją `--now`:

```bash
sudo systemctl enable --now rapira
```

Jednostka używa następujących ustawień:

- `Type=exec`: Rapira działa na **pierwszym planie**, więc `$MAINPID` identyfikuje proces serwera.
- `ExecReload`: polecenie `systemctl reload rapira` wysyła `SIGUSR2` do serwera. Ten sygnał rozpoczyna opisane niżej przeładowanie.
- `Restart=on-failure`: systemd uruchamia Rapirę ponownie po awarii. Nie uruchamia jej ponownie po normalnym zatrzymaniu.
- `RuntimeDirectory=rapira`: systemd tworzy `/run/rapira` podczas uruchamiania i usuwa go podczas zatrzymywania. Poniższe przykłady umieszczają pidfile i gniazdo uniksowe w tym katalogu.
- `Environment=PHPRC`: PHP używa tego katalogu do znalezienia `php.ini`.

Ustaw limity pamięci i CPU dla jednostki usługi lub kontenera, na przykład `MemoryMax=` i `CPUQuota=`.

::: tip Uruchamianie na koncie innym niż root
Dodaj `User=` i `Group=` do bloku `[Service]`. Systemd przekaże temu kontu własność `RuntimeDirectory`. Konto może wtedy utworzyć pidfile i gniazdo uniksowe w `/run/rapira/`. Zwykle nie może tworzyć plików bezpośrednio w `/run`.
:::

Dwie aplikacje na jednym hoście wymagają osobnych plików konfiguracyjnych, jednostek i adresów nasłuchu. Może je definiować szablon jednostki systemd, na przykład `rapira@.service`. Każda instancja inicjalizuje PHP i tworzy własne pule workerów.

## Ścieżki konfiguracji

Ten przewodnik używa `/etc/rapira/rapira.toml` dla ustawień Rapiry. Przechowuje `php.ini` w tym samym katalogu i ustawia `PHPRC=/etc/rapira`. Rapira nie zawiera tych ścieżek w pliku binarnym. Argument `CONFIG` przyjmuje dowolną ścieżkę. PHP używa `PHPRC` do wyszukiwania konfiguracji. Użyj innych ścieżek, jeśli wymaga ich system.

Rapira może działać bez `php.ini`. Ustawienia domyślne zapisują diagnostykę PHP w logu, a nie w odpowiedziach HTTP. Utwórz `/etc/rapira/php.ini`, aby skonfigurować OPcache, limit pamięci lub strefę czasową. Więcej informacji zawierają [Logi](/pl/docs/logging).

W PHP 8.4 OPcache jest osobnym plikiem `opcache.so`. Załaduj go wierszem `zend_extension` w `php.ini`, jak opisuje sekcja [php.ini](/pl/docs/intro/installation#php-ini). PHP 8.5 i PHP 8.6 zawierają OPcache w `libphp`.

Względny `http.pool.entrypoint` używa **katalogu pliku konfiguracyjnego** jako podstawy. W tym układzie `entrypoint = "index.php"` oznacza `/etc/rapira/index.php`. W środowisku produkcyjnym użyj bezwzględnej ścieżki skryptu wejściowego. `server.pidfile` i względne ścieżki nasłuchu `unix:` używają tej samej reguły rozwiązywania.

Każde żądanie classic i każda instancja aplikacji Worker lub Dispatcher uruchamia się w rozwiązanym katalogu skryptu wejściowego. Operacje PHP na plikach ze ścieżkami względnymi używają tego lokalnego dla wątku katalogu. PHP nie szuka `php.ini` w katalogu roboczym, dlatego ustaw `PHPRC`. W modelu ZTS `proc_open()` bez argumentu `$cwd` uruchamia proces potomny w `WorkingDirectory=` serwera; przekaż `getcwd()` jako `$cwd`, aby użyć katalogu aplikacji. Wszystkie klucze i wartości domyślne zawiera [Konfiguracja](/pl/docs/configuration).

## Reverse proxy

Rapira przyjmuje nieszyfrowany HTTP i nie udostępnia ustawień TLS. [Proxy kończące TLS](https://en.wikipedia.org/wiki/TLS_termination_proxy) przyjmuje HTTPS od klienta, odszyfrowuje połączenie i wysyła nieszyfrowany HTTP do Rapiry. Użyj do tego celu nginx, Caddy, HAProxy lub modułu równoważenia obciążenia w chmurze. Połącz proxy z Rapirą przez interfejs pętli zwrotnej lub gniazdo uniksowe. Publiczny adres Rapiry również używa nieszyfrowanego HTTP.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Rapira tworzy gniazdo uniksowe z trybem `0666`. Każdy proces z dostępem do katalogu środowiska uruchomieniowego może połączyć się z gniazdem. Rapira nie konfiguruje trybu gniazda. Ogranicz dostęp za pomocą uprawnień katalogu. Dla tej jednostki ustaw `RuntimeDirectoryMode=0750`. W `Group=` podaj grupę, która zawiera konto proxy.

Przekazuj pola z łącznikami, na przykład `X-Forwarded-For`. Nie używaj nazw takich jak `X_Forwarded_For`. W trybach Classic i Worker nazwa z `_` lub `.` może odpowiadać temu samemu kluczowi `$_SERVER` co nazwa z łącznikami. W tych trybach Rapira zawsze usuwa każdą nazwę ze znakiem innym niż litera ASCII, cyfra lub łącznik. [Strona HTTP](/pl/docs/http) opisuje mapowanie.

Rapira może obsługiwać zasoby statyczne za pomocą [middleware plików statycznych](/pl/docs/static-files). Proxy nie potrzebuje drugiej kopii katalogu głównego dokumentów. Zamiast tego zasoby może obsługiwać proxy lub CDN.

## Wdrożenia bez przestoju

Wdróż nowy kod. Następnie przeładuj Rapirę:

```bash
sudo systemctl reload rapira
```

Polecenie wysyła `SIGUSR2` do serwera. Każdy worker ponownie uruchamia aplikację w tym samym wątku, a nowa aplikacja obsługuje kolejne żądania. Żadne połączenie się nie zamyka i żadne żądanie nie ginie. Więcej informacji zawiera [Model procesów](/pl/docs/process-model#a-reload-restarts-the-apps).

Wyślij sygnał bezpośrednio, gdy systemd nie zarządza procesem. Ustaw `server.pidfile`, aby zapisać identyfikator procesu serwera. Utwórz katalog pidfile przed uruchomieniem Rapiry. Możesz też wybrać istniejący katalog. Serwer nie uruchomi się, jeśli nie może zapisać pliku.

```toml
[server]
pidfile = "/run/rapira/rapira.pid"
stop_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Rapira usuwa plik pidfile podczas normalnego zamykania oraz przy bezpośrednich wyjściach hosta (`70`, `101`, `124`, `130`). Pozostały plik wskazuje na `SIGKILL`, sygnał błędu krytycznego lub awarię systemu; następny start go nadpisuje.

`stop_timeout_secs` ogranicza całkowity czas oczekiwania podczas zamykania (domyślnie `30` sekund). Otwarte połączenia mają czas na zakończenie przez `stop_timeout_secs` minus pięć sekund lub przez połowę limitu zatrzymywania, jeśli wynosi on poniżej dziesięciu sekund. Ustaw `TimeoutStopSec` systemd powyżej `stop_timeout_secs`.

Wdrożenie może umieścić każdą wersję aplikacji w osobnym katalogu i przełączyć dowiązanie symboliczne w ścieżce skryptu wejściowego na nowy katalog. Przeładowanie po przełączeniu przenosi każdego workera każdej puli do nowej wersji: kod, katalog roboczy i domyślny katalog główny sendfile. Przeładuj Rapirę natychmiast po przełączeniu. Przed przeładowaniem aplikacja, która uruchamia się z innego powodu, na przykład po `max_requests`, uruchamia się w nowej wersji. Dlatego pula działa w dwóch wersjach aż do przeładowania.

Przeładowanie opróżnia OPcache, więc wczytuje nowy kod PHP także przy `opcache.validate_timestamps = 0`, chyba że ustawiono `opcache.file_cache`. Jeden worker resetuje OPcache, gdy pozostałe czekają, a kolejne żądania ponownie kompilują swoje pliki.

::: warning Czego przeładowanie nie zmienia
Przeładowanie ponownie uruchamia aplikacje, ale nie restartuje procesu serwera. Rapira zachowuje plik binarny oraz ustawienia z `rapira.toml` i `php.ini`. Zachowuje też zbiór deskryptorów gRPC i plik tokenów `[grpc.auth]`. Przeładowanie nie pobiera ponownie zbioru deskryptorów z jego adresu URL. Uruchom Rapirę ponownie po zmianie jednego z tych plików. Uruchom ją ponownie także po zmianie pliku, który wczytuje `opcache.preload`. PHP wczytuje te pliki jeden raz, przy starcie serwera.

Gdy ustawiono `opcache.restrict_api`, przeładowanie nie opróżnia OPcache. Przy tym ustawieniu i `opcache.validate_timestamps = 0` uruchom Rapirę ponownie po każdym wdrożeniu.

Przy `opcache.file_cache` i `opcache.validate_timestamps = 0` przeładowanie i restart nie wczytują nowego kodu zmienionego pliku. Przeładowanie opróżnia tylko pamięć współdzieloną OPcache. OPcache odczytuje wtedy stary skrypt z pamięci podręcznej plików i nie sprawdza czasu modyfikacji pliku. Po zastąpieniu plików opróżnij katalog `opcache.file_cache`. Następnie przeładuj lub uruchom ponownie Rapirę. Alternatywnie wdrażaj każde wydanie do nowego katalogu, aby każdy zmieniony plik miał nową ścieżkę.
:::

## Logi

Rapira zapisuje przefiltrowane wpisy do logu na **stderr**. Systemd przekazuje stderr do dziennika. Na produkcji używaj JSON-a dla stderr:

```toml
[log]
level = "info"
format = "json"
```

Każda linia zawiera jeden obiekt z polami `timestamp`, `level`, `target` i `fields`. Obiekt `fields` zawiera `message` oraz pozostałe pola zdarzenia. Znacznik czasu używa UTC zgodnie z RFC 3339. Rapira zapisuje znaki nowego wiersza w komunikatach w formie ucieczki. Journald przekazuje obiekt do kolektorów logów bez zmian.

```bash
journalctl -u rapira -f
```

Skonfiguruj kolektor logów do odczytu dziennika jednostki. Możesz też przekazać stderr Rapiry bezpośrednio do kolektora. Kolektor może analizować każdy wpis jako JSON bez wyrażeń regularnych. [Logi](/pl/docs/logging) opisują poziomy dla celów i zastąpienie filtra przez `RUST_LOG`.

## Kontrole stanu i metryki

Dodaj tabelę `[observability]`, aby udostępnić sondy stanu i metryki Prometheus. Rapira uruchamia ten nasłuch w osobnym wątku bez PHP. `GET /livez` pokazuje, że serwer działa. `GET /readyz` pokazuje, że każda pula PHP ma bezczynnego lub aktywnego workera. `GET /metrics` zwraca metryki w formacie tekstowym Prometheus.

```toml
[observability]
listen = "127.0.0.1:9180"

[observability.metrics]

[observability.probes]
```

Punkty końcowe nie mają uwierzytelniania ani TLS. Użyj adresu pętli zwrotnej lub gniazda uniksowego. Kody statusu, przykłady sond i opis metryk zawiera strona [Metryki i kontrole stanu](/pl/docs/observability).

## Ponowne uruchamianie aplikacji i limity czasu żądania

W [trybach Worker i Dispatcher](/pl/docs/execution-modes) worker zachowuje stan aplikacji między żądaniami. Dlatego wyciek pamięci może stopniowo zwiększać pamięć workera. Użyj tych ustawień, aby ograniczyć ten efekt:

```toml
[http.pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

Tabela `[grpc.pool]` przyjmuje te same klucze.

`max_requests` ponownie uruchamia aplikację w wątku workera po określonej liczbie jednostek pracy. Nasłuchy, połączenia i kolejka puli pozostają, więc żadne żądanie nie ginie. Dla każdego workera Rapira dodaje losową liczbę do połowy limitu, aby zapobiec jednoczesnym ponownym uruchomieniom. Ponowne uruchomienie zwalnia pamięć PHP aplikacji. Nie zwalnia pamięci, którą rozszerzenie lub biblioteka C traci poza PHP. Tryb Classic ignoruje to ustawienie.

`request_terminate_timeout_secs` ustawia limit czasu rzeczywistego watchdoga dla jednej jednostki pracy. Po osiągnięciu limitu watchdog przerywa PHP i wybudza zablokowany zapis odpowiedzi. Natywne operacje I/O mogą nadal czekać, więc ustaw limity czasu na gniazdach i zapytaniach do baz danych. Po kolejnych pięciu sekundach Rapira zapisuje raz w logu nadal zablokowanego workera, podczas gdy pozostałe workery dalej obsługują żądania. Rapira kończy działanie z kodem `124` tylko wtedy, gdy wszystkie workery w jednej puli pozostają zablokowane po upływie okresu dodatkowego.

Ustaw `memory_limit` w `php.ini` oraz ustaw limity pamięci kontenera lub systemd dla procesu Rapiry. Rozmiar puli, ponowne próby po nieudanych rozruchach, `SIGRTMAX` i `execution_clock` opisuje [Model procesów](/pl/docs/process-model).
