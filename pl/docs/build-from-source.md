---
title: Budowanie ze źródeł
description: Kiedy i jak samodzielnie skompilować Rapirę — narzędzia Rusta i C, PHP w wersji NTS z SAPI embed oraz szczegóły linkowania na Linuksie i macOS.
---

# Budowanie ze źródeł

Większości czytelników ta strona nigdy się nie przyda: bierzesz gotową binarkę z [Instalacji](/pl/docs/installation) i tyle. Samodzielna kompilacja Rapiry jest dla przypadków, których wydane artefakty nie pokrywają, i wcale nie jest trudna — jedynym nowym wymaganiem jest PHP, które Rapira potrafi osadzić. Rapira buduje się na Linuksie i macOS.

## Kiedy tego potrzebujesz

- **Dla twojej platformy nie ma gotowej binarki** — nietypowa architektura procesora albo dystrybucja oparta na musl, na przykład Alpine.
- **Twoja dystrybucja jest starsza, niż obsługują pakiety.** Wydania powstają na glibc 2.34, więc najstarsze systemy, na których się zainstalują, to Debian 12, Ubuntu 22.04 i RHEL 9 (zobacz [Instalację](/pl/docs/installation)).
- **Potrzebujesz innego zestawu rozszerzeń PHP.** Wydania zawierają PHP skompilowane z listy flag w pliku [`ci/php-configure-flags.txt`](https://github.com/rapira-rs/rapira/blob/main/ci/php-configure-flags.txt), celowo krótkiej: session, mbstring, OPcache, OpenSSL, curl, rodzina XML, PDO z SQLite. Jeśli twoja aplikacja potrzebuje `pdo_mysql`, `intl` albo `gd`, zbuduj Rapirę na PHP, które je ma.
- **Pracujesz nad samą Rapirą** albo chcesz coś, czego jeszcze nie wydaliśmy.

## Zestaw narzędzi

Poza zwykłym wyposażeniem do kompilacji potrzebujesz trzech rzeczy:

- **Rusta z kanału stable.** Wersję przypina `rust-toolchain.toml` w repozytorium, więc [rustup](https://rustup.rs/) sam wybierze właściwą — niczego nie musisz przełączać.
- **Kompilatora C i `pkg-config`.** Część tego, co się buduje, to kod C: drobne warstwy pośrednie kompilowane na nagłówkach PHP.
- **libclang**, ponieważ powiązania z Zend API generuje w trakcie budowania bindgen. Pakiet nazywa się `libclang-dev` na Debianie i Ubuntu, `clang-devel` na Fedorze, `clang` na Archu.

## PHP z SAPI embed

Rapira nie rozmawia z PHP przez gniazdo — linkuje interpreter do własnego procesu. PHP musi więc istnieć jako biblioteka współdzielona: **w wersji 8.4 lub 8.5, NTS (non-thread-safe), skonfigurowanej z `--enable-embed=shared`** — to właśnie ta flaga daje `libphp.so` (na macOS `libphp.dylib`).

::: warning Wersje ZTS są odrzucane
PHP zbudowane jako thread-safe (ZTS) przerywa budowanie jawnym błędem — Rapira działa wyłącznie z NTS, bo uruchamia jeden interpreter na proces workera. Jeśli PHP z twojego `PATH` jest wersją ZTS, zainstaluj NTS i wskaż ją przez `PHP_CONFIG` (patrz niżej).
:::

Kilka dystrybucji ma SAPI embed gotowe w pakietach:

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora/RHEL
sudo pacman -S php php-embed                  # Arch
sudo apk add php84-dev php84-embed            # Alpine
```

::: warning Na macOS nie ma gotowego pakietu z SAPI embed
Formuła `php` z Homebrew powstaje bez niego, więc nie ma z czym linkować. Na macOS zbuduj PHP ze źródeł.
:::

### Samodzielna kompilacja PHP

Plik `ci/php-configure-flags.txt` w repozytorium to wzorcowa linia `configure` — dokładnie ta sama lista, z której powstają wydania. Podaj ją `configure` w rozpakowanym drzewie źródeł PHP i dopisz rozszerzenia, których potrzebuje twoja aplikacja:

```bash
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/ci/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

Na macOS zacznij od zależności (`brew install pkg-config openssl@3 curl oniguruma libxml2 sqlite`), dorzuć ich katalogi `lib/pkgconfig` do `PKG_CONFIG_PATH`, a za listą flag dopisz `--with-iconv="$(xcrun --show-sdk-path)/usr"` — samo `--with-iconv` nie znajdzie tam libiconv, a w autoconfie wygrywa ostatnia postać flagi.

### Nazwa `libphp.so` bez wersji

Budowanie linkuje `-lphp` i przegląda przy tym wyłącznie katalogi `lib` i `lib64` w prefiksie PHP, więc w jednym z nich musi leżeć plik o dokładnie takiej nazwie: `libphp.so` (albo `libphp.dylib`). Debian i Ubuntu dostarczają tylko wersjonowane `libphp8.4.so`, a Alpine ma wprawdzie nazwę bez wersji, ale trzyma plik w `lib/phpXX`, który nie jest przeszukiwany — w obu przypadkach linkowanie nie przejdzie, dopóki nie położysz w `lib` albo `lib64` dowiązania o zwykłej nazwie:

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

Gdy PHP jest już na miejscu, samo budowanie to zwykłe `cargo build`:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
cargo build --release
```

Binarka ląduje w `target/release/rapira`.

PHP jest wykrywane przez `php-config`. Jeśli ten z `PATH` nie wskazuje wersji, którą Rapira ma osadzić, podaj ją wprost:

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
`make test` uruchamia zestawy testów i sam ustala ścieżki do bibliotek: znajduje bibliotekę embed w prefiksie z `php-config` (`lib`, `lib64`, `lib/phpXX`, nazwa zwykła albo wersjonowana) i sprowadza ją do zwykłej nazwy, której oczekuje linker. Dobry sposób, żeby upewnić się, że całość działa, zanim zaufasz swojej binarce.
:::

## Uruchamianie zbudowanej binarki

W czasie działania Rapira ładuje `libphp.so` (na macOS `libphp.dylib`) dynamicznie. Jeśli biblioteka leży w standardowym miejscu, nie musisz nic robić; w przeciwnym razie wskaż ją loaderowi:

```bash
LD_LIBRARY_PATH=$HOME/.local/php-nts/lib ./target/release/rapira serve worker.php     # Linux
DYLD_LIBRARY_PATH=$HOME/.local/php-nts/lib ./target/release/rapira serve worker.php   # macOS
```

Dalej masz już dokładnie ten sam serwer, który instalują pakiety: [Szybki start](/pl/docs/quickstart) przeprowadzi cię przez pierwszy skrypt, [Wiersz poleceń](/pl/docs/cli) wylicza, co przyjmuje `serve`, a [Konfiguracja](/pl/docs/configuration) opisuje `rapira.toml`.

::: question Czy PHP też muszę zbudować ze źródeł?
Tylko wtedy, gdy twoja dystrybucja nie ma pakietu embed, gdy pracujesz na macOS albo gdy potrzebujesz rozszerzeń, których nie ma w gotowym PHP. Poza tym wystarczy dystrybucyjny pakiet `php-embed` / `libphpX.Y-embed` — a na Debianie i Ubuntu dodatkowo dowiązanie o zwykłej nazwie `libphp.so`.
:::

::: question Czy mogę budować na PHP w wersji ZTS z mojej dystrybucji?
Nie — budowanie zatrzymuje się z błędem, gdy `php-config` wskazuje wersję thread-safe. Zainstaluj albo skompiluj PHP w wersji NTS z SAPI embed i ustaw `PHP_CONFIG` na jego `php-config`.
:::

## Praca nad samą Rapirą

Jeśli jesteś tu po to, żeby zmieniać Rapirę, a nie tylko ją skompilować: `make test` uruchamia oba zestawy testów — ten działający w procesie i ten end-to-end, który odpala prawdziwą binarkę — `make stubs` regeneruje nagłówek arginfo z `crates/php_sys/rapira.stub.php`, a CI przy każdym pull requeście buduje projekt i przepuszcza go przez `cargo fmt`, clippy oraz pomiar pokrycia.
