---
title: Wdrożenie produkcyjne
description: "Jak uruchomić Rapirę na serwerze: jednostka systemd, układ konfiguracji, reverse proxy z przodu, przeładowania bez przestoju, logi w JSON-ie i wymiana workerów."
---

# Wdrożenie produkcyjne

Uruchomienie Rapiry na serwerze wymaga tego, bez czego lokalne `rapira serve --mode worker app/worker.php` się obywa: startu przy rozruchu maszyny, powrotu po awarii, przeładowania nowego kodu bez gubienia żądań i logów, które da się potem przeczytać. Ta strona opisuje jednostkę systemd, miejsce na konfigurację, proxy z przodu i ustawienia, które wyznaczają granice długowiecznym workerom.

Prawie nic z tego nie jest wkompilowane w binarkę. Nic w Rapirze nie zależy od tego, gdzie leży twoja konfiguracja ani co pilnuje procesu, więc układ opisany niżej to konwencja, którą ustala ta strona i którą przyjmuje reszta dokumentacji. Najpierw wgraj binarkę na maszynę — tym zajmuje się [Instalacja](/pl/docs/intro/installation).

Rapira wychodzi też jako obraz kontenera w `ghcr.io/rapira-rs/rapira`, który przekopiujesz do własnego obrazu przez `COPY --from`. W kontenerze miejsce poniższej jednostki systemd zajmuje polityka restartów twojego runtime'u kontenerowego; układ konfiguracji, proxy, format logów i ustawienia puli z tej strony zostają bez zmian. Więcej informacji znajdziesz w sekcji [Docker](/pl/docs/intro/installation#docker).

## Jednostka systemd

Rapira zajmuje miejsce php-fpm, a jej proces nadrzędny już pilnuje puli: forkuje, zbiera zakończone procesy, odtwarza je z narastającym odczekiwaniem, wymienia workery i skaluje pulę. Jedynym zadaniem systemd jest utrzymanie tego jednego procesu nadrzędnego przy życiu, więc dla osobnego menedżera procesów w rodzaju supervisord nie zostaje tu nic do roboty.

Pakiety `.deb` i `.rpm` instalują plik wykonywalny i osadzone w nim PHP, i nic poza tym — **żadnej jednostki usługi ani `php.ini`** (dokładną listę plików podaje [Instalacja](/pl/docs/intro/installation)). Jedno i drugie to polityka konkretnej instalacji, a pakiet, który by je dostarczał, przy każdej aktualizacji nadpisywałby twoje zmiany.

Napisz własną w `/etc/systemd/system/rapira.service`:

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

