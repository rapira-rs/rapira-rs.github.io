---
title: Installation
description: Install Rapira from a deb, RPM, or tarball. Verify the checksum and identify the included libphp build.
faqLevel: 2
---

# Installation

Each Rapira artifact contains the `rapira` binary and its `libphp` interpreter library. The server loads this library into its process.
The artifact does not contain the `php` command, php-fpm, or an ini directory. Rapira does not require a system PHP installation.

::: question What is `libphp`, and how does it differ from the PHP command?
PHP builds several interfaces to its engine. These interfaces are Server Application Programming Interfaces, or SAPIs.
Each uses the Zend engine and extensions, but it has a different program interface:

| SAPI | What it produces | Who is in charge |
| --- | --- | --- |
| CLI | the `php` command | PHP: it starts, runs a script, exits. |
| FPM | `php-fpm` | PHP: it listens on the socket and keeps a worker pool. |
| embed | `libphp.so` | The host program: it calls the interpreter like any other library. |

Rapira includes the embed SAPI because the server controls requests. The `php` command uses a different SAPI, so artifacts do not contain it.
:::

::: question Why is `libphp` not taken from the system?
PHP must use `--enable-embed=shared` to create `libphp.so`. Few distributions provide this build.
Fedora and RHEL provide `php-embedded`, and Arch provides `php-embed`. Deb.sury.org provides `libphpX.Y-embed` for Debian and Ubuntu.
These packages have fixed PHP versions and extension sets. Homebrew PHP does not include the embed SAPI.
Therefore, each Rapira release builds `libphp` from an official PHP source archive and includes it with the binary.
:::

