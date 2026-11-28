---
title: Установка
description: "Установите Rapira из deb-пакета, RPM-пакета или архива. Сверьте контрольную сумму. Узнайте, какая сборка libphp входит в артефакт."
faqLevel: 2
---

# Установка

Каждый пакет или архив для Linux или macOS содержит бинарный файл `rapira` и его потокобезопасную (ZTS) библиотеку интерпретатора `libphp`. Сервер загружает эту библиотеку в свой процесс. Эти пакеты и архивы не содержат команду `php`, php-fpm или каталог с ini. Rapira не требует системной установки PHP. ZIP-архивы для Windows описаны в разделе [Windows](#windows).

::: question Что такое `libphp` и чем она отличается от команды PHP?
PHP собирает несколько интерфейсов к своему движку. Эти интерфейсы называют Server Application Programming Interfaces, или SAPI. Каждый использует движок Zend и расширения, но у каждого свой программный интерфейс:

| SAPI | Что получается | Кто управляет |
| --- | --- | --- |
| CLI | команда `php` | PHP: запускается, выполняет скрипт, завершается. |
| FPM | `php-fpm` | PHP: слушает сокет и держит пул воркеров. |
| embed | `libphp.so` | Программа-хост: вызывает интерпретатор как любую другую библиотеку. |

Rapira включает embed SAPI, потому что запросами управляет сервер. Команда `php` использует другой SAPI, поэтому артефакты её не содержат.
:::

::: question Почему Rapira включает свою `libphp`?
Чтобы получить `libphp.so`, PHP нужно собрать с `--enable-embed=shared`. Такую сборку предоставляют немногие дистрибутивы. Fedora и RHEL предоставляют `php-embedded`, а Arch предоставляет `php-embed`. Deb.sury.org предоставляет `libphpX.Y-embed` для Debian и Ubuntu.

У этих пакетов фиксированные версии PHP и наборы расширений. PHP из Homebrew не включает embed SAPI. Поэтому каждый релиз Rapira собирает `libphp` из официального архива исходников PHP и включает её вместе с бинарником.
:::

::: question Что значит «PHP работает внутри процесса Rapira»?
При инициализации процесс `rapira` загружает `libphp` в своё адресное пространство. Rapira вызывает функции PHP в том же процессе. Сокет, FastCGI и сериализация запроса не используются. Библиотека остаётся отдельным файлом рядом с бинарником. Поэтому не переносите бинарник без библиотеки. См. [Архивы для Linux и macOS](#архивы-для-linux-и-macos).
:::

## Выбор версии PHP

Имя каждого файла для скачивания содержит `php8.4`, `php8.5` или `php8.6`. Этот текст указывает минорную версию PHP для его `libphp`. Выберите 8.5 или 8.6, если зависимость приложения не требует 8.4.

Несколько воркеров с включённым OPcache требуют [исправление блокировки потоков PHP](https://github.com/php/php-src/commit/36c6d1f500f7ec477f6eae0b0f5c46b041d82347). Rapira проверяет наличие версии PHP 8.4.29, 8.5.14 или 8.6.1 либо новее в каждой минорной ветке.

Rapira не использует и не изменяет установленный системный PHP, пул php-fpm или PHP из Homebrew. Composer, `bin/console` и `artisan` по-прежнему используют системный PHP CLI.

::: question Почему для каждой версии PHP своя сборка Rapira?
`libphp` в артефакте является частью сборки, и её нельзя заменить. Бинарник `rapira` слинкован с одной конкретной библиотекой. ABI PHP меняется между минорными версиями. Поэтому одна сборка Rapira поддерживает одну минорную версию PHP. Имя файла указывает эту версию. Вам не нужно устанавливать PHP или настраивать `php-config`.
:::

::: question Как переключить минорную версию PHP?
Установите пакет для другой версии PHP. Менеджер пакетов заменит установленный пакет Rapira. Оба пакета используют одни и те же пути. Они объявляют `provides`, `conflicts` и `replaces`, а для RPM `obsoletes`. Установки из архивов используют отдельные каталоги и могут существовать одновременно. Запускайте каждую версию из её пути.
:::

## Артефакты релиза

Файлы для Linux и macOS находятся на [странице релизов Rapira](https://github.com/rapira-rs/rapira/releases). Файлы для Windows находятся на [странице релизов Rapira для Windows](https://github.com/rapira-rs/rapira-windows/releases). На [странице загрузки](/ru/download) выберите ОС, архитектуру, версию PHP и формат пакета. Она также показывает значение SHA-256. У каждого артефакта `php8.5` есть соответствующие артефакты `php8.4` и `php8.6`.

На Linux используйте пакет для стандартного расположения файлов и автоматических зависимостей от библиотек. Используйте архив для одного каталога, образа контейнера, артефакта деплоя или установки без прав root. Архиву для Linux также нужны системные библиотеки. Их список приведён в разделе [Архивы для Linux и macOS](#архивы-для-linux-и-macos).

До установки проверьте файл с помощью `rapira-v0.9.0-SHA256SUMS.txt`. См. [Проверка контрольных сумм](#проверка-контрольных-сумм).

::: question Зачем проверять контрольную сумму до установки?
Пакеты `.deb` и `.rpm` выполняют установочные скрипты от root. Изменённый пакет может выполнить нежелательный код с правами root. Проверка контрольной суммы обнаруживает изменённый пакет до установки.
:::

## Debian и Ubuntu

Скачайте файл `.deb`. Установите его через `apt`, указав путь:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-php8.5_0.9.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.9.0-1_amd64.deb
rapira --version
```

Пакет устанавливает сервер без юнита службы, файла конфигурации и каталога с ini. Настройка systemd описана на странице [Запуск в продакшене](/ru/docs/deployment).

Пакетам для PHP 8.4 и PHP 8.5 нужны glibc 2.34 и OpenSSL 3.0 или новее, например **Debian 12 и Ubuntu 22.04**. Пакетам для PHP 8.6 нужен OpenSSL 3.3 или новее, например **Debian 13 и Ubuntu 26.04**. На Debian 12 и Ubuntu 24.04 используйте PHP 8.4 или PHP 8.5 либо обновите OpenSSL.

::: question Зачем `./` в начале пути к файлу?
`./` в начале сообщает apt, что это локальный файл, а не имя пакета из репозитория.
:::

::: question Какие файлы устанавливает пакет?
Пакет устанавливает `/usr/bin/rapira`, `/usr/lib/rapira/libphp.so` и библиотеки, которые нужны `libphp.so`, в `/usr/lib/rapira/`. На PHP 8.4 он также устанавливает `/usr/lib/rapira/opcache.so`. Лицензию и README он устанавливает в `/usr/share/doc/rapira/`.
:::

## RHEL, Rocky и Fedora

Установите RPM через `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-php8.5-0.9.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.9.0-1.x86_64.rpm
rapira --version
```

RPM для PHP 8.4 и PHP 8.5 требуют glibc 2.34 и OpenSSL 3.0 или новее, например **RHEL 9**, Rocky 9, AlmaLinux 9 и Fedora. RPM для PHP 8.6 требуют OpenSSL 3.3 и **RHEL 9.7** или новее.

## Архивы для Linux и macOS

Архив распаковывается в один каталог, который содержит весь сервер:

```text
rapira-v0.9.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

В Linux каталог `lib/rapira` содержит `libphp.so` и необходимые ей библиотеки. На PHP 8.4 каталог `lib/rapira` также содержит `opcache.so` в Linux и macOS.

Перенесите каталог в его постоянное расположение. Добавьте симлинк на бинарник в `PATH`:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.9.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.9.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-php8.5-macos-aarch64.tar.gz
tar xzf rapira-v0.9.0-php8.5-macos-aarch64.tar.gz
sudo mv rapira-v0.9.0-php8.5-macos-aarch64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

:::

### Установка без прав root

Для установки без прав root сохраните весь каталог в домашнем каталоге. Создайте симлинк в `~/.local/bin`:

```bash
mkdir -p "$HOME/.local/opt" "$HOME/.local/bin"
mv rapira-v0.9.0-php8.5-linux-x86_64 "$HOME/.local/opt/rapira"
ln -s "$HOME/.local/opt/rapira/bin/rapira" "$HOME/.local/bin/rapira"
"$HOME/.local/bin/rapira" --version
```

В macOS замените имя исходного каталога на имя распакованного каталога macOS. Добавьте `$HOME/.local/bin` в `PATH`, если оболочка ещё не использует этот каталог.

::: warning
Бинарник находит свой интерпретатор по относительному пути. Переносите весь каталог целиком. Не копируйте только `bin/rapira` в `/usr/local/bin/`. Используйте симлинк, как показано выше.
:::

::: question Почему симлинк работает, а копия бинарника нет?
Бинарник содержит **относительный rpath** к интерпретатору. Linux использует `$ORIGIN/../lib/rapira`, а macOS использует `@loader_path/../lib/rapira`. Загрузчик разрешает симлинк до того, как разрешает rpath. Поэтому rpath отсчитывается от фактического расположения бинарника. У копии в `/usr/local/bin` нет соседнего каталога `lib/rapira`, и она не находит интерпретатор.
:::

::: question Какие системные библиотеки нужны для архива?
В macOS каталог `lib/rapira` содержит `libphp.dylib` и все необходимые несистемные библиотеки. Каталог самодостаточен.

В Linux каталог `lib/rapira` содержит `libphp.so` и библиотеки из её сборки, например ICU, libxml2, SQLite, Oniguruma и libpq. Система должна предоставлять OpenSSL 3.0 (OpenSSL 3.3 или новее для PHP 8.6), libcurl, zlib и libstdc++. Пакеты deb и RPM объявляют эти библиотеки, glibc и libgcc своими зависимостями.
:::

## Проверка контрольных сумм

В каждом релизе для Linux и macOS есть один файл контрольных сумм для всех файлов релиза. Проверяйте только скачанный файл. На Linux используйте `--ignore-missing`. На macOS используйте `grep`, чтобы передать нужную строку в `shasum`:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-SHA256SUMS.txt
sha256sum -c --ignore-missing rapira-v0.9.0-SHA256SUMS.txt
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-SHA256SUMS.txt
grep rapira-v0.9.0-php8.5-macos-aarch64.tar.gz rapira-v0.9.0-SHA256SUMS.txt | shasum -a 256 -c
```

:::

## Docker

Образ контейнера `ghcr.io/rapira-rs/rapira` содержит Rapira, потокобезопасный (ZTS) PHP и распространённые расширения PHP на Debian Trixie. Добавьте в образ своё приложение:

```dockerfile
FROM ghcr.io/rapira-rs/rapira:php8.5
COPY . /app
```

Образ запускает `rapira serve /app/rapira.toml`. Запускайте контейнер командой `docker run --init`, чтобы процесс init убирал завершившиеся дочерние процессы. В каталоге приложения лежит `rapira.toml`:

```toml
[http]
listen = ":8000"

[http.pool]
entrypoint = "/app/public/index.php"
mode = "classic"
```

Образ содержит `/usr/local/bin/rapira` и PHP в `/usr/local`, в том числе `/usr/local/lib/libphp.so`. Переменная окружения `PHP_VERSION` содержит патч-версию PHP. В PHP 8.4 OPcache поставляется отдельным файлом `opcache.so` с INI-файлом, который его включает. В PHP 8.5 и PHP 8.6 OPcache входит в `libphp.so`.

Все образы включают `bcmath`, `intl`, `mbstring`, `pdo_pgsql`, `pgsql` и `sodium`. Образы PHP 8.4 и PHP 8.5 также включают `igbinary`. Rapira не поставляет расширение `redis`.

В образе есть вспомогательные команды официального образа PHP: `docker-php-ext-install`, `docker-php-ext-enable`, `docker-php-ext-configure`, `docker-php-source` и `docker-php-entrypoint`. Используйте расширения, совместимые с ZTS, когда добавляете их в образ командой `docker-php-ext-install`:

```dockerfile
FROM ghcr.io/rapira-rs/rapira:php8.5
RUN docker-php-ext-install pdo_mysql
COPY . /app
```

В образах PHP 8.6 нет команд `pecl` и `pear`, как и в официальном образе PHP 8.6.

Каждый тег указывает свою минорную версию PHP. Эти теги поддерживают amd64 и arm64:

| Тег | На что указывает |
| --- | --- |
| `X.Y.Z-php8.4`, `X.Y.Z-php8.5`, `X.Y.Z-php8.6` | Один релиз. Для самого нового релиза обновление PHP сдвигает этот тег на новую сборку. |
| `X.Y-php8.4`, `X.Y-php8.5`, `X.Y-php8.6` | Самый новый стабильный релиз с версией `X.Y`. |
| `php8.4`, `php8.5`, `php8.6` | Самый новый стабильный релиз. |
| `nightly-php8.4`, `nightly-php8.5`, `nightly-php8.6` | Самая новая ночная сборка. |

Реестр также содержит теги для отдельных архитектур, например `X.Y.Z-php8.5-amd64` и `X.Y.Z-php8.5-arm64`.

Тега `latest` нет. Каждая сборка Rapira использует заголовки одной минорной версии PHP. Rapira не запускается с `libphp.so` от другой минорной версии PHP. Поэтому каждый тег называет минорную версию PHP, которую он содержит.

::: question На что указывает ночной тег?
Каждый успешный прогон CI на `main` собирает образы из этого коммита. Сборка получает неизменяемый тег `X.Y.Z-nightly.<short-sha>-php8.5`. `X.Y.Z` - это версия в репозитории. `<short-sha>` - это первые семь символов идентификатора коммита. Тег `nightly-php8.5` указывает на эту сборку. Реестр хранит десять самых новых ночных сборок.
:::

### Базовые образы

Rapira собирает свои образы на основе [официальных образов PHP](https://hub.docker.com/_/php) на Debian Trixie: `php:8.4-zts-trixie`, `php:8.5-zts-trixie` и `php:8.6-cli-trixie`. Официальный образ PHP 8.6 CLI включает ZTS и библиотеку embed.

### Обновления при релизах PHP

Workflow в GitHub Actions проверяет дайджест каждого базового образа PHP каждые 15 минут. Когда официальный образ PHP изменяется, workflow заново собирает самый новый релиз Rapira на этом образе и сдвигает его теги. Так образы получают патч-релизы PHP и исправления пакетов Debian без нового релиза Rapira.

## Сборка libphp

Релизные пакеты и архивы для Linux и macOS используют `libphp`, собранную с `--disable-all` и следующим фиксированным набором расширений:

- **Основа рантайма**: session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar, posix.
- **OPcache** и PCRE с включённым JIT. На PHP 8.4 OPcache является отдельным файлом `opcache.so`. См. [php.ini](#php-ini).
- **Сеть и сжатие**: openssl, curl, zlib, sockets, ftp.
- **XML**: libxml, dom, xml, simplexml, xmlreader, xmlwriter.
- **Базы данных**: PDO с `pdo_sqlite` и `pdo_pgsql`, а также `sqlite3` и `pgsql`.
- **Десятичная арифметика и интернационализация**: bcmath и intl.
- **Сериализация**: igbinary на PHP 8.4 и PHP 8.5. Rapira не поставляет расширение `redis`.
- **Криптография**: sodium.
- **Разделяемая память и System V IPC**: shmop, sysvmsg, sysvsem, sysvshm.
- **Даты, метаданные изображений и переводы**: calendar, exif, gettext.
- **Интерфейс к внешним функциям**: ffi.
- **Обязательные компоненты PHP**: Core, standard, SPL, date, json, hash, random, Reflection.

Для других расширений, например `pdo_mysql`, APCu или Imagick, соберите `libphp` с нужными параметрами. Затем скомпилируйте Rapira с этой библиотекой. См. [Сборка из исходников](/ru/docs/intro/build-from-source).

Каждый артефакт использует патч-релиз из своей ветки PHP 8.4, PHP 8.5 или PHP 8.6. В архиве точная версия записана в `share/php/PHP_VERSION.txt`. На работающем сервере её сообщают `PHP_VERSION` и `phpinfo()`. Если задан `[observability.metrics]`, её также сообщает метка `php_version` метрики `rapira_build_info`. См. [Метрики и проверки работоспособности](/ru/docs/observability). `rapira --version` показывает только версию Rapira.

::: question Почему `PHP_SAPI` возвращает `fastcgi` на PHP 8.4?
На PHP 8.4 OPcache запускается только для фиксированного списка имён SAPI. Rapira регистрирует SAPI под именем `fastcgi`, чтобы включить OPcache. В PHP 8.5 и PHP 8.6 этот список убрали, поэтому `PHP_SAPI` и `php_sapi_name()` возвращают `rapira`. Строка *Server API* в `phpinfo()` показывает `Rapira` для всех версий. Код, который проверяет `PHP_SAPI`, должен принимать оба значения.
:::

## php.ini

Пакеты и архивы для Linux и macOS не содержат `php.ini`, и Rapira его не создаёт. Без этого файла PHP использует свои встроенные значения по умолчанию. Rapira изменяет два из них: задаёт `display_errors=0` и `log_errors=1`. Значение в `php.ini` переопределяет эти две настройки. См. [Логирование](/ru/docs/logging). Укажите в `PHPRC` файл или каталог для поиска:

```bash
PHPRC=/etc/rapira/php.ini rapira serve /etc/rapira/rapira.toml
```

На PHP 8.4 OPcache является отдельным файлом `opcache.so` в `lib/rapira`. PHP не загружает этот файл автоматически. Добавьте его абсолютный путь в `php.ini`:

```ini
; пакет deb или RPM
zend_extension=/usr/lib/rapira/opcache.so
; архив в /opt/rapira
;zend_extension=/opt/rapira/lib/rapira/opcache.so
```

На PHP 8.5 и PHP 8.6 OPcache входит в `libphp`. Эта строка не нужна.

::: question Где PHP сам ищет `php.ini`?
Сначала PHP проверяет `PHPRC`. Затем он проверяет путь по умолчанию, заданный при сборке PHP. Обычно этого пути нет в целевой системе. Rapira не читает `php.ini` из текущего каталога.
:::

::: question Почему файл называется `php.ini`, а не `php-rapira.ini`?
PHP сначала ищет `php-<sapi-name>.ini`, а затем `php.ini`. Имя SAPI равно `fastcgi` на 8.4 и `rapira` на 8.5 и 8.6. Обычный `php.ini` подходит для обеих версий.
:::

## Распространение

GitHub Releases содержит архивы, пакеты и файлы контрольных сумм. `ghcr.io/rapira-rs/rapira` содержит образы контейнеров. Репозитория для apt или yum пока нет. Чтобы обновить пакет, скачайте и установите новую версию. Менеджер пакетов заменит установленную версию.

Чтобы обновить архив, распакуйте новый каталог рядом со старым. Затем измените симлинк. Сохраните предыдущий каталог, если вам может понадобиться откат.

Каждый успешный прогон CI на `main` выкладывает архивы и файл контрольных сумм в предрелиз `nightly` на GitHub Releases, кроме релизных коммитов. Предрелиз не содержит пакеты `.deb` и `.rpm`. Ночная сборка не является релизом. Ночные теги контейнеров описаны в разделе [Docker](#docker). Ссылка на ночные сборки есть на [странице загрузки](/ru/download).

Сборка для macOS поддерживает **Apple Silicon** и **macOS 26 или новее**. Минимальная версия равна основной версии macOS раннера GitHub `macos-latest`, который собирает релиз. Сборка использует подпись ad hoc без Developer ID и нотаризации. Перед первым запуском macOS может запросить подтверждение. Сборки для Intel нет.

## Windows {#windows}

[rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows) предоставляет сборки для Windows для локальной разработки. В продакшене используйте Linux или macOS.

Сборка x64 поддерживает Windows 10, Windows 11 и Windows Server. Сборка ARM64 поддерживает Windows 11. Установите [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) для вашей архитектуры.

Выполните эту команду в Windows PowerShell 5.1 или PowerShell 7:

```powershell
irm https://rapira.rs/install.ps1 | iex
```

Установщик определяет архитектуру и скачивает последний стабильный релиз с PHP 8.5. Он проверяет контрольную сумму SHA256. Он устанавливает весь комплект в `%LOCALAPPDATA%\Programs\Rapira` и добавляет этот каталог в пользовательский `PATH` и `PATH` текущего PowerShell. Он отказывается от установки, если целевой каталог уже существует. Для установки Rapira не нужны права администратора.

Запустите Rapira из любого каталога:

```powershell
rapira serve C:\app\rapira.toml
```

Использование PHP 8.4, другого каталога установки, конфигурация и расширения описаны в [README для Windows](https://github.com/rapira-rs/rapira-windows/blob/main/README.md).

Вы также можете скачать ZIP из [релизов для Windows](https://github.com/rapira-rs/rapira-windows/releases). Проверьте его по соответствующему файлу `rapira-v<VERSION>-windows-<x86_64|arm64>-SHA256SUMS.txt`. Распакуйте весь ZIP в один каталог. Сохраните вместе `rapira.exe`, соответствующую среду ZTS PHP, DLL расширений и `php.ini`. Запустите `.\rapira.exe` из этого каталога.

[Быстрый старт](/ru/docs/intro/quickstart) описывает, как обработать первый запрос после установки бинарника.
