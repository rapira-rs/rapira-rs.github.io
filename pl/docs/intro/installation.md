---
title: Instalacja
description: "Zainstaluj Rapirę z pakietu deb, rpm albo z archiwum tar, sprawdź sumę kontrolną pobranego pliku i zobacz, jaką kompilację libphp zawiera każdy artefakt."
faqLevel: 2
---

# Instalacja

Rapira to binarka `rapira` i leżąca obok niej `libphp` — interpreter PHP, który serwer ładuje do własnego procesu. W artefakcie nie ma nic poza tym: żadnego polecenia `php`, żadnego php-fpm, żadnego katalogu z plikami ini. Żeby Rapira ruszyła, nie musisz instalować PHP na maszynie.

::: question Czym jest `libphp` i dlaczego to nie jest „zwykłe PHP”?
Z tych samych źródeł PHP powstaje kilka interfejsów do silnika, nazywanych SAPI. Silnik za każdym razem jest ten sam — Zend wraz z rozszerzeniami; różni się tylko otoczka i to, kto prowadzi program:

| SAPI | Co powstaje | Kto rządzi |
| --- | --- | --- |
| CLI | polecenie `php` | PHP: startuje, wykonuje skrypt, kończy pracę. |
| FPM | `php-fpm` | PHP: samo nasłuchuje na gnieździe i utrzymuje pulę workerów. |
| embed | `libphp.so` | Program hosta: wywołuje interpreter jak każdą inną bibliotekę. |

Rapira dostarcza kompilację embed, bo to serwer prowadzi żądanie, a nie PHP. Polecenie `php` należy do innego SAPI i do innego zadania, więc w artefakcie go nie ma.
:::

::: question Dlaczego `libphp` nie jest brana z systemu?
Potrzebne jest PHP skompilowane z `--enable-embed=shared` — tylko taka kompilacja daje `libphp.so`. Dystrybucje rzadko ją pakują, a tam, gdzie jest — `php-embedded` w Fedorze i RHEL-u, `php-embed` w Archu, `libphpX.Y-embed` z deb.sury.org w Debianie i Ubuntu — wersję pomocniczą i zestaw rozszerzeń bierzesz takie, jakie są; w `php` z Homebrew SAPI embed nie ma w ogóle. Dlatego każde wydanie Rapiry kompiluje `libphp` z oficjalnego archiwum źródeł PHP i kładzie ją obok binarki.
:::

