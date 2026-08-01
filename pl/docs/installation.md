---
title: Instalacja
description: "Zainstaluj Rapirę z pakietu deb, rpm albo z archiwum tar, sprawdź sumę kontrolną pobranego pliku i zobacz, jakie PHP zawiera każdy artefakt."
---

# Instalacja

Na Rapirę składa się plik wykonywalny i osadzone w nim PHP.

Rapira uruchamia PHP przez SAPI embed — interfejs, dzięki któremu program hostuje interpreter jak zwykłą bibliotekę. Potrzebne jest do tego PHP zbudowane z `--enable-embed=shared`, czyli takie, które daje `libphp.so`. Tam, gdzie dystrybucja w ogóle je dostarcza — `php-embedded` w Fedorze i RHEL-u, `php-embed` w Archu, `libphpX.Y-embed` z deb.sury.org w Debianie i Ubuntu — musisz przyjąć jej wersję i jej zestaw rozszerzeń takimi, jakie są (a `php` z Homebrew nie ma SAPI embed w ogóle). Każde wydanie Rapiry buduje PHP z oficjalnego archiwum źródeł i kładzie wynik obok pliku `rapira`.

## Wybór wersji PHP

Każdy plik do pobrania ma w nazwie `php8.4` albo `php8.5`, a ta etykieta opisuje PHP *w środku* tego pliku. Nie ma kroku „najpierw zainstaluj PHP”, nie ma `php-config`, na który trzeba wskazać, nie ma wersji, którą trzeba trzymać w zgodzie. Jeśli masz już PHP na maszynie — systemowe `php`, pulę php-fpm, build z Homebrew — Rapira ani z niego nie korzysta, ani go nie rusza. Żaden artefakt nie zawiera polecenia `php`, więc narzędzia wokół aplikacji — Composer, `bin/console`, `artisan` — nadal potrzebują własnego PHP w wierszu poleceń.

Jedyny wybór to wersja, na której działa aplikacja: **8.4** albo **8.5**. Użyj 8.5, chyba że coś w Twoim stosie wymaga 8.4.

Pakiety deb i rpm to wymuszają. `rapira-php8.4` i `rapira-php8.5` instalują dokładnie te same ścieżki, więc oba deklarują `provides`, `conflicts` i `replaces` (w rpm: `obsoletes`) na wirtualnym pakiecie `rapira`: wykluczają się wzajemnie, a instalacja jednego zajmuje miejsce drugiego, zamiast dokładać się obok. Tak samo zmienia się wersję PHP — zainstaluj ten drugi pakiet, a menedżer pakietów sam dokona podmiany. Archiwa tar się nie wykluczają: każde rozpakowuje się do własnego katalogu, więc drzewo 8.4 i drzewo 8.5 mogą stać obok siebie i działać z różnych ścieżek.

## Artefakty wydania

