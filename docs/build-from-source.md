---
title: Build from source
description: When and how to compile Rapira yourself — the Rust and C toolchain, an NTS PHP with the embed SAPI, and the linking details on Linux and macOS.
---

# Build from source

Rapira compiles from source on Linux and macOS. Building it yourself covers the cases the prebuilt binaries on the [Installation](/docs/installation) page don't, and the only requirement beyond the usual Rust and C toolchain is a PHP that Rapira can embed.

## When to build from source

- **There is no prebuilt binary for your platform** — an unusual CPU architecture, or a musl-based distro such as Alpine.
- **Your distribution is older than the packages support.** The releases are built against glibc 2.34 — Debian 12, Ubuntu 22.04 and RHEL 9 are the oldest they install on (see [Installation](/docs/installation)).
- **You need a different set of PHP extensions.** The release builds bundle a PHP compiled from the flag list in [`ci/php-configure-flags.txt`](https://github.com/rapira-rs/rapira/blob/main/ci/php-configure-flags.txt), which is deliberately small: session, mbstring, OPcache, OpenSSL, curl, the XML family, PDO with SQLite. If your application needs `pdo_mysql`, `intl` or `gd`, build Rapira against a PHP that has them.
- **You are working on Rapira itself**, or want something that hasn't been released yet.

## The toolchain

Three things beyond the usual build essentials:

- **Rust, stable channel.** `rust-toolchain.toml` in the repository pins it, so [rustup](https://rustup.rs/) selects the right toolchain on its own.
- **A C compiler and `pkg-config`.** Part of the build is C: small shims compiled against the PHP headers.
- **libclang**, because the bindings to the Zend API are generated at build time by bindgen. The package is `libclang-dev` on Debian/Ubuntu, `clang-devel` on Fedora, `clang` on Arch.

## PHP with the embed SAPI

Rapira links the interpreter into its own process rather than reaching it over a socket, so PHP has to exist as a shared library: **version 8.4 or 8.5, NTS (non-thread-safe), configured with `--enable-embed=shared`**, which is what produces `libphp.so` (`libphp.dylib` on macOS).

::: warning ZTS builds are rejected
A thread-safe (ZTS) PHP fails the build with an explicit error — Rapira is NTS-only, since it runs one interpreter per worker process. If the PHP on your `PATH` is a ZTS build, install an NTS one and point `PHP_CONFIG` at it (see below).
:::

Several distributions package the embed SAPI already:

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora/RHEL
sudo pacman -S php php-embed                  # Arch
sudo apk add php84-dev php84-embed            # Alpine
```

::: warning macOS has no packaged embed SAPI
Homebrew's `php` formula is built without it, so there is nothing to link against. On macOS, build PHP from source.
:::

### Building PHP yourself

Build PHP yourself when your distribution has no embed package, when you're on macOS, or when the packaged build lacks extensions your application needs.

`ci/php-configure-flags.txt` in the repository is the reference configure line — the same list the release builds use. Feed it to `configure` in an unpacked PHP source tree and add whatever extensions your application needs:

```bash
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/ci/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

On macOS, install the dependencies first (`brew install pkg-config openssl@3 curl oniguruma libxml2 sqlite`), put their `lib/pkgconfig` directories on `PKG_CONFIG_PATH`, and append `--with-iconv="$(xcrun --show-sdk-path)/usr"` after the flags file — a bare `--with-iconv` can't find libiconv there, and with autoconf the last form wins.

### The plain `libphp.so` name

The build links `-lphp`, and the only directories it searches are `lib` and `lib64` under the PHP prefix, so a file named exactly `libphp.so` (or `libphp.dylib`) has to be in one of them. Debian and Ubuntu ship only the versioned `libphp8.4.so`, and Alpine's copy has the plain name but sits in `lib/phpXX`, which is not searched — either way, linking fails until you put a plain-named symlink in the prefix's `lib` or `lib64`:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
sudo ln -sf /usr/lib/php84/libphp.so /usr/lib/libphp.so     # Alpine
```

Without root, put the symlink in a directory of your own and point both the linker and the loader at it:

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="-L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## Building Rapira

With PHP in place, the build itself is an ordinary cargo build:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
cargo build --release
```

The binary lands in `target/release/rapira`.

PHP is discovered through `php-config`. If the one on `PATH` is not the build you want Rapira to embed, name it explicitly:

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
`make test` runs the test suites and resolves the library paths for you: it finds the embed library under the `php-config` prefix (`lib`, `lib64`, `lib/phpXX`, plain or versioned name) and normalizes it into the plain name the linker wants. Run it to confirm the setup before relying on your own build.
:::

## Running the binary you built

At runtime Rapira loads `libphp.so` (`libphp.dylib` on macOS) dynamically. If it lives in a standard location there is nothing to do; otherwise point the loader at it:

```bash
LD_LIBRARY_PATH=$HOME/.local/php-nts/lib ./target/release/rapira serve worker.php     # Linux
DYLD_LIBRARY_PATH=$HOME/.local/php-nts/lib ./target/release/rapira serve worker.php   # macOS
```

The result is the same server the packages install: [Quickstart](/docs/quickstart) walks through a first script, [CLI](/docs/cli) lists what `serve` accepts, and [Configuration](/docs/configuration) covers `rapira.toml`.

## Working on Rapira itself

`make test` runs both suites — the in-process one and the end-to-end suite that spawns the real binary — `make stubs` regenerates the arginfo header from `crates/php_sys/rapira.stub.php`, and CI runs the build, `cargo fmt`, clippy and coverage on every pull request.
