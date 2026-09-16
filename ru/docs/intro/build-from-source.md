---
title: Сборка из исходников
description: "Когда и как собрать Rapira самому: инструменты Rust и C, PHP в сборке NTS с embed SAPI и тонкости линковки на Linux и macOS."
---

# Сборка из исходников

Rapira собирается из исходников на Linux и macOS. Самостоятельная сборка закрывает те случаи, которые не покрывают готовые бинарники со страницы [Установка](/ru/docs/intro/installation), а единственное требование сверх обычных инструментов Rust и C - это PHP, который Rapira сможет встроить.

## Когда собирать из исходников

- **Для вашей платформы нет готового бинарника** - необычная архитектура процессора или дистрибутив на musl вроде Alpine.
- **Дистрибутив старше, чем поддерживают пакеты.** Релизы собраны под glibc 2.34, так что самые старые системы, куда они встанут, - это Debian 12, Ubuntu 22.04 и RHEL 9 (подробности на странице [Установка](/ru/docs/intro/installation)).
- **Приложению нужны другие расширения PHP.** Релизные сборки включают SQLite, PostgreSQL через `pdo_pgsql` и `pgsql`, `bcmath`, `intl`, `igbinary` и `redis`. Полный список расширений приведён на странице [Установка](/ru/docs/intro/installation). Соберите Rapira с другим PHP, если приложению нужны расширения вроде `pdo_mysql` или `gd`.
- **Вы дорабатываете саму Rapira** или хотите то, что ещё не попало в релиз.

## Инструменты сборки

Для сборки нужны следующие инструменты:

- **Rust, стабильный канал.** Файл `rust-toolchain.toml` выбирает версию через [rustup](https://rustup.rs/).
- **Компилятор C и `pkg-config`.** Сборка компилирует небольшие прослойки C с заголовками PHP.
- **libclang.** Bindgen использует его для создания привязок Zend API. Пакет называется `libclang-dev` в Debian и Ubuntu, `clang-devel` в Fedora и `clang` в Arch.

## PHP с embed SAPI

Rapira линкует интерпретатор в свой процесс и не использует сокет. PHP должен быть разделяемой библиотекой NTS версии 8.4 или 8.5. Настройте PHP с `--enable-embed=shared`. Эта опция создаёт `libphp.so` или `libphp.dylib` в macOS.

::: warning Сборки ZTS отвергаются
Потокобезопасный PHP вызывает ошибку сборки. Rapira требует NTS, потому что каждый процесс воркера запускает один интерпретатор. Если `PATH` выбирает сборку ZTS, установите PHP NTS. Задайте путь к `php-config` через `PHP_CONFIG`.
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

В macOS установите зависимости для сборки:

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq
```

В каталоге исходников Rapira запустите цель для своей платформы:

::: code-group

```bash [Linux]
make php PHP_SRC=/path/to/php-src PHP_PREFIX="$HOME/.local/php-nts"
```

```bash [macOS]
make php-macos PHP_SRC=/path/to/php-src PHP_PREFIX="$HOME/.local/php-nts"
```

:::

Обе цели запускают `buildconf`, настраивают PHP, компилируют его и устанавливают в `PHP_PREFIX`. Они включают расширения, поставляемые с PHP и перечисленные в `.github/php-configure-flags.txt`. Цель `php-macos` задаёт пути к библиотекам Homebrew и путь SDK для iconv.

Для собственного набора расширений настройте PHP напрямую в каталоге его исходников. Добавьте параметры нужных расширений к `./configure`:

```bash
./buildconf --force
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

При ручной настройке в macOS используйте пути к библиотекам и параметры конфигурации из цели `php-macos`.

Релизный CI также собирает `igbinary` и `redis` в составе `libphp`, включая поддержку сериализации igbinary в Redis. Версии их исходников и контрольные суммы закреплены в [процессе сборки релизов](https://github.com/rapira-rs/rapira/blob/main/.github/workflows/build-binaries.yml). Распакуйте их исходники в каталоги PHP `ext/igbinary` и `ext/redis` перед запуском `./buildconf --force`. Добавьте `--enable-igbinary --enable-redis --enable-redis-igbinary` к `./configure`.

### Простое имя `libphp.so`

Сборка компонует `-lphp`. Она ищет библиотеку только в каталогах `lib` и `lib64` префикса PHP. Один из этих каталогов должен содержать `libphp.so` или `libphp.dylib` в macOS. Debian и Ubuntu предоставляют только версионный файл `libphp8.4.so`. Alpine помещает `libphp.so` в каталог `lib/phpXX`, который сборка не проверяет. Создайте ссылку с требуемым именем в каталоге `lib` или `lib64` префикса:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
sudo ln -sf /usr/lib/php84/libphp.so /usr/lib/libphp.so     # Alpine
```

Если прав root нет, сделайте симлинк в своём каталоге и покажите на него и линковщику, и загрузчику:

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

PHP находится через `php-config`. Если тот, что лежит в `PATH`, - не та сборка, которую вы хотите встроить, укажите нужную явно:

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
`make test` прогоняет наборы тестов и сам определяет пути к библиотекам: находит embed-библиотеку внутри префикса `php-config` (`lib`, `lib64`, `lib/phpXX`, простое или версионное имя) и приводит её к простому имени, которого ждёт линковщик. Запустите `make test`, чтобы проверить окружение, прежде чем полагаться на собственную сборку.
:::

## Запуск собранного бинарника

Во время работы Rapira подгружает `libphp.so` (на macOS - `libphp.dylib`) динамически. Если библиотека лежит в стандартном месте, делать ничего не нужно; если нет - укажите загрузчику путь к ней. Возьмите `worker.php` из раздела [Быстрый старт](/ru/docs/intro/quickstart). Создайте `rapira.toml` рядом с ним:

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

Результат предоставляет те же функции, что и сервер из пакета. См. разделы [Быстрый старт](/ru/docs/intro/quickstart), [Командная строка](/ru/docs/cli) и [Конфигурация](/ru/docs/configuration).

## Разработка самой Rapira

`make test` прогоняет оба набора тестов - внутрипроцессный и сквозной, который запускает настоящий бинарник; `make stubs` перегенерирует заголовок с arginfo из `crates/php_sys/rapira.stub.php`; а CI на каждый пул-реквест собирает проект и гоняет `cargo fmt`, clippy и покрытие.