::: question Co znaczy, że „PHP działa wewnątrz procesu Rapiry”?
Przy starcie `libphp` trafia do przestrzeni adresowej procesu `rapira`, więc sięgnięcie do PHP jest wywołaniem funkcji w tej samej pamięci: bez gniazda, bez FastCGI, bez serializowania żądania i odpowiedzi. To opis tego, jak wykonuje się kod — jako plik biblioteka pozostaje osobna i leży obok binarki, dlatego binarka nie może opuścić swojego katalogu bez niej (zobacz [Archiwa tar, na Linuksie i macOS](#archiwa-tar-na-linuksie-i-macos)).
:::

## Wybór wersji PHP

W nazwie każdego pliku do pobrania stoi `php8.4` albo `php8.5` — to wersja PHP, z której źródeł zbudowano `libphp` w środku. Wybierz wersję pomocniczą, na której działa twoja aplikacja, i bierz 8.5, chyba że coś w twoim stosie wymaga 8.4.

PHP, które już masz na maszynie — systemowe `php`, pula php-fpm, kompilacja z Homebrew — Rapira ani nie używa, ani nie rusza. Żaden artefakt nie zawiera polecenia `php`, więc Composer, `bin/console` i `artisan` nadal działają na twoim własnym PHP CLI.

::: question Dlaczego każda wersja PHP ma osobną kompilację Rapiry?
`libphp` w artefakcie nie jest wymienną zależnością, tylko częścią kompilacji: binarka `rapira` jest zlinkowana z jedną konkretną biblioteką, a jej ABI zmienia się między wersjami pomocniczymi PHP. Dlatego jedna kompilacja Rapiry obsługuje dokładnie jedną gałąź PHP, a wersja trafiła do nazwy pliku. W zamian nie ma kroku „najpierw zainstaluj PHP”, nie ma `php-config`, na który trzeba wskazać, ani wersji, którą trzeba trzymać w zgodzie.
:::

::: question Jak przejść z 8.4 na 8.5?
Zainstaluj pakiet z drugą wersją, a podmianę zrobi menedżer pakietów. `rapira-php8.4` i `rapira-php8.5` zajmują dokładnie te same ścieżki, więc oba deklarują `provides`, `conflicts` i `replaces` (w rpm — `obsoletes`) na wirtualny pakiet `rapira`: nigdy nie stoją obok siebie, drugi zastępuje pierwszy. Archiwa się nie wykluczają — każde rozpakowuje się do własnego katalogu, więc drzewo 8.4 i drzewo 8.5 mogą leżeć obok siebie i uruchamiać się z różnych ścieżek.
:::

## Artefakty wydania

Wszystko leży na [stronie wydań w GitHubie](https://github.com/rapira-rs/rapira/releases). [Strona pobierania](/pl/download) sama dobierze artefakt do twojej platformy — systemu, architektury, wersji PHP, formatu pakietu — i pokaże jego SHA-256; każdy artefakt `php8.5` ma bliźniaka `php8.4`.

Na Linuksie weź pakiet, jeśli chcesz, żeby pliki trafiły tam, gdzie spodziewa się ich dystrybucja, a `apt` albo `dnf` dociągnęły biblioteki współdzielone potrzebne PHP; weź archiwum, jeśli cały serwer ma się zmieścić w jednym samowystarczalnym katalogu — obraz kontenera, artefakt wdrożenia, maszyna bez roota.

W obu przypadkach sprawdź plik z `rapira-v0.6.0-SHA256SUMS.txt` przed instalacją — polecenia znajdziesz w sekcji [Weryfikacja sum kontrolnych](#weryfikacja-sum-kontrolnych).

::: question Po co sprawdzać sumę kontrolną przed instalacją?
`.deb` i `.rpm` wykonują swoje skrypty instalacyjne jako root, więc podmieniony plik dostaje roota, zanim w ogóle uruchomisz serwer. Sprawdzenie to jedno polecenie i tyle wystarczy, żeby zdjąć to ryzyko.
:::

## Debian i Ubuntu

Pobierz `.deb` i zainstaluj go przez `apt`, podając ścieżkę:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5_0.6.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.6.0-1_amd64.deb
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

To samo, tylko przez `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5-0.6.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.6.0-1.x86_64.rpm
rapira --version
```

Ten sam próg glibc 2.34 wyznacza minimum: **RHEL 9** i jego przebudowy — Rocky 9, AlmaLinux 9 — plus dowolna aktualna Fedora.

## Archiwa tar, na Linuksie i macOS

Archiwum rozpakowuje się do jednego katalogu, w którym leży cały serwer:

```text
rapira-v0.6.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

Przenieś katalog tam, gdzie ma zostać na stałe, i dodaj binarkę do `PATH` przez dowiązanie symboliczne:

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
Binarka szuka swojego interpretera obok siebie, więc katalog można przenosić tylko w całości: `cp bin/rapira /usr/local/bin/` psuje uruchomienie. Do `PATH` dodawaj dowiązanie symboliczne, tak jak w poleceniach wyżej.
:::

::: question Dlaczego dowiązanie działa, a kopia binarki nie?
Ścieżka do interpretera jest wpisana w binarkę jako **względny rpath** — `$ORIGIN/../lib/rapira` na Linuksie i `@loader_path/../lib/rapira` na macOS — a punktem odniesienia jest rzeczywiste położenie samej binarki. Obok `/usr/local/bin` nie ma żadnego `lib/rapira`, więc kopia nie znajdzie interpretera. Dowiązanie loader najpierw rozwiązuje, a dopiero potem rozwija rpath, więc link może leżeć gdziekolwiek, a prawdziwe drzewo zostaje nienaruszone.
:::

::: question Jakich bibliotek systemowych potrzebuje archiwum?
Na macOS w `lib/rapira` leży `libphp.dylib` razem ze wszystkimi niesystemowymi bibliotekami, od których zależy — drzewo jest samowystarczalne. Na Linuksie w komplecie jest tylko `libphp.so`, a zwyczajne biblioteki systemowe — OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib — muszą już być w systemie. W typowej dystrybucji i tak są; to dokładnie one figurują jako zależności pakietów deb i rpm, obok glibc i libgcc.
:::

## Weryfikacja sum kontrolnych

Każde wydanie ma jeden plik z sumami dla wszystkich swoich artefaktów, więc przy weryfikacji trzeba wybrać tylko te, które pobrałeś. Na Linuksie robi to flaga `--ignore-missing`, a na macOS `grep` podaje `shasum` dokładnie tę jedną potrzebną linię:

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

## Kompilacja libphp

`libphp` jest kompilowana z `--disable-all`, po czym z powrotem włączany jest stały zestaw rozszerzeń:

- **Podstawa runtime'u** — session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar.
- **OPcache** oraz PCRE z włączonym JIT-em.
- **Sieć i kompresja** — openssl, curl, zlib.
- **XML** — libxml, dom, xml, simplexml, xmlreader, xmlwriter.
- **Bazy danych** — PDO z `pdo_sqlite` oraz samo `sqlite3`.
- Wszystko, co PHP wkompilowuje zawsze — Core, standard, SPL, date, json, hash, random, Reflection.

Czego w niej *nie ma*: `pdo_mysql`, `pgsql`, redis, apcu, imagick i reszty z tej półki. Jeśli twoja aplikacja potrzebuje takiego rozszerzenia, skompiluj `libphp` razem z nim i zbuduj Rapirę pod tę bibliotekę — jak, opisuje strona [Budowanie ze źródeł](/pl/docs/intro/build-from-source).

Każde wydanie bierze najświeższą wersję łatki z budowanej gałęzi. W archiwum dokładna wersja zapisana jest w `share/php/PHP_VERSION.txt`, a na działającym serwerze podają ją `PHP_VERSION` i `phpinfo()`.

::: question Dlaczego na PHP 8.4 `PHP_SAPI` zwraca `fastcgi`?
Na PHP 8.4 OPcache startuje tylko dla zamkniętej listy nazw SAPI, a nazwa spoza listy oznacza brak wspólnego cache'u opcode'ów w ogóle — dlatego tam SAPI rejestruje się jako `fastcgi`. PHP 8.5 zniosło tę listę, więc `PHP_SAPI` i `php_sapi_name()` zwracają `rapira`. Wiersz *Server API* w `phpinfo()` w obu przypadkach pokazuje `Rapira`. Kod, który rozgałęzia się po `PHP_SAPI`, musi rozumieć obie wartości.
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
PHP najpierw szuka `php-<nazwa-sapi>.ini`, a dopiero potem zwykłego `php.ini`, a nazwa SAPI zależy od wersji — `fastcgi` na 8.4 i `rapira` na 8.5. Zwykły `php.ini` pasuje do obu.
:::

## Dystrybucja

Buildy publikujemy w GitHub Releases i nigdzie indziej. Repozytorium dla apta ani yuma na razie nie ma, więc aktualizacja to pobranie nowego artefaktu i zainstalowanie go na miejscu starego, a nie `apt upgrade`. Pakiet zastępuje zainstalowany w miejscu; przy archiwum rozpakuj nowy katalog obok starego i przełącz dowiązanie — poprzednie drzewo zostaje na swoim miejscu, a wycofanie zmiany to jedno polecenie.

Build dla macOS działa **wyłącznie na Apple Silicon**, celuje w **macOS 14 i nowsze** i jest podpisany doraźnie: bez Developer ID, bez notaryzacji, więc przy pierwszym uruchomieniu macOS może poprosić o potwierdzenie. Wersji na Intela nie ma. Buildy dla Windowsa są publikowane osobno, w [rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows), i służą wyłącznie do lokalnego developmentu — w produkcji Rapira działa na Linuksie lub macOS.

[Szybki start](/pl/docs/intro/quickstart) pokazuje, jak obsłużyć pierwsze żądanie, gdy binarka jest już na miejscu.
