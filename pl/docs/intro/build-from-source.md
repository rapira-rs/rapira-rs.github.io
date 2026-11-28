---
title: Budowanie ze źródeł
description: Wymagania i instrukcje kompilacji Rapiry na Linuksie i macOS.
---

# Budowanie ze źródeł

Rapira kompiluje się ze źródeł na Linuksie i macOS. Budowanie ze źródeł może obsłużyć platformy i rozszerzenia PHP, których nie obsługują gotowe binarki. Budowanie wymaga Rusta, narzędzi C i biblioteki PHP z SAPI embed. Gotowe binarki opisuje strona [Instalacja](/pl/docs/intro/installation).

## Kiedy budować ze źródeł

- **Żadna gotowa binarka nie obsługuje platformy.** Przykładem jest nietypowa architektura procesora.
- **Dystrybucja jest starsza niż wymagania pakietów.** Binarki PHP 8.4 i PHP 8.5 wymagają glibc 2.34 oraz OpenSSL 3.0 lub nowszego (Debian 12, Ubuntu 22.04, RHEL 9). Binarki PHP 8.6 wymagają OpenSSL 3.3 oraz RHEL 9.7 lub nowszego.
- **Aplikacja wymaga innych rozszerzeń PHP.** Wydania zawierają SQLite, PostgreSQL przez `pdo_pgsql` i `pgsql`, `bcmath`, `intl`, `sodium` oraz `igbinary` na PHP 8.4 i PHP 8.5. Pełną listę rozszerzeń zawiera [Instalacja](/pl/docs/intro/installation). Zbuduj Rapirę z innym PHP, gdy aplikacja wymaga rozszerzeń takich jak `pdo_mysql` lub `gd`.
- **Zmieniasz Rapirę** albo potrzebujesz zmiany, której nie ma w wydaniu.

## Zestaw narzędzi

Budowanie wymaga następujących narzędzi:

