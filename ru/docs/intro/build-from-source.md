---
title: Сборка из исходников
description: Требования и инструкции для компиляции Rapira на Linux и macOS.
---

# Сборка из исходников

Rapira компилируется из исходников на Linux и macOS. Сборка из исходников может поддерживать платформы и расширения PHP, которые не поддерживают готовые бинарники. Для сборки нужны Rust, инструменты C и встраиваемая библиотека PHP. Готовые бинарники описаны на странице [Установка](/ru/docs/intro/installation).

## Когда собирать из исходников

- **Нет готового бинарника для платформы.** Например, необычная архитектура процессора.
- **Дистрибутив старше, чем поддерживают пакеты.** Бинарникам для PHP 8.4 и PHP 8.5 нужны glibc 2.34 и OpenSSL 3.0 или новее (Debian 12, Ubuntu 22.04, RHEL 9). Бинарникам для PHP 8.6 нужны OpenSSL 3.3 и RHEL 9.7 или новее.
- **Приложению нужны другие расширения PHP.** Релизные сборки включают SQLite, PostgreSQL через `pdo_pgsql` и `pgsql`, `bcmath`, `intl`, `sodium`, а также `igbinary` для PHP 8.4 и PHP 8.5. Полный список расширений приведён на странице [Установка](/ru/docs/intro/installation). Соберите Rapira с другим PHP, если приложению нужны расширения вроде `pdo_mysql` или `gd`.
- **Вы изменяете Rapira** или вам нужно изменение, которого нет в релизе.

## Инструменты сборки

Для сборки нужны следующие инструменты:

