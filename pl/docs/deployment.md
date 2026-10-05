---
title: Wdrożenie produkcyjne
description: Produkcyjna jednostka systemd, układ konfiguracji, reverse proxy, proces przeładowania, logi w JSON-ie, kontrole stanu, metryki i wymiana workerów.
---

# Wdrożenie produkcyjne

Wdrożenie produkcyjne musi utrzymać dostępność Rapiry po ponownym uruchomieniu i po zmianach kodu. Uruchamia Rapirę podczas inicjalizacji systemu i uruchamia ją ponownie po awarii. Przeładowuje też kod bez utraty żądań i zachowuje logi. Ta strona opisuje jednostkę systemd, reverse proxy, kontrole stanu, metryki i trwałe ustawienia workerów.

Rapira nie definiuje układu wdrożenia. Nie wymaga określonej ścieżki konfiguracji ani supervisora procesów. Ta strona definiuje konwencję używaną przez pozostałą dokumentację. Najpierw zainstaluj plik binarny zgodnie z [Instalacją](/pl/docs/intro/installation).

Rapira jest też dostępna jako obraz `ghcr.io/rapira-rs/rapira`. Skopiuj jego pliki do obrazu aplikacji przez `COPY --from`. Kontener używa polityki restartów środowiska uruchomieniowego zamiast systemd. Pozostałe ustawienia nie zmieniają się. Więcej informacji zawiera sekcja [Docker](/pl/docs/intro/installation#docker).

## Jednostka systemd

Rapira może zastąpić php-fpm. Proces nadrzędny tworzy, monitoruje i zastępuje workery. Każda pula uruchamia stałą liczbę workerów, którą ustawia `processes`. Systemd musi monitorować tylko proces nadrzędny. Oddzielny menedżer procesów nie jest potrzebny.

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
KillMode=mixed
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

- `Type=exec`: Rapira działa na **pierwszym planie**. Proces uruchomiony przez systemd jest procesem nadrzędnym, więc `$MAINPID` go identyfikuje.
- `ExecReload`: polecenie `systemctl reload rapira` wysyła `SIGUSR2` do procesu nadrzędnego. Ten sygnał rozpoczyna opisane niżej przeładowanie.
- `KillMode=mixed`: systemd wysyła sygnał zatrzymania tylko do procesu nadrzędnego. Następnie proces nadrzędny wysyła `SIGQUIT` do workerów i czeka na nie. Po `TimeoutStopSec` systemd wysyła `SIGKILL` do całej grupy. Bez `KillMode=mixed` zatrzymanie może zakończyć bieżące żądania.
- `Restart=on-failure`: systemd uruchamia Rapirę ponownie po awarii. Nie uruchamia jej ponownie po normalnym zatrzymaniu.
- `RuntimeDirectory=rapira`: systemd tworzy `/run/rapira` podczas uruchamiania i usuwa go podczas zatrzymywania. Poniższe przykłady umieszczają pidfile i gniazdo uniksowe w tym katalogu.
- `Environment=PHPRC`: PHP używa tego katalogu do znalezienia `php.ini`.

::: tip Uruchamianie na koncie innym niż root
Dodaj `User=` i `Group=` do bloku `[Service]`. Systemd przekaże temu kontu własność `RuntimeDirectory`. Konto może wtedy utworzyć pidfile i gniazdo uniksowe w `/run/rapira/`. Zwykle nie może tworzyć plików bezpośrednio w `/run`.
:::

Dwie aplikacje na jednym hoście wymagają osobnych plików konfiguracyjnych, jednostek i adresów nasłuchu. Może je definiować szablon jednostki systemd, na przykład `rapira@.service`. Każda instancja inicjalizuje PHP i tworzy osobną pulę workerów.

## Ścieżki konfiguracji

Ten przewodnik używa `/etc/rapira/rapira.toml` dla ustawień Rapiry. Przechowuje `php.ini` w tym samym katalogu i ustawia `PHPRC=/etc/rapira`. Rapira nie zawiera tych ścieżek w pliku binarnym. Argument `CONFIG` przyjmuje dowolną ścieżkę. PHP używa `PHPRC` do wyszukiwania konfiguracji. Użyj innych ścieżek, jeśli wymaga ich system.

Rapira może działać bez `php.ini`. Ustawienia domyślne zapisują diagnostykę PHP w logu, a nie w odpowiedziach HTTP. Utwórz `/etc/rapira/php.ini`, aby skonfigurować OPcache, limit pamięci lub strefę czasową. Więcej informacji zawierają [Logi](/pl/docs/logging).

W PHP 8.4 OPcache jest osobnym plikiem `opcache.so`. Załaduj go wierszem `zend_extension` w `php.ini`, jak opisuje sekcja [php.ini](/pl/docs/intro/installation#php-ini). PHP 8.5 zawiera OPcache w `libphp`.

Względny `http.pool.entrypoint` używa **katalogu pliku konfiguracyjnego** jako podstawy. Dlatego `entrypoint = "index.php"` w tym układzie oznacza `/etc/rapira/index.php`. W środowisku produkcyjnym użyj bezwzględnej ścieżki skryptu wejściowego. `supervisor.pidfile` używa tej samej reguły.

Każdy worker zmienia katalog roboczy na katalog skryptu wejściowego, zanim uruchomi PHP. Operacje PHP na plikach ze ścieżkami względnymi używają tego katalogu. PHP nie szuka `php.ini` w katalogu roboczym, dlatego ustaw `PHPRC`. Ustawienie `WorkingDirectory=` dotyczy tylko procesu nadrzędnego. Proces nadrzędny używa go jako podstawy dla względnej ścieżki `CONFIG` i względnej ścieżki nasłuchu `unix:`. Wszystkie klucze i wartości domyślne zawiera [Konfiguracja](/pl/docs/configuration).

## Reverse proxy

Rapira przyjmuje nieszyfrowany HTTP i nie udostępnia ustawień TLS. [Proxy kończące TLS](https://en.wikipedia.org/wiki/TLS_termination_proxy) przyjmuje HTTPS od klienta, odszyfrowuje połączenie i wysyła nieszyfrowany HTTP do Rapiry. Użyj do tego celu nginx, Caddy, HAProxy lub modułu równoważenia obciążenia w chmurze. Połącz proxy z Rapirą przez interfejs pętli zwrotnej lub gniazdo uniksowe. Publiczny adres Rapiry również używa nieszyfrowanego HTTP.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Rapira tworzy gniazdo uniksowe z trybem `0666`. Każdy proces z dostępem do katalogu środowiska uruchomieniowego może połączyć się z gniazdem. Rapira nie konfiguruje trybu gniazda. Ogranicz dostęp za pomocą uprawnień katalogu. Dla tej jednostki ustaw `RuntimeDirectoryMode=0750`. W `Group=` podaj grupę, która zawiera konto proxy.

Przekazuj pola z łącznikami, na przykład `X-Forwarded-For`. Nie używaj nazw takich jak `X_Forwarded_For`. W trybach Classic i Worker nazwa z `_` lub `.` może odpowiadać temu samemu kluczowi `$_SERVER` co nazwa z łącznikami. W tych trybach Rapira domyślnie usuwa każdą nazwę ze znakiem innym niż litera ASCII, cyfra lub łącznik. [Strona HTTP](/pl/docs/http) opisuje mapowanie i ustawienie `http.unsafe_field_names`.

Rapira może obsługiwać zasoby statyczne za pomocą [middleware plików statycznych](/pl/docs/static-files). Proxy nie potrzebuje drugiej kopii katalogu głównego dokumentów. Zamiast tego zasoby może obsługiwać proxy lub CDN.

## Wdrożenia bez przestoju

Wdróż nowy kod. Następnie przeładuj Rapirę:

```bash
sudo systemctl reload rapira
```

Polecenie wysyła `SIGUSR2` do procesu nadrzędnego. Proces nadrzędny zastępuje po jednym workerze i pozwala zakończyć bieżące żądania. Jeśli worker przekroczy `process_control_timeout_secs`, proces nadrzędny wysyła `SIGTERM`, a następnie `SIGKILL`. To zakończenie przerywa bieżące żądanie. Sekwencję wymiany opisuje [Model procesów](/pl/docs/process-model).

Wyślij sygnał bezpośrednio, gdy systemd nie zarządza procesem. Ustaw `supervisor.pidfile`, aby zapisać identyfikator procesu nadrzędnego. Utwórz katalog pidfile przed uruchomieniem Rapiry. Możesz też wybrać istniejący katalog. Proces nadrzędny nie uruchomi się, jeśli nie może zapisać pliku.

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Tylko proces nadrzędny zapisuje pidfile. Usuwa go podczas kontrolowanego zakończenia. Pozostały plik może wskazywać na `SIGKILL`, awarię procesu lub awarię systemu.

`process_control_timeout_secs` ogranicza początkowe oczekiwanie podczas zatrzymywania i każde oczekiwanie na gotowość nowego workera. Po oczekiwaniu podczas zatrzymywania proces nadrzędny wysyła `SIGTERM`. Sekundę później wysyła `SIGKILL`. Ustaw `TimeoutStopSec` systemd powyżej tego pełnego czasu.

Połączenia mają krótszy czas na zakończenie: limit sterowania pomniejszony o mniejszą z wartości: pięć sekund lub połowę limitu. Domyślnie jest to 25 sekund. Odpowiedzi, które przekroczą ten czas, mogą zostać przerwane podczas zatrzymywania lub przeładowania.

::: warning Czego przeładowanie nie zmienia
Przeładowanie zastępuje workery, ale nie proces nadrzędny. Proces nadrzędny zachowuje plik binarny Rapiry oraz ustawienia z `rapira.toml` i `php.ini`. Zachowuje też zbiór deskryptorów gRPC, plik tokenów `[grpc.auth]` i pamięć współdzieloną OPcache. Uruchom Rapirę ponownie po zmianie jednego z tych plików. Uruchom ją ponownie także przy `opcache.validate_timestamps = 0`. W tej konfiguracji przeładowanie nie zastępuje zapisanych kodów operacji.
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

Dodaj tabelę `[observability]`, aby udostępnić sondy stanu i metryki Prometheus. Rapira uruchamia wtedy jeden dodatkowy proces, który nie uruchamia PHP. `GET /livez` pokazuje, że proces nadrzędny działa. `GET /readyz` pokazuje, że każda pula PHP ma bezczynnego lub aktywnego workera. `GET /metrics` zwraca metryki w formacie tekstowym Prometheus.

```toml
[observability]
listen = "127.0.0.1:9180"

[observability.metrics]

[observability.probes]
```

Punkty końcowe nie mają uwierzytelniania ani TLS. Użyj adresu pętli zwrotnej lub gniazda uniksowego. Kody statusu, przykłady sond i opis metryk zawiera strona [Metryki i kontrole stanu](/pl/docs/observability).

## Wymiana workerów i limity czasu żądania

W [trybach Worker i Dispatcher](/pl/docs/execution-modes) worker zachowuje stan aplikacji między żądaniami. Dlatego wyciek pamięci może stopniowo zwiększać pamięć workera. Użyj tych dwóch ustawień, aby ograniczyć ten efekt:

```toml
[http.pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

Tabela `[grpc.pool]` przyjmuje te same klucze.

`max_requests` zastępuje workera po określonej liczbie żądań. Dla każdego workera Rapira dodaje losową liczbę do połowy limitu, aby nie zastępować workerów jednocześnie. To ustawienie ogranicza wpływ wycieku pamięci, ale go nie naprawia.

`request_terminate_timeout_secs` ogranicza czas jednego żądania. Rapira kończy i zastępuje workera, który przekroczy limit. Domyślna wartość obu ustawień to zero, które je wyłącza. Włącz je w środowisku produkcyjnym.

[Model procesów](/pl/docs/process-model) opisuje rozmiar puli, opóźnienia wymiany oraz obsługę awarii workerów.
