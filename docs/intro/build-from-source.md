---
title: Build from source
description: Requirements and instructions to compile Rapira on Linux and macOS.
---

# Build from source

Rapira compiles from source on Linux and macOS. A source build can support platforms and PHP extensions that the prebuilt binaries do not support. The build requires Rust, a C toolchain, and an embeddable PHP library. See [Installation](/docs/intro/installation) for prebuilt binaries.

## When to build from source

- **No prebuilt binary supports the platform.** Examples include an uncommon CPU architecture and a musl-based distribution such as Alpine.
- **The distribution is older than the package requirements.** Release binaries require glibc 2.34 or newer. The oldest supported systems are Debian 12, Ubuntu 22.04, and RHEL 9.
- **The application requires other PHP extensions.** Release builds include SQLite, PostgreSQL through `pdo_pgsql` and `pgsql`, `bcmath`, `intl`, `igbinary`, and `redis`. See [Installation](/docs/intro/installation) for the complete extension list. Build with another PHP when the application requires extensions such as `pdo_mysql` or `gd`.
- **You modify Rapira** or need a change that is not in a release.

## The toolchain

The build requires these tools:

- **Rust 1.98.1.** Install Rust through [rustup](https://rustup.rs/). Run `rustup toolchain install` in the repository to install the version that `rust-toolchain.toml` selects. Do not use Rust 1.99. On x86_64 it makes incorrect machine code, and Rapira can crash ([rust-lang/rust#163911](https://github.com/rust-lang/rust/issues/163911)). A Rust package from the distribution can have a different version.
- **A C compiler.** The build compiles small C interface files against the PHP headers.
- **libclang.** Bindgen uses it to create Zend API bindings during the build. The package is `libclang-dev` on Debian or Ubuntu, `clang-devel` on Fedora, and `clang` on Arch.

## PHP with the embed SAPI

Rapira links the PHP interpreter into its process and does not use a socket. PHP must be an NTS shared library, version 8.4 or 8.5. Configure PHP with `--enable-embed=shared`. This option creates `libphp.so`, or `libphp.dylib` on macOS.

::: warning The build rejects ZTS
A thread-safe PHP causes a build error. Rapira requires NTS because it runs one interpreter in each worker process. If `PATH` selects a ZTS build, install NTS PHP. Set `PHP_CONFIG` to its `php-config` path.
:::

Several distributions package the embed SAPI already:

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora
sudo pacman -S php php-embed                  # Arch
sudo apk add php84-dev php84-embed            # Alpine
```

::: warning macOS has no packaged embed SAPI
The Homebrew `php` formula does not include the embed SAPI. Build PHP from source on macOS.
:::

### Building PHP from source

Build PHP when no embed package is available. Also build it when the package does not include required extensions.

`.github/php-configure-flags.txt` contains the configuration options for extensions bundled with PHP. These include `bcmath`, `intl`, `pdo_pgsql`, and `pgsql`.

Install the ICU and PostgreSQL client development libraries for `intl` and PostgreSQL support. Their package names are `libicu-dev` and `libpq-dev` on Debian or Ubuntu, and `libicu-devel` and `libpq-devel` on Rocky Linux. The `intl` extension also requires a C++ compiler.

On Debian or Ubuntu, install the build dependencies:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl git autoconf bison re2c libclang-dev llvm-dev libssl-dev libcurl4-openssl-dev libxml2-dev libonig-dev libsqlite3-dev zlib1g-dev libffi-dev libicu-dev libpq-dev
```

On macOS, install the build dependencies:

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq
export PATH="$(brew --prefix bison)/bin:$PATH"
```

From the Rapira source directory, run the `php` target:

```bash
make php PHP_SRC=/path/to/php-src PHP_PREFIX="$HOME/.local/php-nts"
```

The target runs `buildconf`, configures PHP, compiles it, and installs it under `PHP_PREFIX`. It enables the bundled PHP extensions from `.github/php-configure-flags.txt`. It detects macOS and sets the Homebrew library paths and the SDK path for iconv.

For a custom extension set, configure PHP directly in its source directory. Append the required extension options to `./configure`:

```bash
./buildconf --force
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

For manual configuration on macOS, use the library paths and configure options from the `php` target.

The `make` targets do not add `igbinary` and `redis`. Release CI compiles both into `libphp` and enables igbinary serialization for Redis. [The release workflow](https://github.com/rapira-rs/rapira/blob/main/.github/workflows/build-binaries.yml) pins their source versions and checksums. To add them, extract their sources into the `ext/igbinary` and `ext/redis` directories of PHP. Do this before you run `./buildconf --force`. Then add `--enable-igbinary --enable-redis --enable-redis-igbinary` to `./configure`.

### The plain `libphp.so` name

The build links `-lphp`. It searches only `lib` and `lib64` under the PHP prefix. One of these directories must contain `libphp.so`, or `libphp.dylib` on macOS. Debian and Ubuntu provide only the versioned `libphp8.4.so`. Alpine puts `libphp.so` in `lib/phpXX`, which the build does not search. Create a link with the required name in the prefix `lib` or `lib64` directory:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
sudo ln -sf /usr/lib/php84/libphp.so /usr/lib/libphp.so     # Alpine
```

Without root access, put the link in a user directory. Configure the linker and loader to use it:

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="-L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## Building Rapira

After PHP installation, build Rapira with Cargo:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
cargo build --release
```

The build writes the binary to `target/release/rapira`.

The build finds PHP through `php-config`. Set `PHP_CONFIG` when `PATH` does not select the required PHP:

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
Run `make test` to validate the build configuration. It finds the PHP library in `lib`, `lib64`, or `lib/phpXX` under the PHP prefix. It accepts plain and versioned library names, and it creates the plain name that the linker requires.
:::

## Running the binary you built

Rapira loads `libphp.so`, or `libphp.dylib`, when the process starts. A library in a standard system directory needs no extra configuration. For another directory, configure the loader. The loaded library must have the same PHP minor version as the PHP that `php-config` selected for the build. Otherwise, Rapira stops at boot with an error.

Use the `worker.php` from [Quickstart](/docs/intro/quickstart). Create `rapira.toml` next to it:

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

::: tip OPcache on PHP 8.4
PHP 8.4 builds OPcache as a separate `opcache.so` file. Add `zend_extension=opcache` to `php.ini` to load it. PHP 8.5 includes OPcache in `libphp`.
:::

The result has the same functions as a packaged server. See [Quickstart](/docs/intro/quickstart), [CLI](/docs/cli), and [Configuration](/docs/configuration).

## Working on Rapira itself

`make test` runs the unit tests and the end-to-end tests. `make stubs` regenerates each `*_arginfo.h` header from the `*.stub.php` file next to it under `crates/`. It uses PHP's `gen_stub.php`. Set `GEN_STUB` when `make` cannot find that file. For each pull request, CI runs the build, the tests, `cargo fmt`, Clippy, and coverage.

- `make test_nts` runs workspace unit tests.
- `make test_e2e` builds the server and runs the binary-based end-to-end tests. Run it separately from `test_nts`. `make test` runs both in sequence.
- `make coverage` writes unit and end-to-end coverage to `lcov.info`. It requires `cargo-llvm-cov` and the `llvm-tools-preview` Rust component.
- `make grpc_fixtures` regenerates gRPC descriptor fixtures. It uses Go by default. Set `BUF=/path/to/buf` to use an installed Buf executable.

See the [core contributor guide](https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md) for test placement, lint commands, and fuzz commands. The fuzz workflow runs each target for 60 seconds on pull requests and 30 minutes twice weekly.
