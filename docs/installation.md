---
title: Installation
description: Install Rapira from a deb, an rpm or a tarball. Every artifact bundles its own PHP, so there is no separate PHP installation to get right first.
---

# Installation

Rapira ships as a binary plus the PHP it embeds. That second half is the part worth understanding before you download anything, because it works differently from every other PHP tool you have installed.

Rapira runs PHP through the embed SAPI — the interface that lets a program host the interpreter as a library. Using it needs a PHP built with `--enable-embed=shared`, which produces a `libphp.so`, and where a distribution does ship one — `php-embedded` on Fedora and RHEL, `php-embed` on Arch, `libphpX.Y-embed` from deb.sury.org on Debian and Ubuntu — you take its minor version and its extension set as given (Homebrew's `php` has no embed SAPI at all). Rather than leave that up to your package manager, every release builds PHP from the official source tarball and ships the result right next to the `rapira` binary.

## You pick a PHP version, not a PHP install

Every download is labelled `php8.4` or `php8.5`, and that label describes the PHP *inside* the download. There is no "install PHP first" step, no `php-config` to point at, no version to keep in sync. If you already have PHP on the machine — a system `php`, a php-fpm pool, a Homebrew build — Rapira neither uses it nor disturbs it. They are unrelated programs that happen to run the same language.

So the only choice you make is which minor version you want your application to run on: **8.4** or **8.5**. Pick 8.5 unless something in your stack still holds you to 8.4.

The deb and rpm packages take that literally. `rapira-php8.4` and `rapira-php8.5` install the exact same paths, so both declare `provides`, `conflicts` and `replaces` on a virtual `rapira` package: they are mutually exclusive, and installing one takes the place of the other instead of landing beside it. That is also how you switch PHP versions — install the other package, and the package manager does the swap.

## Which file to download

Everything lives on the [GitHub releases page](https://github.com/rapira-rs/rapira/releases). Release `v0.6.0` publishes these, with a `php8.4` twin of every `php8.5` name below:

| Platform                            | Artifact                                     |
| ----------------------------------- | -------------------------------------------- |
| Debian / Ubuntu, x86_64             | `rapira-php8.5_0.6.0-1_amd64.deb`            |
| Debian / Ubuntu, ARM                | `rapira-php8.5_0.6.0-1_arm64.deb`            |
| RHEL / Fedora, x86_64               | `rapira-php8.5-0.6.0-1.x86_64.rpm`           |
| RHEL / Fedora, ARM                  | `rapira-php8.5-0.6.0-1.aarch64.rpm`          |
| Linux tarball, x86_64               | `rapira-v0.6.0-php8.5-linux-x86_64.tar.gz`   |
| Linux tarball, ARM                  | `rapira-v0.6.0-php8.5-linux-aarch64.tar.gz`  |
| macOS, Apple Silicon                | `rapira-v0.6.0-php8.5-macos-aarch64.tar.gz`  |
| Checksums for all of the above      | `rapira-v0.6.0-SHA256SUMS.txt`               |

A package is the better default on Linux: it puts things where your distribution expects them and lets `apt` or `dnf` pull the shared libraries PHP needs. Reach for a tarball when you want the server to live in one self-contained directory — a container image, a deploy artifact, a machine where you are not root.

## Debian and Ubuntu

Download the `.deb` and hand it to `apt` with a path — the leading `./` is what tells apt this is a local file and not a package name to look up:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5_0.6.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.6.0-1_amd64.deb
rapira --version
```

Four files land: the binary at `/usr/bin/rapira`, the bundled interpreter at `/usr/lib/rapira/libphp.so`, and the license and README under `/usr/share/doc/rapira/`. Nothing else is touched — no service unit, no config file, no ini directory. Wiring Rapira into systemd is a separate, deliberate step described on [Deployment](/docs/deployment).

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

```
rapira-v0.6.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

On macOS `lib/rapira` holds `libphp.dylib` together with the rest of its non-system library closure, so the tree is genuinely standalone. On Linux only `libphp.so` is bundled and the usual system libraries — OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib — have to be present. On a normal distribution they already are; that is the list the deb and rpm declare as dependencies, alongside glibc and libgcc.

Put the directory wherever you keep such things and link the binary into your `PATH`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.6.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

::: warning
The binary finds its interpreter through a **relative rpath** — `$ORIGIN/../lib/rapira` on Linux, `@loader_path/../lib/rapira` on macOS — where the base is the binary's own real location. Move the whole directory anywhere you like, but never take the binary out of it: `cp bin/rapira /usr/local/bin/` breaks the lookup, because nothing named `lib/rapira` sits next to `/usr/local/bin`. Symlink it instead, as above. The loader resolves the link before it expands the rpath, so a symlink can live anywhere while the real tree stays together.
:::

## Check what you downloaded

Every release publishes one checksum file covering all of its assets. `--ignore-missing` is what lets you verify just the one or two files you actually pulled:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-SHA256SUMS.txt
sha256sum -c --ignore-missing rapira-v0.6.0-SHA256SUMS.txt
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-SHA256SUMS.txt
shasum -a 256 rapira-v0.6.0-php8.5-macos-aarch64.tar.gz
grep macos-aarch64 rapira-v0.6.0-SHA256SUMS.txt
```

:::

## What's inside

The bundled PHP is built with `--disable-all` and then a deliberate set of extensions switched back on — a common web baseline rather than everything that exists:

- **Runtime basics** — session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar
- **OPcache**, and PCRE with the JIT enabled
- **Network and compression** — openssl, curl, zlib
- **XML** — libxml, dom, xml, simplexml, xmlreader, xmlwriter
- **Database** — PDO with `pdo_sqlite`, plus `sqlite3`
- Everything PHP always compiles in — Core, standard, SPL, date, json, hash, random, Reflection

Each release picks up the newest patch version of the branch it builds. The tarball records exactly which one in `share/php/PHP_VERSION.txt`; from a running server, `PHP_VERSION` and `phpinfo()` answer the same question.

::: info The SAPI name
On PHP 8.4 the SAPI registers itself as `fastcgi`, because OPcache on that version only starts for a fixed list of SAPI names and an unlisted one means no shared opcode cache at all. PHP 8.5 dropped that list, so there `PHP_SAPI` and `php_sapi_name()` report `rapira`. The *Server API* row in `phpinfo()` reads `Rapira` on both. Code that branches on `PHP_SAPI` should recognise either value.
:::

What is *not* in the box: `pdo_mysql`, `pgsql`, redis, apcu, imagick, and everything else in that family. If your application needs one, the release artifacts can't help — build PHP with the extensions you want and compile Rapira against it, which [Build from source](/docs/build-from-source) walks through end to end.

## No php.ini is shipped

Neither the packages nor the tarballs contain a `php.ini`, and Rapira does not generate one. PHP falls back to its ordinary discovery: it checks `PHPRC` first, then the current working directory, and finally the path compiled into the build — which points inside the directory PHP was built in and therefore never resolves on your machine. In practice that means an untouched install runs on PHP's built-in defaults.

Point it at a real file, or at a directory to search, with `PHPRC`:

```bash
PHPRC=/etc/rapira/php.ini rapira serve --config /etc/rapira/rapira.toml
```

One detail is worth knowing when you write that file: PHP looks for `php-<sapi-name>.ini` before plain `php.ini`, and the SAPI name differs per version (see above) — so `php.ini` is the spelling that works on both 8.4 and 8.5.

## Where the builds come from

GitHub Releases, and only GitHub Releases — there is no apt or yum repository yet, so upgrading means downloading the new artifact and installing it over the old one rather than running `apt upgrade`.

The macOS build is **Apple Silicon only**, targets **macOS 14 and newer**, and is ad-hoc signed: no Developer ID, no notarization, so macOS may want you to confirm the first run. There is no Intel build. There is no Windows build either — Rapira is Linux and macOS.

With the binary in place, [Quickstart](/docs/quickstart) gets a request served in about a minute.

::: question Do I need PHP installed before I install Rapira?
No. Every artifact carries its own `libphp`, built with the embed SAPI that Rapira requires. A system PHP is neither used nor modified — if you have php-fpm running, it keeps running, untouched.
:::

::: question Can I have PHP 8.4 and 8.5 side by side?
Not from packages: `rapira-php8.4` and `rapira-php8.5` conflict on a virtual `rapira` package, so only one can be installed at a time. Tarballs are self-contained directories, though, so you can unpack both and run them from different paths.
:::

::: question How do I upgrade to a new release?
Download the new artifact and install it the same way. A package replaces the old one in place; with a tarball, unpack the new directory next to the old one and repoint the symlink, which also gives you a one-command rollback.
:::