- **Rust stable.** Zainstaluj Rusta przez [rustup](https://rustup.rs/). Plik `rust-toolchain.toml` automatycznie wybiera kanał stable. Pakiet Rusta z dystrybucji może mieć starszą wersję.
- **Kompilatora C.** Proces budowania kompiluje małe pliki interfejsu C z nagłówkami PHP.
- **libclang.** Bindgen używa go do tworzenia powiązań Zend API podczas budowania. Pakiet nazywa się `libclang-dev` na Debianie i Ubuntu, `clang-devel` na Fedorze oraz `clang` na Archu.

## PHP z SAPI embed

Rapira linkuje interpreter PHP ze swoim procesem i nie używa gniazda. Zbuduj bezpieczne wątkowo (ZTS) PHP 8.4, 8.5 lub 8.6 z opcjami `--enable-zts --enable-embed=shared --disable-zend-signals`. Tworzy to plik `libphp.so`, a na macOS `libphp.dylib`.

Wiele workerów z włączonym OPcache wymaga [poprawki blokowania wątków w PHP](https://github.com/php/php-src/commit/36c6d1f500f7ec477f6eae0b0f5c46b041d82347). Rapira sprawdza wersję PHP 8.4.29, 8.5.14 lub 8.6.1 albo nowszą w każdej wersji pomocniczej.

::: info Tryb awaryjny z PHP NTS
Pakiety embed z dystrybucji są zwykle w wersji niewspółbieżnej wątkowo (NTS). Kompilacja zlinkowana z PHP NTS uruchamia jedną pulę z jednym workerem. Rapira ostrzega, gdy wartość `workers` jest większa niż `1`, i odrzuca drugą pulę PHP.
:::

Kilka dystrybucji udostępnia SAPI embed w wersji NTS w pakietach:

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora
sudo pacman -S php php-embed                  # Arch
```

::: warning Na macOS nie ma gotowego pakietu z SAPI embed
Formuła `php` z Homebrew nie zawiera SAPI embed. Na macOS zbuduj PHP ze źródeł.
:::

### Budowanie PHP ze źródeł

Zbuduj ZTS PHP ze źródeł, aby używać wielu workerów lub własnych rozszerzeń.

Plik `.github/php-configure-flags.txt` zawiera opcje konfiguracji dla rozszerzeń dołączanych do wydań PHP. Należą do nich `bcmath`, `intl`, `pdo_pgsql`, `pgsql` i `sodium`.

Na Debianie lub Ubuntu zainstaluj zależności potrzebne do budowania:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl git autoconf bison re2c libclang-dev llvm-dev libssl-dev libcurl4-openssl-dev libxml2-dev libonig-dev libsqlite3-dev zlib1g-dev libffi-dev libicu-dev libpq-dev libargon2-dev libreadline-dev libsodium-dev
```

Na macOS zainstaluj zależności potrzebne do budowania:

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq argon2 readline libsodium
export PATH="$(brew --prefix bison)/bin:$PATH"
```

W katalogu źródeł Rapiry uruchom cel `php` z osobną kopią `php-src`:

```bash
make php PHP_SRC=/path/to/php-src
```

Cel buduje ZTS PHP ze współdzieloną biblioteką embed i instaluje je w katalogu `$HOME/.local/share/php-zts`. Włącza `sodium` w podkatalogu `etc/php/conf.d` prefiksu. Ustaw `PHP_PREFIX`, aby zainstalować w innej lokalizacji.

Dla zestawu rozszerzeń z wydań skonfiguruj PHP bezpośrednio w jego katalogu źródeł:

```bash
./buildconf --force
./configure --prefix="$HOME/.local/share/php-zts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

Kompilacje wydań dla PHP 8.4 i PHP 8.5 kompilują także `igbinary` do `libphp`. [Skrypt budowania](https://github.com/rapira-rs/rapira/blob/main/.github/build-php.sh) określa wersję jego źródeł i sumę kontrolną. Rapira nie dołącza `redis`.

### Nazwa `libphp.so` bez wersji

Proces budowania łączy bibliotekę przez `-lphp`. Przeszukuje katalogi `lib` i `lib64` w prefiksie PHP. Jeden z tych katalogów musi zawierać `libphp.so` lub `libphp.dylib` na macOS. Debian i Ubuntu dostarczają tylko wersjonowany plik `libphp8.4.so`. Utwórz dowiązanie z wymaganą nazwą w katalogu `lib` lub `lib64` prefiksu:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
```

Bez uprawnień roota umieść dowiązanie w katalogu użytkownika. Skonfiguruj linker i loader, aby go używały:

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="--cfg tokio_unstable -L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## Budowanie Rapiry

Po zainstalowaniu PHP zbuduj Rapirę za pomocą Cargo:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
export PHP_CONFIG="$HOME/.local/share/php-zts/bin/php-config"
export LD_LIBRARY_PATH="$("$PHP_CONFIG" --prefix)/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" # Linux
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--cfg tokio_unstable"
cargo build --release
```

Czytnik plików Tokio używa io_uring na Linuksie, gdy jądro na to pozwala. Zachowaj `--cfg tokio_unstable`, gdy ustawiasz `RUSTFLAGS`. Proces budowania zapisuje plik binarny w `target/release/rapira`.

::: tip
Uruchom `make test`, aby sprawdzić konfigurację budowania. Polecenie znajduje `libphp.so` lub `libphp.dylib` przez `PHP_CONFIG` i automatycznie przekazuje `--cfg tokio_unstable`.
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
LD_LIBRARY_PATH="$HOME/.local/share/php-zts/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml         # Linux
DYLD_LIBRARY_PATH="$HOME/.local/share/php-zts/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml   # macOS
```

::: tip OPcache w PHP 8.4
PHP 8.4 buduje OPcache jako osobny plik `opcache.so`. Ustaw `zend_extension` na jego ścieżkę bezwzględną w `php.ini`, aby go załadować. PHP 8.5 i PHP 8.6 zawierają OPcache w `libphp`.
:::

Wynik udostępnia te same funkcje co serwer z pakietu. Zobacz strony [Szybki start](/pl/docs/intro/quickstart), [Wiersz poleceń](/pl/docs/cli) i [Konfiguracja](/pl/docs/configuration).

## Praca nad samą Rapirą

`make test` uruchamia testy jednostkowe i testy end-to-end. `make stubs` regeneruje każdy nagłówek `*_arginfo.h` z pliku `*.stub.php` obok niego w `crates/`. Używa do tego pliku `gen_stub.php` z PHP. Ustaw `GEN_STUB`, gdy `make` nie może znaleźć tego pliku. Dla każdego pull requesta CI uruchamia budowanie, testy, `cargo fmt`, Clippy i pomiar pokrycia.

- `make test_unit` uruchamia testy jednostkowe workspace.
- `make test_e2e` buduje serwer i uruchamia szeregowo testy end-to-end na jego pliku binarnym. `make test` uruchamia oba zestawy po kolei.
- `make coverage` zapisuje pokrycie testów jednostkowych i end-to-end w `lcov.info`. Wymaga `cargo-llvm-cov` i komponentu Rusta `llvm-tools-preview`.
- `make grpc_fixtures` regeneruje deskryptory testowe gRPC. Domyślnie używa Go. Ustaw `BUF=/path/to/buf`, aby użyć zainstalowanego programu Buf.

[Poradnik dla współtwórców rdzenia](https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md) opisuje położenie testów oraz polecenia lintowania i fuzzingu. Workflow fuzzingu uruchamia każdy cel przez 60 sekund dla pull requestów i przez 30 minut dwa razy w tygodniu.
