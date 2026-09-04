---
title: Wdrożenie produkcyjne
description: "Jak uruchomić Rapirę na serwerze: jednostka systemd, układ konfiguracji, reverse proxy z przodu, przeładowania bez przestoju, logi w JSON-ie i wymiana workerów."
---

# Wdrożenie produkcyjne

Wdrożenie produkcyjne musi uruchamiać Rapirę po ponownym uruchomieniu systemu i przywracać ją po awarii.
Musi też aktualizować kod bez utraty żądań i zachowywać logi. Ta strona opisuje jednostkę systemd, reverse proxy i ustawienia workerów.

Rapira nie definiuje układu wdrożenia. Nie wymaga określonej ścieżki konfiguracji ani supervisora procesów.
Ta strona definiuje konwencję używaną przez pozostałą dokumentację. Najpierw zainstaluj plik binarny zgodnie z [Instalacją](/pl/docs/intro/installation).

Rapira jest też dostępna jako obraz `ghcr.io/rapira-rs/rapira`. Skopiuj jego pliki do obrazu aplikacji przez `COPY --from`.
Kontener używa polityki restartów środowiska uruchomieniowego zamiast systemd. Pozostałe ustawienia nie zmieniają się.
Więcej informacji zawiera sekcja [Docker](/pl/docs/intro/installation#docker).

## Jednostka systemd

Rapira może zastąpić php-fpm. Proces nadrzędny tworzy, monitoruje, zastępuje i usuwa workery. Zmienia też rozmiar puli.
Systemd musi monitorować tylko proces nadrzędny. Oddzielny menedżer procesów nie jest potrzebny.

Pakiety `.deb` i `.rpm` instalują plik wykonywalny i osadzone PHP. Nie instalują jednostki usługi ani `php.ini`.
Te pliki zawierają ustawienia określonej witryny. Aktualizacje pakietów nie powinny ich zastępować.
Listę zainstalowanych plików zawiera [Instalacja](/pl/docs/intro/installation).

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

- `Type=exec` - Rapira działa na **pierwszym planie** i nigdy nie forkuje się w tło. Trybu demona nie ma i nie jest potrzebny: proces, który uruchamia systemd, *jest* procesem nadrzędnym, więc `$MAINPID` to dokładnie ten pid, do którego chcesz wysłać sygnał.
- `ExecReload` - zamienia `systemctl reload rapira` w `SIGUSR2` do procesu nadrzędnego, czyli w opisane niżej przeładowanie bez przestoju.
- `KillMode=mixed` - domyślnie systemd wysyła sygnał zatrzymania do każdego procesu w cgrupie, a worker traktuje `SIGTERM` jak natychmiastowe ubicie. `mixed` kieruje go wyłącznie do procesu nadrzędnego, a ten przeprowadza łagodne wygaszanie przez `SIGQUIT`, opisane niżej; `SIGKILL` po `TimeoutStopSec` i tak obejmuje całą grupę. Bez tej linii `systemctl stop` i `systemctl restart` gubią żądania będące w toku.
- `Restart=on-failure` - czyste wygaszenie kończy się kodem zero i serwer zostaje wyłączony, więc ta linia podnosi go z powrotem tylko po awarii albo nieudanym starcie.
- `RuntimeDirectory=rapira` - systemd tworzy `/run/rapira` przy starcie i usuwa przy zatrzymaniu. To tam leżą pidfile i gniazdo uniksowe z poniższych przykładów.
- `Environment=PHPRC` - miejsce, w którym PHP szuka swojego `php.ini`; o tym mówi następna sekcja.

::: tip Uruchamianie na koncie innym niż root
Dodaj `User=` i `Group=` do bloku `[Service]` - systemd przepisze `RuntimeDirectory` na to konto, więc pidfile i gniazdo uniksowe w `/run/rapira/` będą działać dalej. Ścieżki spoza tego katalogu, `/run/rapira.pid` i podobne, leżą w katalogu należącym do roota i nie uda się ich otworzyć.
:::

Dwie aplikacje na jednej maszynie wymagają dwóch konfiguracji, dwóch jednostek i dwóch adresów nasłuchu; użyj do tego szablonu jednostki systemd (`rapira@.service`). Każda instancja podnosi własne PHP i własną pulę workerów i nie dzieli z drugą instancją nic poza maszyną.

## Ścieżki konfiguracji

Ten przewodnik używa `/etc/rapira/rapira.toml` dla ustawień Rapiry. Przechowuje `php.ini` w tym samym katalogu i ustawia `PHPRC=/etc/rapira`.
Rapira nie zawiera tych ścieżek w pliku binarnym. Opcja `--config` przyjmuje dowolną ścieżkę.
PHP używa `PHPRC` do wyszukiwania konfiguracji. Użyj innych ścieżek, jeśli wymaga ich system.

Rapira może działać bez `php.ini`. Ustawienia domyślne zapisują diagnostykę PHP w logu, a nie w odpowiedziach HTTP.
Utwórz `/etc/rapira/php.ini`, aby skonfigurować OPcache, limit pamięci lub strefę czasową. Więcej informacji zawierają [Logi](/pl/docs/logging).

Względny `pool.entrypoint` używa katalogu pliku konfiguracyjnego jako podstawy. Dlatego `entrypoint = "index.php"` w tym układzie oznacza `/etc/rapira/index.php`.
W środowisku produkcyjnym użyj bezwzględnej ścieżki skryptu wejściowego. `supervisor.pidfile` używa tej samej reguły.
Argument `SCRIPT` i operacje PHP używają katalogu roboczego. Rapira nie zmienia tego katalogu.
Systemd domyślnie używa `/`, dlatego jednostka ustawia `WorkingDirectory=/srv/app`. PHP szuka w tym katalogu również pliku ini.
Wszystkie klucze zawiera [Konfiguracja](/pl/docs/configuration).

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

Gniazdo uniksowe powstaje z prawami `0666`, więc połączy się z nim każdy lokalny proces, który ma dostęp do katalogu z gniazdem, i wyśle żądania prosto do twojej aplikacji. Rapira nie ma ustawienia, którym dałoby się te prawa zmienić, więc dostęp do gniazda ograniczają wyłącznie prawa samego katalogu. Jeśli to dla ciebie istotne, ogranicz sam katalog: w jednostce wyżej `RuntimeDirectoryMode=0750` i `Group=`, do której należy użytkownik proxy, zamykają `/run/rapira` przed wszystkimi innymi.

Pola przekazywane dalej muszą docierać do Rapiry w zwykłej pisowni z `-` - `X-Forwarded-For`, nigdy `X_Forwarded_For`. Wersje z podkreśleniem i z kropką lądują pod tym samym kluczem `$_SERVER` co ta prawidłowa, a to właśnie tędy klient mógłby nadpisać to, co przed chwilą ustawiło twoje proxy - dlatego Rapira wycina je, zanim PHP je zobaczy. Mapowanie nazw i sterujące nim ustawienie `http.unsafe_field_names` opisuje [strona o HTTP](/pl/docs/http).

Zasoby statyczne Rapira potrafi serwować sama, gdy włączysz [middleware plików statycznych](/pl/docs/static-files), więc proxy nie musi trzymać drugiej kopii katalogu z zasobami. Proxy albo CDN przed serwerem nadal pozostaje opcją.

## Wdrożenia bez przestoju

Wdróż nowy kod. Następnie przeładuj Rapirę:

```bash
sudo systemctl reload rapira
```

Polecenie wysyła `SIGUSR2` do procesu nadrzędnego. Proces zastępuje po jednym workerze i kończy bieżące żądania.
Jeśli worker przekroczy `process_control_timeout_secs`, proces nadrzędny wysyła `SIGTERM`, a następnie `SIGKILL`. To kończy bieżące żądanie.
Sekwencję wymiany opisuje [Model procesów](/pl/docs/process-model).

Wyślij sygnał do procesu nadrzędnego, gdy systemd nie zarządza procesem. Ustaw `supervisor.pidfile`, aby zapisać identyfikator procesu.
Utwórz katalog pidfile przed uruchomieniem Rapiry. Możesz też wybrać istniejący katalog.
Proces nadrzędny nie uruchomi się, jeśli nie może zapisać pliku.

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Ten plik zapisuje wyłącznie proces nadrzędny - workery go nie dotykają - i sam go usuwa na każdej ścieżce wyjścia, którą kontroluje. Plik, który został po zgaszonym serwerze, znaczy więc, że proces nadrzędny zginął bez własnego zamykania: `SIGKILL`, twarda awaria albo padnięta maszyna.

`process_control_timeout_secs` to czas, jaki proces nadrzędny daje workerowi na dokończenie pracy, zanim zacznie eskalować; ten sam limit obejmuje każdy krok przeładowania kroczącego, więc jeden zakleszczony worker nie zatrzyma całej wymiany - kolejność eskalacji i pełną tabelę sygnałów znajdziesz w [Modelu procesów](/pl/docs/process-model). Trzymaj tę wartość z zapasem poniżej `TimeoutStopSec` z systemd, bo inaczej limit systemd wygaśnie pierwszy i to systemd ubije proces nadrzędny w środku eskalacji.

::: warning Czego przeładowanie nie robi
Proces nadrzędny zostaje przy ustawieniach, z którymi wystartował, a współdzielona pamięć OPcache też należy do niego, więc przeżywa każde pokolenie workerów. Zmiana w `rapira.toml` wymaga `systemctl restart rapira`. A jeśli ustawiłeś `opcache.validate_timestamps = 0`, przeładowanie nadal będzie podawać stare opcode'y - wtedy również restartuj.
:::

## Logi

Rapira zapisuje każdy wpis do logu na **stderr**. Stderr jednostki systemd trafia do journala bez dodatkowej konfiguracji.
Na produkcji używaj JSON-a:

```toml
[log]
level = "info"
format = "json"
```

Każda linia zawiera jeden obiekt z polami `timestamp`, `level`, `target` i `fields`. Obiekt `fields` zawiera `message` oraz pozostałe pola zdarzenia.
Znacznik czasu używa UTC zgodnie z RFC 3339.

```bash
journalctl -u rapira -f
```

Żeby wysłać logi poza maszynę, skieruj swój kolektor na journal tej jednostki albo - jeśli wolisz ominąć journald - uruchom Rapirę ze stderr wpuszczonym rurą prosto do agenta. Tak czy inaczej wpis jest już ustrukturyzowany, więc kolektor nie musi go rozbierać wyrażeniami regularnymi. O poziomach per target i o `RUST_LOG`, które podmienia cały filtr na jedną sesję debugowania, mówią [Logi](/pl/docs/logging).

## Wymiana workerów i limity czasu żądania

W [trybie Worker](/pl/docs/execution-modes) proces zostaje rezydentny, więc powolny wyciek, który pod php-fpm pozostaje niezauważony, kumuluje się z żądania na żądanie. Chronią przed tym dwa ustawienia:

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` zastępuje workera po określonej liczbie żądań. Rapira dodaje małą wartość losową, aby nie zastępować całej puli jednocześnie.
To ustawienie ogranicza wpływ wycieku, ale go nie naprawia.
`request_terminate_timeout_secs` ogranicza czas jednego żądania. Rapira zastępuje workera, który przekroczy tę wartość.
Oba ustawienia są domyślnie wyłączone. Włącz je przed użyciem środowiska produkcyjnego.

Resztę spraw wokół puli - dobór rozmiaru w trybie static, dynamic i ondemand, odczekiwanie przed ponownym forkiem i to, co proces nadrzędny robi po śmierci workera - opisuje [Model procesów](/pl/docs/process-model).
