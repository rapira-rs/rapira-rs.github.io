---
title: Wdrożenie produkcyjne
description: Jednostka systemd, miejsce na konfigurację, reverse proxy z przodu, przeładowania bez przestoju i logi w JSON-ie — Rapira na prawdziwym serwerze.
---

# Wdrożenie produkcyjne

Na laptopie całą historią jest `rapira serve app/worker.php`. Na serwerze potrzebujesz kilku rzeczy więcej: startu przy rozruchu maszyny, powrotu po awarii, przeładowania nowego kodu bez zgubienia choćby jednego żądania i logów w miejscu, do którego naprawdę da się zajrzeć. Ta strona to operacyjna połowa tej roboty — jednostka systemd, miejsce na konfigurację, proxy z przodu i garść ustawień, które trzymają długowieczne workery w zdrowiu.

Prawie nic z tego nie jest wkompilowane w binarkę. Rapirze jest wszystko jedno, gdzie leży twoja konfiguracja i kto pilnuje procesu, więc układ opisany niżej to konwencja, którą ustala ta strona, a reszta dokumentacji zwyczajnie z niej korzysta. Najpierw jednak wgraj binarkę na maszynę — tym zajmuje się [Instalacja](/pl/docs/installation).

## Jednostka systemd

Pakiety `.deb` i `.rpm` instalują plik wykonywalny i osadzone w nim PHP, i nic poza tym — **żadnej jednostki usługi ani `php.ini`** (dokładną listę plików podaje [Instalacja](/pl/docs/installation)). To decyzja świadoma: jedno i drugie to polityka, która należy do ciebie, a pakiet, który by ją dostarczał, przy każdej aktualizacji nadpisywałby twoje zmiany.

Napisz więc własną. Wrzuć to do `/etc/systemd/system/rapira.service`:

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

Sześć linii zasługuje na słowo komentarza:

- `Type=exec` — Rapira działa na **pierwszym planie** i nigdy nie forkuje się w tło. Trybu demona nie ma i nikt go tu nie chce: proces, który uruchamia systemd, *jest* procesem nadrzędnym, więc `$MAINPID` to dokładnie ten pid, do którego chcesz wysłać sygnał.
- `ExecReload` — zamienia `systemctl reload rapira` w `SIGUSR2` do procesu nadrzędnego, czyli w opisane niżej przeładowanie bez przestoju.
- `KillMode=mixed` — domyślnie systemd wysyła sygnał zatrzymania do każdego procesu w cgrupie, a worker traktuje `SIGTERM` jak natychmiastowe ubicie. `mixed` kieruje go wyłącznie do procesu nadrzędnego, a ten przeprowadza łagodne wygaszanie przez `SIGQUIT`, opisane niżej; `SIGKILL` po `TimeoutStopSec` i tak obejmuje całą grupę. Bez tej linii `systemctl stop` i `systemctl restart` gubią żądania będące w toku.
- `Restart=on-failure` — czyste wygaszenie kończy się kodem zero i serwer zostaje wyłączony, więc ta linia podnosi go z powrotem tylko po awarii albo nieudanym starcie.
- `RuntimeDirectory=rapira` — systemd tworzy `/run/rapira` przy starcie i usuwa przy zatrzymaniu. To tam leżą pidfile i gniazdo uniksowe z poniższych przykładów.
- `Environment=PHPRC` — miejsce, w którym PHP szuka swojego `php.ini`; o tym mówi następna sekcja.

::: tip Nie chcesz działać z prawami roota?
Dodaj `User=` i `Group=` do bloku `[Service]` — systemd przepisze `RuntimeDirectory` na to konto, więc pidfile i gniazdo uniksowe w `/run/rapira/` będą działać dalej. Ścieżki spoza tego katalogu, `/run/rapira.pid` i podobne, leżą w katalogu należącym do roota i nie uda się ich otworzyć.
:::

## Gdzie leży konfiguracja

Konwencja to `/etc/rapira/rapira.toml` na ustawienia samej Rapiry i `php.ini` leżący obok, znajdowany dzięki `PHPRC=/etc/rapira`. Żadna z tych ścieżek nie jest wkompilowana. `--config` przyjmuje dowolną ścieżkę, a `PHPRC` w ogóle nie jest funkcją Rapiry — Rapira nie rusza wyszukiwania plików ini w PHP, więc PHP zagląda najpierw do `$PHPRC`, dokładnie tak jak pod każdym innym SAPI. Jeśli twoja dystrybucja albo twoja rola Ansible woli inne miejsce, wskaż jedno i drugie gdzie indziej.

