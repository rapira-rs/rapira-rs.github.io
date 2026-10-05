---
title: Конфигурация
description: "Все ключи rapira.toml, их типы, значения по умолчанию и правила проверки."
---

# Конфигурация

Rapira требует файл конфигурации. Команда `rapira serve` принимает путь к нему единственным аргументом. Имя файла может быть любым, а эта документация использует `rapira.toml`:

```bash
rapira serve /etc/rapira/rapira.toml
```

Файл задаёт адрес, число воркеров, политику замены, pidfile и уровень логирования. Значение в файле переопределяет встроенное значение по умолчанию.

`[http]` и `[grpc]` настраивают отдельные слушатели и пулы PHP-воркеров. Настройте хотя бы одну из этих секций. Необязательная секция `[observability]` настраивает слушатель для метрик и проверок состояния. `[supervisor]` настраивает мастер-процесс. `[log]` настраивает вывод в stderr.

Каждому включённому пулу HTTP или gRPC нужен входной PHP-скрипт. Задайте `http.pool.entrypoint`, `grpc.pool.entrypoint` или оба ключа.

## Полный rapira.toml

Следующая конфигурация включает оба протокола и показывает поддерживаемые таблицы. Большинство отсутствующих ключей используют стандартное значение. Каждому пулу требуется `entrypoint`. Таблица `[http.static]` требует `http.static.root`.

Некоторые ключи должны использоваться вместе. Таблица `[http.static]` требует элемент `"static"` в `middleware`, и этот элемент требует таблицу. Таблица `[grpc.auth]` и элемент `"auth"` в списке перехватчиков подчиняются тому же правилу.

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # Optional. Sets SERVER_NAME for PHP.
server_port = 8000                    # Optional. Uses the TCP listen port by default.
max_body_size_mb = 8                  # Optional. Rapira returns 413 for larger request bodies.
write_timeout_secs = 30               # Optional. Closes a connection after a response write times out.
keepalive_timeout_secs = 60           # Optional. Limits idle periods and read operations.
unsafe_field_names = "drop"           # Optional. Use "drop" or "reject". Default: "drop".
middleware = ["static"]               # Optional. Rapira uses the list order.

[http.static]                         # Required when middleware contains "static".
root = "public"                       # Required. Relative paths use this file's directory.
forbid = [".php"]                     # Optional. Rapira does not serve these suffixes.

[http.sendfile]                       # Optional. Sets the sendFile() root in Dispatcher mode.
root = "public"                       # Optional. Uses the entry script directory by default.

[http.uploads]                        # Optional. Sets multipart limits in Dispatcher mode.
dir = "/var/spool/rapira"             # Optional. Uses the system temporary directory by default.
max_file_size_mb = 2                  # Optional. Limits one file part.
max_field_size_kb = 256               # Optional. Limits one field part.
max_files = 20                        # Optional. Limits file parts in one request.
max_parts = 1024                      # Optional. Limits all parts in one request.
max_part_headers = 32                 # Optional. Limits fields in one part.

[http.pool]                           # The worker pool behind the http listener.
entrypoint = "index.php"              # Relative paths use this file's directory.
mode = "dispatcher"                   # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
processes = 4                         # Sets the fixed worker count.
max_requests = 0                      # Replaces a worker after this request count. Zero disables the limit.
request_terminate_timeout_secs = 0    # Replaces a worker when one request exceeds this time. Zero disables the limit.

[grpc]
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"          # Required. A FileDescriptorSet with its imports.
services = ["example.v1.Echo"]        # Optional. Default: the services of the files that no other file imports.
reflection = false
default_timeout_secs = 30             # Optional. Deadline of a call without a client timeout.
max_timeout_secs = 60                 # Optional. Upper limit for a client timeout.
keepalive_interval_secs = 10          # Optional. Idle time before an HTTP/2 PING.
keepalive_timeout_secs = 10           # Optional. Closes a connection that does not answer the PING.
interceptors = ["auth"]               # Optional. Rapira uses the list order.

[grpc.auth]                           # Required when interceptors contains "auth".
tokens_file = "grpc-tokens"           # Required. One bearer token on each line.

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"                   # Required mode for gRPC.
processes = 4
max_requests = 0
request_terminate_timeout_secs = 0

