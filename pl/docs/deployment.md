---
title: Wdrożenie produkcyjne
description: "Jak uruchomić Rapirę na serwerze: jednostka systemd, układ konfiguracji, reverse proxy z przodu, przeładowania bez przestoju, logi w JSON-ie i wymiana workerów."
---

# Wdrożenie produkcyjne

Wdrożenie produkcyjne musi uruchamiać Rapirę po ponownym uruchomieniu systemu i przywracać ją po awarii. Musi też aktualizować kod bez utraty żądań i zachowywać logi. Ta strona opisuje jednostkę systemd, reverse proxy i ustawienia workerów.

Rapira nie definiuje układu wdrożenia. Nie wymaga określonej ścieżki konfiguracji ani supervisora procesów. Ta strona definiuje konwencję używaną przez pozostałą dokumentację. Najpierw zainstaluj plik binarny zgodnie z [Instalacją](/pl/docs/intro/installation).

Rapira jest też dostępna jako obraz `ghcr.io/rapira-rs/rapira`. Skopiuj jego pliki do obrazu aplikacji przez `COPY --from`. Kontener używa polityki restartów środowiska uruchomieniowego zamiast systemd. Pozostałe ustawienia nie zmieniają się. Więcej informacji zawiera sekcja [Docker](/pl/docs/intro/installation#docker).

## Jednostka systemd

Rapira może zastąpić php-fpm. Proces nadrzędny tworzy, monitoruje, zastępuje i usuwa workery. Zmienia też rozmiar puli. Systemd musi monitorować tylko proces nadrzędny. Oddzielny menedżer procesów nie jest potrzebny.

Pakiety `.deb` i `.rpm` instalują plik wykonywalny i osadzone PHP. Nie instalują jednostki usługi ani `php.ini`. Te pliki zawierają ustawienia określonej witryny. Aktualizacje pakietów nie powinny ich zastępować. Listę zainstalowanych plików zawiera [Instalacja](/pl/docs/intro/installation).

Utwórz `/etc/systemd/system/rapira.service`:

```ini
[Unit]
Description=Rapira PHP application server
After=network.target

[Service]
Type=exec
WorkingDirectory=/srv/app
ExecStart=/usr/bin/rapira serve --config /etc/rapira/rapira.toml
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

- `Type=exec` — Rapira działa na **pierwszym planie**. Proces uruchomiony przez systemd jest procesem nadrzędnym, więc `$MAINPID` go identyfikuje.
- `ExecReload` — polecenie `systemctl reload rapira` wysyła `SIGUSR2` do procesu nadrzędnego. Ten sygnał rozpoczyna opisane niżej przeładowanie.
- `KillMode=mixed` — systemd wysyła sygnał zatrzymania tylko do procesu nadrzędnego. Następnie proces nadrzędny wysyła `SIGQUIT` do workerów i czeka na nie. Po `TimeoutStopSec` systemd wysyła `SIGKILL` do całej grupy. Bez `KillMode=mixed` zatrzymanie może zakończyć bieżące żądania.
- `Restart=on-failure` — systemd uruchamia Rapirę ponownie po awarii. Nie uruchamia jej ponownie po normalnym zatrzymaniu.
- `RuntimeDirectory=rapira` — systemd tworzy `/run/rapira` podczas uruchamiania i usuwa go podczas zatrzymywania. Poniższe przykłady umieszczają pidfile i gniazdo uniksowe w tym katalogu.
- `Environment=PHPRC` — PHP używa tego katalogu do znalezienia `php.ini`.

::: tip Uruchamianie na koncie innym niż root
Dodaj `User=` i `Group=` do bloku `[Service]`. Systemd przekaże temu kontu własność `RuntimeDirectory`. Konto może wtedy utworzyć pidfile i gniazdo uniksowe w `/run/rapira/`. Zwykle nie może tworzyć plików bezpośrednio w `/run`.
:::

Dwie aplikacje na jednym hoście wymagają osobnych plików konfiguracyjnych, jednostek i adresów nasłuchu. Może je definiować szablon jednostki systemd, na przykład `rapira@.service`. Każda instancja inicjalizuje PHP i tworzy osobną pulę workerów.

## Ścieżki konfiguracji

Ten przewodnik używa `/etc/rapira/rapira.toml` dla ustawień Rapiry. Przechowuje `php.ini` w tym samym katalogu i ustawia `PHPRC=/etc/rapira`. Rapira nie zawiera tych ścieżek w pliku binarnym. Opcja `--config` przyjmuje dowolną ścieżkę. PHP używa `PHPRC` do wyszukiwania konfiguracji. Użyj innych ścieżek, jeśli wymaga ich system.

Rapira może działać bez `php.ini`. Ustawienia domyślne zapisują diagnostykę PHP w logu, a nie w odpowiedziach HTTP. Utwórz `/etc/rapira/php.ini`, aby skonfigurować OPcache, limit pamięci lub strefę czasową. Więcej informacji zawierają [Logi](/pl/docs/logging).

Względny `pool.entrypoint` używa katalogu pliku konfiguracyjnego jako podstawy. Dlatego `entrypoint = "index.php"` w tym układzie oznacza `/etc/rapira/index.php`. W środowisku produkcyjnym użyj bezwzględnej ścieżki skryptu wejściowego. `supervisor.pidfile` używa tej samej reguły. Argument `SCRIPT` i operacje PHP używają katalogu roboczego. Rapira nie zmienia tego katalogu. Systemd domyślnie używa `/`, dlatego jednostka ustawia `WorkingDirectory=/srv/app`. PHP szuka w tym katalogu również pliku ini. Wszystkie klucze zawiera [Konfiguracja](/pl/docs/configuration).

## Reverse proxy

Rapira przyjmuje nieszyfrowany HTTP i nie udostępnia ustawień TLS.
[Proxy kończące TLS](https://en.wikipedia.org/wiki/TLS_termination_proxy) przyjmuje HTTPS od klienta, odszyfrowuje połączenie i wysyła nieszyfrowany HTTP do Rapiry.
Użyj do tego celu nginx, Caddy, HAProxy lub modułu równoważenia obciążenia w chmurze.
Połącz proxy z Rapirą przez interfejs pętli zwrotnej lub gniazdo uniksowe. Publiczny adres Rapiry również używa nieszyfrowanego HTTP.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Rapira tworzy gniazdo uniksowe z trybem `0666`. Każdy proces z dostępem do katalogu środowiska uruchomieniowego może połączyć się z gniazdem. Rapira nie konfiguruje trybu gniazda. Ogranicz dostęp za pomocą uprawnień katalogu. Dla tej jednostki ustaw `RuntimeDirectoryMode=0750`. W `Group=` podaj grupę, która zawiera konto proxy.

Przekazuj pola z łącznikami, na przykład `X-Forwarded-For`. Nie używaj nazw takich jak `X_Forwarded_For`. Nazwy z podkreśleniami lub kropkami mogą odpowiadać temu samemu kluczowi `$_SERVER`. Rapira usuwa te nazwy, zanim PHP je otrzyma. [Strona HTTP](/pl/docs/http) opisuje mapowanie i ustawienie `http.unsafe_field_names`.

Rapira może obsługiwać zasoby statyczne za pomocą [middleware plików statycznych](/pl/docs/static-files). Proxy nie potrzebuje drugiej kopii katalogu głównego dokumentów. Zamiast tego zasoby może obsługiwać proxy lub CDN.

## Wdrożenia bez przestoju

Wdróż nowy kod. Następnie przeładuj Rapirę:

```bash
sudo systemctl reload rapira
```

Polecenie wysyła `SIGUSR2` do procesu nadrzędnego. Proces zastępuje po jednym workerze i kończy bieżące żądania. Jeśli worker przekroczy `process_control_timeout_secs`, proces nadrzędny wysyła `SIGTERM`, a następnie `SIGKILL`. To kończy bieżące żądanie. Sekwencję wymiany opisuje [Model procesów](/pl/docs/process-model).

Wyślij sygnał do procesu nadrzędnego, gdy systemd nie zarządza procesem. Ustaw `supervisor.pidfile`, aby zapisać identyfikator procesu. Utwórz katalog pidfile przed uruchomieniem Rapiry. Możesz też wybrać istniejący katalog. Proces nadrzędny nie uruchomi się, jeśli nie może zapisać pliku.

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Tylko proces nadrzędny zapisuje pidfile. Usuwa go podczas kontrolowanego zakończenia. Pozostały plik może wskazywać na `SIGKILL`, awarię procesu lub awarię systemu.

`process_control_timeout_secs` ogranicza każde oczekiwanie na workera podczas zatrzymywania i przeładowania. Po upływie limitu proces nadrzędny wysyła następny sygnał zakończenia. Ustaw tę wartość poniżej `TimeoutStopSec` systemd. W przeciwnym razie systemd może zakończyć proces nadrzędny przed końcem sekwencji. [Model procesów](/pl/docs/process-model) opisuje sekwencję sygnałów.

::: warning Czego przeładowanie nie zmienia
Proces nadrzędny zachowuje ustawienia początkowe i pamięć współdzieloną OPcache podczas przeładowania. Uruchom Rapirę ponownie po zmianie `rapira.toml`. Uruchom ją ponownie także przy `opcache.validate_timestamps = 0`. W tej konfiguracji przeładowanie nie zastępuje zapisanych kodów operacji.
:::

## Logi

Rapira zapisuje każdy wpis do logu na **stderr**. Stderr jednostki systemd trafia do journala bez dodatkowej konfiguracji. Na produkcji używaj JSON-a:

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

## Wymiana workerów i limity czasu żądania

W [trybie Worker](/pl/docs/execution-modes) proces zachowuje stan aplikacji między żądaniami. Dlatego wyciek pamięci może stopniowo zwiększać pamięć procesu. Użyj tych dwóch ustawień:

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` zastępuje workera po określonej liczbie żądań. Rapira dodaje małą wartość losową, aby nie zastępować całej puli jednocześnie. To ustawienie ogranicza wpływ wycieku, ale go nie naprawia. `request_terminate_timeout_secs` ogranicza czas jednego żądania. Rapira zastępuje workera, który przekroczy tę wartość. Oba ustawienia są domyślnie wyłączone. Włącz je przed użyciem środowiska produkcyjnego.

[Model procesów](/pl/docs/process-model) opisuje rozmiary puli dla trybów static, dynamic i ondemand, opóźnienia ponownego uruchamiania oraz awarie workerów.