Potem załaduj ją i włącz:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rapira
```

Sześć linii wymaga objaśnienia:

- `Type=exec` — Rapira działa na **pierwszym planie** i nigdy nie forkuje się w tło. Trybu demona nie ma i nie jest potrzebny: proces, który uruchamia systemd, *jest* procesem nadrzędnym, więc `$MAINPID` to dokładnie ten pid, do którego chcesz wysłać sygnał.
- `ExecReload` — zamienia `systemctl reload rapira` w `SIGUSR2` do procesu nadrzędnego, czyli w opisane niżej przeładowanie bez przestoju.
- `KillMode=mixed` — domyślnie systemd wysyła sygnał zatrzymania do każdego procesu w cgrupie, a worker traktuje `SIGTERM` jak natychmiastowe ubicie. `mixed` kieruje go wyłącznie do procesu nadrzędnego, a ten przeprowadza łagodne wygaszanie przez `SIGQUIT`, opisane niżej; `SIGKILL` po `TimeoutStopSec` i tak obejmuje całą grupę. Bez tej linii `systemctl stop` i `systemctl restart` gubią żądania będące w toku.
- `Restart=on-failure` — czyste wygaszenie kończy się kodem zero i serwer zostaje wyłączony, więc ta linia podnosi go z powrotem tylko po awarii albo nieudanym starcie.
- `RuntimeDirectory=rapira` — systemd tworzy `/run/rapira` przy starcie i usuwa przy zatrzymaniu. To tam leżą pidfile i gniazdo uniksowe z poniższych przykładów.
- `Environment=PHPRC` — miejsce, w którym PHP szuka swojego `php.ini`; o tym mówi następna sekcja.

::: tip Uruchamianie na koncie innym niż root
Dodaj `User=` i `Group=` do bloku `[Service]` — systemd przepisze `RuntimeDirectory` na to konto, więc pidfile i gniazdo uniksowe w `/run/rapira/` będą działać dalej. Ścieżki spoza tego katalogu, `/run/rapira.pid` i podobne, leżą w katalogu należącym do roota i nie uda się ich otworzyć.
:::

Dwie aplikacje na jednej maszynie wymagają dwóch konfiguracji, dwóch jednostek i dwóch adresów nasłuchu; użyj do tego szablonu jednostki systemd (`rapira@.service`). Każda instancja podnosi własne PHP i własną pulę workerów i nie dzieli z drugą instancją nic poza maszyną.

## Gdzie leży konfiguracja

Konwencja to `/etc/rapira/rapira.toml` na ustawienia samej Rapiry i `php.ini` leżący obok, znajdowany dzięki `PHPRC=/etc/rapira`. Żadna z tych ścieżek nie jest wkompilowana. `--config` przyjmuje dowolną ścieżkę, a `PHPRC` w ogóle nie jest funkcją Rapiry — Rapira nie rusza wyszukiwania plików ini w PHP, więc PHP zagląda najpierw do `$PHPRC`, dokładnie tak jak pod każdym innym SAPI. Jeśli twoja dystrybucja albo twoja rola Ansible używa innych ścieżek, wskaż jedno i drugie gdzie indziej.

Rapira działa też zupełnie bez `php.ini` — jej wbudowane ustawienia ini trzymają diagnostykę PHP w logu, a nie w twoich odpowiedziach, co wyjaśniają [Logi](/pl/docs/logging). Własny plik w `/etc/rapira` napisz wtedy, gdy zechcesz dostroić OPcache, ustawić limit pamięci albo strefę czasową; cokolwiek w nim ustawisz, ma pierwszeństwo.

Względny `pool.entrypoint` liczy się od katalogu **pliku konfiguracyjnego**, a nie od katalogu roboczego. Przy powyższym układzie `entrypoint = "index.php"` oznaczałby `/etc/rapira/index.php`, a tam twojej aplikacji nie ma. Na produkcji podaj skryptowi wejściowemu ścieżkę bezwzględną, a pytanie w ogóle nie powstanie. `supervisor.pidfile` działa tak samo: obie ścieżki z konfiguracji liczą się od katalogu pliku konfiguracyjnego. Od katalogu roboczego liczą się natomiast argument pozycyjny `SCRIPT` i każda względna ścieżka, którą twój kod PHP otwiera już w trakcie działania, a sama Rapira nigdy nie zmienia katalogu — bez `WorkingDirectory=` systemd uruchamia usługę w `/`, i właśnie dlatego jednostka wyżej ten klucz ustawia (wyszukiwanie ini w samym PHP obejmuje też `.`, więc PHP również tam zajrzy). Każdy klucz razem z wartością domyślną opisuje [Konfiguracja](/pl/docs/configuration).

## Za reverse proxy

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

Pola przekazywane dalej muszą docierać do Rapiry w zwykłej pisowni z `-` — `X-Forwarded-For`, nigdy `X_Forwarded_For`. Wersje z podkreśleniem i z kropką lądują pod tym samym kluczem `$_SERVER` co ta prawidłowa, a to właśnie tędy klient mógłby nadpisać to, co przed chwilą ustawiło twoje proxy — dlatego Rapira wycina je, zanim PHP je zobaczy. Mapowanie nazw i sterujące nim ustawienie `http.unsafe_field_names` opisuje [strona o HTTP](/pl/docs/http).

Zasoby statyczne Rapira potrafi serwować sama, gdy włączysz [middleware plików statycznych](/pl/docs/static-files), więc proxy nie musi trzymać drugiej kopii katalogu z zasobami. Proxy albo CDN przed serwerem nadal pozostaje opcją.

## Wdrożenia bez przestoju

Wgraj nowy kod, a potem:

```bash
sudo systemctl reload rapira
```

To `SIGUSR2` do procesu nadrzędnego, a ten odpowiada na niego **przeładowaniem kroczącym**: pula wymienia się worker po workerze, a żądania w toku dobiegają końca — nic nie ginie, dopóki worker mieści się w `process_control_timeout_secs`. Ten, który się nie zmieści, dostaje `SIGTERM`, potem `SIGKILL`, a jego żądanie w toku przepada (piszemy o tym niżej). Jak przy takiej wymianie świeży worker zachodzi na starego, opisuje [Model procesów](/pl/docs/process-model).

Bez systemd — w entrypoincie kontenera, w skrypcie wdrożeniowym — wyślij sygnał wprost do procesu nadrzędnego. Ustaw `supervisor.pidfile`, a pid będziesz miał pod ręką. Poza systemd nikt nie tworzy `/run/rapira`, więc najpierw załóż ten katalog albo wybierz ścieżkę, która istnieje: proces nadrzędny odmawia startu, gdy nie może zapisać tego pliku.

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Ten plik zapisuje wyłącznie proces nadrzędny — workery nie mają do niego dostępu — i sam go usuwa na każdej ścieżce wyjścia, którą kontroluje. Plik, który został po zgaszonym serwerze, znaczy więc, że proces nadrzędny zginął bez własnego zamykania: `SIGKILL`, twarda awaria albo padnięta maszyna.

`process_control_timeout_secs` to czas, jaki proces nadrzędny daje workerowi na dokończenie pracy, zanim zacznie eskalować; ten sam limit obejmuje każdy krok przeładowania kroczącego, więc jeden zakleszczony worker nie zatrzyma całej wymiany — kolejność eskalacji i pełną tabelę sygnałów znajdziesz w [Modelu procesów](/pl/docs/process-model). Trzymaj tę wartość z zapasem poniżej `TimeoutStopSec` z systemd, bo inaczej limit systemd wygaśnie pierwszy i to systemd ubije proces nadrzędny w środku eskalacji.

::: warning Czego przeładowanie nie robi
Proces nadrzędny zostaje przy ustawieniach, z którymi wystartował, a współdzielona pamięć OPcache też należy do niego, więc przeżywa każde pokolenie workerów. Zmiana w `rapira.toml` wymaga `systemctl restart rapira`. A jeśli ustawiłeś `opcache.validate_timestamps = 0`, przeładowanie nadal będzie podawać stare opcode'y — wtedy również restartuj.
:::

## Logi

Każdy wpis do logu Rapira pisze na **stderr**, jednym zapisem na wpis, dzięki czemu wyjście procesu nadrzędnego i workerów nigdy nie przeplata się w połowie linii. Stderr jednostki systemd trafia do journala bez żadnej konfiguracji, więc do wyboru zostaje tylko format. Na produkcji używaj JSON-a:

```toml
[log]
level = "info"
format = "json"
```

Jeden obiekt na linię, `timestamp` w RFC 3339 i w UTC, do tego `level`, `message` i `target`; znaki nowej linii wewnątrz komunikatu są ekranowane, więc wpis zawsze zajmuje dokładnie jedną linię. Dokładnie takiego kształtu oczekują kolektory logów, a journald przepuszcza go bez zmian.

```bash
journalctl -u rapira -f
```

Żeby wysłać logi poza maszynę, skieruj swój kolektor na journal tej jednostki albo — jeśli wolisz ominąć journald — uruchom Rapirę ze stderr wpuszczonym rurą prosto do agenta. Tak czy inaczej wpis jest już ustrukturyzowany, więc kolektor nie musi go rozbierać wyrażeniami regularnymi. O poziomach per target i o `RUST_LOG`, które podmienia cały filtr na jedną sesję debugowania, mówią [Logi](/pl/docs/logging).

## Wymiana workerów i limity czasu żądania

W [trybie Worker](/pl/docs/execution-modes) proces zostaje rezydentny, więc powolny wyciek, który pod php-fpm pozostaje niezauważony, kumuluje się z żądania na żądanie. Chronią przed tym dwa ustawienia:

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` wycofuje workera po tylu żądaniach i forkuje w jego miejsce świeżego, z odrobiną rozrzutu, żeby cała pula nie wymieniała się równym krokiem. To nie jest naprawa wycieku — to coś, co nie pozwala nieznalezionemu wyciekowi zamienić się w awarię. `request_terminate_timeout_secs` to sufit czasu rzeczywistego dla pojedynczego żądania: worker, który go przekroczy, zostaje ubity i postawiony od nowa, więc jedno zawieszone żądanie nie zajmuje workera na stałe. Oba są domyślnie wyłączone; włącz je, zanim ruszysz z produkcją.

Resztę spraw wokół puli — dobór rozmiaru w trybie static, dynamic i ondemand, odczekiwanie przed ponownym forkiem i to, co proces nadrzędny robi po śmierci workera — opisuje [Model procesów](/pl/docs/process-model).