[observability]                       # Optional. Starts one process without PHP for metrics and probes.
listen = "127.0.0.1:9180"             # Required.
keepalive_timeout_secs = 60           # Optional.

[observability.metrics]               # Enables GET /metrics. Set this table, the probes table, or both.

[observability.probes]                # Enables GET /livez and GET /readyz.

[supervisor]                          # Optional. Sets master process behavior.
pidfile = "/run/rapira.pid"           # Optional. Relative paths use this file's directory.
process_control_timeout_secs = 30     # Waits after SIGQUIT before SIGTERM. SIGKILL follows one second later.

[log]                                 # Optional. Sets the level and record format.
level = "error"                       # Use error, warn, info, debug, or trace. Default: error.
format = "plain"                      # Use plain or json. Default: plain.

[log.targets]                         # Optional. Overrides the level for each target.
php = "debug"
http = "warn"
```

## Секция `[http]`

Эта секция задаёт слушатель и сведения о сервере, которые получает PHP. Она также задаёт пределы тела запроса и middleware, которые работают до PHP.

| Ключ | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `listen` | строка | `"127.0.0.1:8000"` | Адрес, который занимает сервер. Используйте `host:port` с IP-адресом, `:port` для всех интерфейсов IPv4 или `unix:/run/rapira.sock` для Unix-сокета. Для всех интерфейсов IPv6 используйте `[::]:8080`. IPv6-литерал заключайте в квадратные скобки, например `[::1]:8000`. Rapira отвергает имена хостов и порт без двоеточия, например `8000`. |
| `server_name` | строка | `"localhost"` | То, что PHP прочитает в `$_SERVER['SERVER_NAME']`. |
| `server_port` | целое | порт из `listen`, `80` для `unix:` | То, что PHP прочитает в `$_SERVER['SERVER_PORT']`. Задайте его, когда прокси перед Rapira принимает соединения на одном порту, а Rapira слушает другой. |
| `max_body_size_mb` | целое | `8` | Наибольший размер тела запроса в МиБ. На тело большего размера Rapira отвечает `413`. Значение не меньше 1. |
| `write_timeout_secs` | целое | `30` | Наибольшее время без продвижения при записи ответа. После этого Rapira закрывает соединение. Значение от 1 до `86400`. |
| `keepalive_timeout_secs` | целое | `60` | Предел времени на получение заголовков запроса. В него входит ожидание на простаивающем соединении. Это также наибольшее время между двумя фрагментами тела запроса. После предела Rapira закрывает соединение. Замершее тело запроса сначала получает `408`. Значение от 1 до `86400`. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | Обработка поля, имя которого содержит символы вне `[A-Za-z0-9-]`. `"reject"` возвращает `400`. В режимах Classic и Worker `"drop"` удаляет поле и записывает это в лог. В режиме Dispatcher `"drop"` оставляет поле. Смотрите раздел [HTTP](/ru/docs/http). |
| `middleware` | список строк | пусто | Middleware, которые работают до PHP, в порядке списка. Доступно только `"static"`. Rapira отвергает повторяющиеся имена и имена без таблицы настроек. Rapira также отвергает таблицы middleware, которых нет в списке. |

### Таблица `[http.static]`

Middleware `static` может вернуть файл до того, как PHP получит запрос. Он обрабатывает `GET` и `HEAD`. PHP получает другие методы и пути, за которыми нет файла. PHP также получает скрытые пути и пути каталогов. Middleware не отдаёт индексные файлы.

| Ключ | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `root` | строка | нет - ключ обязателен | Каталог, из которого middleware отдаёт файлы. Относительный путь считается от каталога с файлом конфигурации. Каталог должен существовать и быть доступен при инициализации. |
| `forbid` | список строк | `[".php"]` | Окончания имён файлов, которые middleware не отдаёт. Каждый элемент начинается с точки и содержит не меньше двух символов. Элемент не может содержать `/` или пробельные символы. Регистр при сравнении не учитывается. Явный список заменяет значение по умолчанию. |

Кэш файлов и другие подробности описаны в разделе [Статические файлы](/ru/docs/static-files).

### Таблица `[http.sendfile]`

Корень sendfile - это каталог, из которого может читать `sendFile()`. Rapira приводит корень и запрошенный путь к каноническому виду. Rapira отвергает путь вне корня.

`sendFile()` - метод класса `Rapira\Http\Exchange`. Объект обмена скрипт получает только в режиме Dispatcher. Поэтому эта таблица влияет только на режим Dispatcher. Режимы Classic и Worker принимают её, но не используют.

| Ключ | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `root` | строка | каталог входного скрипта (`http.pool.entrypoint`) | Единственный каталог, из которого `sendFile()` может читать. Относительный путь считается от каталога с файлом конфигурации. |

Если корня нет при запуске, Rapira записывает предупреждение в лог, и `sendFile()` отвергает любой путь. Создайте каталог до старта сервера.

### Таблица `[http.uploads]`

Таблица `[http.uploads]` ограничивает разбор тела `multipart/form-data` на стороне хоста. Хост разбирает такое тело только в режиме Dispatcher. В режимах Classic и Worker его разбирает PHP с пределами из `php.ini`. В этих двух режимах Rapira отвергает эту таблицу.

| Ключ | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `dir` | строка | системный каталог для временных файлов | Каталог для файловых частей. Относительный путь считается от каталога с файлом конфигурации. Rapira создаёт и проверяет этот каталог. Каждый воркер создаёт подкаталог `rapira-spool-<pid>` и удаляет его при завершении. |
| `max_file_size_mb` | целое | `2` | Наибольший размер одной файловой части, в МиБ. |
| `max_field_size_kb` | целое | `256` | Наибольший размер одной части-поля, в КиБ. |
| `max_files` | целое | `20` | Наибольшее число файловых частей в одном запросе. |
| `max_parts` | целое | `1024` | Наибольшее число файловых частей и частей-полей в одном запросе. |
| `max_part_headers` | целое | `32` | Наибольшее число полей заголовка в одной части. |

Каждый предел должен быть не меньше 1. Если запрос превышает предел, Rapira возвращает `413`.

### Таблица `[http.pool]` {#http-pool}

Воркеры выполняют PHP. Эта таблица задаёт, что они выполняют, сколько их работает и когда мастер убирает воркер. Как мастер использует эти значения, объясняет [Модель процессов](/ru/docs/process-model).

Плагин `http` владеет этим пулом PHP-воркеров. Слушатель gRPC использует отдельную таблицу `[grpc.pool]`.

| Ключ | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `entrypoint` | строка | нет - ключ обязателен | PHP-скрипт, который выполняет каждый воркер. Относительный путь считается от каталога с файлом конфигурации. Путь должен указывать на обычный файл, доступный для чтения. |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | Как воркер выполняет входной скрипт. `classic` каждый раз начинает новый PHP-запрос. `worker` сохраняет скрипт и заново заполняет суперглобальные переменные. `dispatcher` сохраняет скрипт и передаёт ему объект диспетчера. Смотрите [Режимы выполнения](/ru/docs/execution-modes). |
| `processes` | целое | доступный параллелизм или `1`, если его нельзя определить | Число воркеров. Мастер держит столько воркеров запущенными. Значение не меньше 1. Сумма `processes` во всех пулах должна быть не больше 2048. Секция `[observability]` добавляет к этой сумме один процесс. |
| `max_requests` | целое | `0` | Число запросов, после которого Rapira заменяет воркер. Rapira немного изменяет этот предел, чтобы воркеры не заменялись одновременно. `0` отключает предел. |
| `request_terminate_timeout_secs` | целое | `0` | Предел реального времени для одного запроса. Rapira завершает и заменяет воркер, который превышает этот предел. `0` отключает проверку. |

## Секция `[grpc]` {#grpc}

Эта секция включает унарные вызовы gRPC, gRPC-Web и Connect на одном слушателе. Полный пример PHP-сервиса и клиентские команды приведены в разделе [gRPC](./grpc).

| Ключ | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `listen` | строка | `"127.0.0.1:50051"` | Адрес TCP или путь к сокету `unix:`. Использует тот же синтаксис адреса, что и `http.listen`. |
| `descriptor_set` | строка | нет - ключ обязателен | Путь к бинарному `google.protobuf.FileDescriptorSet`, который содержит все импортируемые файлы. Соберите его командой `buf build --as-file-descriptor-set` или `protoc --include_imports`. |
| `services` | список строк | не задан | Полные имена обслуживаемых сервисов. Если ключ не задан, пул обслуживает сервисы тех файлов, которые не импортирует ни один другой файл набора. Список не должен быть пустым. |
| `reflection` | логическое | `false` | Включает сервисы `grpc.reflection.v1` и `v1alpha`. |
| `default_timeout_secs` | целое | не задан | Предельный срок вызова, для которого клиент не задал таймаут. Если ключ не задан, у такого вызова нет предельного срока. |
| `max_timeout_secs` | целое | не задан | Верхний предел для таймаута клиента. Если ключ не задан, предела нет. |
| `keepalive_interval_secs` | целое | `10` | Время простоя, после которого Rapira отправляет HTTP/2 keepalive PING. Не применяется к клиентам HTTP/1.1. Значение от 1 до `86400`. |
| `keepalive_timeout_secs` | целое | `10` | Время, которое Rapira ждёт ответа на PING. Если ответ не пришёл за это время, Rapira закрывает соединение. Значение от 1 до `86400`. |
| `interceptors` | список строк | пусто | Перехватчики, которые работают до PHP, в порядке списка. Доступно только `"auth"`. Rapira отвергает повторяющиеся имена, неизвестные имена и имена без таблицы настроек. Rapira также отвергает таблицу `[grpc.auth]`, которой нет в списке. |

Мастер загружает набор дескрипторов до создания воркеров через fork. Эти ошибки останавливают инициализацию: набор, который Rapira не может прочитать или декодировать, набор без импортируемых файлов и набор без сервисов для обслуживания. Элемент `services`, которого нет в наборе, повторяющийся элемент и элемент с именем сервиса проверки состояния или рефлексии также останавливают её. `default_timeout_secs` не должен быть больше `max_timeout_secs`.

### Таблица `[grpc.auth]` {#grpc-auth}

Перехватчик `auth` принимает вызов только с действительным bearer-токеном. PHP не получает отвергнутый вызов. Клиентская сторона и сервис проверки состояния описаны в разделе [Аутентификация gRPC](/ru/docs/grpc#authentication).

| Ключ | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `tokens_file` | строка | нет - ключ обязателен | Файл с допустимыми токенами. Относительный путь считается от каталога с файлом конфигурации. Пишите один токен на каждой строке. Rapira пропускает пустые строки и строки, которые начинаются с `#`. Каждый токен должен быть [bearer-токеном по RFC 6750](https://www.rfc-editor.org/rfc/rfc6750#section-2.1). Файл должен содержать хотя бы один токен. |

