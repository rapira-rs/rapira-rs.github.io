---
title: Installation
description: Install Rapira from a deb, an rpm or a tarball, verify the checksum, and see which libphp build each artifact carries.
faqLevel: 2
---

# Installation

Rapira ships as the `rapira` binary with `libphp` next to it — the PHP interpreter the server loads into its own process. Nothing else is in the artifact: no `php` command, no php-fpm, no ini directory. You do not have to install PHP on the machine for Rapira to run.

::: question What is `libphp`, and why is it not "just PHP"?
The PHP sources build into several interfaces to the engine, called SAPIs. The engine behind them is the same — Zend plus the extensions; what differs is the wrapper around it and who drives the program:

| SAPI | What it produces | Who is in charge |
| --- | --- | --- |
| CLI | the `php` command | PHP: it starts, runs a script, exits. |
| FPM | `php-fpm` | PHP: it listens on the socket and keeps a worker pool. |
| embed | `libphp.so` | The host program: it calls the interpreter like any other library. |

Rapira ships the embed build because the server drives the request, not PHP. The `php` command is a different SAPI for a different job, so no artifact contains it.
:::

::: question Why is `libphp` not taken from the system?
It has to be a PHP built with `--enable-embed=shared` — only that build produces `libphp.so`. Distributions rarely package it, and where they do — `php-embedded` on Fedora and RHEL, `php-embed` on Arch, `libphpX.Y-embed` from deb.sury.org on Debian and Ubuntu — you take the minor version and the extension set as they come; Homebrew's `php` has no embed SAPI at all. Each Rapira release therefore builds `libphp` from the official PHP source tarball and ships it beside the binary.
:::