- **Rust stable.** Установите Rust через [rustup](https://rustup.rs/). Файл `rust-toolchain.toml` автоматически выбирает канал stable. Пакет Rust из дистрибутива может иметь более старую версию.
- **Компилятор C.** Сборка компилирует небольшие интерфейсные файлы C с заголовками PHP.
- **libclang.** Bindgen использует его для создания привязок Zend API во время сборки. Пакет называется `libclang-dev` в Debian и Ubuntu, `clang-devel` в Fedora и `clang` в Arch.

## PHP с embed SAPI

Rapira компонует интерпретатор PHP в свой процесс и не использует сокет. Соберите потокобезопасный (ZTS) PHP 8.4, 8.5 или 8.6 с параметрами `--enable-zts --enable-embed=shared --disable-zend-signals`. Эта конфигурация создаёт `libphp.so` или `libphp.dylib` в macOS.

Несколько воркеров с включённым OPcache требуют [исправление блокировки потоков PHP](https://github.com/php/php-src/commit/36c6d1f500f7ec477f6eae0b0f5c46b041d82347). Rapira проверяет наличие версии PHP 8.4.29, 8.5.14 или 8.6.1 либо новее в каждой минорной ветке.

::: info Запасной вариант с NTS PHP
Готовые пакеты embed в дистрибутивах обычно непотокобезопасны (NTS). Сборка с NTS PHP запускает один пул с одним воркером. Rapira выводит предупреждение, если `workers` больше `1`, и отклоняет второй пул PHP.
:::

В нескольких дистрибутивах embed SAPI уже лежит в пакетах:

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora
sudo pacman -S php php-embed                  # Arch
```

::: warning В macOS готового embed SAPI нет
Формула Homebrew `php` не включает embed SAPI. Соберите PHP из исходников в macOS.
:::

### Сборка PHP из исходников

Соберите ZTS PHP из исходников, чтобы использовать несколько воркеров или свои расширения.

Файл `.github/php-configure-flags.txt` содержит параметры конфигурации для расширений из релизных сборок PHP. Среди них `bcmath`, `intl`, `pdo_pgsql`, `pgsql` и `sodium`.

Установите зависимости для сборки в Debian или Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl git autoconf bison re2c libclang-dev llvm-dev libssl-dev libcurl4-openssl-dev libxml2-dev libonig-dev libsqlite3-dev zlib1g-dev libffi-dev libicu-dev libpq-dev libargon2-dev libreadline-dev libsodium-dev
```

Установите зависимости для сборки в macOS:

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq argon2 readline libsodium
export PATH="$(brew --prefix bison)/bin:$PATH"
```

Из каталога исходников Rapira запустите цель `php` с отдельной копией `php-src`:

```bash
make php PHP_SRC=/path/to/php-src
```

Цель собирает ZTS PHP с разделяемой библиотекой embed и устанавливает её в `$HOME/.local/share/php-zts`. Она включает `sodium` в каталоге `etc/php/conf.d` внутри префикса. Задайте `PHP_PREFIX`, чтобы установить PHP в другой каталог.

Для релизного набора расширений настройте PHP напрямую в каталоге его исходников:

```bash
./buildconf --force
./configure --prefix="$HOME/.local/share/php-zts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

Релизные сборки для PHP 8.4 и PHP 8.5 также компилируют `igbinary` в `libphp`. [Скрипт сборки](https://github.com/rapira-rs/rapira/blob/main/.github/build-php.sh) закрепляет версию исходников и контрольную сумму. Rapira не поставляет `redis`.

### Простое имя `libphp.so`

Сборка компонует `-lphp`. Она ищет в `lib` и `lib64` внутри префикса PHP. Один из этих каталогов должен содержать `libphp.so` или `libphp.dylib` в macOS. Debian и Ubuntu предоставляют только версионный файл `libphp8.4.so`. Создайте ссылку с требуемым именем в каталоге `lib` или `lib64` префикса:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
```

Без прав root создайте ссылку в каталоге пользователя. Настройте компоновщик и загрузчик на использование этой ссылки:

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="--cfg tokio_unstable -L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## Сборка Rapira

После установки PHP соберите Rapira с помощью Cargo:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
export PHP_CONFIG="$HOME/.local/share/php-zts/bin/php-config"
export LD_LIBRARY_PATH="$("$PHP_CONFIG" --prefix)/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" # Linux
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--cfg tokio_unstable"
cargo build --release
```

Чтение файлов в Tokio использует io_uring в Linux, когда это разрешает ядро. Сохраняйте `--cfg tokio_unstable`, когда задаёте `RUSTFLAGS`. Сборка записывает бинарный файл в `target/release/rapira`.

::: tip
Запустите `make test`, чтобы проверить конфигурацию сборки. Команда находит `libphp.so` или `libphp.dylib` через `PHP_CONFIG` и автоматически передаёт `--cfg tokio_unstable`.
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
LD_LIBRARY_PATH="$HOME/.local/share/php-zts/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml         # Linux
DYLD_LIBRARY_PATH="$HOME/.local/share/php-zts/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml   # macOS
```

::: tip OPcache в PHP 8.4
PHP 8.4 собирает OPcache как отдельный файл `opcache.so`. Задайте `zend_extension` с его абсолютным путём в `php.ini`, чтобы загрузить его. PHP 8.5 и PHP 8.6 включают OPcache в `libphp`.
:::

Результат предоставляет те же функции, что и сервер из пакета. См. разделы [Быстрый старт](/ru/docs/intro/quickstart), [Командная строка](/ru/docs/cli) и [Конфигурация](/ru/docs/configuration).

## Разработка самой Rapira

`make test` запускает модульные и сквозные тесты. `make stubs` заново создаёт каждый заголовок `*_arginfo.h` из файла `*.stub.php` рядом с ним в `crates/`. Команда использует `gen_stub.php` из PHP. Задайте `GEN_STUB`, если `make` не находит этот файл. Для каждого пул-реквеста CI запускает сборку, тесты, `cargo fmt`, Clippy и покрытие.

- `make test_unit` запускает модульные тесты рабочего пространства.
- `make test_e2e` собирает сервер и запускает сквозные тесты на его бинарном файле последовательно. `make test` запускает оба набора по порядку.
- `make coverage` записывает покрытие модульных и сквозных тестов в `lcov.info`. Нужны `cargo-llvm-cov` и компонент Rust `llvm-tools-preview`.
- `make grpc_fixtures` создаёт тестовые дескрипторы gRPC заново. По умолчанию цель использует Go. Задайте `BUF=/path/to/buf`, чтобы использовать установленную программу Buf.

[Руководство для участников разработки ядра](https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md) описывает размещение тестов, команды линтера и фаззинга. Процесс фаззинга запускает каждую цель на 60 секунд для пул-реквестов и на 30 минут дважды в неделю.
