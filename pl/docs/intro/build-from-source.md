---
title: Budowanie ze źródeł
description: Wymagania i instrukcje kompilacji Rapiry na Linuksie i macOS.
---

# Budowanie ze źródeł

Rapira kompiluje się ze źródeł na Linuksie i macOS. Budowanie ze źródeł może obsłużyć platformy i rozszerzenia PHP, których nie obsługują gotowe binarki. Budowanie wymaga Rusta, narzędzi C i biblioteki PHP z SAPI embed. Gotowe binarki opisuje strona [Instalacja](/pl/docs/intro/installation).

## Kiedy budować ze źródeł

- **Żadna gotowa binarka nie obsługuje platformy.** Przykłady to nietypowa architektura procesora i dystrybucja oparta na musl, na przykład Alpine.
- **Twoja dystrybucja jest starsza, niż obsługują pakiety.** Binarki z wydań wymagają glibc 2.34 lub nowszej. Najstarsze obsługiwane systemy to Debian 12, Ubuntu 22.04 i RHEL 9.
- **Aplikacja wymaga innych rozszerzeń PHP.** Wydania zawierają SQLite, PostgreSQL przez `pdo_pgsql` i `pgsql`, `bcmath`, `intl`, `igbinary` oraz `redis`. Pełna lista rozszerzeń znajduje się na stronie [Instalacja](/pl/docs/intro/installation). Zbuduj Rapirę z innym PHP, gdy aplikacja wymaga rozszerzeń takich jak `pdo_mysql` lub `gd`.
- **Zmieniasz Rapirę** albo potrzebujesz zmiany, której nie ma w wydaniu.

## Zestaw narzędzi

Budowanie wymaga następujących narzędzi:

