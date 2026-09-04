---
title: Instalacja
description: "Zainstaluj Rapirę z pakietu deb, rpm albo z archiwum tar, sprawdź sumę kontrolną pobranego pliku i zobacz, jaką kompilację libphp zawiera każdy artefakt."
faqLevel: 2
---

# Instalacja

Rapira to binarka `rapira` i leżąca obok niej `libphp` - interpreter PHP, który serwer ładuje do własnego procesu. W artefakcie nie ma nic poza tym: żadnego polecenia `php`, żadnego php-fpm, żadnego katalogu z plikami ini. Żeby Rapira ruszyła, nie musisz instalować PHP na maszynie.

::: question Czym jest `libphp` i dlaczego to nie jest „zwykłe PHP”?
Z tych samych źródeł PHP powstaje kilka interfejsów do silnika, nazywanych SAPI. Silnik za każdym razem jest ten sam - Zend wraz z rozszerzeniami; różni się tylko otoczka i to, kto prowadzi program:

| SAPI | Co powstaje | Kto rządzi |
| --- | --- | --- |
| CLI | polecenie `php` | PHP: startuje, wykonuje skrypt, kończy pracę. |
| FPM | `php-fpm` | PHP: samo nasłuchuje na gnieździe i utrzymuje pulę workerów. |
| embed | `libphp.so` | Program hosta: wywołuje interpreter jak każdą inną bibliotekę. |

Rapira dostarcza kompilację embed, bo to serwer prowadzi żądanie, a nie PHP. Polecenie `php` należy do innego SAPI i do innego zadania, więc w artefakcie go nie ma.
:::

::: question Dlaczego `libphp` nie jest brana z systemu?
Potrzebne jest PHP skompilowane z `--enable-embed=shared` - tylko taka kompilacja daje `libphp.so`. Dystrybucje rzadko ją pakują, a tam, gdzie jest - `php-embedded` w Fedorze i RHEL-u, `php-embed` w Archu, `libphpX.Y-embed` z deb.sury.org w Debianie i Ubuntu - wersję pomocniczą i zestaw rozszerzeń bierzesz takie, jakie są; w `php` z Homebrew SAPI embed nie ma w ogóle. Dlatego każde wydanie Rapiry kompiluje `libphp` z oficjalnego archiwum źródeł PHP i kładzie ją obok binarki.
:::