::: question What does "PHP runs inside the Rapira process" mean?
At startup `libphp` is loaded into the address space of the `rapira` process, so calling into PHP is a function call in the same memory: no socket, no FastCGI, no serializing the request and the response. That describes how the code executes — the library itself stays a separate file next to the binary, which is why the binary cannot leave its directory without it (see [Tarballs, on Linux and macOS](#tarballs-on-linux-and-macos)).
:::

## Choosing a PHP version

Every download has `php8.4` or `php8.5` in its name — that is the PHP version whose sources produced the `libphp` inside. Pick the minor version your application runs on, and take 8.5 unless something in your stack needs 8.4.

Whatever PHP is already on the machine — the system `php`, a php-fpm pool, a Homebrew build — Rapira neither uses nor touches. No artifact carries a `php` command, so Composer, `bin/console` and `artisan` keep running on your own PHP CLI.

::: question Why does each PHP version get its own Rapira build?
The `libphp` in the artifact is not a swappable dependency but part of the build: the `rapira` binary is linked against one specific library, and its ABI changes from one PHP minor version to the next. One Rapira build therefore works with exactly one PHP branch, and the version is in the file name. In exchange there is no "install PHP first" step, no `php-config` to point at, and no version to keep in sync.
:::

::: question How do I switch from 8.4 to 8.5?
Install the package for the other version and the package manager does the swap. `rapira-php8.4` and `rapira-php8.5` occupy exactly the same paths, so both declare `provides`, `conflicts` and `replaces` (`obsoletes` on rpm) on a virtual `rapira` package: they never sit side by side, the second one replaces the first. Tarballs do not exclude each other — each unpacks into its own directory, so an 8.4 tree and an 8.5 tree can live next to each other and run from different paths.
:::

## Release artifacts

Everything is on the [GitHub releases page](https://github.com/rapira-rs/rapira/releases). The [download page](/download) picks the artifact for your platform — OS, architecture, PHP version, package format — and shows its SHA-256; every `php8.5` artifact has a `php8.4` twin.

On Linux, take a package if you want the files where your distribution expects them and `apt` or `dnf` to pull in the shared libraries PHP needs; take a tarball if the server has to fit into one self-contained directory — a container image, a deploy artifact, a machine where you have no root.

Check either one against `rapira-v0.6.0-SHA256SUMS.txt` before installing — the commands are in [Verifying checksums](#verifying-checksums).

::: question Why verify the checksum before installing?
`.deb` and `.rpm` run their maintainer scripts as root, so a tampered file gets root before you ever start the server. The check is one command and takes that risk away.
:::

## Debian and Ubuntu

Download the `.deb` and install it through `apt`, giving it a path:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5_0.6.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.6.0-1_amd64.deb
rapira --version
```

The package installs the server and nothing around it: no service unit, no config file, no ini directory. Running Rapira under systemd is a separate step, described in [Running in production](/docs/deployment).

The packages are built against glibc 2.34, so the oldest systems they install on are **Debian 12 and Ubuntu 22.04**. Anything newer works.

::: question Why the `./` in front of the file name?
The leading `./` is what tells apt this is a local file rather than a package name to look up in the repositories.
:::

::: question Which files end up on the system?
Four: the `/usr/bin/rapira` binary, the `/usr/lib/rapira/libphp.so` interpreter, plus the license and the README under `/usr/share/doc/rapira/`. The package changes nothing else.
:::

## RHEL, Rocky and Fedora

The same thing, through `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5-0.6.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.6.0-1.x86_64.rpm
rapira --version
```

The same glibc 2.34 floor sets the minimum: **RHEL 9** and its rebuilds — Rocky 9, AlmaLinux 9 — plus any current Fedora.

## Tarballs, on Linux and macOS

A tarball unpacks into a single directory that holds the whole server:

```text
rapira-v0.6.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

Move the directory where it is going to live, and put the binary on `PATH` through a symlink:

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
The binary looks for its interpreter next to itself, so the directory can only be moved as a whole: `cp bin/rapira /usr/local/bin/` breaks the launch. Put a symlink on `PATH` instead, as in the commands above.
:::

::: question Why does a symlink work when a copy of the binary does not?
The path to the interpreter is baked into the binary as a **relative rpath** — `$ORIGIN/../lib/rapira` on Linux, `@loader_path/../lib/rapira` on macOS — resolved from wherever the binary really sits. There is no `lib/rapira` next to `/usr/local/bin`, so a copy never finds the interpreter. A symlink is resolved by the loader before the rpath is expanded, so the link can live anywhere while the real tree stays intact.
:::

::: question Which system libraries does the tarball need?
On macOS, `lib/rapira` holds `libphp.dylib` together with every non-system library it depends on, so the tree is self-contained. On Linux only `libphp.so` is included, and the usual system libraries — OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib — have to be present. On an ordinary distribution they already are; those are exactly what the deb and the rpm declare as dependencies, along with glibc and libgcc.
:::

## Verifying checksums

Each release has one checksum file covering all of its files, so verification has to select the ones you downloaded. On Linux the `--ignore-missing` flag does that; on macOS `grep` hands `shasum` the single line it needs:

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

## The libphp build

`libphp` is built with `--disable-all`, with a fixed set of extensions turned back on:

- **Runtime basics** — session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar.
- **OPcache** and PCRE with JIT enabled.
- **Networking and compression** — openssl, curl, zlib.
- **XML** — libxml, dom, xml, simplexml, xmlreader, xmlwriter.
- **Databases** — PDO with `pdo_sqlite`, and `sqlite3` itself.
- Everything PHP always builds in — Core, standard, SPL, date, json, hash, random, Reflection.

What it does *not* have: `pdo_mysql`, `pgsql`, redis, apcu, imagick and the rest of that list. If your application needs one of those, build `libphp` with it and compile Rapira against that library — [Build from source](/docs/intro/build-from-source) describes how.

Each release takes the newest patch version of the branch it builds. In a tarball the exact version is written in `share/php/PHP_VERSION.txt`; on a running server `PHP_VERSION` and `phpinfo()` report it.

::: question Why does `PHP_SAPI` return `fastcgi` on PHP 8.4?
On PHP 8.4 OPcache only starts for a fixed list of SAPI names, and a name outside that list means no shared opcode cache at all — so the SAPI registers as `fastcgi` there. PHP 8.5 dropped the list, and `PHP_SAPI` and `php_sapi_name()` return `rapira`. The *Server API* line in `phpinfo()` shows `Rapira` either way. Code that branches on `PHP_SAPI` has to understand both values.
:::

## php.ini

Neither the packages nor the tarballs contain a `php.ini`, and Rapira does not create one, so an untouched installation runs on PHP's built-in defaults. Point `PHPRC` at a real file, or at the directory to look in:

```bash
PHPRC=/etc/rapira/php.ini rapira serve --config /etc/rapira/rapira.toml
```

::: question Where does PHP look for `php.ini` on its own?
The usual way: `PHPRC` first, then the current working directory, and finally the path baked into the build, which points inside the directory where PHP was compiled and therefore leads nowhere on your machine.
:::

::: question Why is the file called `php.ini` and not `php-rapira.ini`?
PHP looks for `php-<sapi-name>.ini` first and only then for a plain `php.ini`, and the SAPI name depends on the version — `fastcgi` on 8.4, `rapira` on 8.5. A plain `php.ini` fits both.
:::

## Distribution

Builds are published on GitHub Releases and nowhere else. There is no apt or yum repository yet, so upgrading means downloading the new artifact and installing it over the old one rather than running `apt upgrade`. A package replaces the installed one in place; with a tarball, unpack the new directory next to the old one and move the symlink — the previous tree stays where it is, and a rollback is one command.

The macOS build is **Apple Silicon only**, targets **macOS 14 and newer**, and is ad-hoc signed: no Developer ID, no notarization, so macOS may ask you to confirm the first run. There is no Intel build. Windows builds are published separately, in [rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows), and are meant for local development only — in production Rapira runs on Linux or macOS.

[Quickstart](/docs/intro/quickstart) covers serving a first request once the binary is in place.