- **Rusta 1.99 lub nowszego.** Zainstaluj Rusta przez [rustup](https://rustup.rs/). Plik `rust-toolchain.toml` w repozytorium wybiera kanał stable. Jeśli zainstalowana wersja stable jest starsza niż 1.99, uruchom `rustup update stable`. Pakiet Rusta z dystrybucji może być za stary.
- **Kompilatora C.** Proces budowania kompiluje małe pliki interfejsu C z nagłówkami PHP.
- **libclang.** Bindgen używa go do tworzenia powiązań Zend API podczas budowania. Pakiet nazywa się `libclang-dev` na Debianie i Ubuntu, `clang-devel` na Fedorze oraz `clang` na Archu.

## PHP z SAPI embed

Rapira linkuje interpreter PHP ze swoim procesem i nie używa gniazda. PHP musi być biblioteką współdzieloną NTS w wersji 8.4 lub 8.5. Skonfiguruj PHP z `--enable-embed=shared`. Ta opcja tworzy `libphp.so`, a na macOS `libphp.dylib`.

::: warning Wersje ZTS są odrzucane
PHP zbudowane jako thread-safe powoduje błąd budowania. Rapira wymaga NTS, ponieważ uruchamia jeden interpreter w każdym procesie workera. Jeśli `PATH` wybiera wersję ZTS, zainstaluj PHP NTS. Ustaw `PHP_CONFIG` na ścieżkę do jego `php-config`.
:::

Kilka dystrybucji ma SAPI embed gotowe w pakietach:

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora/RHEL
sudo pacman -S php php-embed                  # Arch
sudo apk add php84-dev php84-embed            # Alpine
```

::: warning Na macOS nie ma gotowego pakietu z SAPI embed
Formuła `php` z Homebrew nie zawiera SAPI embed. Na macOS zbuduj PHP ze źródeł.
:::

### Budowanie PHP ze źródeł

Zbuduj PHP, gdy pakiet embed jest niedostępny. Zbuduj je także wtedy, gdy pakiet nie zawiera wymaganych rozszerzeń.

Plik `.github/php-configure-flags.txt` zawiera opcje rozszerzeń dostarczanych ze źródłami PHP. Należą do nich `bcmath`, `intl`, `pdo_pgsql` i `pgsql`.

Zainstaluj biblioteki deweloperskie ICU i klienta PostgreSQL, aby włączyć obsługę `intl` i PostgreSQL. Pakiety nazywają się `libicu-dev` i `libpq-dev` na Debianie lub Ubuntu oraz `libicu-devel` i `libpq-devel` na Rocky Linux. Rozszerzenie `intl` wymaga również kompilatora C++.

Na Debianie lub Ubuntu zainstaluj zależności potrzebne do budowania:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl git autoconf bison re2c libclang-dev llvm-dev libssl-dev libcurl4-openssl-dev libxml2-dev libonig-dev libsqlite3-dev zlib1g-dev libffi-dev libicu-dev libpq-dev
```

Na macOS zainstaluj zależności potrzebne do budowania:

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq
export PATH="$(brew --prefix bison)/bin:$PATH"
```

W katalogu źródeł Rapiry uruchom cel `php`:

```bash
make php PHP_SRC=/path/to/php-src PHP_PREFIX="$HOME/.local/php-nts"
```

Cel uruchamia `buildconf`, konfiguruje PHP, kompiluje je i instaluje w `PHP_PREFIX`. Włącza rozszerzenia dostarczane z PHP, wymienione w `.github/php-configure-flags.txt`. Wykrywa macOS i ustawia ścieżki bibliotek Homebrew oraz ścieżkę SDK dla iconv.

Aby użyć własnego zestawu rozszerzeń, skonfiguruj PHP bezpośrednio w jego katalogu źródeł. Dodaj opcje wymaganych rozszerzeń do `./configure`:

```bash
./buildconf --force
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

Przy ręcznej konfiguracji na macOS użyj ścieżek bibliotek i opcji konfiguracji z celu `php`.

Cele `make` nie dodają `igbinary` i `redis`. CI dla wydań kompiluje oba rozszerzenia do `libphp` i włącza serializację igbinary dla Redis. [Przepływ budowania wydań](https://github.com/rapira-rs/rapira/blob/main/.github/workflows/build-binaries.yml) ustala wersje ich źródeł i sumy kontrolne. Aby je dodać, rozpakuj ich źródła do katalogów PHP `ext/igbinary` i `ext/redis`. Zrób to przed uruchomieniem `./buildconf --force`. Następnie dodaj `--enable-igbinary --enable-redis --enable-redis-igbinary` do `./configure`.

### Nazwa `libphp.so` bez wersji

Proces budowania łączy bibliotekę przez `-lphp`. Przeszukuje tylko katalogi `lib` i `lib64` w prefiksie PHP. Jeden z tych katalogów musi zawierać `libphp.so` lub `libphp.dylib` na macOS. Debian i Ubuntu dostarczają tylko wersjonowany plik `libphp8.4.so`. Alpine umieszcza `libphp.so` w katalogu `lib/phpXX`, którego proces budowania nie przeszukuje. Utwórz dowiązanie z wymaganą nazwą w katalogu `lib` lub `lib64` prefiksu:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
sudo ln -sf /usr/lib/php84/libphp.so /usr/lib/libphp.so     # Alpine
```

Bez uprawnień roota umieść dowiązanie w katalogu użytkownika. Skonfiguruj linker i loader, aby go używały:

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="-L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## Budowanie Rapiry

Po zainstalowaniu PHP zbuduj Rapirę za pomocą Cargo:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
cargo build --release
```

Proces budowania zapisuje plik binarny w `target/release/rapira`.

Proces budowania znajduje PHP przez `php-config`. Ustaw `PHP_CONFIG`, gdy `PATH` nie wybiera wymaganego PHP:

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
Uruchom `make test`, aby sprawdzić konfigurację budowania. Polecenie znajduje bibliotekę PHP w `lib`, `lib64` lub `lib/phpXX` w prefiksie PHP. Akceptuje nazwy bez wersji i wersjonowane. Tworzy też nazwę bez wersji, której wymaga linker.
:::

## Uruchamianie zbudowanej binarki

Rapira ładuje `libphp.so` lub `libphp.dylib` podczas startu procesu. Biblioteka w standardowym katalogu systemowym nie wymaga dodatkowej konfiguracji. Dla innego katalogu skonfiguruj loader. Załadowana biblioteka musi mieć tę samą wersję minor PHP co PHP, które `php-config` wybrał do budowania. W przeciwnym razie Rapira zatrzymuje się podczas startu z błędem.

Użyj pliku `worker.php` z [Szybkiego startu](/pl/docs/intro/quickstart). Utwórz `rapira.toml` obok niego:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

```bash
LD_LIBRARY_PATH="$HOME/.local/php-nts/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml         # Linux
DYLD_LIBRARY_PATH="$HOME/.local/php-nts/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml   # macOS
```

::: tip OPcache w PHP 8.4
PHP 8.4 buduje OPcache jako osobny plik `opcache.so`. Dodaj `zend_extension=opcache` do `php.ini`, aby go załadować. PHP 8.5 zawiera OPcache w `libphp`.
:::

Wynik udostępnia te same funkcje co serwer z pakietu. Zobacz strony [Szybki start](/pl/docs/intro/quickstart), [Wiersz poleceń](/pl/docs/cli) i [Konfiguracja](/pl/docs/configuration).

## Praca nad samą Rapirą

`make test` uruchamia testy jednostkowe i testy end-to-end. `make stubs` regeneruje każdy nagłówek `*_arginfo.h` z pliku `*.stub.php` obok niego w `crates/`. Używa do tego pliku `gen_stub.php` z PHP. Ustaw `GEN_STUB`, gdy `make` nie może znaleźć tego pliku. Dla każdego pull requesta CI uruchamia budowanie, testy, `cargo fmt`, Clippy i pomiar pokrycia.

- `make test_nts` uruchamia testy jednostkowe workspace.
- `make test_e2e` buduje serwer i uruchamia testy end-to-end na jego pliku binarnym. Uruchamiaj go oddzielnie od `test_nts`. `make test` uruchamia oba cele kolejno.
- `make coverage` zapisuje pokrycie testów jednostkowych i end-to-end w `lcov.info`. Wymaga `cargo-llvm-cov` i komponentu Rusta `llvm-tools-preview`.
- `make grpc_fixtures` regeneruje deskryptory testowe gRPC. Domyślnie używa Go. Ustaw `BUF=/path/to/buf`, aby użyć zainstalowanego programu Buf.

[Poradnik dla współtwórców rdzenia](https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md) opisuje położenie testów oraz polecenia lintowania i fuzzingu. Workflow fuzzingu uruchamia każdy cel przez 60 sekund dla pull requestów i przez 30 minut dwa razy w tygodniu.