Wszystko leży na [stronie wydań na GitHubie](https://github.com/rapira-rs/rapira/releases). Wydanie `v0.6.0` publikuje poniższe pliki, a każda nazwa z `php8.5` ma swój odpowiednik z `php8.4`:

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

Na Linuksie wybierz pakiet, jeśli chcesz, żeby pliki trafiły tam, gdzie spodziewa się ich dystrybucja, a `apt` albo `dnf` dociągnęły biblioteki współdzielone potrzebne PHP; wybierz archiwum tar, jeśli serwer ma zmieścić się w jednym samowystarczalnym katalogu — obraz kontenera, artefakt wdrożeniowy, maszyna, na której nie masz roota. Jedno i drugie przed instalacją porównaj z `rapira-v0.6.0-SHA256SUMS.txt`, bo `.deb` i `.rpm` uruchamiają swoje skrypty instalacyjne jako root. Polecenia znajdziesz w sekcji [Weryfikacja sum kontrolnych](#weryfikacja-sum-kontrolnych).

## Debian i Ubuntu

Pobierz `.deb` i zainstaluj go przez `apt`, podając ścieżkę — to wiodące `./` mówi apt, że chodzi o lokalny plik, a nie o nazwę pakietu do wyszukania:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5_0.6.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.6.0-1_amd64.deb
rapira --version
```

Pakiet instaluje cztery pliki: program w `/usr/bin/rapira`, dołączony interpreter w `/usr/lib/rapira/libphp.so` oraz licencję i README w `/usr/share/doc/rapira/`. Nic poza tym nie zostaje ruszone — żadnej jednostki usługi, żadnego pliku konfiguracyjnego, żadnego katalogu z plikami ini. Uruchamianie Rapiry pod systemd to osobny krok, opisany na stronie [Wdrożenie produkcyjne](/pl/docs/deployment).

Pakiety są budowane pod glibc 2.34, więc najstarsze wydania, na których się zainstalują, to **Debian 12 i Ubuntu 22.04**. Wszystko nowsze działa.

## RHEL, Rocky i Fedora

Ten sam schemat, tyle że z `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5-0.6.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.6.0-1.x86_64.rpm
rapira --version
```

Ten sam próg glibc 2.34 ustawia minimum na **RHEL 9** i jego pochodne — Rocky 9, AlmaLinux 9 — oraz dowolną aktualną Fedorę.

## Archiwa tar, na Linuksie i macOS

Archiwum rozpakowuje się do jednego katalogu, w którym mieści się cały serwer:

```text
rapira-v0.6.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

Na macOS w `lib/rapira` leży `libphp.dylib` razem z całą resztą niesystemowych bibliotek, od których zależy, więc drzewo jest samodzielne. Na Linuksie dołączona jest tylko `libphp.so`, a zwykłe biblioteki systemowe — OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib — muszą już być w systemie. Na typowej dystrybucji są; dokładnie tę listę deb i rpm deklarują jako zależności, obok glibc i libgcc.

Przenieś katalog do jego docelowej lokalizacji i podlinkuj program do `PATH`:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.6.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-php8.5-macos-aarch64.tar.gz
tar xzf rapira-v0.6.0-php8.5-macos-aarch64.tar.gz
sudo mv rapira-v0.6.0-php8.5-macos-aarch64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

:::

::: warning
Program znajduje swój interpreter przez **względny rpath** — `$ORIGIN/../lib/rapira` na Linuksie, `@loader_path/../lib/rapira` na macOS — liczony od rzeczywistego położenia samego pliku wykonywalnego. Cały katalog można przenieść gdziekolwiek, ale plik wykonywalny musi zostać w środku: `cp bin/rapira /usr/local/bin/` psuje wyszukiwanie, bo obok `/usr/local/bin` nie ma niczego o nazwie `lib/rapira`. Zrób zamiast tego dowiązanie symboliczne, jak wyżej. Loader rozwiązuje dowiązanie, zanim rozwinie rpath, więc symlink może leżeć gdziekolwiek, a prawdziwe drzewo zostaje w całości.
:::

## Weryfikacja sum kontrolnych

Każde wydanie publikuje jeden plik z sumami kontrolnymi, obejmujący wszystkie jego artefakty, więc sprawdzanie musi wybrać z niego tylko te pliki, które pobrałeś. Na Linuksie robi to `--ignore-missing`; na macOS `grep` podaje `shasum` jedyny potrzebny wiersz:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-SHA256SUMS.txt
sha256sum -c --ignore-missing rapira-v0.6.0-SHA256SUMS.txt
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-SHA256SUMS.txt
grep rapira-v0.6.0-php8.5-macos-aarch64.tar.gz rapira-v0.6.0-SHA256SUMS.txt | shasum -a 256 -c
```

:::

## Dołączone PHP

Dołączone PHP buduje się z `--disable-all`, a potem włącza z powrotem stały zestaw rozszerzeń:

- **Podstawy działania** — session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar
- **OPcache** oraz PCRE z włączonym JIT
- **Sieć i kompresja** — openssl, curl, zlib
- **XML** — libxml, dom, xml, simplexml, xmlreader, xmlwriter
- **Bazy danych** — PDO z `pdo_sqlite` oraz `sqlite3`
- Wszystko, co PHP i tak zawsze wkompilowuje — Core, standard, SPL, date, json, hash, random, Reflection

Każde wydanie bierze najnowszą wersję poprawkową gałęzi, którą buduje. Archiwum zapisuje dokładny numer w `share/php/PHP_VERSION.txt`; z poziomu działającego serwera podają go `PHP_VERSION` i `phpinfo()`.

::: info Nazwa SAPI
Na PHP 8.4 SAPI rejestruje się jako `fastcgi`, bo OPcache w tej wersji uruchamia się tylko dla zamkniętej listy nazw SAPI, a nazwa spoza listy oznacza brak współdzielonej pamięci podręcznej opcode'ów. PHP 8.5 pozbyło się tej listy, więc tam `PHP_SAPI` i `php_sapi_name()` zwracają `rapira`. Wiersz *Server API* w `phpinfo()` w obu przypadkach pokazuje `Rapira`. Kod, który rozgałęzia się po `PHP_SAPI`, powinien rozpoznawać obie wartości.
:::

Czego w zestawie *nie* ma: `pdo_mysql`, `pgsql`, redis, apcu, imagick i całej reszty z tej rodziny. Jeśli aplikacja któregoś potrzebuje, zbuduj PHP z rozszerzeniami, których chcesz, i skompiluj z nim Rapirę. Więcej informacji znajdziesz na stronie [Budowanie ze źródeł](/pl/docs/build-from-source).

## php.ini

Ani pakiety, ani archiwa nie zawierają `php.ini`, a Rapira sama go nie tworzy. PHP korzysta więc ze swojego zwykłego wyszukiwania: sprawdza najpierw `PHPRC`, potem bieżący katalog roboczy, a na końcu ścieżkę wkompilowaną w build — ta wskazuje wnętrze katalogu, w którym PHP było budowane, więc na Twojej maszynie nigdy nic nie znajdzie. Nietknięta instalacja działa zatem na wbudowanych ustawieniach domyślnych PHP.

Wskaż konkretny plik albo katalog do przeszukania przez `PHPRC`:

```bash
PHPRC=/etc/rapira/php.ini rapira serve --config /etc/rapira/rapira.toml
```

PHP szuka `php-<sapi-name>.ini` przed zwykłym `php.ini`, a nazwa SAPI zależy od wersji (patrz wyżej), dlatego to `php.ini` jest nazwą, która działa i na 8.4, i na 8.5.

## Dystrybucja

Gotowe buildy są publikowane w GitHub Releases i nigdzie indziej. Repozytorium apt ani yum jeszcze nie ma, więc aktualizacja polega na pobraniu nowego artefaktu i zainstalowaniu go na starym, a nie na uruchomieniu `apt upgrade`. Pakiet zastępuje w miejscu ten już zainstalowany; przy archiwum tar rozpakuj nowy katalog obok starego i przestaw dowiązanie symboliczne — poprzednie drzewo zostaje na dysku, więc wycofanie zmiany to jedno polecenie.

Build dla macOS działa **wyłącznie na Apple Silicon**, celuje w **macOS 14 i nowsze** i jest podpisany doraźnie: bez Developer ID, bez notaryzacji, więc przy pierwszym uruchomieniu macOS może poprosić o potwierdzenie. Wersji na Intela nie ma. Wersji na Windows też nie — Rapira działa tylko na Linuksie i macOS.

[Szybki start](/pl/docs/quickstart) opisuje, jak obsłużyć pierwsze żądanie, gdy plik wykonywalny jest już na miejscu.