::: question What does "PHP runs inside the Rapira process" mean?
During initialization, the `rapira` process loads `libphp` into its address space. Rapira calls PHP functions in the same process.
It does not use a socket, FastCGI, or request serialization. The library remains a separate file next to the binary.
Therefore, do not move the binary without the library. See [Tarballs on Linux and macOS](#tarballs-on-linux-and-macos).
:::

## Choosing a PHP version

Each download name contains `php8.4` or `php8.5`. This text identifies the PHP source version for its `libphp`.
Select the minor version that the application supports. Select 8.5 unless an application dependency requires 8.4.

Rapira does not use or change an existing system PHP, php-fpm pool, or Homebrew PHP.
Artifacts do not contain a `php` command. Composer, `bin/console`, and `artisan` continue to use the system PHP CLI.

::: question Why does each PHP version get its own Rapira build?
The artifact `libphp` is part of the build and is not interchangeable. The `rapira` binary links to one specific library.
The PHP ABI changes between minor versions. Therefore, one Rapira build supports one PHP minor version.
The file name identifies this version. You do not need to install PHP or configure `php-config`.
:::

::: question How do I switch from 8.4 to 8.5?
Install the package for the other PHP version. The package manager replaces the installed Rapira package.
Both packages use the same paths. They declare `provides`, `conflicts`, and `replaces`, or `obsoletes` for RPM.
Tarball installations use separate directories and can exist at the same time. Start each version from its own path.
:::

## Release artifacts

The [GitHub releases page](https://github.com/rapira-rs/rapira/releases) contains all release files.
Use the [download page](/download) to select the operating system, architecture, PHP version, and package format.
It also shows the SHA-256 value. Each `php8.5` artifact has a corresponding `php8.4` artifact.

On Linux, use a package for standard file locations and automatic library dependencies.
Use a tarball for a single directory, container image, deployment artifact, or installation without root access.
On Linux, the tarball also requires system libraries. See [Tarballs, on Linux and macOS](#tarballs-on-linux-and-macos) for the list.

Check the file with `rapira-v0.8.0-SHA256SUMS.txt` before installation. See [Verifying checksums](#verifying-checksums).

::: question Why verify the checksum before installing?
`.deb` and `.rpm` packages run installation scripts as root. A changed package could execute unwanted code with root permission.
Checksum verification detects a changed package before installation.
:::

## Debian and Ubuntu

Download the `.deb` file. Install it through `apt` with its path:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-php8.5_0.8.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.8.0-1_amd64.deb
rapira --version
```

The package installs the server without a service unit, configuration file, or ini directory.
See [Running in production](/docs/deployment) to configure systemd.

The packages require glibc 2.34 or newer. The minimum supported versions are **Debian 12 and Ubuntu 22.04**.

::: question Why does the file path start with `./`?
The leading `./` tells apt to use a local file instead of a repository package name.
:::

::: question Which files end up on the system?
The package installs `/usr/bin/rapira` and `/usr/lib/rapira/libphp.so`. It installs the license and README under `/usr/share/doc/rapira/`.
:::

## RHEL, Rocky and Fedora

Install the RPM through `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-php8.5-0.8.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.8.0-1.x86_64.rpm
rapira --version
```

The glibc 2.34 requirement supports **RHEL 9**, Rocky 9, AlmaLinux 9, and current Fedora versions.

## Tarballs on Linux and macOS

A tarball unpacks into a single directory that holds the whole server:

```text
rapira-v0.8.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

Move the directory to its permanent location. Add a symbolic link to the binary on `PATH`:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.8.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.8.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-php8.5-macos-aarch64.tar.gz
tar xzf rapira-v0.8.0-php8.5-macos-aarch64.tar.gz
sudo mv rapira-v0.8.0-php8.5-macos-aarch64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

:::

::: warning
The binary uses a relative path to find its interpreter. Move the complete directory together.
Do not copy only `bin/rapira` to `/usr/local/bin/`. Use a symbolic link as shown above.
:::

::: question Why does a symlink work when a copy of the binary does not?
The binary contains a **relative rpath** to the interpreter. Linux uses `$ORIGIN/../lib/rapira`, and macOS uses `@loader_path/../lib/rapira`.
The loader resolves a symbolic link before it resolves the rpath. Thus, the rpath starts from the actual binary location.
A copy in `/usr/local/bin` has no adjacent `lib/rapira` directory and cannot find the interpreter.
:::

::: question Which system libraries does the tarball need?
On macOS, `lib/rapira` contains `libphp.dylib` and all required non-system libraries. The directory is self-contained.
On Linux, the artifact includes only `libphp.so`. The system must provide OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, and zlib.
The deb and RPM packages declare these libraries, glibc, and libgcc as dependencies.
:::

## Verifying checksums

Each release has one checksum file for all release files. Verify only the downloaded file.
On Linux, use `--ignore-missing`. On macOS, use `grep` to pass the selected line to `shasum`:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-SHA256SUMS.txt
sha256sum -c --ignore-missing rapira-v0.8.0-SHA256SUMS.txt
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-SHA256SUMS.txt
grep rapira-v0.8.0-php8.5-macos-aarch64.tar.gz rapira-v0.8.0-SHA256SUMS.txt | shasum -a 256 -c
```

:::

## Docker

The `ghcr.io/rapira-rs/rapira` container image contains the `rapira` binary and its `libphp.so`.
The image uses `FROM scratch` and has no base system, shell, or entry point. It cannot run by itself.
Copy its files into an application image:

```dockerfile
FROM php:8.5-cli-trixie
COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /
COPY . /app
CMD ["rapira", "serve", "--listen", ":8000", "--mode", "classic", "/app/public/index.php"]
```

The image contains `/usr/local/bin/rapira`, `/usr/local/lib/libphp.so`, and OPcache.
For PHP 8.4, OPcache is a separate `opcache.so` with an ini file. For PHP 8.5, it is part of `libphp.so`.
The `/usr/local/share/rapira` directory contains two more files. `PHP_VERSION.txt` contains the bundled PHP patch version.
`debian-packages.txt` lists required Debian packages for a base image without PHP.

The image build uses `libphp.so` from `php:8.4-cli-trixie` or `php:8.5-cli-trixie`.
It includes the extensions from that image, not the set in [The libphp build](#the-libphp-build).
Add other extensions in the application base image. On a PHP base image, `docker-php-ext-install` compiles against the same `libphp.so`.

::: question Why is the image built `FROM scratch`?
A scratch image contains only files that the build copies into it.
Thus, `COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /` copies only Rapira files. You select the application base image.
:::

Each tag identifies its PHP minor version. The following tags support amd64 and arm64:

| Tag | What it points at |
| --- | --- |
| `X.Y.Z-php8.4`, `X.Y.Z-php8.5` | One release build. The tag never moves. |
| `X.Y-php8.4`, `X.Y-php8.5` | The newest stable release with that `X.Y` version. |
| `php8.4`, `php8.5` | The newest stable release. |
| `nightly-php8.4`, `nightly-php8.5` | The newest nightly build. |

The registry also contains architecture-specific tags such as `X.Y.Z-php8.5-amd64` and `X.Y.Z-php8.5-arm64`.

There is no `latest` tag. Rapira binds the Zend structures at build time. It refuses to start with a `libphp.so` from another PHP minor version. Therefore, every tag names the PHP minor version that it contains.

::: question What does a nightly tag point at?
Each successful CI run on `main` builds images from that commit. The build gets an immutable `X.Y.Z-nightly.<short-sha>-php8.5` tag.
`X.Y.Z` is the repository version. `<short-sha>` is the first seven characters of the commit identifier.
The `nightly-php8.5` tag points to that build. The registry retains the ten newest nightly builds.
:::

## The libphp build

Rapira builds `libphp` with `--disable-all` and enables this fixed set of extensions:

- **Runtime basics**: session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar, posix.
- **OPcache** and PCRE with JIT enabled.
- **Networking and compression**: openssl, curl, zlib, sockets, ftp.
- **XML**: libxml, dom, xml, simplexml, xmlreader, xmlwriter.
- **Databases**: PDO with `pdo_sqlite`, and `sqlite3` itself.
- **Shared memory and System V IPC**: shmop, sysvmsg, sysvsem, sysvshm.
- **Dates, image metadata and translations**: calendar, exif, gettext.
- **Foreign function interface**: ffi.
- **Required PHP components**: Core, standard, SPL, date, json, hash, random, Reflection.

The build does not include `pdo_mysql`, `pgsql`, Redis, APCu, or Imagick.
If the application requires another extension, build `libphp` with it. Then compile Rapira against that library.
See [Build from source](/docs/intro/build-from-source).

Each release uses the latest patch version available for its PHP branch. In a tarball, `share/php/PHP_VERSION.txt` contains the exact version.
On a running server, `PHP_VERSION` and `phpinfo()` report it.

::: question Why does `PHP_SAPI` return `fastcgi` on PHP 8.4?
On PHP 8.4, OPcache starts only for a fixed list of SAPI names. Rapira registers the SAPI as `fastcgi` to enable OPcache.
PHP 8.5 removed this list, so `PHP_SAPI` and `php_sapi_name()` return `rapira`.
The *Server API* line in `phpinfo()` shows `Rapira` for both versions. Code that checks `PHP_SAPI` must accept both values.
:::

## php.ini

Packages and tarballs do not contain `php.ini`, and Rapira does not create one. Without this file, PHP uses built-in defaults.
Set `PHPRC` to a file or search directory:

```bash
PHPRC=/etc/rapira/php.ini rapira serve --config /etc/rapira/rapira.toml
```

::: question Where does PHP look for `php.ini` on its own?
PHP first checks `PHPRC` and then the current directory. Finally, it checks the default path set during the PHP build.
That build path usually does not exist on the target system.
:::

::: question Why is the file called `php.ini` and not `php-rapira.ini`?
PHP first checks `php-<sapi-name>.ini` and then `php.ini`. The SAPI name is `fastcgi` on 8.4 and `rapira` on 8.5.
A plain `php.ini` supports both versions.
:::

## Distribution

GitHub Releases contains tarballs, packages, and checksum files. `ghcr.io/rapira-rs/rapira` contains container images.
No apt or yum repository is available yet.
To update a package, download and install the new version. The package manager replaces the installed version.
To update a tarball, extract the new directory next to the old directory. Then change the symbolic link.
Retain the previous directory if you must restore it.

Each successful CI run on `main` publishes nightly container tags. It also uploads tarballs to the `nightly` prerelease on GitHub Releases.
Release commits do not upload nightly tarballs because the release contains them.
The prerelease contains tarballs and a checksum file. It does not contain `.deb` or `.rpm` packages.
A nightly build is not a release.

The macOS build supports **Apple Silicon** and **macOS 14 or newer**. It uses an ad hoc signature without a Developer ID or notarization.
macOS can request confirmation before the first run. There is no Intel build.
[rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows) provides Windows builds for local development. Use Linux or macOS for production.

[Quickstart](/docs/intro/quickstart) covers serving a first request once the binary is in place.
