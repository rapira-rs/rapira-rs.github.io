---
title: Installation
description: Install Rapira from a deb, an rpm or a tarball, verify the download, and see which PHP build each artifact bundles.
---

# Installation

Rapira ships as a binary plus the PHP it embeds.

Rapira runs PHP through the embed SAPI — the interface that lets a program host the interpreter as a library. Using it needs a PHP built with `--enable-embed=shared`, which produces a `libphp.so`, and where a distribution does ship one — `php-embedded` on Fedora and RHEL, `php-embed` on Arch, `libphpX.Y-embed` from deb.sury.org on Debian and Ubuntu — you take its minor version and its extension set as given (Homebrew's `php` has no embed SAPI at all). Every Rapira release builds PHP from the official source tarball and ships the result next to the `rapira` binary.

## Choosing a PHP version

Every download is labelled `php8.4` or `php8.5`, and that label describes the PHP *inside* the download. There is no "install PHP first" step, no `php-config` to point at, no version to keep in sync. If you already have PHP on the machine — a system `php`, a php-fpm pool, a Homebrew build — Rapira neither uses it nor disturbs it. No artifact ships a `php` command, so the tooling around your application — Composer, `bin/console`, `artisan` — still needs a PHP CLI of its own.

The only choice is which minor version your application runs on: **8.4** or **8.5**. Use 8.5 unless something in your stack requires 8.4.

The deb and rpm packages enforce that. `rapira-php8.4` and `rapira-php8.5` install the exact same paths, so both declare `provides`, `conflicts` and `replaces` (`obsoletes` in rpm) on a virtual `rapira` package: they are mutually exclusive, and installing one takes the place of the other instead of landing beside it. That is also how you switch PHP versions — install the other package, and the package manager does the swap. Tarballs are not exclusive: each unpacks into its own directory, so an 8.4 tree and an 8.5 tree can sit side by side and run from different paths.

## Release artifacts

Everything lives on the [GitHub releases page](https://github.com/rapira-rs/rapira/releases). The [download page](/download) picks the right artifact for your platform — OS, architecture, PHP version, package format — and shows its SHA-256; every `php8.5` artifact has a `php8.4` counterpart.

Use a package on Linux if you want the files where your distribution expects them and `apt` or `dnf` to pull the shared libraries PHP needs; use a tarball if you want the server in one self-contained directory — a container image, a deploy artifact, a machine where you are not root. Check either against `rapira-v0.6.0-SHA256SUMS.txt` before installing it, because a `.deb` or `.rpm` runs its install scripts as root. See [Verifying checksums](#verifying-checksums) for the commands.

## Debian and Ubuntu

Download the `.deb` and install it with `apt` by path — the leading `./` tells apt this is a local file and not a package name to look up:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5_0.6.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.6.0-1_amd64.deb
rapira --version
```

The package installs four files: the binary at `/usr/bin/rapira`, the bundled interpreter at `/usr/lib/rapira/libphp.so`, and the license and README under `/usr/share/doc/rapira/`. Nothing else is touched — no service unit, no config file, no ini directory. Running Rapira under systemd is a separate step. See [Deployment](/docs/deployment) for more information.

The packages are built against glibc 2.34, which makes **Debian 12 and Ubuntu 22.04** the oldest releases they install on. Everything newer works.

## RHEL, Rocky and Fedora

Same shape, with `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5-0.6.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.6.0-1.x86_64.rpm
rapira --version
```

The same glibc 2.34 floor puts the baseline at **RHEL 9** and its rebuilds — Rocky 9, AlmaLinux 9 — plus any current Fedora.

## Tarballs, on Linux and macOS

An archive unpacks into a single directory that holds the whole server:

```text
rapira-v0.6.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

On macOS `lib/rapira` holds `libphp.dylib` together with the rest of its non-system library closure, so the tree is standalone. On Linux only `libphp.so` is bundled and the usual system libraries — OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib — have to be present. On a normal distribution they already are; that is the list the deb and rpm declare as dependencies, alongside glibc and libgcc.

Move the directory to its final location and link the binary into your `PATH`:

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
The binary finds its interpreter through a **relative rpath** — `$ORIGIN/../lib/rapira` on Linux, `@loader_path/../lib/rapira` on macOS — where the base is the binary's own real location. The whole directory can be moved anywhere, but the binary has to stay inside it: `cp bin/rapira /usr/local/bin/` breaks the lookup, because nothing named `lib/rapira` sits next to `/usr/local/bin`. Symlink it instead, as above. The loader resolves the link before it expands the rpath, so a symlink can live anywhere while the real tree stays together.
:::

## Verifying checksums

Every release publishes one checksum file covering all of its assets, so the check has to select only the files you downloaded. `--ignore-missing` does that on Linux; on macOS the `grep` passes `shasum` the single line it needs:

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

## Bundled PHP build

The bundled PHP is built with `--disable-all` and a fixed set of extensions switched back on:

- **Runtime basics** — session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar
- **OPcache**, and PCRE with the JIT enabled
- **Network and compression** — openssl, curl, zlib
- **XML** — libxml, dom, xml, simplexml, xmlreader, xmlwriter
- **Database** — PDO with `pdo_sqlite`, plus `sqlite3`
- Everything PHP always compiles in — Core, standard, SPL, date, json, hash, random, Reflection

Each release picks up the newest patch version of the branch it builds. The tarball records exactly which one in `share/php/PHP_VERSION.txt`; from a running server, `PHP_VERSION` and `phpinfo()` report it.

::: info The SAPI name
On PHP 8.4 the SAPI registers itself as `fastcgi`, because OPcache on that version only starts for a fixed list of SAPI names and an unlisted one means no shared opcode cache at all. PHP 8.5 dropped that list, so there `PHP_SAPI` and `php_sapi_name()` report `rapira`. The *Server API* row in `phpinfo()` reads `Rapira` on both. Code that branches on `PHP_SAPI` should recognise either value.
:::

What is *not* included: `pdo_mysql`, `pgsql`, redis, apcu, imagick, and everything else in that family. If your application needs one, build PHP with the extensions you want and compile Rapira against it. See [Build from source](/docs/intro/build-from-source) for more information.

## php.ini

Neither the packages nor the tarballs contain a `php.ini`, and Rapira does not generate one. PHP falls back to its ordinary discovery: it checks `PHPRC` first, then the current working directory, and finally the path compiled into the build, which points inside the directory PHP was built in and never resolves on your machine. An untouched install therefore runs on PHP's built-in defaults.

Point it at a real file, or at a directory to search, with `PHPRC`:

```bash
PHPRC=/etc/rapira/php.ini rapira serve --config /etc/rapira/rapira.toml
```

PHP looks for `php-<sapi-name>.ini` before plain `php.ini`, and the SAPI name differs per version (see above), so `php.ini` is the spelling that works on both 8.4 and 8.5.

## Distribution

Builds are published on GitHub Releases and nowhere else. There is no apt or yum repository yet, so upgrading means downloading the new artifact and installing it over the old one rather than running `apt upgrade`. A package replaces the installed one in place; with a tarball, unpack the new directory next to the old one and repoint the symlink, which leaves the previous tree in place for a one-command rollback.

The macOS build is **Apple Silicon only**, targets **macOS 14 and newer**, and is ad-hoc signed: no Developer ID, no notarization, so macOS may ask you to confirm the first run. There is no Intel build. Windows builds are published separately, in [rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows), and are meant for local development only — in production Rapira runs on Linux or macOS.

[Quickstart](/docs/intro/quickstart) covers serving a first request once the binary is in place.
