---
title: OpenTelemetry
description: "Нативные трассы, логи, метрики, экспорт OTLP и контекст трассировки PHP."
---

# OpenTelemetry

Плагин `otel` экспортирует нативные трассы, логи и метрики через OTLP по HTTP/protobuf. Плагин `http` владеет пулом PHP-воркеров. Плагин `otel` владеет одним процессом экспортера.

## Включение телеметрии

Добавьте эту секцию в `rapira.toml`:

```toml
[otel]
enabled = true
endpoint = "http://localhost:4318"
service_name = "rapira"
sample_ratio = 1.0
```

Значение `enabled` по умолчанию равно `false`. Когда телеметрия отключена, PHP API контекста трассировки возвращает пустые массивы. Rapira читает настройки телеметрии из TOML. Переменные окружения `OTEL_*` на них не влияют. PHP SDK настраивается независимо.

Корневая Cargo feature `otel` включена по умолчанию. Крейт `otel` находится в `crates/plugins/otel`. Для сборки без SDK и экспортера используйте:

```sh
cargo build --release --no-default-features
```

Такой бинарный файл отвергает `[otel].enabled = true`. Все значения по умолчанию и правила проверки перечислены в [Конфигурации](./configuration#otel).

Endpoint задаёт базовый URL HTTP или HTTPS. Rapira добавляет `/v1/traces`, `/v1/logs` или `/v1/metrics` после префикса пути. Например, `https://collector.example/tenant` отправляет трассы в `https://collector.example/tenant/v1/traces`.

## Процессы и доставка

Мастер контролирует один дочерний процесс, запущенный через `exec`. Этот экспортер группирует записи, повторяет запросы и отправляет OTLP. Однопоточный мастер не запускает сетевой экспортер или фоновые потоки SDK.

Воркеры отправляют записи прямо экспортеру через неблокирующие локальные Unix-потоки. Записи мастера используют тот же экспортер. Ограниченные буферы отбрасывают записи при перегрузке или недоступности экспортера. Выполнение запросов не ждёт экспорта. Каждая закодированная IPC-запись занимает меньше 1 МиБ.

- Полные записи, которые экспортер уже принял, сохраняются у него после сбоя воркера.
- Неотправленные записи и незавершённые span теряются вместе с воркером.
- Экспортер хранит очереди в памяти, без постоянного хранилища.
- При сбое экспортера записи в его очередях теряются. Мастер заменяет экспортер, а отправители подключаются снова.
- При нормальном завершении ожидающие записи отправляются в пределах `export_timeout_secs`.
- Записи о сбоях процессов содержат `worker_pid`, `pool` и `exit_code` или `signal`.

Rapira не сохраняет снимки запросов и не восстанавливает трассы из общей памяти. Мастер не трассирует выполнение PHP.

## Контекст трассировки и семплирование

Rapira продолжает входящую трассу по заголовкам W3C `traceparent` и `tracestate`. При отсутствии или неверном значении родителя начинается новая трасса. Rapira объединяет повторяющиеся поля `tracestate`. Нативные операции получают новые локальные ID span. PHP получает контекст нативного span `php.execute`.

Параметр `sample_ratio` управляет семплированием корневых трасс. Семплер ParentBased сохраняет входящее состояние sampled или unsampled. Он использует `sample_ratio` только для трасс без родителя. `traces`, `logs` и `metrics` независимо управляют экспортом сигналов. При `traces = false` Rapira продолжает передавать контекст.

::: info Ограничение SDK
Rust SDK `opentelemetry` 0.32 отвергает корректные multi-tenant ключи `tracestate`, в которых ID системы содержит ровно 14 символов, например `tenant@abcdefghijklmn`. Из-за этого теряется весь `tracestate`. ID трассы и флаг sampled продолжают передаваться. См. [проверку в исходном коде SDK](https://docs.rs/opentelemetry/0.32.0/src/opentelemetry/trace/span_context.rs.html) и [грамматику ключа W3C](https://www.w3.org/TR/trace-context/#key).
:::

## Нативные сигналы

Нативные span охватывают запуск, приём запросов, middleware, сбор тела, разбор multipart, `queue.wait` и `php.execute`. Они также охватывают потоковую отправку ответа, sendfile, завершение текущей работы и остановку воркера.

| Метрика | Тип и единица | Атрибуты |
| --- | --- | --- |
| `http.server.request.duration` | Гистограмма, секунды (`s`) | `http.request.method`, `http.response.status_code` |
| `rapira.operation.duration` | Гистограмма, секунды (`s`) | `rapira.operation` |
| `rapira.otel.dropped_records` | Счётчик, записи | Нет |

Завершённые запросы и нативные операции записывают значения метрик. Существующий runtime каждого воркера собирает накопительные снимки с новыми значениями каждые `flush_interval_ms`, в том числе во время простоя. При завершении воркер отправляет оставшиеся значения. Экспортёр использует тот же интервал для отправки неполных пакетов. Каждая передача sendfile имеет один span с количеством байтов.

Ресурсы OTLP содержат `service.name`, `process.pid` и `rapira.role`. Каждый процесс также имеет постоянный случайный `service.instance.id`. Ресурсы воркера также содержат `rapira.pool`.

Записи логов связаны с активным нативным span. `[log]` и `RUST_LOG` управляют только фильтрацией stderr. OTLP использует собственные переключатели сигналов. Нативные span продолжают создаваться ниже уровня логирования stderr.

Диагностика экспортера и внутреннего SDK остаётся в stderr и не поступает обратно в OTLP. Все процессы используют одинаковые настройки фильтра и формата stderr. См. [Логирование](./logging).

## Span приложения PHP

Rapira предоставляет два носителя контекста типа `array<string, string>`:

- `Rapira\Http\Request::$traceContext` содержит нативный контекст. `Request` является классом `final readonly`. Последний аргумент его публичного конструктора - `array $traceContext`.
- Созданный хостом объект запроса сохраняет собственный контекст. Отложенное создание или сохранение объекта запроса не меняет его контекст.
- `Rapira\trace_context(): array` возвращает контекст активного callback в Worker или обмена в Dispatcher. Вне активной работы функция возвращает пустой массив.

В режиме Worker нативная область контекста сохраняется во время shutdown и освобождения ресурсов каждого задания. В Dispatcher область заканчивается при завершении обмена. Rust сохраняет контекст запроса во время выполнения PHP. PHP не возвращает ID span в Rust.

PHP управляет своими дочерними span, активацией контекста, SDK, семплированием, сбросом данных и экспортером. Rapira не инструментирует автоматически PHP-код или его планировщик Fiber. Для параллельных Fiber используйте [поддержку контекста PHP SDK](https://opentelemetry.io/docs/languages/php/context/#context-in-asynchronous-environments).

### Пример для Dispatcher

Настройте PHP SDK до запуска примера. Поместите настройку в `instrumentation.php`. Следуйте официальным руководствам по [настройке SDK](https://opentelemetry.io/docs/languages/php/instrumentation/#initialize-the-sdk) и [экспорту](https://opentelemetry.io/docs/languages/php/exporters/). Зарегистрируйте провайдер трассировки до цикла запросов. Настройте семплирование и сброс данных PHP для своего приложения.

Пример извлекает родительский контекст для каждого запроса и создаёт дочерний span PHP. Он использует стандартный [PHP API передачи контекста](https://opentelemetry.io/docs/languages/php/propagation/#manual-context-propagation).

```php
<?php

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\Context\Context;
use Rapira\Exception\ClosedException;

require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/instrumentation.php';

$tracer = Globals::tracerProvider()->getTracer('app');
$dispatcher = \Rapira\get_dispatcher();

while (true) {
    try {
        $exchange = $dispatcher->receive();
    } catch (ClosedException) {
        break;
    }

    $request = $exchange->getRequest();
    $parent = TraceContextPropagator::getInstance()->extract($request->traceContext, null, Context::getRoot());
    $span = $tracer->spanBuilder('app.handle')->setParent($parent)->startSpan();
    $scope = $span->activate();

    try {
        $exchange->writeHead(200, ['content-type' => ['text/plain']]);
        $exchange->writeBody("Hello\n");
    } finally {
        $scope->detach();
        $span->end();
    }
}
```

Извлекайте контекст для каждого запроса. Активируйте контекст для этого запроса. Отсоединяйте область в `finally`. Завершайте span в том же блоке. Глобальный родитель, заданный один раз при запуске воркера, не может идентифицировать последующие запросы.

### Контекст в Worker

В callback функции `Rapira\handle_request()` используйте такое извлечение родителя с тем же дочерним span и блоком `finally`:

```php
$parent = TraceContextPropagator::getInstance()->extract(\Rapira\trace_context(), null, Context::getRoot());
```

Внутри callback используйте функции ответа Worker, например `header()` и `echo`. Цикл описан в разделе [Режим Worker](./worker).
