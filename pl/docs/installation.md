---
title: Instalacja
description: Zainstaluj Rapirę z pakietu deb, rpm albo z archiwum tar. Każdy artefakt ma w środku własne PHP, więc nie musisz najpierw prawidłowo postawić interpretera.
---

# Instalacja

Na Rapirę składa się plik wykonywalny i osadzone w nim PHP. Warto zrozumieć tę drugą część, zanim cokolwiek pobierzesz — działa inaczej niż wszystkie pozostałe narzędzia PHP, jakie masz na maszynie.

Rapira uruchamia PHP przez SAPI embed — interfejs, dzięki któremu program hostuje interpreter jak zwykłą bibliotekę. Potrzebne jest do tego PHP zbudowane z `--enable-embed=shared`, czyli takie, które daje `libphp.so`. Tam, gdzie dystrybucja w ogóle je dostarcza — `php-embedded` w Fedorze i RHEL-u, `php-embed` w Archu, `libphpX.Y-embed` z deb.sury.org w Debianie i Ubuntu — musisz przyjąć jej wersję i jej zestaw rozszerzeń takimi, jakie są (a `php` z Homebrew nie ma SAPI embed w ogóle). Zamiast zostawiać to menedżerowi pakietów, każde wydanie buduje PHP z oficjalnego archiwum źródeł i kładzie wynik tuż obok pliku `rapira`.

## Wybierasz wersję PHP, a nie instalację PHP

Każdy plik do pobrania ma w nazwie `php8.4` albo `php8.5`, a ta etykieta opisuje PHP *w środku* tego pliku. Nie ma kroku „najpierw zainstaluj PHP”, nie ma `php-config`, na który trzeba wskazać, nie ma wersji, którą trzeba trzymać w zgodzie. Jeśli masz już PHP na maszynie — systemowe `php`, pulę php-fpm, build z Homebrew — Rapira ani z niego nie korzysta, ani go nie rusza. To po prostu osobne programy, które akurat uruchamiają ten sam język.

Jedyny wybór, jaki przed Tobą stoi, to wersja, na której ma działać aplikacja: **8.4** albo **8.5**. Wybierz 8.5, chyba że coś w Twoim stosie wciąż trzyma Cię przy 8.4.

Pakiety deb i rpm biorą to dosłownie. `rapira-php8.4` i `rapira-php8.5` instalują dokładnie te same ścieżki, więc oba deklarują `provides`, `conflicts` i `replaces` na wirtualnym pakiecie `rapira`: wykluczają się wzajemnie, a instalacja jednego zajmuje miejsce drugiego, zamiast dokładać się obok. Tak samo zmienia się wersję PHP — zainstaluj ten drugi pakiet, a menedżer pakietów sam dokona podmiany.

## Który plik pobrać