::: question Co znaczy, że „PHP działa wewnątrz procesu Rapiry”?
Przy starcie `libphp` trafia do przestrzeni adresowej procesu `rapira`, więc sięgnięcie do PHP jest wywołaniem funkcji w tej samej pamięci: bez gniazda, bez FastCGI, bez serializowania żądania i odpowiedzi. To opis tego, jak wykonuje się kod - jako plik biblioteka pozostaje osobna i leży obok binarki, dlatego binarka nie może opuścić swojego katalogu bez niej (zobacz [Archiwa tar, na Linuksie i macOS](#archiwa-tar-na-linuksie-i-macos)).
:::

## Wybór wersji PHP

W nazwie każdego pliku do pobrania stoi `php8.4` albo `php8.5` - to wersja PHP, z której źródeł zbudowano `libphp` w środku. Wybierz wersję pomocniczą, na której działa twoja aplikacja, i bierz 8.5, chyba że coś w twoim stosie wymaga 8.4.

PHP, które już masz na maszynie - systemowe `php`, pula php-fpm, kompilacja z Homebrew - Rapira ani nie używa, ani nie rusza. Żaden artefakt nie zawiera polecenia `php`, więc Composer, `bin/console` i `artisan` nadal działają na twoim własnym PHP CLI.

::: question Dlaczego każda wersja PHP ma osobną kompilację Rapiry?
`libphp` w artefakcie nie jest wymienną zależnością, tylko częścią kompilacji: binarka `rapira` jest zlinkowana z jedną konkretną biblioteką, a jej ABI zmienia się między wersjami pomocniczymi PHP. Dlatego jedna kompilacja Rapiry obsługuje dokładnie jedną gałąź PHP, a wersja trafiła do nazwy pliku. W zamian nie ma kroku „najpierw zainstaluj PHP”, nie ma `php-config`, na który trzeba wskazać, ani wersji, którą trzeba trzymać w zgodzie.
:::

::: question Jak przejść z 8.4 na 8.5?
Zainstaluj pakiet z drugą wersją, a podmianę zrobi menedżer pakietów. `rapira-php8.4` i `rapira-php8.5` zajmują dokładnie te same ścieżki, więc oba deklarują `provides`, `conflicts` i `replaces` (w rpm - `obsoletes`) na wirtualny pakiet `rapira`: nigdy nie stoją obok siebie, drugi zastępuje pierwszy. Archiwa się nie wykluczają - każde rozpakowuje się do własnego katalogu, więc drzewo 8.4 i drzewo 8.5 mogą leżeć obok siebie i uruchamiać się z różnych ścieżek.
:::

## Artefakty wydania

Pliki dla Linuksa i macOS znajdują się na [stronie wydań Rapiry](https://github.com/rapira-rs/rapira/releases). Pliki dla Windowsa znajdują się na [stronie wydań Rapiry dla Windowsa](https://github.com/rapira-rs/rapira-windows/releases). [Strona pobierania](/pl/download) sama dobierze artefakt do twojej platformy - systemu, architektury, wersji PHP, formatu pakietu - i pokaże jego SHA-256; każdy artefakt `php8.5` ma bliźniaka `php8.4`.

Na Linuksie weź pakiet, jeśli chcesz, żeby pliki trafiły tam, gdzie spodziewa się ich dystrybucja, a `apt` albo `dnf` dociągnęły biblioteki współdzielone potrzebne PHP; weź archiwum, jeśli cały serwer ma się zmieścić w jednym katalogu - obraz kontenera, artefakt wdrożenia, maszyna bez roota.
Na Linuksie archiwum wymaga też bibliotek systemowych. Ich listę znajdziesz w sekcji [Archiwa tar, na Linuksie i macOS](#archiwa-tar-na-linuksie-i-macos).

W obu przypadkach sprawdź plik z `rapira-v0.8.0-SHA256SUMS.txt` przed instalacją - polecenia znajdziesz w sekcji [Weryfikacja sum kontrolnych](#weryfikacja-sum-kontrolnych).

::: question Po co sprawdzać sumę kontrolną przed instalacją?
`.deb` i `.rpm` wykonują swoje skrypty instalacyjne jako root, więc podmieniony plik dostaje roota, zanim w ogóle uruchomisz serwer. Sprawdzenie to jedno polecenie i tyle wystarczy, żeby zdjąć to ryzyko.
:::

## Debian i Ubuntu

Pobierz `.deb` i zainstaluj go przez `apt`, podając ścieżkę:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-php8.5_0.8.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.8.0-1_amd64.deb
rapira --version
```

Pakiet instaluje sam serwer i nic poza tym: nie dodaje ani jednostki usługi, ani pliku konfiguracyjnego, ani katalogu z ini. Uruchomienie Rapiry pod systemd to osobny krok, opisany na stronie [Wdrożenie produkcyjne](/pl/docs/deployment).

Pakiety są budowane pod glibc 2.34, więc najstarsze systemy, na których się zainstalują, to **Debian 12 i Ubuntu 22.04**. Wszystko nowsze działa.

::: question Po co `./` przed nazwą pliku?
To właśnie początkowe `./` mówi aptowi, że chodzi o plik lokalny, a nie o nazwę pakietu do wyszukania w repozytoriach.
:::

::: question Jakie pliki pojawią się w systemie?
Cztery: binarka `/usr/bin/rapira`, interpreter `/usr/lib/rapira/libphp.so` oraz licencja i README w `/usr/share/doc/rapira/`. Poza tym pakiet niczego nie zmienia.
:::

## RHEL, Rocky i Fedora

Zainstaluj pakiet RPM przez `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-php8.5-0.8.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.8.0-1.x86_64.rpm
rapira --version
```

Ten sam próg glibc 2.34 wyznacza minimum: **RHEL 9** i jego przebudowy - Rocky 9, AlmaLinux 9 - plus dowolna aktualna Fedora.

## Archiwa tar na Linuksie i macOS

Archiwum rozpakowuje się do jednego katalogu, w którym leży cały serwer:

```text
rapira-v0.8.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

Przenieś katalog tam, gdzie ma zostać na stałe, i dodaj binarkę do `PATH` przez dowiązanie symboliczne:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.8.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.8.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-php8.5-macos-aarch64.tar.gz
tar xzf rapira-v0.8.0-php8.5-macos-aarch64.tar.gz
sudo mv rapira-v0.8.0-php8.5-macos-aarch64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

:::

### Instalacja bez uprawnień roota

Przy instalacji bez uprawnień roota zachowaj cały katalog w katalogu domowym. Utwórz dowiązanie symboliczne w `~/.local/bin`:

```bash
mkdir -p "$HOME/.local/opt" "$HOME/.local/bin"
mv rapira-v0.8.0-php8.5-linux-x86_64 "$HOME/.local/opt/rapira"
ln -s "$HOME/.local/opt/rapira/bin/rapira" "$HOME/.local/bin/rapira"
"$HOME/.local/bin/rapira" --version
```

W systemie macOS zastąp nazwę katalogu źródłowego nazwą rozpakowanego katalogu macOS. Dodaj `$HOME/.local/bin` do `PATH`, jeśli powłoka nie zawiera jeszcze tego katalogu.

::: warning
Binarka szuka swojego interpretera obok siebie, więc katalog można przenosić tylko w całości: `cp bin/rapira /usr/local/bin/` psuje uruchomienie. Do `PATH` dodawaj dowiązanie symboliczne, tak jak w poleceniach wyżej.
:::

::: question Dlaczego dowiązanie działa, a kopia binarki nie?
Ścieżka do interpretera jest wpisana w binarkę jako **względny rpath** - `$ORIGIN/../lib/rapira` na Linuksie i `@loader_path/../lib/rapira` na macOS - a punktem odniesienia jest rzeczywiste położenie samej binarki. Obok `/usr/local/bin` nie ma żadnego `lib/rapira`, więc kopia nie znajdzie interpretera. Dowiązanie loader najpierw rozwiązuje, a dopiero potem rozwija rpath, więc link może leżeć gdziekolwiek, a prawdziwe drzewo zostaje nienaruszone.
:::

::: question Jakich bibliotek systemowych potrzebuje archiwum?
Na macOS w `lib/rapira` leży `libphp.dylib` razem ze wszystkimi niesystemowymi bibliotekami, od których zależy - drzewo jest samowystarczalne. Na Linuksie w komplecie jest tylko `libphp.so`, a zwyczajne biblioteki systemowe - OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib - muszą już być w systemie. W typowej dystrybucji i tak są; to dokładnie one figurują jako zależności pakietów deb i rpm, obok glibc i libgcc.
:::

## Weryfikacja sum kontrolnych

Każde wydanie ma jeden plik z sumami dla wszystkich swoich artefaktów, więc przy weryfikacji trzeba wybrać tylko te, które pobrałeś. Na Linuksie robi to flaga `--ignore-missing`, a na macOS `grep` podaje `shasum` dokładnie tę jedną potrzebną linię:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-SHA256SUMS.txt
sha256sum -c --ignore-missing rapira-v0.8.0-SHA256SUMS.txt
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-SHA256SUMS.txt
grep rapira-v0.8.0-php8.5-macos-aarch64.tar.gz rapira-v0.8.0-SHA256SUMS.txt | shasum -a 256 -c
```

:::

## Docker

`ghcr.io/rapira-rs/rapira` to obraz kontenera z binarką `rapira` i biblioteką `libphp.so`, pod którą została zbudowana. Obraz powstaje `FROM scratch`: nie ma w nim ani systemu bazowego, ani powłoki, ani entrypointa, więc sam z siebie nie ruszy. Jego zawartość kopiujesz do własnego obrazu:

```dockerfile
FROM php:8.5-cli-trixie
COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /
COPY . /app
CMD ["rapira", "serve", "--listen", ":8000", "--mode", "classic", "/app/public/index.php"]
```

W obrazie leżą `/usr/local/bin/rapira`, `/usr/local/lib/libphp.so` i OPcache. Na PHP 8.4 OPcache jest osobnym `opcache.so` z własnym plikiem ini, a na PHP 8.5 jest wlinkowany w `libphp.so`. W `/usr/local/share/rapira` czekają jeszcze dwa pliki: `PHP_VERSION.txt` z wersją łatki dołączonej `libphp` oraz `debian-packages.txt` z pakietami Debiana, których `libphp` potrzebuje na obrazie bazowym bez PHP.

`libphp.so` z obrazu pochodzi z oficjalnego obrazu bazowego PHP, na którym powstał build: `php:8.4-cli-trixie` albo `php:8.5-cli-trixie`. Niesie więc zestaw rozszerzeń tamtego obrazu, a nie zestaw `--disable-all` opisany w sekcji [Kompilacja libphp](#kompilacja-libphp). Kolejne rozszerzenia dokładasz na własnym obrazie bazowym: na obrazie z PHP skompilujesz je pod tę samą `libphp.so` przez `docker-php-ext-install`.

::: question Dlaczego obraz powstaje `FROM scratch`?
W obrazie scratch nie ma nic poza tym, co wkopiuje build, więc `COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /` bierze sam ładunek i nic więcej. Obraz bazowy zostaje twoim wyborem, a kopiowanie nie dokłada na niego drugiej dystrybucji.
:::

Każdy tag nazywa swoją wersję pomocniczą PHP, a tagi z tabeli niżej są wieloarchitekturowe: każdy obejmuje amd64 i arm64.

| Tag | Na co wskazuje |
| --- | --- |
| `X.Y.Z-php8.4`, `X.Y.Z-php8.5` | Jeden build wydania. Ten tag nigdy się nie przesuwa. |
| `X.Y-php8.4`, `X.Y-php8.5` | Najnowsze stabilne wydanie z wersją `X.Y`. |
| `php8.4`, `php8.5` | Najnowsze stabilne wydanie. |
| `nightly-php8.4`, `nightly-php8.5` | Najnowszy build nocny. |

W rejestrze leżą też tagi jednoarchitekturowe, które build tworzy najpierw, na przykład `X.Y.Z-php8.5-amd64` i `X.Y.Z-php8.5-arm64`.

Taga `latest` nie ma. Rapira wiąże struktury Zenda w czasie kompilacji i odmawia startu z `libphp.so` z innej wersji pomocniczej PHP, więc każdy tag musi nazywać wersję, którą niesie.

::: question Na co wskazuje tag nocny?
Każdy przebieg CI, który przejdzie na `main`, buduje obrazy na nowo z tego commita. Build dostaje niezmienny tag `X.Y.Z-nightly.<short-sha>-php8.5`, gdzie `X.Y.Z` to wersja, którą repozytorium akurat niesie, a `<short-sha>` to siedem pierwszych znaków commita. Ruchomy tag `nightly-php8.5` idzie za tym buildem. Rejestr trzyma dziesięć najnowszych buildów nocnych, a starsze kasuje.
:::

## Kompilacja libphp

Rapira buduje `libphp` z `--disable-all` i włącza stały zestaw rozszerzeń:

- **Podstawa runtime'u**: session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar, posix.
- **OPcache** oraz PCRE z włączonym JIT-em.
- **Sieć i kompresja**: openssl, curl, zlib, sockets, ftp.
- **XML**: libxml, dom, xml, simplexml, xmlreader, xmlwriter.
- **Bazy danych**: PDO z `pdo_sqlite` oraz samo `sqlite3`.
- **Pamięć współdzielona i System V IPC**: shmop, sysvmsg, sysvsem, sysvshm.
- **Daty, metadane obrazów i tłumaczenia**: calendar, exif, gettext.
- **Interfejs do funkcji zewnętrznych**: ffi.
- **Wymagane komponenty PHP**: Core, standard, SPL, date, json, hash, random, Reflection.

Czego w niej *nie ma*: `pdo_mysql`, `pgsql`, redis, apcu, imagick i reszty z tej półki. Jeśli twoja aplikacja potrzebuje takiego rozszerzenia, skompiluj `libphp` razem z nim i zbuduj Rapirę pod tę bibliotekę - jak, opisuje strona [Budowanie ze źródeł](/pl/docs/intro/build-from-source).

Każde wydanie używa najnowszej dostępnej wersji poprawkowej swojej gałęzi PHP. Plik `share/php/PHP_VERSION.txt` w archiwum zawiera dokładną wersję. Na działającym serwerze wersję podają `PHP_VERSION` i `phpinfo()`.

::: question Dlaczego na PHP 8.4 `PHP_SAPI` zwraca `fastcgi`?
Na PHP 8.4 OPcache startuje tylko dla zamkniętej listy nazw SAPI, a nazwa spoza listy oznacza brak wspólnego cache'u opcode'ów w ogóle - dlatego tam SAPI rejestruje się jako `fastcgi`. PHP 8.5 zniosło tę listę, więc `PHP_SAPI` i `php_sapi_name()` zwracają `rapira`. Wiersz *Server API* w `phpinfo()` w obu przypadkach pokazuje `Rapira`. Kod, który rozgałęzia się po `PHP_SAPI`, musi rozumieć obie wartości.
:::

## php.ini

Ani pakiety, ani archiwa nie zawierają `php.ini`, a Rapira sama go nie tworzy, więc nietknięta instalacja działa na wbudowanych domyślnych ustawieniach PHP. Wskaż przez `PHPRC` konkretny plik albo katalog, w którym go szukać:

```bash
PHPRC=/etc/rapira/php.ini rapira serve --config /etc/rapira/rapira.toml
```

::: question Gdzie PHP samo szuka `php.ini`?
Tak jak zwykle: najpierw patrzy na `PHPRC`, potem do bieżącego katalogu roboczego, a na końcu na ścieżkę wpisaną przy kompilacji, która prowadzi do katalogu, w którym budowano PHP, i tym samym na twojej maszynie nie prowadzi donikąd.
:::

::: question Dlaczego plik nazywa się `php.ini`, a nie `php-rapira.ini`?
PHP najpierw szuka `php-<sapi-name>.ini`, a dopiero potem zwykłego `php.ini`, a nazwa SAPI zależy od wersji - `fastcgi` na 8.4 i `rapira` na 8.5. Zwykły `php.ini` pasuje do obu.
:::

## Dystrybucja

Buildy publikujemy w dwóch miejscach: w GitHub Releases jako archiwa, pakiety i plik z sumami kontrolnymi oraz na `ghcr.io/rapira-rs/rapira` jako obrazy kontenerów. Repozytorium dla apta ani yuma na razie nie ma, więc aktualizacja to pobranie nowego artefaktu i zainstalowanie go na miejscu starego, a nie `apt upgrade`. Pakiet zastępuje zainstalowany w miejscu; przy archiwum rozpakuj nowy katalog obok starego i przełącz dowiązanie: poprzednie drzewo zostaje na swoim miejscu, a wycofanie zmiany to jedno polecenie.

Obok wydań działa kanał nocny. Każdy przebieg CI, który przejdzie na `main`, publikuje nocne tagi kontenerów. Ten sam przebieg wrzuca też archiwa do kroczącego przedwydania `nightly` w GitHub Releases. Na commicie wydania ten krok jest pomijany, bo build wydania publikuje te archiwa już przy samym wydaniu. Przedwydanie niesie wyłącznie archiwa i ich plik z sumami kontrolnymi: nie ma w nim ani `.deb`, ani `.rpm`. Build nocny jest buildem gałęzi `main`, a nie wydaniem.

Build dla macOS działa **wyłącznie na Apple Silicon**, celuje w **macOS 14 i nowsze** i jest podpisany doraźnie: bez Developer ID, bez notaryzacji, więc przy pierwszym uruchomieniu macOS może poprosić o potwierdzenie. Wersji na Intela nie ma. Buildy dla Windowsa są publikowane osobno, w [rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows), i służą wyłącznie do lokalnego developmentu - w produkcji Rapira działa na Linuksie lub macOS.

[Szybki start](/pl/docs/intro/quickstart) pokazuje, jak obsłużyć pierwsze żądanie, gdy binarka jest już na miejscu.