Zanim napiszesz ten plik, warto wiedzieć jedno: względny `pool.entrypoint` liczy się od katalogu **pliku konfiguracyjnego**, a nie od katalogu roboczego. Przy powyższym układzie `entrypoint = "index.php"` oznaczałby `/etc/rapira/index.php`, a tam twojej aplikacji nie ma. Na produkcji podaj skryptowi wejściowemu ścieżkę bezwzględną, a pytanie w ogóle nie powstanie. Wszystko *pozostałe*, co liczy się względnie, ląduje w katalogu roboczym, a Rapira nigdy nie zmienia katalogu — bez `WorkingDirectory=` systemd uruchamia usługę w `/`, i właśnie dlatego jednostka wyżej ten klucz ustawia (wyszukiwanie ini w samym PHP obejmuje też `.`, więc PHP również tam zajrzy). Każdy klucz razem z wartością domyślną opisuje [Konfiguracja](/pl/docs/configuration).

## Za reverse proxy

Rapira nasłuchuje wyłącznie nieszyfrowanego HTTP: sekcji TLS w konfiguracji nie ma i to celowo. Zakończ TLS na proxy, które i tak już masz — nginx, Caddy, HAProxy, load balancer w chmurze — a do Rapiry pozwól mu sięgać przez pętlę zwrotną albo gniazdo uniksowe. Podpiąć się pod publiczny interfejs oczywiście możesz, ale skoro na tym nasłuchu nie ma TLS-a, rzadko kiedy naprawdę tego chcesz.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Gniazdo uniksowe powstaje z prawami `0666`, więc połączy się z nim wszystko, co dosięgnie tej ścieżki. Jeśli to dla ciebie istotne, umieść gniazdo w katalogu, do którego wejść może tylko użytkownik proxy.

Twoje proxy ma po drodze jeden obowiązek: pola przekazywane dalej muszą mieć zwyczajną pisownię z `-` — `X-Forwarded-For`, nigdy `X_Forwarded_For`. Wersje z podkreśleniem i z kropką lądują pod tym samym kluczem `$_SERVER` co ta prawidłowa, a to właśnie tędy klient mógłby nadpisać to, co przed chwilą ustawiło twoje proxy — dlatego Rapira wycina je, zanim PHP je zobaczy. Mapowanie nazw i sterujący nim klucz `http.unsafe_field_names` opisuje [strona o HTTP](/pl/docs/http).

## Wdrożenia bez przestoju

Wgraj nowy kod, a potem:

```bash
sudo systemctl reload rapira
```

To `SIGUSR2` do procesu nadrzędnego, a ten odpowiada na niego **przeładowaniem kroczącym**: pula wymienia się worker po workerze, żądania w toku dobiegają końca i żadne połączenie nie ginie. Jak przy takiej wymianie świeży worker zachodzi na starego, opisuje [Model procesów](/pl/docs/process-model).

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

`process_control_timeout_secs` to budżet cierpliwości, jaki proces nadrzędny daje workerowi na dokończenie pracy, zanim zacznie eskalować; ten sam limit obejmuje każdy krok przeładowania kroczącego, więc jeden zakleszczony worker nie zatrzyma całej wymiany — drabinę eskalacji i pełną tabelę sygnałów znajdziesz w [Modelu procesów](/pl/docs/process-model). Trzymaj tę wartość z zapasem poniżej `TimeoutStopSec` z systemd, bo inaczej to systemd straci cierpliwość pierwszy i ubije proces nadrzędny w środku eskalacji.

::: warning Przeładowanie wymienia workery, a nie wczytuje niczego na nowo
Proces nadrzędny zostaje przy ustawieniach, z którymi wystartował, a współdzielona pamięć OPcache też należy do niego, więc przeżywa każde pokolenie workerów. Zmiana w `rapira.toml` wymaga `systemctl restart rapira`. A jeśli ustawiłeś `opcache.validate_timestamps = 0`, przeładowanie z czystym sumieniem poda stare opcode'y — wtedy również restartuj.
:::

