---
title: Build from source
description: Requirements and instructions to compile Rapira on Linux and macOS.
---

# Build from source

Rapira compiles from source on Linux and macOS. A source build can support platforms and PHP extensions that the prebuilt binaries do not support. The build requires Rust, a C toolchain, and an embeddable PHP library. See [Installation](/docs/intro/installation) for prebuilt binaries.

## When to build from source

- **No prebuilt binary supports the platform.** Examples include an uncommon CPU architecture.
- **The distribution is older than the package requirements.** PHP 8.4 and PHP 8.5 binaries require glibc 2.34 and OpenSSL 3.0 or newer (Debian 12, Ubuntu 22.04, RHEL 9). PHP 8.6 binaries require OpenSSL 3.3 and RHEL 9.7 or newer.
- **The application requires other PHP extensions.** Release builds include SQLite, PostgreSQL through `pdo_pgsql` and `pgsql`, `bcmath`, `intl`, `sodium`, and `igbinary` on PHP 8.4 and PHP 8.5. See [Installation](/docs/intro/installation) for the complete extension list. Build with another PHP when the application requires extensions such as `pdo_mysql` or `gd`.
- **You modify Rapira** or need a change that is not in a release.

## The toolchain

The build requires these tools:

- **Rust stable.** Install Rust through [rustup](https://rustup.rs/). `rust-toolchain.toml` selects the stable channel automatically. A Rust package from the distribution can have an older version.
- **A C compiler.** The build compiles small C interface files against the PHP headers.
- **libclang.** Bindgen uses it to create Zend API bindings during the build. The package is `libclang-dev` on Debian or Ubuntu, `clang-devel` on Fedora, and `clang` on Arch.

## PHP with the embed SAPI

Rapira links the PHP interpreter into its process and does not use a socket. Build thread-safe (ZTS) PHP 8.4, 8.5, or 8.6 with `--enable-zts --enable-embed=shared --disable-zend-signals`. This creates `libphp.so`, or `libphp.dylib` on macOS.

Multiple workers with OPcache enabled require the [PHP thread-locking fix](https://github.com/php/php-src/commit/36c6d1f500f7ec477f6eae0b0f5c46b041d82347). Rapira checks for PHP 8.4.29, 8.5.14, or 8.6.1 or later in each minor version.

::: info NTS PHP fallback
Distribution embed packages are usually non-thread-safe (NTS). A build linked to NTS PHP runs one pool with one worker. Rapira warns when `workers` is higher than `1` and refuses a second PHP pool.
:::

Several distributions package an NTS embed SAPI:

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora
sudo pacman -S php php-embed                  # Arch
```

::: warning macOS has no packaged embed SAPI
The Homebrew `php` formula does not include the embed SAPI. Build PHP from source on macOS.
:::

### Building PHP from source

Build ZTS PHP from source for multiple workers or custom extensions.

`.github/php-configure-flags.txt` contains the configuration options for extensions bundled with PHP releases. These include `bcmath`, `intl`, `pdo_pgsql`, `pgsql`, and `sodium`.

Install the build dependencies on Debian or Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl git autoconf bison re2c libclang-dev llvm-dev libssl-dev libcurl4-openssl-dev libxml2-dev libonig-dev libsqlite3-dev zlib1g-dev libffi-dev libicu-dev libpq-dev libargon2-dev libreadline-dev libsodium-dev
```

Install the build dependencies on macOS:

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq argon2 readline libsodium
export PATH="$(brew --prefix bison)/bin:$PATH"
```

From the Rapira source directory, run the `php` target with a dedicated `php-src` checkout:

```bash
make php PHP_SRC=/path/to/php-src
```

The target builds ZTS PHP with the shared embed library and installs it under `$HOME/.local/share/php-zts`. It enables `sodium` in the prefix `etc/php/conf.d` directory. Set `PHP_PREFIX` to install to another location.

For the release extension set, configure PHP directly in its source directory:

```bash
./buildconf --force
./configure --prefix="$HOME/.local/share/php-zts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

Release builds on PHP 8.4 and PHP 8.5 also compile `igbinary` into `libphp`. [The build script](https://github.com/rapira-rs/rapira/blob/main/.github/build-php.sh) pins its source version and checksum. Rapira does not bundle `redis`.

### The plain `libphp.so` name

The build links `-lphp`. It searches `lib` and `lib64` under the PHP prefix. One of these directories must contain `libphp.so`, or `libphp.dylib` on macOS. Debian and Ubuntu provide only the versioned `libphp8.4.so`. Create a link with the required name in the prefix `lib` or `lib64` directory:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
```

Without root access, put the link in a user directory. Configure the linker and loader to use it:

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="--cfg tokio_unstable -L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## Building Rapira

After PHP installation, build Rapira with Cargo:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
export PHP_CONFIG="$HOME/.local/share/php-zts/bin/php-config"
export LD_LIBRARY_PATH="$("$PHP_CONFIG" --prefix)/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" # Linux
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--cfg tokio_unstable"
cargo build --release
```

The Tokio file reader uses io_uring on Linux when the kernel permits it. Keep `--cfg tokio_unstable` when you set `RUSTFLAGS`. The build writes the binary to `target/release/rapira`.

::: tip
Run `make test` to validate the build configuration. It finds `libphp.so` or `libphp.dylib` through `PHP_CONFIG` and passes `--cfg tokio_unstable` automatically.
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
LD_LIBRARY_PATH="$HOME/.local/share/php-zts/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml         # Linux
DYLD_LIBRARY_PATH="$HOME/.local/share/php-zts/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml   # macOS
```

::: tip OPcache on PHP 8.4
PHP 8.4 builds OPcache as a separate `opcache.so` file. Set `zend_extension` to its absolute path in `php.ini` to load it. PHP 8.5 and PHP 8.6 include OPcache in `libphp`.
:::

The result has the same functions as a packaged server. See [Quickstart](/docs/intro/quickstart), [CLI](/docs/cli), and [Configuration](/docs/configuration).

## Working on Rapira itself

`make test` runs the unit tests and the end-to-end tests. `make stubs` regenerates each `*_arginfo.h` header from the `*.stub.php` file next to it under `crates/`. It uses PHP's `gen_stub.php`. Set `GEN_STUB` when `make` cannot find that file. For each pull request, CI runs the build, the tests, `cargo fmt`, Clippy, and coverage.

- `make test_unit` runs workspace unit tests.
- `make test_e2e` builds the server and runs the binary-based end-to-end tests serially. `make test` runs both suites in order.
- `make coverage` writes unit and end-to-end coverage to `lcov.info`. It requires `cargo-llvm-cov` and the `llvm-tools-preview` Rust component.
- `make grpc_fixtures` regenerates gRPC descriptor fixtures. It uses Go by default. Set `BUF=/path/to/buf` to use an installed Buf executable.

See the [core contributor guide](https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md) for test placement, lint commands, and fuzz commands. The fuzz workflow runs each target for 60 seconds on pull requests and 30 minutes twice weekly.
