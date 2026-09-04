---
title: Сборка из исходников
description: "Когда и как собрать Rapira самому: инструменты Rust и C, PHP в сборке NTS с embed SAPI и тонкости линковки на Linux и macOS."
---

# Сборка из исходников

Rapira собирается из исходников на Linux и macOS. Самостоятельная сборка закрывает те случаи, которые не покрывают готовые бинарники со страницы [Установка](/ru/docs/intro/installation), а единственное требование сверх обычных инструментов Rust и C - это PHP, который Rapira сможет встроить.

## Когда собирать из исходников

- **Для вашей платформы нет готового бинарника** - необычная архитектура процессора или дистрибутив на musl вроде Alpine.
- **Дистрибутив старше, чем поддерживают пакеты.** Релизы собраны под glibc 2.34, так что самые старые системы, куда они встанут, - это Debian 12, Ubuntu 22.04 и RHEL 9 (подробности на странице [Установка](/ru/docs/intro/installation)).
- **Нужен другой набор расширений PHP.** В релизные сборки вложен PHP, собранный по списку флагов из [`ci/php-configure-flags.txt`](https://github.com/rapira-rs/rapira/blob/main/ci/php-configure-flags.txt), а список этот намеренно короткий: session, mbstring, OPcache, OpenSSL, curl, семейство XML, PDO с SQLite. Если приложению нужны `pdo_mysql`, `intl` или `gd`, соберите Rapira с тем PHP, где они есть.
- **Вы дорабатываете саму Rapira** или хотите то, что ещё не попало в релиз.

## Инструменты сборки

Для сборки нужны следующие инструменты:

- **Rust, стабильный канал.** Файл `rust-toolchain.toml` выбирает версию через [rustup](https://rustup.rs/).
- **Компилятор C и `pkg-config`.** Сборка компилирует небольшие прослойки C с заголовками PHP.
- **libclang.** Bindgen использует его для создания привязок Zend API. Пакет называется `libclang-dev` в Debian и Ubuntu, `clang-devel` в Fedora и `clang` в Arch.

## PHP с embed SAPI

Rapira линкует интерпретатор в свой процесс и не использует сокет. PHP должен быть разделяемой библиотекой NTS версии 8.4 или 8.5.
Настройте PHP с `--enable-embed=shared`. Эта опция создаёт `libphp.so` или `libphp.dylib` в macOS.

::: warning Сборки ZTS отвергаются
Потокобезопасный PHP вызывает ошибку сборки. Rapira требует NTS, потому что каждый процесс воркера запускает один интерпретатор.
Если `PATH` выбирает сборку ZTS, установите PHP NTS. Задайте путь к `php-config` через `PHP_CONFIG`.
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

Файл `ci/php-configure-flags.txt` содержит параметры выпусков. Передайте его в `configure` в распакованном каталоге исходного кода PHP.
Добавьте параметры нужных расширений:

```bash
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/ci/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

На macOS сначала поставьте зависимости (`brew install pkg-config openssl@3 curl oniguruma libxml2 sqlite`), добавьте их каталоги `lib/pkgconfig` в `PKG_CONFIG_PATH`, а после файла с флагами допишите `--with-iconv="$(xcrun --show-sdk-path)/usr"`: голый `--with-iconv` там libiconv не находит, а в autoconf побеждает последнее вхождение.

### Простое имя `libphp.so`

Сборка линкуется с `-lphp` и ищет библиотеку только в `lib` и `lib64` внутри префикса PHP, поэтому файл ровно с именем `libphp.so` (или `libphp.dylib`) должен лежать в одном из них. Debian и Ubuntu кладут только версионный `libphp8.4.so`, у Alpine имя простое, но сам файл лежит в `lib/phpXX`, который сборка не просматривает. И там, и там линковка падает, пока вы не положите в `lib` или `lib64` префикса симлинк с простым именем:

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

Когда PHP на месте, дальше всё как в любом проекте на Rust - обычная сборка через cargo:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
cargo build --release
```

Готовый бинарник окажется в `target/release/rapira`.

PHP находится через `php-config`. Если тот, что лежит в `PATH`, - не та сборка, которую вы хотите встроить, укажите нужную явно:

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
`make test` прогоняет наборы тестов и сам определяет пути к библиотекам: находит embed-библиотеку внутри префикса `php-config` (`lib`, `lib64`, `lib/phpXX`, простое или версионное имя) и приводит её к простому имени, которого ждёт линковщик. Запустите `make test`, чтобы проверить окружение, прежде чем полагаться на собственную сборку.
:::

## Запуск собранного бинарника

Во время работы Rapira подгружает `libphp.so` (на macOS - `libphp.dylib`) динамически. Если библиотека лежит в стандартном месте, делать ничего не нужно; если нет - укажите загрузчику путь к ней:

```bash
LD_LIBRARY_PATH="$HOME/.local/php-nts/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ./target/release/rapira serve --mode worker worker.php         # Linux
DYLD_LIBRARY_PATH="$HOME/.local/php-nts/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ./target/release/rapira serve --mode worker worker.php   # macOS
```

В результате получается тот же сервер, что ставится из пакетов: [Быстрый старт](/ru/docs/intro/quickstart) проведёт через первый скрипт, [Командная строка](/ru/docs/cli) перечисляет всё, что принимает `serve`, а [Конфигурация](/ru/docs/configuration) разбирает `rapira.toml`.

## Разработка самой Rapira

`make test` прогоняет оба набора тестов - внутрипроцессный и сквозной, который запускает настоящий бинарник; `make stubs` перегенерирует заголовок с arginfo из `crates/php_sys/rapira.stub.php`; а CI на каждый пул-реквест собирает проект и гоняет `cargo fmt`, clippy и покрытие.
