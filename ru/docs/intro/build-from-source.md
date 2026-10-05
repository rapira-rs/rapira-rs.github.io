---
title: Сборка из исходников
description: Требования и инструкции для компиляции Rapira на Linux и macOS.
---

# Сборка из исходников

Rapira компилируется из исходников на Linux и macOS. Сборка из исходников может поддерживать платформы и расширения PHP, которые не поддерживают готовые бинарники. Для сборки нужны Rust, инструменты C и встраиваемая библиотека PHP. Готовые бинарники описаны на странице [Установка](/ru/docs/intro/installation).

## Когда собирать из исходников

- **Нет готового бинарника для платформы.** Например, необычная архитектура процессора или дистрибутив на musl, такой как Alpine.
- **Дистрибутив старше, чем поддерживают пакеты.** Релизным бинарникам нужна glibc 2.34 или новее. Самые старые поддерживаемые системы: Debian 12, Ubuntu 22.04 и RHEL 9.
- **Приложению нужны другие расширения PHP.** Релизные сборки включают SQLite, PostgreSQL через `pdo_pgsql` и `pgsql`, `bcmath`, `intl`, `igbinary` и `redis`. Полный список расширений приведён на странице [Установка](/ru/docs/intro/installation). Соберите Rapira с другим PHP, если приложению нужны расширения вроде `pdo_mysql` или `gd`.
- **Вы изменяете Rapira** или вам нужно изменение, которого нет в релизе.

## Инструменты сборки

Для сборки нужны следующие инструменты:

- **Rust 1.99 или новее.** Установите Rust через [rustup](https://rustup.rs/). Файл `rust-toolchain.toml` в репозитории выбирает стабильный канал. Если установленная стабильная версия старше 1.99, выполните `rustup update stable`. Пакет Rust из дистрибутива может быть слишком старым.
- **Компилятор C.** Сборка компилирует небольшие интерфейсные файлы C с заголовками PHP.
- **libclang.** Bindgen использует его для создания привязок Zend API во время сборки. Пакет называется `libclang-dev` в Debian и Ubuntu, `clang-devel` в Fedora и `clang` в Arch.

## PHP с embed SAPI

Rapira компонует интерпретатор PHP в свой процесс и не использует сокет. PHP должен быть разделяемой библиотекой NTS версии 8.4 или 8.5. Настройте PHP с `--enable-embed=shared`. Эта опция создаёт `libphp.so` или `libphp.dylib` в macOS.

::: warning Сборка отклоняет ZTS
Потокобезопасный PHP вызывает ошибку сборки. Rapira требует NTS, потому что Rapira запускает один интерпретатор в каждом процессе воркера. Если `PATH` выбирает сборку ZTS, установите PHP NTS. Задайте в `PHP_CONFIG` путь к его `php-config`.
:::

В нескольких дистрибутивах embed SAPI уже лежит в пакетах:

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora/RHEL
sudo pacman -S php php-embed                  # Arch
sudo apk add php84-dev php84-embed            # Alpine
```

::: warning В macOS готового embed SAPI нет
Формула Homebrew `php` не включает embed SAPI. Соберите PHP из исходников в macOS.
:::

### Сборка PHP из исходников

Соберите PHP, если пакет embed недоступен. Также соберите PHP, если пакет не содержит нужные расширения.

Файл `.github/php-configure-flags.txt` содержит параметры расширений, поставляемых с PHP. Среди них `bcmath`, `intl`, `pdo_pgsql` и `pgsql`.

Для поддержки `intl` и PostgreSQL установите библиотеки разработки ICU и клиента PostgreSQL. Пакеты называются `libicu-dev` и `libpq-dev` в Debian или Ubuntu, а в Rocky Linux - `libicu-devel` и `libpq-devel`. Расширению `intl` также нужен компилятор C++.

В Debian или Ubuntu установите зависимости для сборки:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl git autoconf bison re2c libclang-dev llvm-dev libssl-dev libcurl4-openssl-dev libxml2-dev libonig-dev libsqlite3-dev zlib1g-dev libffi-dev libicu-dev libpq-dev
```

В macOS установите зависимости для сборки:

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq
export PATH="$(brew --prefix bison)/bin:$PATH"
```

В каталоге исходников Rapira запустите цель `php`:

```bash
make php PHP_SRC=/path/to/php-src PHP_PREFIX="$HOME/.local/php-nts"
```

Цель запускает `buildconf`, настраивает PHP, компилирует его и устанавливает в `PHP_PREFIX`. Она включает поставляемые с PHP расширения из `.github/php-configure-flags.txt`. Она определяет macOS и задаёт пути к библиотекам Homebrew и путь SDK для iconv.

Для собственного набора расширений настройте PHP напрямую в каталоге его исходников. Добавьте параметры нужных расширений к `./configure`:

```bash
./buildconf --force
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

При ручной настройке в macOS используйте пути к библиотекам и параметры конфигурации из цели `php`.

Цели `make` не добавляют `igbinary` и `redis`. Релизный CI компилирует оба расширения в `libphp` и включает сериализацию igbinary для Redis. [Процесс сборки релизов](https://github.com/rapira-rs/rapira/blob/main/.github/workflows/build-binaries.yml) закрепляет версии их исходников и контрольные суммы. Чтобы добавить их, распакуйте их исходники в каталоги PHP `ext/igbinary` и `ext/redis`. Сделайте это перед запуском `./buildconf --force`. Затем добавьте `--enable-igbinary --enable-redis --enable-redis-igbinary` к `./configure`.

### Простое имя `libphp.so`

Сборка компонует `-lphp`. Она ищет библиотеку только в каталогах `lib` и `lib64` префикса PHP. Один из этих каталогов должен содержать `libphp.so` или `libphp.dylib` в macOS. Debian и Ubuntu предоставляют только версионный файл `libphp8.4.so`. Alpine помещает `libphp.so` в каталог `lib/phpXX`, который сборка не проверяет. Создайте ссылку с требуемым именем в каталоге `lib` или `lib64` префикса:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
sudo ln -sf /usr/lib/php84/libphp.so /usr/lib/libphp.so     # Alpine
```

Без прав root создайте ссылку в каталоге пользователя. Настройте компоновщик и загрузчик на использование этой ссылки:

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="-L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## Сборка Rapira

После установки PHP соберите Rapira с помощью Cargo:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
cargo build --release
```

Сборка записывает бинарный файл в `target/release/rapira`.

Сборка находит PHP через `php-config`. Задайте `PHP_CONFIG`, если `PATH` не выбирает нужный PHP:

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
Запустите `make test`, чтобы проверить конфигурацию сборки. Команда находит библиотеку PHP в `lib`, `lib64` или `lib/phpXX` в префиксе PHP. Она принимает простое и версионное имя библиотеки и создаёт простое имя, которое нужно компоновщику.
:::

## Запуск собранного бинарника

Rapira загружает `libphp.so` или `libphp.dylib` при запуске процесса. Библиотеке в стандартном системном каталоге не нужна дополнительная настройка. Для другого каталога настройте загрузчик. Загруженная библиотека должна иметь ту же минорную версию PHP, что и PHP, который `php-config` выбрал для сборки. Иначе Rapira останавливается при запуске с ошибкой.

Возьмите `worker.php` из раздела [Быстрый старт](/ru/docs/intro/quickstart). Создайте `rapira.toml` рядом с ним:

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

::: tip OPcache в PHP 8.4
PHP 8.4 собирает OPcache как отдельный файл `opcache.so`. Добавьте `zend_extension=opcache` в `php.ini`, чтобы загрузить его. PHP 8.5 включает OPcache в `libphp`.
:::

Результат предоставляет те же функции, что и сервер из пакета. См. разделы [Быстрый старт](/ru/docs/intro/quickstart), [Командная строка](/ru/docs/cli) и [Конфигурация](/ru/docs/configuration).

## Разработка самой Rapira

`make test` запускает модульные и сквозные тесты. `make stubs` заново создаёт каждый заголовок `*_arginfo.h` из файла `*.stub.php` рядом с ним в `crates/`. Команда использует `gen_stub.php` из PHP. Задайте `GEN_STUB`, если `make` не находит этот файл. Для каждого пул-реквеста CI запускает сборку, тесты, `cargo fmt`, Clippy и покрытие.

- `make test_nts` запускает модульные тесты рабочего пространства.
- `make test_e2e` собирает сервер и запускает сквозные тесты на его бинарном файле. Запускайте эту цель отдельно от `test_nts`. `make test` запускает обе цели последовательно.
- `make coverage` записывает покрытие модульных и сквозных тестов в `lcov.info`. Нужны `cargo-llvm-cov` и компонент Rust `llvm-tools-preview`.
- `make grpc_fixtures` создаёт тестовые дескрипторы gRPC заново. По умолчанию цель использует Go. Задайте `BUF=/path/to/buf`, чтобы использовать установленную программу Buf.

[Руководство для участников разработки ядра](https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md) описывает размещение тестов, команды линтера и фаззинга. Процесс фаззинга запускает каждую цель на 60 секунд для пул-реквестов и на 30 минут дважды в неделю.