Wszystko leży na [stronie wydań na GitHubie](https://github.com/rapira-rs/rapira/releases). Wydanie `v0.6.0` publikuje poniższe pliki, a każda nazwa z `php8.5` ma swojego bliźniaka z `php8.4`:

| Platforma                           | Artefakt                                     |
| ----------------------------------- | -------------------------------------------- |
| Debian / Ubuntu, x86_64             | `rapira-php8.5_0.6.0-1_amd64.deb`            |
| Debian / Ubuntu, ARM                | `rapira-php8.5_0.6.0-1_arm64.deb`            |
| RHEL / Fedora, x86_64               | `rapira-php8.5-0.6.0-1.x86_64.rpm`           |
| RHEL / Fedora, ARM                  | `rapira-php8.5-0.6.0-1.aarch64.rpm`          |
| Archiwum tar dla Linuksa, x86_64    | `rapira-v0.6.0-php8.5-linux-x86_64.tar.gz`   |
| Archiwum tar dla Linuksa, ARM       | `rapira-v0.6.0-php8.5-linux-aarch64.tar.gz`  |
| macOS, Apple Silicon                | `rapira-v0.6.0-php8.5-macos-aarch64.tar.gz`  |
| Sumy kontrolne wszystkich powyższych | `rapira-v0.6.0-SHA256SUMS.txt`               |

Na Linuksie lepszym domyślnym wyborem jest pakiet: rozkłada pliki tam, gdzie spodziewa się ich dystrybucja, i pozwala `apt` albo `dnf` dociągnąć biblioteki współdzielone, których potrzebuje PHP. Po archiwum tar sięgnij wtedy, gdy serwer ma zmieścić się w jednym samowystarczalnym katalogu — obraz kontenera, artefakt wdrożeniowy, maszyna, na której nie masz roota.

## Debian i Ubuntu

Pobierz `.deb` i podaj `apt` ścieżkę do niego — to wiodące `./` mówi apt, że chodzi o lokalny plik, a nie o nazwę pakietu do wyszukania:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5_0.6.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.6.0-1_amd64.deb
rapira --version
```

Na dysku lądują cztery pliki: program w `/usr/bin/rapira`, dołączony interpreter w `/usr/lib/rapira/libphp.so` oraz licencja i README w `/usr/share/doc/rapira/`. Nic poza tym nie zostaje ruszone — żadnej jednostki usługi, żadnego pliku konfiguracyjnego, żadnego katalogu z plikami ini. Podpięcie Rapiry pod systemd to osobny, świadomy krok, który opisuje [Wdrożenie produkcyjne](/pl/docs/deployment).

Pakiety są budowane pod glibc 2.34, więc najstarsze wydania, na których się zainstalują, to **Debian 12 i Ubuntu 22.04**. Wszystko nowsze działa.

## RHEL, Rocky i Fedora

Ten sam schemat, tyle że z `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5-0.6.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.6.0-1.x86_64.rpm
rapira --version
```

Ten sam próg glibc 2.34 ustawia poprzeczkę na **RHEL 9** i jego pochodne — Rocky 9, AlmaLinux 9 — oraz dowolną aktualną Fedorę.

## Archiwa tar, na Linuksie i macOS

Archiwum rozpakowuje się do jednego katalogu, w którym mieści się cały serwer:

```
rapira-v0.6.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

Na macOS w `lib/rapira` leży `libphp.dylib` razem z całą resztą niesystemowych bibliotek, od których zależy, więc drzewo jest naprawdę samodzielne. Na Linuksie dołączona jest tylko `libphp.so`, a zwykłe biblioteki systemowe — OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib — muszą już być w systemie. Na typowej dystrybucji są; dokładnie tę listę deb i rpm deklarują jako zależności, obok glibc i libgcc.

Umieść katalog tam, gdzie trzymasz takie rzeczy, i podlinkuj program do `PATH`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.6.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

::: warning
Program znajduje swój interpreter przez **względny rpath** — `$ORIGIN/../lib/rapira` na Linuksie, `@loader_path/../lib/rapira` na macOS — liczony od rzeczywistego położenia samego pliku wykonywalnego. Cały katalog możesz przenieść, gdzie chcesz, ale nigdy nie wyjmuj z niego pliku wykonywalnego: `cp bin/rapira /usr/local/bin/` psuje wyszukiwanie, bo obok `/usr/local/bin` nie ma niczego o nazwie `lib/rapira`. Zrób zamiast tego dowiązanie symboliczne, jak wyżej. Loader rozwiązuje dowiązanie, zanim rozwinie rpath, więc symlink może leżeć gdziekolwiek, a prawdziwe drzewo zostaje w całości.
:::

## Sprawdź pobrane pliki

Każde wydanie publikuje jeden plik z sumami kontrolnymi, obejmujący wszystkie jego pliki. To `--ignore-missing` pozwala sprawdzić tylko ten jeden czy dwa pliki, które naprawdę pobierasz:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-SHA256SUMS.txt
sha256sum -c --ignore-missing rapira-v0.6.0-SHA256SUMS.txt
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-SHA256SUMS.txt
shasum -a 256 rapira-v0.6.0-php8.5-macos-aarch64.tar.gz
grep macos-aarch64 rapira-v0.6.0-SHA256SUMS.txt
```

:::

## Co jest w środku

Dołączone PHP buduje się z `--disable-all`, a potem świadomie włącza z powrotem wybrany zestaw rozszerzeń — typową bazę pod aplikacje webowe, a nie wszystko, co istnieje:

- **Podstawy działania** — session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar
- **OPcache** oraz PCRE z włączonym JIT
- **Sieć i kompresja** — openssl, curl, zlib
- **XML** — libxml, dom, xml, simplexml, xmlreader, xmlwriter
- **Bazy danych** — PDO z `pdo_sqlite` oraz `sqlite3`
- Wszystko, co PHP i tak zawsze wkompilowuje — Core, standard, SPL, date, json, hash, random, Reflection

Każde wydanie bierze najnowszą wersję poprawkową gałęzi, którą buduje. Archiwum zapisuje dokładny numer w `share/php/PHP_VERSION.txt`; z poziomu działającego serwera na to samo pytanie odpowiadają `PHP_VERSION` i `phpinfo()`.

::: info Nazwa SAPI
Na PHP 8.4 SAPI rejestruje się jako `fastcgi`, bo OPcache w tej wersji uruchamia się tylko dla zamkniętej listy nazw SAPI, a nazwa spoza listy oznacza brak współdzielonej pamięci podręcznej opcode'ów. PHP 8.5 pozbyło się tej listy, więc tam `PHP_SAPI` i `php_sapi_name()` zwracają `rapira`. Wiersz *Server API* w `phpinfo()` w obu przypadkach pokazuje `Rapira`. Kod, który rozgałęzia się po `PHP_SAPI`, powinien rozpoznawać obie wartości.
:::

Czego w zestawie *nie* ma: `pdo_mysql`, `pgsql`, redis, apcu, imagick i całej reszty z tej rodziny. Jeśli aplikacja któregoś potrzebuje, gotowe artefakty wydania nie pomogą — zbuduj PHP z rozszerzeniami, których chcesz, i skompiluj z nim Rapirę; krok po kroku prowadzi przez to [Budowanie ze źródeł](/pl/docs/build-from-source).

## Nie dostajesz żadnego php.ini

Ani pakiety, ani archiwa nie zawierają `php.ini`, a Rapira sama go nie tworzy. PHP korzysta więc ze swojego zwykłego wyszukiwania: sprawdza najpierw `PHPRC`, potem bieżący katalog roboczy, a na końcu ścieżkę wkompilowaną w build — ta wskazuje wnętrze katalogu, w którym PHP było budowane, więc na Twojej maszynie nigdy nic nie znajdzie. W praktyce nietknięta instalacja działa na wbudowanych ustawieniach domyślnych PHP.

Wskaż konkretny plik albo katalog do przeszukania przez `PHPRC`:

```bash
PHPRC=/etc/rapira/php.ini rapira serve --config /etc/rapira/rapira.toml
```

Pisząc ten plik, warto znać jeden szczegół: PHP szuka `php-<sapi-name>.ini` przed zwykłym `php.ini`, a nazwa SAPI zależy od wersji (patrz wyżej) — dlatego to `php.ini` jest nazwą, która działa i na 8.4, i na 8.5.

## Skąd pochodzą gotowe wydania

Z GitHub Releases i tylko stamtąd — repozytorium apt ani yum jeszcze nie ma, więc aktualizacja polega na pobraniu nowego artefaktu i zainstalowaniu go na starym, a nie na uruchomieniu `apt upgrade`.

Build dla macOS działa **wyłącznie na Apple Silicon**, celuje w **macOS 14 i nowsze** i jest podpisany doraźnie: bez Developer ID, bez notaryzacji, więc przy pierwszym uruchomieniu macOS może poprosić o potwierdzenie. Wersji na Intela nie ma. Wersji na Windows też nie — Rapira to Linux i macOS.

Gdy plik wykonywalny jest już na miejscu, [Szybki start](/pl/docs/quickstart) doprowadzi Cię do pierwszego obsłużonego żądania w jakąś minutę.

::: question Czy przed instalacją Rapiry muszę mieć zainstalowane PHP?
Nie. Każdy artefakt niesie własne `libphp`, zbudowane z SAPI embed, którego Rapira wymaga. Systemowe PHP nie jest ani używane, ani zmieniane — jeśli masz działającego php-fpm, będzie działał dalej, nietknięty.
:::

::: question Czy mogę mieć PHP 8.4 i 8.5 obok siebie?
Z pakietów nie: `rapira-php8.4` i `rapira-php8.5` konfliktują na wirtualnym pakiecie `rapira`, więc naraz zainstalowany może być tylko jeden. Archiwa tar to jednak samowystarczalne katalogi — możesz rozpakować oba i uruchamiać je z różnych ścieżek.
:::

::: question Jak zaktualizować do nowego wydania?
Pobierz nowy artefakt i zainstaluj go tak samo jak poprzedni. Pakiet zastąpi stary w miejscu; przy archiwum rozpakuj nowy katalog obok starego i przestaw dowiązanie symboliczne — wycofanie zmiany to wtedy jedno polecenie.
:::