## Logi

Każdy wpis do logu Rapira pisze na **stderr**, jednym zapisem na wpis, dzięki czemu wyjście procesu nadrzędnego i workerów nigdy nie przeplata się w połowie linii. Stderr jednostki systemd trafia do journala bez żadnej konfiguracji, więc do ustalenia zostaje tylko format — a na produkcji jest nim JSON:

```toml
[log]
level = "info"
format = "json"
```

Jeden obiekt na linię, `timestamp` w RFC 3339 i w UTC, do tego `level`, `message` i `target`; znaki nowej linii wewnątrz komunikatu są ekranowane, więc wpis zawsze zajmuje dokładnie jedną linię. Dokładnie takiego kształtu oczekuje każdy kolektor logów, a podróż przez journald przechodzi on bez szwanku.

```bash
journalctl -u rapira -f
```

Żeby wysłać logi poza maszynę, skieruj swój kolektor na journal tej jednostki albo — jeśli wolisz ominąć journald — uruchom Rapirę ze stderr wpuszczonym rurą prosto do agenta. Tak czy inaczej wpis jest już ustrukturyzowany, więc po drugiej stronie nikt nie musi go rozbierać wyrażeniami regularnymi. O poziomach per target i o `RUST_LOG`, które podmienia cały filtr na jedną sesję debugowania, mówią [Logi](/pl/docs/logging).

## Higiena workerów

Rezydentny proces to cały sens [szczebli z workerem](/pl/docs/execution-modes) — i zarazem powód, dla którego powolny wyciek, którego pod php-fpm nigdy byś nie zauważył, nagle zaczyna mieć znaczenie. Siatką bezpieczeństwa są dwa ustawienia:

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` odsyła workera na emeryturę po tylu żądaniach i forkuje w jego miejsce świeżego, z odrobiną rozrzutu, żeby cała pula nie wymieniała się równym krokiem. To nie jest naprawa wycieku — to coś, co nie pozwala nieznalezionemu wyciekowi zamienić się w awarię o trzeciej w nocy. `request_terminate_timeout_secs` to sufit czasu rzeczywistego dla pojedynczego żądania: worker, który go przekroczy, zostaje ubity i postawiony od nowa, więc jedno zawieszone żądanie nie kosztuje cię workera na stałe. Oba są domyślnie wyłączone i oba warto włączyć, zanim ruszysz z produkcją.

Resztę spraw wokół puli — dobór rozmiaru w trybie static, dynamic i ondemand, odczekiwanie przed ponownym forkiem i to, co proces nadrzędny robi po śmierci workera — opisuje [Model procesów](/pl/docs/process-model).

::: question Czy nadal potrzebuję php-fpm albo menedżera procesów w rodzaju supervisord?
Ani jednego, ani drugiego. Rapira zajmuje miejsce php-fpm, a jej proces nadrzędny już pilnuje puli — forkuje, zbiera zakończone procesy, odtwarza je z narastającym odczekiwaniem, wymienia workery i skaluje pulę. Jedyne zadanie systemd to utrzymanie tego jednego procesu nadrzędnego przy życiu.
:::

::: question Czy mogę uruchomić dwie aplikacje na jednej maszynie?
Tak — dwie konfiguracje, dwie jednostki, dwa adresy nasłuchu. Najporządniej wychodzi to na szablonie jednostki systemd (`rapira@.service`). Każda instancja podnosi własne PHP i własną pulę workerów; nie dzielą ze sobą nic poza maszyną.
:::

::: question Dlaczego pakiet nie instaluje php.ini?
Bo to jedyny plik, który na pewno będziesz edytować, a edytowany plik konfiguracyjny z pakietu to konflikt scalania przy każdej aktualizacji. Rapira zresztą świetnie działa bez niego — jej wbudowane ustawienia ini trzymają diagnostykę PHP w logu, a nie w twoich odpowiedziach, co wyjaśniają [Logi](/pl/docs/logging). Własny `php.ini` w `/etc/rapira` napisz wtedy, gdy zechcesz dostroić OPcache, ustawić limit pamięci albo strefę czasową; cokolwiek w nim ustawisz, ma pierwszeństwo.
:::