### Таблица `[grpc.pool]` {#grpc-pool}

Эта таблица использует [ключи и значения по умолчанию пула HTTP](#http-pool), с обязательным `entrypoint` и `mode = "dispatcher"`. Режимы Classic и Worker отвергаются. Число воркеров, замена и контроль времени работы процессов применяются к этому пулу независимо.

HTTP и gRPC могут работать вместе. Каждый слушатель использует собственный пул и входной скрипт. Мастер читает набор дескрипторов и файл токенов один раз при запуске. Перезапустите Rapira, чтобы загрузить изменённый файл. Перезагрузка сохраняет старые файлы.

## Секция `[observability]` {#observability}

Эта секция запускает ещё один процесс, который отдаёт метрики и пробы состояния по HTTP. Этот процесс не выполняет PHP-код. Секция не является таблицей плагина, поэтому файлу всё равно нужна секция `[http]` или `[grpc]`. Эндпоинты и метрики описаны в разделе [Метрики и проверки состояния](/ru/docs/observability).

| Ключ | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `listen` | строка | нет - ключ обязателен | Адрес для прослушивания. Использует тот же синтаксис, что и `http.listen`. Укажите адрес, который не используют слушатели `http` и `grpc`. |
| `keepalive_timeout_secs` | целое | `60` | Предел времени на получение заголовков запроса. В него входит ожидание на простаивающем соединении. Значение от 1 до `86400`. |
| `[observability.metrics]` | пустая таблица | нет | Включает `GET /metrics` в текстовом формате Prometheus. |
| `[observability.probes]` | пустая таблица | нет | Включает `GET /livez` и `GET /readyz`. |

Задайте хотя бы одну из двух подтаблиц. Подтаблицы не принимают ключей.

## Секция `[supervisor]`

Эта секция задаёт правила мастер-процесса. Мастер владеет слушающими сокетами, контролирует воркеры и принимает сигналы. Мастером управляет система инициализации. Пример unit-файла приведён в разделе [Развёртывание](/ru/docs/deployment).

| Ключ | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `pidfile` | строка | нет | Файл для идентификатора мастер-процесса. Относительный путь считается от каталога с файлом конфигурации. Отправляйте сигналы процессу с этим идентификатором. Смотрите [Модель процессов](/ru/docs/process-model). |
| `process_control_timeout_secs` | целое | `30` | Сколько мастер ждёт после `SIGQUIT` перед отправкой `SIGTERM`. Мастер отправляет `SIGKILL` через одну секунду после `SIGTERM`. |

Соединения получают меньше времени на завершение: тайм-аут управления минус меньшее из двух значений: пять секунд или половина тайм-аута. По умолчанию это 25 секунд. Этот срок действует при остановке и перезагрузке.

## Секция `[log]`

Эта секция определяет уровень и формат логов stderr. Цели, форматы и уровни диагностики PHP описаны в разделе [Логирование](/ru/docs/logging).

| Ключ | Тип | По умолчанию | Что делает |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | Подробность записей, общая сразу для всех целей. |
| `format` | `"plain"` \| `"json"` | `"plain"` | Формат записи. Формат `plain` содержит читаемые строки и может использовать цвета. Формат JSON содержит один объект на строку. |
| `[log.targets]` | таблица «цель → уровень» | пусто | Переопределения уровня логирования для целей. Ключи сопоставляются с префиксами целей. Список целей приведён в разделе [Логирование](/ru/docs/logging#уровни-для-отдельных-целеи). |

Ключ `[log.targets]` может содержать буквы, цифры, `_`, `:`, `.` и `-`. Первый символ должен быть буквой, цифрой или `_`. Rapira отвергает другие символы, потому что фильтр может интерпретировать их как синтаксис. Ключ цели с символом `:` или `.` нужно заключить в кавычки, потому что TOML не разрешает эти символы в простом ключе без кавычек. Например:

```toml
[log.targets]
"h2::proto" = "debug"
```

`RUST_LOG` и `NO_COLOR` влияют только на вывод stderr. `RUST_LOG` заменяет весь фильтр stderr для одного запуска. Непустое значение `NO_COLOR` отключает цвета в формате `plain`.

## Незнакомые ключи отвергаются

Rapira принимает только документированные таблицы и ключи. Например, `[htttp]` или `lissten = ":8000"` вызывает сбой инициализации. Ошибка указывает неизвестное имя. Каждый ключ принадлежит одной таблице. Например, `max_requests` принадлежит `[http.pool]`, а `pidfile` принадлежит `[supervisor]`.

Rapira также проверяет значения. Он отвергает неподдерживаемые значения вместо замены стандартными. Например, он отвергает `level = "verbose"`, `format = "pretty"` и `unsafe_field_names = "allow"`. Число воркеров, размеры тела и пределы загрузки должны быть не меньше 1. Каждый ключ `*_secs` должен быть от 1 до `86400`. Только `request_terminate_timeout_secs` также принимает `0`.

::: warning
Rapira читает файл конфигурации только при запуске. Перезагрузка через `SIGHUP` или `SIGUSR2` не читает его снова. Перезапустите Rapira, чтобы применить изменённый файл.
:::

## Относительные пути

Пути файловой системы включают входные скрипты обоих пулов, `grpc.descriptor_set`, `grpc.auth.tokens_file`, `supervisor.pidfile`, `http.static.root`, `http.sendfile.root` и `http.uploads.dir`. Каждый относительный путь использует каталог файла конфигурации как базовый. Например, значение `entrypoint = "app/worker.php"` в `/etc/rapira/rapira.toml` даёт путь `/etc/rapira/app/worker.php`.

Относительный путь слушателя `unix:` использует рабочий каталог процесса Rapira как базовый. Для Unix-сокета используйте абсолютный путь.

::: tip
Храните файл конфигурации `rapira.toml` внутри приложения. Указывайте пути относительно файла конфигурации. Вы можете переместить каталог приложения. Эти пути не изменятся.
:::
