---
title: gRPC
description: "Обслуживайте унарные вызовы gRPC, gRPC-Web и Connect из диспетчера PHP и вызывайте их через grpcurl или curl."
---

# gRPC

Rapira обслуживает унарные вызовы RPC из PHP. Один слушатель принимает вызовы gRPC, gRPC-Web и Connect по HTTP/1.1 или незашифрованному HTTP/2 через TCP или Unix-сокеты. Унарный вызов содержит одно сообщение запроса и одно сообщение ответа.

Пул gRPC использует режим Dispatcher. Rapira управляет транспортом и передаёт PHP бинарные сообщения protobuf. Каждый PHP-воркер обрабатывает один вызов за раз. Потоковые методы не поддерживаются. Слушатель не завершает TLS.

## Запуск эхо-сервиса

Установите Rapira. Установите [buf](https://buf.build/docs/installation/) для сборки набора дескрипторов и [grpcurl](https://github.com/fullstorydev/grpcurl#installation) для выполнения клиентских команд. Этот пример возвращает байты запроса в качестве ответа. Для него не нужны сгенерированные классы PHP или расширение gRPC для PHP.

Создайте следующую структуру каталогов:

```text
app/
├── proto/
│   └── echo.proto
├── grpc.php
└── rapira.toml
```

### Определение сервиса

Сохраните эту схему в `proto/echo.proto`:

```protobuf
syntax = "proto3";

package example.v1;

option php_namespace = "Example\\V1";
option php_metadata_namespace = "Example\\Metadata";

service Echo {
  rpc Echo(EchoMessage) returns (EchoMessage);
}

message EchoMessage {
  string text = 1;
}
```

Маршрут имеет вид `/example.v1.Echo/Echo`. Контекст PHP предоставляет имя метода `example.v1.Echo/Echo` без начальной косой черты.

### Сборка набора дескрипторов

Rapira читает схему из набора дескрипторов: бинарного `google.protobuf.FileDescriptorSet`, который содержит все импортируемые файлы. Соберите его из `app/`:

```sh
buf build proto --as-file-descriptor-set -o api.binpb
```

Его также может собрать `protoc`. Добавьте `--include_imports`, потому что без этого флага `protoc` не включает импортируемые файлы:

```sh
protoc --include_imports --descriptor_set_out=api.binpb -I proto proto/echo.proto
```

Исполняемый файл `protoc` не нужен Rapira во время работы.

### Диспетчер PHP

Сохраните этот скрипт в `grpc.php`:

```php
<?php

use Rapira\Exception\ClosedException;
use Rapira\Exception\WorkDiscardedException;

$dispatcher = Rapira\get_dispatcher();

try {
    while (true) {
        $call = $dispatcher->receive();

        try {
            $metadata = $call->getResponseMetadata();
            $metadata->addHeader('x-worker', (string) getmypid());
            $metadata->addTrailer('x-result', 'echoed');
            $call->respond($call->getMessage());
        } catch (WorkDiscardedException) {
            continue;
        }
    }
} catch (ClosedException) {
    return;
}
```

Запрос и ответ используют один тип сообщения, поэтому обработчик может вернуть байты напрямую. `ClosedException` завершает цикл при остановке. `WorkDiscardedException` означает, что хост уже отменил вызов.

### Настройка слушателя и пула

Сохраните эту конфигурацию в `rapira.toml`:

```toml
[grpc]
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"
reflection = true

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"
processes = 2
```

`descriptor_set` использует каталог файла конфигурации как базовый. Конфигурации только для gRPC не нужна секция `[http]`.

Запустите сервер из `app/`:

```sh
rapira serve rapira.toml
```

### Вызов сервиса

Получите список сервисов из другого терминала:

```sh
grpcurl -plaintext 127.0.0.1:50051 list
```

Вызовите эхо-метод:

```sh
grpcurl -plaintext -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

Ответ:

```json
{
  "text": "hello"
}
```

grpcurl получает схему через рефлексию. Добавьте `-v` перед адресом, чтобы посмотреть заголовки и трейлеры ответа.

Клиент Connect может отправить JSON. Rapira преобразует JSON-запрос в бинарный protobuf до того, как его получит PHP, и преобразует бинарный ответ обратно в JSON:

```sh
curl -H 'Content-Type: application/json' -d '{"text":"hello"}' http://127.0.0.1:50051/example.v1.Echo/Echo
```

## Использование сгенерированных сообщений PHP

Сгенерируйте классы PHP, если обработчику нужно читать или изменять поля сообщения. Установите `protoc` и Composer для этого этапа сборки.

Установите библиотеку protobuf для PHP в `app/`:

```sh
composer require google/protobuf
```

Создайте каталог для сгенерированных файлов:

```sh
mkdir -p generated
```

Сгенерируйте классы:

```sh
protoc --proto_path=proto --php_out=generated proto/echo.proto
```

Добавьте эти сопоставления пространств имён в объект `autoload.psr-4` файла `composer.json`:

```json
{
  "autoload": {
    "psr-4": {
      "Example\\V1\\": "generated/Example/V1/",
      "Example\\Metadata\\": "generated/Example/Metadata/"
    }
  }
}
```

Обновите автозагрузчик:

```sh
composer dump-autoload
```

Подключите его перед циклом диспетчера в `grpc.php`:

```php
require __DIR__ . '/vendor/autoload.php';
```

Замените строку с `respond()` внутри вложенного блока `try` следующим кодом:

```php
$message = new Example\V1\EchoMessage();
$message->mergeFromString($call->getMessage());
$message->setText(strtoupper($message->getText()));
$call->respond($message->serializeToString());
```

Перезапустите сервер примера. Теперь тот же клиентский вызов возвращает `{"text":"HELLO"}`. В обработчике приложения перехватывайте исключения разбора protobuf и отправляйте `StatusCode::InvalidArgument`.

[Руководство по сгенерированному коду PHP](https://protobuf.dev/reference/php/php-generated/) описывает методы доступа к полям и сериализацию. Для этого серверного API не требуется расширение gRPC для PHP.

## Контракт диспетчера

В воркере gRPC функция `Rapira\get_dispatcher()` возвращает `Rapira\Grpc\GrpcDispatcher`. Инициализируйте автозагрузчик и общие сервисы приложения до цикла.

| API | Поведение |
| --- | --- |
| `receive(int $timeout = -1)` | Возвращает следующий `UnaryCall`. Время ожидания задаётся в микросекундах. `-1` означает неограниченное ожидание. При истечении времени выбрасывает `Rapira\Exception\TimeoutException`. |
| `tryReceive()` | Возвращает `UnaryCall` или `null`, если ожидающих вызовов нет. Не ждёт. |
| `getServices()` | Возвращает список обслуживаемых сервисов, их методов, входных и выходных типов и видов методов. Потоковые методы входят в список. Доступен до первого вызова. |
| `$call->getContext()` | Возвращает метод, метаданные, адрес клиента, протокол, время получения и предельный срок. |
| `$call->getMessage()` | Возвращает сообщение запроса как бинарный protobuf в строке PHP. |
| `$call->respond(string $message)` | Завершает вызов одним сериализованным ответом protobuf. |
| `$call->fail(Status $status)` | Завершает вызов со статусом ошибки gRPC. |
| `$call->isCancelled()` | Сообщает об отмене клиентом, закрытии соединения или истечении предельного срока. |
| `$call->isFinalized()` | Сообщает, завершён ли вызов. |

Завершите текущий вызов перед получением следующего. Пока вызов открыт, `receive()` выбрасывает `\Error`. Повторное завершение выбрасывает `Rapira\Exception\AlreadyFinalizedError`. Ответ после отмены выбрасывает `WorkDiscardedException`.

Вызов, который PHP не завершил, теряется. Тогда клиент получает `INTERNAL` с сообщением `internal error`. Неперехваченное исключение тоже приводит к потере вызова, и клиент не видит его сообщение.

Используйте `$call->getContext()->method` для выбора обработчика, если схема определяет несколько методов. `$call->getContext()->protocol` имеет значение `Grpc`, `GrpcWeb` или `Connect`. Очищайте состояние приложения, относящееся к вызову, перед следующей итерацией. Диспетчер не заполняет суперглобальные переменные HTTP.

## Возврат ошибок и подробностей

Используйте `fail()` для ожидаемой ошибки приложения. Выполните этот код в обработчике текущего вызова:

```php
$call->fail(new Rapira\Grpc\Status(
    Rapira\Grpc\StatusCode::InvalidArgument,
    'text is required',
));
```

`StatusCode` содержит коды статусов gRPC. Успешный `respond()` отправляет статус `OK`. `fail()` - единственный способ отправить статус ошибки.

Необязательный третий аргумент `Status` - список объектов `Rapira\Grpc\ErrorDetail`. Каждый объект содержит URL типа protobuf и байты сериализованного сообщения. Для gRPC и gRPC-Web Rapira отправляет подробности в `grpc-status-details-bin`. Для Connect она отправляет их в теле ошибки JSON.

Rapira не перехватывает `Rapira\Grpc\Exception\GrpcException`. Перехватите его и передайте его свойство `$status` в `fail()`.

Клиент получает `UNAVAILABLE`, если Rapira отклоняет вызов до того, как его получит PHP. Это происходит, когда очередь воркеров остаётся заполненной 30 секунд, когда пул останавливается или когда загрузка PHP в воркере завершилась ошибкой.

## Метаданные

Читайте метаданные запроса из `$call->getContext()->metadata`. `values($name)` возвращает все значения для имени в порядке поступления без учёта регистра имени. Массив `entries`, доступный только для чтения, хранит имена в нижнем регистре.

Rapira удаляет из метаданных запроса транспортные имена, например `grpc-timeout`, `content-type` и `te`. Она отбрасывает текстовое значение, которое содержит не только печатные символы ASCII. Для имени с суффиксом `-bin` Rapira разделяет значение по `,` и декодирует каждую часть из base64. PHP получает необработанные байты. Часть, которая не декодируется, отбрасывается.

Добавляйте метаданные ответа перед `respond()` или `fail()`:

```php
$requestId = $call->getContext()->metadata->values('x-request-id')[0] ?? '';
$metadata = $call->getResponseMetadata();
$metadata->addHeader('x-request-id', $requestId);
$metadata->addBinaryHeader('x-token-bin', "\x00\xff");
$metadata->addTrailer('x-result', 'completed');
```

`addHeader()` и `addTrailer()` принимают значения из печатных символов ASCII. Пустое значение допустимо. При отправке Rapira удаляет начальные и конечные пробелы текстового значения. Для бинарных значений используйте `addBinaryHeader()` или `addBinaryTrailer()`. Имя бинарного значения должно заканчиваться на `-bin`.

Имя метаданных может содержать только `0-9`, `a-z`, `_`, `-` и `.`, как требует [протокол gRPC](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md#requests). Транспортное имя, некорректное имя или некорректное значение выбрасывает `\ValueError`. Повторное имя добавляет ещё одно значение.

`headers()` и `trailers()` возвращают снимки. Для Connect каждый трейлер передаётся как заголовок с префиксом `trailer-`. Передайте метаданные запроса через параметр grpcurl `-H 'x-request-id: demo-1'`.

## Предельные сроки и отмена

Клиент задаёт таймаут через `grpc-timeout` (gRPC и gRPC-Web) или `connect-timeout-ms` (Connect). `grpc.default_timeout_secs` задаёт таймаут вызова, для которого клиент не задал таймаут. `grpc.max_timeout_secs` уменьшает более длинный таймаут клиента до своего значения. По умолчанию оба ключа не заданы, поэтому у вызова без таймаута клиента нет предельного срока.

`$call->getContext()->deadline` содержит предельный срок как отметку времени Unix в секундах или `null`. `receivedAt` содержит время, когда Rapira прочитала сообщение запроса полностью.

Например, задайте клиенту предельный срок в две секунды:

```sh
grpcurl -plaintext -max-time 2 -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

Когда предельный срок истекает, клиент получает `DEADLINE_EXCEEDED`, а `isCancelled()` возвращает `true`. Rapira не может остановить код PHP, поэтому PHP продолжает обработку вызова. Проверяйте `isCancelled()` во время длительных операций. Перехватывайте `WorkDiscardedException` при вызове методов ответа, поскольку отмена может произойти после проверки.

Таймаут `receive()` задаёт, сколько PHP ждёт новую работу. Он не связан с предельным сроком вызова. `grpc.pool.request_terminate_timeout_secs` контролирует время работы процесса. Он заменяет воркер, если вызов выполняется дольше лимита.

## Сервисы и рефлексия

Мастер загружает набор дескрипторов до создания воркеров через fork. Некорректный набор, набор без импортируемых файлов или неизвестный сервис останавливают запуск. Для загрузки изменённого набора остановите и снова запустите Rapira. Перезагрузка сохраняет старый набор.

По умолчанию пул обслуживает сервисы тех файлов, которые не импортирует ни один другой файл набора. Файл, который импортирует другой файл, является зависимостью, например `google/longrunning/operations.proto`. Его сервисы не обслуживаются. Задайте `grpc.services`, чтобы указать обслуживаемые сервисы, например `["billing.v1.InvoiceService"]`. Используйте этот ключ, если один набор используют несколько экземпляров Rapira, или чтобы обслуживать сервис импортируемого файла.

Потоковый метод, метод сервиса, который пул не обслуживает, и неизвестный метод возвращают `UNIMPLEMENTED`. При запуске Rapira записывает предупреждение для каждого потокового метода обслуживаемого сервиса.

Рефлексия по умолчанию отключена. При `reflection = true` Rust обслуживает `grpc.reflection.v1` и `grpc.reflection.v1alpha`. `ListServices` возвращает обслуживаемые сервисы. Все файлы и символы набора дескрипторов доступны, поэтому каждый клиент может прочитать весь набор.

При `reflection = false` передайте схему клиенту:

```sh
grpcurl -plaintext -import-path proto -proto echo.proto -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

## Проверки состояния

Rust обслуживает [протокол проверки состояния gRPC](https://github.com/grpc/grpc/blob/master/doc/health-checking.md) (`grpc.health.v1.Health`) в каждом воркере. `Check` и `Watch` сообщают `SERVING` для пустого имени `""` и для каждого обслуживаемого сервиса. Во время остановки они сообщают `NOT_SERVING`.

Сервис проверки состояния не проверяет PHP. Воркер, в котором загрузка PHP завершилась ошибкой, сообщает `SERVING`, а его вызовы получают `UNAVAILABLE`. `grpc.services` не может указывать сервисы проверки состояния или рефлексии, потому что Rapira обслуживает их сама.

Рефлексия не показывает сервис проверки состояния. Запросу Connect в формате JSON схема не нужна:

```sh
curl -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:50051/grpc.health.v1.Health/Check
```

## Протоколы и ограничения

- Запрос Connect в формате JSON, который не декодируется, возвращает `INVALID_ARGUMENT`, и PHP не получает вызов. Декодер JSON игнорирует неизвестные поля. Он не игнорирует имя значения перечисления, которое набор дескрипторов не объявляет.
- Метод с `option idempotency_level = NO_SIDE_EFFECTS;` также принимает запрос Connect GET.
- Сообщения могут использовать сжатие gzip. Запрос с другим кодированием сообщения возвращает `UNIMPLEMENTED`.
- Ограничение размера сообщения составляет 4 МиБ. Более крупный запрос возвращает `RESOURCE_EXHAUSTED`.
- `$call->getContext()->tls` всегда равен `null`. Если клиентам нужен TLS, поставьте TLS-прокси перед слушателем. Для нативного gRPC прокси должен использовать HTTP/2 для соединения с Rapira.
- Rapira отправляет HTTP/2 keepalive PING неактивному соединению каждые 10 секунд. Она закрывает соединение, которое не отвечает в течение 10 секунд.

::: warning Одно соединение использует один воркер
Каждое соединение обслуживает один процесс воркера. Клиент gRPC обычно отправляет все вызовы канала по одному соединению HTTP/2. Такой клиент получает пропускную способность одного воркера при любом размере пула. Чтобы использовать больше воркеров, откройте несколько соединений или используйте балансировщик нагрузки L7, который распределяет вызовы.
:::

## Совместная работа HTTP и gRPC

Одна конфигурация может содержать и `[http]`, и `[grpc]`. Каждый плагин имеет собственный слушатель, входной PHP-скрипт и пул воркеров. Мастер контролирует оба пула. Пул gRPC поддерживает те же настройки масштабирования и замены, что и пул HTTP, с `mode = "dispatcher"`.

Все настройки gRPC описаны в разделе [Конфигурация](./configuration#grpc), а надзор за пулами - в разделе [Модель процессов](./process-model).

## Windows

[Сборка для Windows](https://github.com/rapira-rs/rapira-windows) обслуживает тот же слушатель gRPC и тот же API PHP. Действуют следующие отличия:

- `grpc.listen` принимает только адрес TCP.
- Пул gRPC - статический пул потоков интерпретатора PHP в одном процессе. `grpc.pool.processes` задаёт число потоков.
- `getmypid()` возвращает один и тот же идентификатор процесса в каждом интерпретаторе.
- Сбой загрузки PHP в любом из пулов останавливает сервер с кодом выхода 70.
