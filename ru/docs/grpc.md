---
title: gRPC
description: "Настройте унарный сервис gRPC, напишите диспетчер PHP и вызовите сервис через grpcurl."
---

# gRPC

Rapira обслуживает нативный gRPC по незашифрованному HTTP/2 через TCP или Unix-сокеты. Каждый PHP-воркер обрабатывает один унарный вызов за раз. Унарный вызов содержит одно сообщение запроса и одно сообщение ответа.

Пул gRPC использует режим Dispatcher. Rapira управляет транспортом и передаёт PHP бинарные сообщения protobuf. Потоковые методы приложения, gRPC-Web и Connect не поддерживаются. TLS-прокси должен использовать HTTP/2 для соединения с Rapira.

## Запуск эхо-сервиса

Установите Rapira с нативной поддержкой gRPC. Установите [grpcurl](https://github.com/fullstorydev/grpcurl#installation) для выполнения клиентских команд. Этот пример возвращает байты запроса в качестве ответа. Для него не нужны сгенерированные классы PHP или расширение gRPC для PHP.

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

Rapira разбирает схему при запуске. Маршрут имеет вид `/example.v1.Echo/Echo`. Контекст PHP предоставляет имя метода `example.v1.Echo/Echo` без начальной косой черты.

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
listen = "127.0.0.1:9001"
protos = ["proto"]
reflection = true

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"
processes = 2
```

`protos` содержит каталоги. Rapira рекурсивно ищет в них файлы `.proto`. Относительные пути используют каталог файла конфигурации как базовый. Конфигурации только для gRPC не нужна секция `[http]`.

Запустите сервер из `app/`:

```sh
rapira serve rapira.toml
```

### Вызов сервиса

Получите список сервисов из другого терминала:

```sh
grpcurl -plaintext 127.0.0.1:9001 list
```

Вызовите эхо-метод:

```sh
grpcurl -plaintext -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

Ответ:

```json
{
  "text": "hello"
}
```

Эти команды получают схемы через рефлексию. Добавьте `-v` перед адресом, чтобы посмотреть заголовки и трейлеры ответа.

## Использование сгенерированных сообщений PHP

Сгенерируйте классы PHP, если обработчику нужно читать или изменять поля сообщения. Установите `protoc` и Composer для этого этапа сборки. Сервер сам разбирает файлы `.proto`, поэтому исполняемый файл `protoc` не нужен во время работы.

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

Перезапустите сервер примера. Теперь тот же клиентский вызов возвращает `{"text":"HELLO"}`. Перехватывайте исключения разбора protobuf в обработчике приложения и преобразуйте их в `StatusCode::InvalidArgument`.

[Руководство по сгенерированному коду PHP](https://protobuf.dev/reference/php/php-generated/) описывает методы доступа к полям и сериализацию. Для этого серверного API не требуется расширение gRPC для PHP.

## Контракт диспетчера

В воркере gRPC функция `Rapira\get_dispatcher()` возвращает `Rapira\Grpc\GrpcDispatcher`. Инициализируйте автозагрузчик и общие сервисы приложения до цикла.

| API | Поведение |
| --- | --- |
| `receive(int $timeout = -1)` | Возвращает следующий `UnaryCall`. Время ожидания задаётся в микросекундах. `-1` означает неограниченное ожидание. При истечении времени выбрасывает `Rapira\Exception\TimeoutException`. |
| `tryReceive()` | Немедленно возвращает `UnaryCall` или `null`. |
| `getServices()` | Возвращает список сервисов приложения, их методов, входных и выходных типов и видов методов. Доступен до первого вызова. |
| `$call->getContext()` | Возвращает метод, метаданные, адрес клиента, протокол, время получения и предельный срок. |
| `$call->getMessage()` | Возвращает байты protobuf запроса в виде строки PHP. |
| `$call->respond(string $message)` | Завершает вызов одним сериализованным ответом protobuf. |
| `$call->fail(Status $status)` | Завершает вызов ошибкой gRPC. |
| `$call->isCancelled()` | Сообщает об отмене клиентом или истечении предельного срока. |
| `$call->isFinalized()` | Сообщает, завершён ли вызов. |

Завершите активный вызов перед получением следующего. Повторное завершение выбрасывает `Rapira\Exception\AlreadyFinalizedError`. Ответ после отмены выбрасывает `WorkDiscardedException`. Удаление незавершённого объекта вызова возвращает клиенту `INTERNAL`.

Используйте `$call->getContext()->method` для выбора обработчика, если схема определяет несколько методов. Очищайте состояние приложения, относящееся к вызову, между итерациями. Диспетчер сохраняет PHP-приложение в памяти и не заполняет суперглобальные переменные HTTP.

## Возврат ошибок и подробностей

Используйте `fail()` для ожидаемой ошибки приложения. Выполните этот код в обработчике активного вызова:

```php
$call->fail(new Rapira\Grpc\Status(
    Rapira\Grpc\StatusCode::InvalidArgument,
    'text is required',
));
```

`StatusCode` содержит коды ошибок gRPC. Успешный `respond()` возвращает статус `OK`. Если неперехваченное исключение оставляет вызов незавершённым, Rapira возвращает статус `INTERNAL` без внутренних подробностей.

Необязательный третий аргумент `Status` - список объектов `Rapira\Grpc\ErrorDetail`. Каждый объект принимает URL типа protobuf и байты сериализованного сообщения. Rapira кодирует эти подробности в `grpc-status-details-bin`. `Rapira\Grpc\Exception\GrpcException` предоставляет свойство `$status`, которое блок catch приложения может передать в `fail()`.

## Метаданные

Читайте метаданные запроса из `$call->getContext()->metadata`. `values($name)` возвращает все значения для имени без учёта регистра. Массив `entries`, доступный только для чтения, хранит имена в нижнем регистре. Значения для имён с суффиксом `-bin` представлены в PHP как необработанные бинарные данные.

Добавляйте метаданные ответа перед `respond()` или `fail()`:

```php
$requestId = $call->getContext()->metadata->values('x-request-id')[0] ?? '';
$metadata = $call->getResponseMetadata();
$metadata->addHeader('x-request-id', $requestId);
$metadata->addBinaryHeader('x-token-bin', "\x00\xff");
$metadata->addTrailer('x-result', 'completed');
```

`addHeader()` и `addTrailer()` принимают значения из печатных символов ASCII. Для бинарных значений используйте `addBinaryHeader()` или `addBinaryTrailer()`. Повторные добавления сохраняют каждое значение. Имена, зарезервированные транспортом, например `grpc-status`, отвергаются.

`headers()` и `trailers()` возвращают неизменяемые снимки. После завершения вызова метаданные ответа изменить нельзя. Передайте метаданные запроса через параметр grpcurl `-H 'x-request-id: demo-1'`.

## Предельные сроки и отмена

Клиент задаёт предельный срок через `grpc-timeout`. Rapira проверяет этот срок при получении запроса и ожидании PHP. `$call->getContext()->deadline` содержит отметку времени Unix в секундах или `null`. `receivedAt` содержит отметку времени получения в секундах.

Например, задайте клиенту предельный срок в две секунды:

```sh
grpcurl -plaintext -max-time 2 -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

Код PHP может продолжить выполнение после отмены. Проверяйте `isCancelled()` во время длительных операций. Перехватывайте `WorkDiscardedException` при вызове методов ответа, поскольку отмена может произойти после проверки.

Таймаут `receive()` ограничивает ожидание новой работы в PHP. Он не связан с предельным сроком вызова. `grpc.pool.request_terminate_timeout_secs` контролирует время работы процесса: если активный вызов превышает лимит, Rapira завершает и заменяет воркер.

## Схемы и рефлексия

Мастер загружает схемы proto2 и proto3 до создания воркеров через fork. Файлы, найденные в `protos`, регистрируют сервисы приложения. Файлы, найденные только через `import_paths`, предоставляют типы зависимостей и данные для рефлексии.

Корневые каталоги импорта используются в порядке конфигурации: сначала `protos`, затем `import_paths`. Стандартные импорты `google/protobuf` встроены. Отсутствующие импорты, конфликтующие определения и потоковые методы приложения останавливают инициализацию. Перезапустите Rapira после изменения схем.

Рефлексия включена по умолчанию. Она обслуживает `grpc.reflection.v1` и `grpc.reflection.v1alpha` на Rust. Она возвращает список сервисов приложения и сервисов рефлексии, а также дескрипторы с их пользовательскими опциями. PHP-метод `getServices()` возвращает только сервисы приложения.

При `reflection = false` передайте схему клиенту:

```sh
grpcurl -plaintext -import-path proto -proto echo.proto -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

## Сжатие и ограничения сообщений

Запросы со сжатием gzip принимаются. Ответы со сжатием gzip по умолчанию отключены. Включите сжатие ответов приложения:

```toml
[grpc.compression.gzip]
enabled = true
```

Клиент также должен указать поддержку gzip в `grpc-accept-encoding`. Оба ограничения размера сообщений по умолчанию равны 4 МиБ. Для их изменения задайте `grpc.max_request_message_size_mb` и `grpc.max_response_message_size_mb`. И сжатые, и несжатые данные должны укладываться в настроенный лимит. Настройте клиентские ограничения для приёма ожидаемого размера ответа.

## Совместная работа HTTP и gRPC

Одна конфигурация может содержать и `[http]`, и `[grpc]`. Каждый плагин имеет собственный слушатель, входной PHP-скрипт и пул воркеров. Мастер контролирует оба пула. Пул gRPC поддерживает те же настройки масштабирования и замены, что и пул HTTP, с `mode = "dispatcher"`.

Самостоятельный бинарный файл принимает пустой список `grpc.interceptors`. Хосты на Rust могут предоставлять перехватчики через общий API `Middleware`. Все настройки gRPC описаны в разделе [Конфигурация](./configuration#grpc), а надзор за пулами - в разделе [Модель процессов](./process-model).
