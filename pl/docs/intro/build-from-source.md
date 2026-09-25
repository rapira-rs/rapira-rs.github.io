---
title: Budowanie ze źródeł
description: "Kiedy i jak samodzielnie skompilować Rapirę - narzędzia Rusta i C, PHP w wersji NTS z SAPI embed oraz szczegóły linkowania na Linuksie i macOS."
---

# Budowanie ze źródeł

Rapira kompiluje się ze źródeł na Linuksie i macOS. Samodzielne budowanie pokrywa przypadki, których nie obejmują gotowe binarki ze strony [Instalacja](/pl/docs/intro/installation), a jedynym wymaganiem poza zwykłymi narzędziami Rusta i C jest PHP, które Rapira potrafi osadzić.

## Kiedy budować ze źródeł

- **Dla twojej platformy nie ma gotowej binarki** - nietypowa architektura procesora albo dystrybucja oparta na musl, na przykład Alpine.
- **Twoja dystrybucja jest starsza, niż obsługują pakiety.** Wydania powstają na glibc 2.34, więc najstarsze systemy, na których się zainstalują, to Debian 12, Ubuntu 22.04 i RHEL 9 (zobacz [Instalację](/pl/docs/intro/installation)).
- **Aplikacja wymaga innych rozszerzeń PHP.** Wydania zawierają SQLite, PostgreSQL przez `pdo_pgsql` i `pgsql`, `bcmath`, `intl`, `igbinary` oraz `redis`. Pełna lista rozszerzeń znajduje się na stronie [Instalacja](/pl/docs/intro/installation). Zbuduj Rapirę z innym PHP, gdy aplikacja wymaga rozszerzeń takich jak `pdo_mysql` lub `gd`.
- **Pracujesz nad samą Rapirą** albo chcesz coś, czego jeszcze nie wydaliśmy.

## Zestaw narzędzi

Budowanie wymaga następujących narzędzi:

- **Rusta z kanału stable.** Plik `rust-toolchain.toml` wybiera wersję przez [rustup](https://rustup.rs/).
- **Kompilatora C i `pkg-config`.** Proces budowania kompiluje małe adaptery C z nagłówkami PHP.
- **libclang.** Bindgen używa go do tworzenia powiązań Zend API. Pakiet nazywa się `libclang-dev` na Debianie i Ubuntu, `clang-devel` na Fedorze oraz `clang` na Archu.

## PHP z SAPI embed

Rapira linkuje interpreter ze swoim procesem i nie używa gniazda. PHP musi być biblioteką współdzieloną NTS w wersji 8.4 lub 8.5. Skonfiguruj PHP z `--enable-embed=shared`. Ta opcja tworzy `libphp.so`, a na macOS `libphp.dylib`.

::: warning Wersje ZTS są odrzucane
PHP zbudowane jako thread-safe powoduje błąd budowania. Rapira wymaga NTS, ponieważ każdy proces workera uruchamia jeden interpreter. Jeśli `PATH` wybiera wersję ZTS, zainstaluj PHP NTS. Ustaw `PHP_CONFIG` na ścieżkę do jego `php-config`.
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

Na macOS zainstaluj zależności potrzebne do budowania:

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq
```

W katalogu źródeł Rapiry uruchom cel dla swojej platformy:

::: code-group

```bash [Linux]
make php PHP_SRC=/path/to/php-src PHP_PREFIX="$HOME/.local/php-nts"
```

```bash [macOS]
make php-macos PHP_SRC=/path/to/php-src PHP_PREFIX="$HOME/.local/php-nts"
```

:::

Oba cele uruchamiają `buildconf`, konfigurują PHP, kompilują je i instalują w `PHP_PREFIX`. Włączają rozszerzenia dostarczane z PHP, wymienione w `.github/php-configure-flags.txt`. Cel `php-macos` ustawia ścieżki bibliotek Homebrew i ścieżkę SDK dla iconv.

Aby użyć własnego zestawu rozszerzeń, skonfiguruj PHP bezpośrednio w jego katalogu źródeł. Dodaj opcje wymaganych rozszerzeń do `./configure`:

```bash
./buildconf --force
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

Przy ręcznej konfiguracji na macOS użyj ścieżek bibliotek i opcji konfiguracji z celu `php-macos`.

CI dla wydań kompiluje również `igbinary` i `redis` do `libphp`, z włączoną serializacją igbinary dla Redis. Wersje ich źródeł i sumy kontrolne są ustalone w [przepływie budowania wydań](https://github.com/rapira-rs/rapira/blob/main/.github/workflows/build-binaries.yml). Przed uruchomieniem `./buildconf --force` rozpakuj ich źródła do katalogów PHP `ext/igbinary` i `ext/redis`. Dodaj `--enable-igbinary --enable-redis --enable-redis-igbinary` do `./configure`.

### Nazwa `libphp.so` bez wersji

Proces budowania łączy bibliotekę przez `-lphp`. Przeszukuje tylko katalogi `lib` i `lib64` w prefiksie PHP. Jeden z tych katalogów musi zawierać `libphp.so` lub `libphp.dylib` w macOS. Debian i Ubuntu dostarczają tylko wersjonowany plik `libphp8.4.so`. Alpine umieszcza `libphp.so` w katalogu `lib/phpXX`, którego proces budowania nie przeszukuje. Utwórz dowiązanie z wymaganą nazwą w katalogu `lib` lub `lib64` prefiksu:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
sudo ln -sf /usr/lib/php84/libphp.so /usr/lib/libphp.so     # Alpine
```

Bez roota umieść dowiązanie we własnym katalogu i wskaż go zarówno linkerowi, jak i loaderowi:

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

PHP jest wykrywane przez `php-config`. Jeśli ten z `PATH` nie wskazuje wersji, którą Rapira ma osadzić, podaj ją wprost:

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
`make test` uruchamia zestawy testów i sam ustala ścieżki do bibliotek: znajduje bibliotekę embed w prefiksie z `php-config` (`lib`, `lib64`, `lib/phpXX`, nazwa zwykła albo wersjonowana) i sprowadza ją do zwykłej nazwy, której oczekuje linker. Uruchom `make test`, żeby sprawdzić konfigurację, zanim zaufasz własnej binarce.
:::

## Uruchamianie zbudowanej binarki

W czasie działania Rapira ładuje `libphp.so` (na macOS `libphp.dylib`) dynamicznie. Jeśli biblioteka leży w standardowym miejscu, nie musisz nic robić; w przeciwnym razie wskaż ją loaderowi. Użyj pliku `worker.php` z [Szybkiego startu](/pl/docs/intro/quickstart). Utwórz `rapira.toml` obok niego:

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

Wynik udostępnia te same funkcje co serwer z pakietu. Zobacz strony [Szybki start](/pl/docs/intro/quickstart), [Wiersz poleceń](/pl/docs/cli) i [Konfiguracja](/pl/docs/configuration).

## Praca nad samą Rapirą

`make test` uruchamia oba zestawy testów - ten działający w procesie i ten end-to-end, który odpala prawdziwą binarkę - `make stubs` regeneruje nagłówek arginfo z `crates/php_sys/rapira.stub.php`, a CI przy każdym pull requeście buduje projekt i przepuszcza go przez `cargo fmt`, clippy oraz pomiar pokrycia.
