---
title: Instalacja
description: "Zainstaluj Rapirę z pakietu deb, RPM lub archiwum tar. Sprawdź sumę kontrolną. Sprawdź, jaką kompilację libphp zawiera artefakt."
faqLevel: 2
---

# Instalacja

Każdy pakiet lub archiwum dla Linuksa lub macOS zawiera plik binarny `rapira` i bibliotekę interpretera `libphp`. Serwer ładuje tę bibliotekę do swojego procesu. Te pakiety i archiwa nie zawierają polecenia `php`, php-fpm ani katalogu z plikami ini. Rapira nie wymaga systemowej instalacji PHP. Pliki ZIP dla Windowsa opisuje sekcja [Windows](#windows).

::: question Czym jest `libphp` i czym różni się od polecenia `php`?
PHP buduje kilka interfejsów do swojego silnika. Te interfejsy to Server Application Programming Interfaces, czyli SAPI. Każdy używa silnika Zend i rozszerzeń, ale ma inny interfejs programu:

| SAPI | Co powstaje | Kto steruje |
| --- | --- | --- |
| CLI | polecenie `php` | PHP: uruchamia się, wykonuje skrypt, kończy pracę. |
| FPM | `php-fpm` | PHP: nasłuchuje na gnieździe i utrzymuje pulę workerów. |
| embed | `libphp.so` | Program hosta: wywołuje interpreter jak każdą inną bibliotekę. |

Rapira zawiera SAPI embed, ponieważ to serwer steruje żądaniami. Polecenie `php` używa innego SAPI, więc artefakty go nie zawierają.
:::

::: question Dlaczego Rapira zawiera własną `libphp`?
PHP musi użyć `--enable-embed=shared`, aby utworzyć `libphp.so`. Niewiele dystrybucji udostępnia taką kompilację. Fedora i RHEL udostępniają `php-embedded`, a Arch udostępnia `php-embed`. Deb.sury.org udostępnia `libphpX.Y-embed` dla Debiana i Ubuntu.

Te pakiety mają stałe wersje PHP i stałe zestawy rozszerzeń. PHP z Homebrew nie zawiera SAPI embed. Dlatego każde wydanie Rapiry buduje `libphp` z oficjalnego archiwum źródeł PHP i dołącza ją do pliku binarnego.
:::

::: question Co znaczy „PHP działa wewnątrz procesu Rapiry”?
Podczas inicjalizacji proces `rapira` ładuje `libphp` do swojej przestrzeni adresowej. Rapira wywołuje funkcje PHP w tym samym procesie. Nie używa gniazda, FastCGI ani serializacji żądań. Biblioteka pozostaje osobnym plikiem obok pliku binarnego. Dlatego nie przenoś pliku binarnego bez biblioteki. Zobacz [Archiwa tar na Linuksie i macOS](#archiwa-tar-na-linuksie-i-macos).
:::

## Wybór wersji PHP

Nazwa każdego pliku do pobrania zawiera `php8.4` lub `php8.5`. Ten tekst określa wersję pomocniczą PHP w jego `libphp`. Wybierz 8.5, chyba że zależność aplikacji wymaga 8.4.

Rapira nie używa ani nie zmienia istniejącego systemowego PHP, puli php-fpm ani PHP z Homebrew. Composer, `bin/console` i `artisan` nadal używają systemowego PHP CLI.

::: question Dlaczego każda wersja PHP ma osobną kompilację Rapiry?
`libphp` w artefakcie jest częścią kompilacji i nie jest wymienna. Plik binarny `rapira` jest zlinkowany z jedną konkretną biblioteką. ABI PHP zmienia się między wersjami pomocniczymi. Dlatego jedna kompilacja Rapiry obsługuje jedną wersję pomocniczą PHP. Nazwa pliku określa tę wersję. Nie musisz instalować PHP ani konfigurować `php-config`.
:::

::: question Jak przejść z 8.4 na 8.5?
Zainstaluj pakiet dla drugiej wersji PHP. Menedżer pakietów zastąpi zainstalowany pakiet Rapiry. Oba pakiety używają tych samych ścieżek. Deklarują `provides`, `conflicts` i `replaces`, a w RPM `obsoletes`. Instalacje z archiwów używają osobnych katalogów i mogą istnieć jednocześnie. Uruchamiaj każdą wersję z jej własnej ścieżki.
:::

## Artefakty wydania

Pliki dla Linuksa i macOS znajdują się na [stronie wydań Rapiry](https://github.com/rapira-rs/rapira/releases). Pliki dla Windowsa znajdują się na [stronie wydań Rapiry dla Windowsa](https://github.com/rapira-rs/rapira-windows/releases). Na [stronie pobierania](/pl/download) wybierz system operacyjny, architekturę, wersję PHP i format pakietu. Strona pokazuje też wartość SHA-256. Każdy artefakt `php8.5` ma odpowiadający mu artefakt `php8.4`.

Na Linuksie użyj pakietu, aby uzyskać standardowe lokalizacje plików i automatyczne zależności bibliotek. Użyj archiwum dla jednego katalogu, obrazu kontenera, artefaktu wdrożenia lub instalacji bez uprawnień roota. Archiwum dla Linuksa wymaga też bibliotek systemowych. Ich listę znajdziesz w sekcji [Archiwa tar na Linuksie i macOS](#archiwa-tar-na-linuksie-i-macos).

Przed instalacją sprawdź plik za pomocą `rapira-v0.9.0-SHA256SUMS.txt`. Zobacz [Weryfikacja sum kontrolnych](#weryfikacja-sum-kontrolnych).

::: question Dlaczego trzeba sprawdzić sumę kontrolną przed instalacją?
Pakiety `.deb` i `.rpm` wykonują skrypty instalacyjne jako root. Zmieniony pakiet może wykonać niepożądany kod z uprawnieniami roota. Weryfikacja sumy kontrolnej wykrywa zmieniony pakiet przed instalacją.
:::

## Debian i Ubuntu

Pobierz plik `.deb`. Zainstaluj go przez `apt`, podając jego ścieżkę:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-php8.5_0.9.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.9.0-1_amd64.deb
rapira --version
```

Pakiet instaluje serwer bez jednostki usługi, pliku konfiguracyjnego i katalogu z plikami ini. Konfigurację systemd opisuje strona [Wdrożenie produkcyjne](/pl/docs/deployment).

Pakiety wymagają glibc 2.34 lub nowszej. Minimalne obsługiwane wersje to **Debian 12 i Ubuntu 22.04**.

::: question Dlaczego ścieżka pliku zaczyna się od `./`?
Początkowe `./` mówi aptowi, aby użył pliku lokalnego zamiast nazwy pakietu z repozytorium.
:::

::: question Jakie pliki instaluje pakiet?
Pakiet instaluje `/usr/bin/rapira`, `/usr/lib/rapira/libphp.so` oraz biblioteki wymagane przez `libphp.so` w `/usr/lib/rapira/`. Na PHP 8.4 instaluje też `/usr/lib/rapira/opcache.so`. Licencję i README instaluje w `/usr/share/doc/rapira/`.
:::

## RHEL, Rocky i Fedora

Zainstaluj pakiet RPM przez `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-php8.5-0.9.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.9.0-1.x86_64.rpm
rapira --version
```

Pakiet RPM wymaga glibc 2.34 lub nowszej. **RHEL 9**, Rocky 9, AlmaLinux 9 i aktualne wersje Fedory spełniają to wymaganie.

## Archiwa tar na Linuksie i macOS

Archiwum rozpakowuje się do jednego katalogu, który zawiera cały serwer:

```text
rapira-v0.9.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

Na Linuksie katalog `lib/rapira` zawiera `libphp.so` i wymagane przez nią biblioteki. Na PHP 8.4 katalog `lib/rapira` zawiera też `opcache.so` na Linuksie i macOS.

Przenieś katalog do jego stałej lokalizacji. Dodaj dowiązanie symboliczne do pliku binarnego w `PATH`:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.9.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.9.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-php8.5-macos-aarch64.tar.gz
tar xzf rapira-v0.9.0-php8.5-macos-aarch64.tar.gz
sudo mv rapira-v0.9.0-php8.5-macos-aarch64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

:::

### Instalacja bez uprawnień roota

Przy instalacji bez uprawnień roota zachowaj cały katalog w katalogu domowym. Utwórz dowiązanie symboliczne w `~/.local/bin`:

```bash
mkdir -p "$HOME/.local/opt" "$HOME/.local/bin"
mv rapira-v0.9.0-php8.5-linux-x86_64 "$HOME/.local/opt/rapira"
ln -s "$HOME/.local/opt/rapira/bin/rapira" "$HOME/.local/bin/rapira"
"$HOME/.local/bin/rapira" --version
```

W systemie macOS zastąp nazwę katalogu źródłowego nazwą rozpakowanego katalogu macOS. Dodaj `$HOME/.local/bin` do `PATH`, jeśli powłoka nie zawiera jeszcze tego katalogu.

::: warning
Plik binarny używa ścieżki względnej, aby znaleźć swój interpreter. Przenoś cały katalog razem. Nie kopiuj samego `bin/rapira` do `/usr/local/bin/`. Użyj dowiązania symbolicznego, jak pokazano powyżej.
:::

::: question Dlaczego dowiązanie symboliczne działa, a kopia pliku binarnego nie?
Plik binarny zawiera **względny rpath** do interpretera. Linux używa `$ORIGIN/../lib/rapira`, a macOS używa `@loader_path/../lib/rapira`. Loader rozwiązuje dowiązanie symboliczne przed rozwiązaniem rpath. Dlatego rpath zaczyna się od rzeczywistej lokalizacji pliku binarnego. Kopia w `/usr/local/bin` nie ma obok siebie katalogu `lib/rapira` i nie może znaleźć interpretera.
:::

::: question Jakich bibliotek systemowych potrzebuje archiwum?
Na macOS katalog `lib/rapira` zawiera `libphp.dylib` i wszystkie wymagane biblioteki niesystemowe. Katalog jest samowystarczalny.

Na Linuksie katalog `lib/rapira` zawiera `libphp.so` i biblioteki z jej kompilacji, takie jak ICU, libxml2, SQLite, Oniguruma i libpq. System musi udostępniać OpenSSL 3, libcurl, zlib i libstdc++. Pakiety deb i RPM deklarują te biblioteki, glibc i libgcc jako zależności.
:::

## Weryfikacja sum kontrolnych

Każde wydanie dla Linuksa i macOS ma jeden plik z sumami kontrolnymi dla wszystkich plików wydania. Sprawdź tylko pobrany plik. Na Linuksie użyj `--ignore-missing`. Na macOS użyj `grep`, aby przekazać wybraną linię do `shasum`:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-SHA256SUMS.txt
sha256sum -c --ignore-missing rapira-v0.9.0-SHA256SUMS.txt
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-SHA256SUMS.txt
grep rapira-v0.9.0-php8.5-macos-aarch64.tar.gz rapira-v0.9.0-SHA256SUMS.txt | shasum -a 256 -c
```

:::

## Docker

Obraz kontenera `ghcr.io/rapira-rs/rapira` zawiera plik binarny `rapira` i jego `libphp.so`. Obraz używa `FROM scratch` i nie ma systemu bazowego, powłoki ani punktu wejścia. Nie może działać samodzielnie. Skopiuj jego pliki do obrazu aplikacji:

```dockerfile
FROM php:8.5-cli-trixie
COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /
RUN apt-get update \
    && xargs -r apt-get install -y --no-install-recommends < /usr/local/share/rapira/debian-packages.txt \
    && rm -rf /var/lib/apt/lists/*
COPY . /app
CMD ["rapira", "serve", "/app/rapira.toml"]
```

Katalog aplikacji zawiera plik `rapira.toml`:

```toml
[http]
listen = ":8000"

[http.pool]
entrypoint = "/app/public/index.php"
mode = "classic"
```

Obraz zawiera `/usr/local/bin/rapira`, `/usr/local/lib/libphp.so` i OPcache. W PHP 8.4 OPcache jest osobnym plikiem `opcache.so` z plikiem ini. W PHP 8.5 jest częścią `libphp.so`.

Obraz zawiera też `bcmath`, `intl`, `pdo_pgsql`, `pgsql`, `igbinary` i `redis` jako moduły współdzielone wraz z plikami INI, które je włączają. Redis obsługuje serializację igbinary.

Katalog `/usr/local/share/rapira` zawiera jeszcze dwa pliki. `PHP_VERSION.txt` zawiera wersję poprawkową dołączonego PHP. `debian-packages.txt` wymienia pakiety potrzebne do uruchomienia `libphp` i jej rozszerzeń współdzielonych. Zainstaluj te pakiety w obrazie aplikacji, także gdy obraz bazowy zawiera PHP.

Proces budowania obrazu używa `libphp.so` z `php:8.4-cli-trixie` lub `php:8.5-cli-trixie`. Dodaje sześć rozszerzeń współdzielonych wymienionych powyżej. Dodaj inne rozszerzenia w obrazie bazowym aplikacji. W obrazie bazowym PHP polecenie `docker-php-ext-install` kompiluje je dla tej samej `libphp.so`.

::: question Dlaczego obraz jest budowany `FROM scratch`?
Obraz scratch zawiera tylko pliki, które build do niego kopiuje. Dlatego `COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /` kopiuje tylko pliki Rapiry. Obraz bazowy aplikacji wybierasz sam.
:::

Każdy tag określa swoją wersję pomocniczą PHP. Te tagi obsługują amd64 i arm64:

| Tag | Na co wskazuje |
| --- | --- |
| `X.Y.Z-php8.4`, `X.Y.Z-php8.5` | Jeden build wydania. Ten tag nigdy się nie zmienia. |
| `X.Y-php8.4`, `X.Y-php8.5` | Najnowsze stabilne wydanie z wersją `X.Y`. |
| `php8.4`, `php8.5` | Najnowsze stabilne wydanie. |
| `nightly-php8.4`, `nightly-php8.5` | Najnowszy build nocny. |

Rejestr zawiera też tagi dla konkretnej architektury, na przykład `X.Y.Z-php8.5-amd64` i `X.Y.Z-php8.5-arm64`.

Tag `latest` nie istnieje. Każda kompilacja Rapiry używa nagłówków jednej wersji pomocniczej PHP. Rapira nie uruchamia się z `libphp.so` z innej wersji pomocniczej PHP. Dlatego każdy tag nazywa wersję pomocniczą PHP, którą zawiera.

::: question Na co wskazuje tag nocny?
Każdy udany przebieg CI na `main` buduje obrazy z tego commita. Build dostaje niezmienny tag `X.Y.Z-nightly.<short-sha>-php8.5`. `X.Y.Z` to wersja repozytorium. `<short-sha>` to pierwsze siedem znaków identyfikatora commita. Tag `nightly-php8.5` wskazuje na ten build. Rejestr przechowuje dziesięć najnowszych buildów nocnych.
:::

## Kompilacja libphp

Pakiety i archiwa wydań dla Linuksa i macOS używają `libphp` zbudowanej z `--disable-all` i następującym stałym zestawem rozszerzeń:

- **Podstawa runtime'u**: session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar, posix.
- **OPcache** oraz PCRE z włączonym JIT. Na PHP 8.4 OPcache jest osobnym plikiem `opcache.so`. Zobacz [php.ini](#php-ini).
- **Sieć i kompresja**: openssl, curl, zlib, sockets, ftp.
- **XML**: libxml, dom, xml, simplexml, xmlreader, xmlwriter.
- **Bazy danych**: PDO z `pdo_sqlite` i `pdo_pgsql`, a także `sqlite3` i `pgsql`.
- **Arytmetyka dziesiętna i internacjonalizacja**: bcmath i intl.
- **Serializacja i pamięć podręczna**: igbinary i redis, z włączoną serializacją igbinary dla Redis.
- **Pamięć współdzielona i System V IPC**: shmop, sysvmsg, sysvsem, sysvshm.
- **Daty, metadane obrazów i tłumaczenia**: calendar, exif, gettext.
- **Interfejs do funkcji zewnętrznych**: ffi.
- **Wymagane komponenty PHP**: Core, standard, SPL, date, json, hash, random, Reflection.

Dla innych rozszerzeń, takich jak `pdo_mysql`, APCu lub Imagick, zbuduj `libphp` z wymaganymi opcjami. Następnie skompiluj Rapirę z tą biblioteką. Zobacz [Budowanie ze źródeł](/pl/docs/intro/build-from-source).

Każdy artefakt używa najnowszej dostępnej wersji poprawkowej swojej serii PHP 8.4 lub PHP 8.5. W archiwum plik `share/php/PHP_VERSION.txt` zawiera dokładną wersję. Na działającym serwerze wersję podają `PHP_VERSION` i `phpinfo()`. Gdy ustawiona jest sekcja `[observability.metrics]`, wersję podaje też etykieta `php_version` metryki `rapira_build_info`. Zobacz [Metryki i kontrole stanu](/pl/docs/observability). `rapira --version` pokazuje tylko wersję Rapiry.

::: question Dlaczego na PHP 8.4 `PHP_SAPI` zwraca `fastcgi`?
Na PHP 8.4 OPcache uruchamia się tylko dla stałej listy nazw SAPI. Rapira rejestruje SAPI jako `fastcgi`, aby włączyć OPcache. PHP 8.5 usunęło tę listę, więc `PHP_SAPI` i `php_sapi_name()` zwracają `rapira`. Wiersz *Server API* w `phpinfo()` pokazuje `Rapira` dla obu wersji. Kod, który sprawdza `PHP_SAPI`, musi akceptować obie wartości.
:::

## php.ini

Pakiety i archiwa dla Linuksa i macOS nie zawierają `php.ini`, a Rapira go nie tworzy. Bez tego pliku PHP używa swoich wbudowanych wartości domyślnych. Rapira zmienia dwie z nich: ustawia `display_errors=0` i `log_errors=1`. Wartość w `php.ini` zastępuje te dwa ustawienia. Zobacz [Logi](/pl/docs/logging). Ustaw `PHPRC` na plik lub katalog wyszukiwania:

```bash
PHPRC=/etc/rapira/php.ini rapira serve /etc/rapira/rapira.toml
```

Na PHP 8.4 OPcache jest osobnym plikiem `opcache.so` w `lib/rapira`. PHP nie ładuje tego pliku automatycznie. Dodaj jego ścieżkę bezwzględną do `php.ini`:

```ini
; pakiet deb lub RPM
zend_extension=/usr/lib/rapira/opcache.so
; archiwum w /opt/rapira
;zend_extension=/opt/rapira/lib/rapira/opcache.so
```

Na PHP 8.5 OPcache jest częścią `libphp`. Ta linia nie jest potrzebna.

::: question Gdzie PHP samo szuka `php.ini`?
PHP najpierw sprawdza `PHPRC`. Potem sprawdza domyślną ścieżkę ustawioną podczas kompilacji PHP. Ta ścieżka zwykle nie istnieje w systemie docelowym. Rapira nie czyta `php.ini` z bieżącego katalogu.
:::

::: question Dlaczego plik nazywa się `php.ini`, a nie `php-rapira.ini`?
PHP najpierw sprawdza `php-<sapi-name>.ini`, a potem `php.ini`. Nazwa SAPI to `fastcgi` na 8.4 i `rapira` na 8.5. Zwykły `php.ini` obsługuje obie wersje.
:::

## Dystrybucja

GitHub Releases zawiera archiwa, pakiety i pliki z sumami kontrolnymi. `ghcr.io/rapira-rs/rapira` zawiera obrazy kontenerów. Repozytorium apt ani yum nie jest jeszcze dostępne. Aby zaktualizować pakiet, pobierz i zainstaluj nową wersję. Menedżer pakietów zastąpi zainstalowaną wersję.

Aby zaktualizować archiwum, rozpakuj nowy katalog obok starego katalogu. Następnie zmień dowiązanie symboliczne. Zachowaj poprzedni katalog, jeśli musisz go przywrócić.

Każdy udany przebieg CI na `main` przesyła archiwa i plik z sumami kontrolnymi do przedwydania `nightly` w GitHub Releases, z wyjątkiem commitów wydania. Przedwydanie nie zawiera pakietów `.deb` ani `.rpm`. Build nocny nie jest wydaniem. Tagi nocne kontenerów opisuje sekcja [Docker](#docker). Link do buildów nocnych znajdziesz na [stronie pobierania](/pl/download).

Build dla macOS obsługuje **Apple Silicon** i **macOS 26 lub nowszy**. Minimalna wersja to główna wersja macOS runnera GitHub `macos-latest`, który buduje wydanie. Build używa podpisu ad hoc bez Developer ID i bez notaryzacji. macOS może poprosić o potwierdzenie przed pierwszym uruchomieniem. Build dla Intela nie istnieje.

## Windows {#windows}

[rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows) udostępnia buildy dla Windowsa do lokalnego developmentu. W produkcji używaj Linuksa lub macOS. Najnowsze stabilne wydanie dla Windowsa to v0.8.0. Jego konfigurację i zestaw rozszerzeń opisuje [README wydania](https://github.com/rapira-rs/rapira-windows/blob/v0.8.0/README.md).

Build x64 obsługuje Windows 10, Windows 11 i Windows Server. Build ARM64 obsługuje Windows 11. Zainstaluj [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) dla wybranej architektury. Wypakuj cały ZIP do jednego katalogu. Zachowaj razem `rapira.exe`, pasujące środowisko ZTS PHP, biblioteki DLL rozszerzeń i `php.ini`.

Windows v0.8.0 obsługuje tylko HTTP. Jego konfiguracja używa tabeli `[pool]` na najwyższym poziomie. Uruchom go z wypakowanego katalogu:

```powershell
.\rapira.exe serve --config C:\app\rapira.toml
```

To wydanie nie obsługuje konfiguracji szybkiego startu v0.9 ani gRPC. Jego profil PHP nie zawiera OpenSSL, cURL, SQLite, XML ani iconv. Każde wydanie dla Windowsa ma jeden plik `rapira-v<VERSION>-windows-<x86_64|arm64>-SHA256SUMS.txt` dla każdej architektury.

[Bieżące źródła dla Windowsa](https://github.com/rapira-rs/rapira-windows/blob/main/README.md) implementują konfigurację pluginów v0.9 i gRPC. Używają `rapira serve CONFIG` i oddzielnej puli wątków interpretera dla każdego pluginu. Odrzucają `[observability]`, `grpc.interceptors` i `[grpc.auth]`. Te funkcje źródeł nie są dostępne w stabilnym wydaniu v0.8.0 do pobrania.

[Szybki start](/pl/docs/intro/quickstart) wyjaśnia, jak obsłużyć pierwsze żądanie po instalacji pliku binarnego.
