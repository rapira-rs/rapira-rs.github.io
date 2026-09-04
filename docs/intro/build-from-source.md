---
title: Build from source
description: Requirements and instructions to compile Rapira on Linux and macOS.
---

# Build from source

Rapira compiles from source on Linux and macOS. A source build can support platforms and PHP extensions that prebuilt binaries do not support.
It requires Rust, a C toolchain, and an embeddable PHP library. See [Installation](/docs/intro/installation) for prebuilt binaries.

## When to build from source

- **No prebuilt binary supports the platform.** Examples include an uncommon CPU architecture and a musl-based distribution such as Alpine.
- **The distribution is older than the package requirements.** Releases require glibc 2.34 or newer.
- Debian 12, Ubuntu 22.04, and RHEL 9 are the oldest supported package systems.
- **The application requires other PHP extensions.** Release builds use [`.github/php-configure-flags.txt`](https://github.com/rapira-rs/rapira/blob/main/.github/php-configure-flags.txt).
- They include session, mbstring, OPcache, OpenSSL, curl, XML extensions, PDO, and SQLite.
- Build with another PHP when the application requires extensions such as `pdo_mysql`, `intl`, or `gd`.
- **You modify Rapira** or need a change that is not in a release.

## The toolchain

The build requires these tools:

- **Rust, stable channel.** The repository `rust-toolchain.toml` selects the version through [rustup](https://rustup.rs/).
- **A C compiler and `pkg-config`.** The build compiles small C interface files against the PHP headers.
- **libclang.** Bindgen uses it to create Zend API bindings during the build.
- The package is `libclang-dev` on Debian or Ubuntu, `clang-devel` on Fedora, and `clang` on Arch.

## PHP with the embed SAPI

Rapira links the PHP interpreter into its process and does not use a socket. PHP must be an NTS shared library, version 8.4 or 8.5.
Configure PHP with `--enable-embed=shared`. This option creates `libphp.so`, or `libphp.dylib` on macOS.

::: warning The build rejects ZTS
A thread-safe PHP causes a build error. Rapira requires NTS because it runs one interpreter in each worker process.
If `PATH` selects a ZTS build, install NTS PHP. Set `PHP_CONFIG` to its `php-config` path.
:::

Several distributions package the embed SAPI already:

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora/RHEL
sudo pacman -S php php-embed                  # Arch
sudo apk add php84-dev php84-embed            # Alpine
```

::: warning macOS has no packaged embed SAPI
The Homebrew `php` formula does not include the embed SAPI. Build PHP from source on macOS.
:::

### Building PHP from source

Build PHP when no embed package is available. Also build it when the package does not include required extensions.

`.github/php-configure-flags.txt` contains the configuration options for release builds. Pass it to `configure` in an extracted PHP source directory. Append options for required extensions at the end of the `./configure` line:

```bash
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

On macOS, install the dependencies with `brew install pkg-config openssl@3 curl oniguruma libxml2 sqlite`. Add their `lib/pkgconfig` directories to `PKG_CONFIG_PATH`. Append `--with-iconv="$(xcrun --show-sdk-path)/usr"` after the options file. This path lets `configure` find macOS libiconv. Autoconf uses the last value of a repeated option.

### The plain `libphp.so` name

The build links `-lphp`. It searches only `lib` and `lib64` under the PHP prefix.
One of these directories must contain `libphp.so`, or `libphp.dylib` on macOS.
Debian and Ubuntu provide only the versioned `libphp8.4.so`. Alpine puts `libphp.so` in `lib/phpXX`, which the build does not search.
Create a link with the required name in the prefix `lib` or `lib64` directory:

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
`make test` runs the test suites and finds the PHP library. It searches `lib`, `lib64`, and `lib/phpXX` under the PHP prefix.
It accepts plain and versioned library names. It creates the plain name that the linker requires.
Run it to validate the build configuration.
:::

## Running the binary you built

Rapira loads `libphp.so`, or `libphp.dylib`, during process initialization. Standard system library directories require no extra configuration.
For another directory, configure the loader:

```bash
LD_LIBRARY_PATH="$HOME/.local/php-nts/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ./target/release/rapira serve --mode worker worker.php         # Linux
DYLD_LIBRARY_PATH="$HOME/.local/php-nts/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ./target/release/rapira serve --mode worker worker.php   # macOS
```

The result has the same functions as a packaged server. See [Quickstart](/docs/intro/quickstart), [CLI](/docs/cli), and [Configuration](/docs/configuration).

## Working on Rapira itself

`make test` runs the in-process and end-to-end test suites.
`make stubs` creates the arginfo header from `crates/php_sys/rapira.stub.php`.
For each pull request, CI runs the build, `cargo fmt`, Clippy, and coverage.
