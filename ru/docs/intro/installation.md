---
title: Установка
description: "Установите Rapira из deb-пакета, RPM-пакета или архива. Сверьте контрольную сумму. Узнайте, какая сборка libphp входит в артефакт."
faqLevel: 2
---

# Установка

Каждый пакет или архив для Linux или macOS содержит бинарный файл `rapira` и библиотеку интерпретатора `libphp`. Сервер загружает эту библиотеку в свой процесс. Эти пакеты и архивы не содержат команду `php`, php-fpm или каталог с ini. Rapira не требует системной установки PHP. ZIP-архивы для Windows описаны в разделе [Windows](#windows).

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

Имя каждого файла для скачивания содержит `php8.4` или `php8.5`. Этот текст указывает минорную версию PHP для его `libphp`. Выберите 8.5, если зависимость приложения не требует 8.4.

Rapira не использует и не изменяет установленный системный PHP, пул php-fpm или PHP из Homebrew. Composer, `bin/console` и `artisan` по-прежнему используют системный PHP CLI.

::: question Почему для каждой версии PHP своя сборка Rapira?
`libphp` в артефакте является частью сборки, и её нельзя заменить. Бинарник `rapira` слинкован с одной конкретной библиотекой. ABI PHP меняется между минорными версиями. Поэтому одна сборка Rapira поддерживает одну минорную версию PHP. Имя файла указывает эту версию. Вам не нужно устанавливать PHP или настраивать `php-config`.
:::

::: question Как переключиться с 8.4 на 8.5?
Установите пакет для другой версии PHP. Менеджер пакетов заменит установленный пакет Rapira. Оба пакета используют одни и те же пути. Они объявляют `provides`, `conflicts` и `replaces`, а для RPM `obsoletes`. Установки из архивов используют отдельные каталоги и могут существовать одновременно. Запускайте каждую версию из её пути.
:::

## Артефакты релиза

Файлы для Linux и macOS находятся на [странице релизов Rapira](https://github.com/rapira-rs/rapira/releases). Файлы для Windows находятся на [странице релизов Rapira для Windows](https://github.com/rapira-rs/rapira-windows/releases). На [странице загрузки](/ru/download) выберите ОС, архитектуру, версию PHP и формат пакета. Она также показывает значение SHA-256. У каждого артефакта `php8.5` есть соответствующий артефакт `php8.4`.

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

Пакетам нужна glibc 2.34 или новее. Минимальные поддерживаемые версии: **Debian 12 и Ubuntu 22.04**.

::: question Зачем `./` в начале пути к файлу?
`./` в начале сообщает apt, что это локальный файл, а не имя пакета из репозитория.
:::

::: question Какие файлы устанавливает пакет?
Пакет устанавливает `/usr/bin/rapira`, `/usr/lib/rapira/libphp.so` и библиотеки ICU в `/usr/lib/rapira/`. На PHP 8.4 он также устанавливает `/usr/lib/rapira/opcache.so`. Лицензию и README он устанавливает в `/usr/share/doc/rapira/`.
:::

## RHEL, Rocky и Fedora

Установите RPM через `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-php8.5-0.9.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.9.0-1.x86_64.rpm
rapira --version
```

RPM нужна glibc 2.34 или новее. **RHEL 9**, Rocky 9, AlmaLinux 9 и актуальные версии Fedora выполняют это требование.

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

В Linux каталог `lib/rapira` содержит `libphp.so` и необходимые библиотеки ICU. На PHP 8.4 каталог `lib/rapira` также содержит `opcache.so` в Linux и macOS.

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

В Linux каталог `lib/rapira` содержит `libphp.so` и библиотеки ICU из её сборки. Система должна предоставлять OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib, libpq и libstdc++. Пакеты deb и RPM объявляют эти библиотеки, glibc и libgcc своими зависимостями.
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

Образ контейнера `ghcr.io/rapira-rs/rapira` содержит бинарник `rapira` и его `libphp.so`. Образ использует `FROM scratch`, и в нём нет базовой системы, оболочки и точки входа. Сам по себе он не запускается. Скопируйте его файлы в образ приложения:

```dockerfile
FROM php:8.5-cli-trixie
COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /
RUN apt-get update \
    && xargs -r apt-get install -y --no-install-recommends < /usr/local/share/rapira/debian-packages.txt \
    && rm -rf /var/lib/apt/lists/*
COPY . /app
CMD ["rapira", "serve", "/app/rapira.toml"]
```

В каталоге приложения лежит `rapira.toml`:

```toml
[http]
listen = ":8000"

[http.pool]
entrypoint = "/app/public/index.php"
mode = "classic"
```

Образ содержит `/usr/local/bin/rapira`, `/usr/local/lib/libphp.so` и OPcache. В PHP 8.4 OPcache поставляется отдельным файлом `opcache.so` с ini-файлом. В PHP 8.5 он входит в `libphp.so`.

Образ также включает `bcmath`, `intl`, `pdo_pgsql`, `pgsql`, `igbinary` и `redis` как разделяемые модули с INI-файлами, которые их включают. Redis поддерживает сериализацию igbinary.

Каталог `/usr/local/share/rapira` содержит ещё два файла. В `PHP_VERSION.txt` указана патч-версия вложенного PHP. `debian-packages.txt` перечисляет пакеты, необходимые для работы `libphp` и её разделяемых расширений. Установите эти пакеты в образ приложения, в том числе если базовый образ содержит PHP.

Сборка образа использует `libphp.so` из `php:8.4-cli-trixie` или `php:8.5-cli-trixie`. Она добавляет шесть разделяемых расширений, перечисленных выше. Добавляйте другие расширения в базовый образ приложения. В базовом образе PHP команда `docker-php-ext-install` собирает их для той же `libphp.so`.

::: question Почему образ построен `FROM scratch`?
Образ scratch содержит только файлы, которые сборка копирует в него. Поэтому `COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /` копирует только файлы Rapira. Базовый образ приложения выбираете вы.
:::

Каждый тег указывает свою минорную версию PHP. Эти теги поддерживают amd64 и arm64:

| Тег | На что указывает |
| --- | --- |
| `X.Y.Z-php8.4`, `X.Y.Z-php8.5` | Одна релизная сборка. Тег никогда не сдвигается. |
| `X.Y-php8.4`, `X.Y-php8.5` | Самый новый стабильный релиз с версией `X.Y`. |
| `php8.4`, `php8.5` | Самый новый стабильный релиз. |
| `nightly-php8.4`, `nightly-php8.5` | Самая новая ночная сборка. |

Реестр также содержит теги для отдельных архитектур, например `X.Y.Z-php8.5-amd64` и `X.Y.Z-php8.5-arm64`.

Тега `latest` нет. Каждая сборка Rapira использует заголовки одной минорной версии PHP. Rapira не запускается с `libphp.so` от другой минорной версии PHP. Поэтому каждый тег называет минорную версию PHP, которую он содержит.

::: question На что указывает ночной тег?
Каждый успешный прогон CI на `main` собирает образы из этого коммита. Сборка получает неизменяемый тег `X.Y.Z-nightly.<short-sha>-php8.5`. `X.Y.Z` - это версия в репозитории. `<short-sha>` - это первые семь символов идентификатора коммита. Тег `nightly-php8.5` указывает на эту сборку. Реестр хранит десять самых новых ночных сборок.
:::

## Сборка libphp

Релизные пакеты и архивы для Linux и macOS используют `libphp`, собранную с `--disable-all` и следующим фиксированным набором расширений:

- **Основа рантайма**: session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar, posix.
- **OPcache** и PCRE с включённым JIT. На PHP 8.4 OPcache является отдельным файлом `opcache.so`. См. [php.ini](#php-ini).
- **Сеть и сжатие**: openssl, curl, zlib, sockets, ftp.
- **XML**: libxml, dom, xml, simplexml, xmlreader, xmlwriter.
- **Базы данных**: PDO с `pdo_sqlite` и `pdo_pgsql`, а также `sqlite3` и `pgsql`.
- **Десятичная арифметика и интернационализация**: bcmath и intl.
- **Сериализация и кеширование**: igbinary и redis с поддержкой сериализации igbinary в Redis.
- **Разделяемая память и System V IPC**: shmop, sysvmsg, sysvsem, sysvshm.
- **Даты, метаданные изображений и переводы**: calendar, exif, gettext.
- **Интерфейс к внешним функциям**: ffi.
- **Обязательные компоненты PHP**: Core, standard, SPL, date, json, hash, random, Reflection.

Для других расширений, например `pdo_mysql`, APCu или Imagick, соберите `libphp` с нужными параметрами. Затем скомпилируйте Rapira с этой библиотекой. См. [Сборка из исходников](/ru/docs/intro/build-from-source).

Каждый артефакт использует последнюю доступную патч-версию своей ветки PHP 8.4 или PHP 8.5. В архиве точная версия записана в `share/php/PHP_VERSION.txt`. На работающем сервере её сообщают `PHP_VERSION` и `phpinfo()`. Если задан `[observability.metrics]`, её также сообщает метка `php_version` метрики `rapira_build_info`. См. [Метрики и проверки работоспособности](/ru/docs/observability). `rapira --version` показывает только версию Rapira.

::: question Почему `PHP_SAPI` возвращает `fastcgi` на PHP 8.4?
На PHP 8.4 OPcache запускается только для фиксированного списка имён SAPI. Rapira регистрирует SAPI под именем `fastcgi`, чтобы включить OPcache. В PHP 8.5 этот список убрали, поэтому `PHP_SAPI` и `php_sapi_name()` возвращают `rapira`. Строка *Server API* в `phpinfo()` показывает `Rapira` для обеих версий. Код, который проверяет `PHP_SAPI`, должен принимать оба значения.
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

На PHP 8.5 OPcache входит в `libphp`. Эта строка не нужна.

::: question Где PHP сам ищет `php.ini`?
Сначала PHP проверяет `PHPRC`. Затем он проверяет путь по умолчанию, заданный при сборке PHP. Обычно этого пути нет в целевой системе. Rapira не читает `php.ini` из текущего каталога.
:::

::: question Почему файл называется `php.ini`, а не `php-rapira.ini`?
PHP сначала ищет `php-<sapi-name>.ini`, а затем `php.ini`. Имя SAPI равно `fastcgi` на 8.4 и `rapira` на 8.5. Обычный `php.ini` подходит для обеих версий.
:::

## Распространение

GitHub Releases содержит архивы, пакеты и файлы контрольных сумм. `ghcr.io/rapira-rs/rapira` содержит образы контейнеров. Репозитория для apt или yum пока нет. Чтобы обновить пакет, скачайте и установите новую версию. Менеджер пакетов заменит установленную версию.

Чтобы обновить архив, распакуйте новый каталог рядом со старым. Затем измените симлинк. Сохраните предыдущий каталог, если вам может понадобиться откат.

Каждый успешный прогон CI на `main` выкладывает архивы и файл контрольных сумм в предрелиз `nightly` на GitHub Releases, кроме релизных коммитов. Предрелиз не содержит пакеты `.deb` и `.rpm`. Ночная сборка не является релизом. Ночные теги контейнеров описаны в разделе [Docker](#docker).

Сборка для macOS поддерживает **Apple Silicon** и **macOS 14 или новее**. Она использует подпись ad hoc без Developer ID и нотаризации. Перед первым запуском macOS может запросить подтверждение. Сборки для Intel нет.

## Windows {#windows}

[rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows) предоставляет сборки для Windows для локальной разработки. В продакшене используйте Linux или macOS. Последний стабильный релиз для Windows - v0.8.0. Его конфигурация и набор расширений описаны в [README релиза](https://github.com/rapira-rs/rapira-windows/blob/v0.8.0/README.md).

Сборка x64 поддерживает Windows 10, Windows 11 и Windows Server. Сборка ARM64 поддерживает Windows 11. Установите [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) для выбранной архитектуры. Распакуйте весь ZIP в один каталог. Сохраните вместе `rapira.exe`, соответствующую среду ZTS PHP, DLL расширений и `php.ini`.

Windows v0.8.0 обслуживает только HTTP. Его конфигурация использует таблицу `[pool]` верхнего уровня. Запустите его из каталога распакованного архива:

```powershell
.\rapira.exe serve --config C:\app\rapira.toml
```

Этот релиз не поддерживает конфигурацию быстрого старта v0.9 и gRPC. Его профиль PHP не содержит OpenSSL, cURL, SQLite, XML и iconv. Каждый релиз для Windows содержит один файл `rapira-v<VERSION>-windows-<x86_64|arm64>-SHA256SUMS.txt` для каждой архитектуры.

[Текущие исходники для Windows](https://github.com/rapira-rs/rapira-windows/blob/main/README.md) реализуют конфигурацию плагинов v0.9 и gRPC. Они используют `rapira serve CONFIG` и отдельный пул потоков интерпретатора для каждого плагина. Они отклоняют `[observability]`, `grpc.interceptors` и `[grpc.auth]`. Эти функции отсутствуют в стабильной сборке v0.8.0.

[Быстрый старт](/ru/docs/intro/quickstart) описывает, как обработать первый запрос после установки бинарника.
