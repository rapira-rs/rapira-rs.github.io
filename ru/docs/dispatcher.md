---
title: Режим Dispatcher
description: "Цикл HTTP-диспетчера Rapira, API Request и Exchange, загрузки файлов, sendFile() и исключения диспетчера."
faqLevel: 2
---

# Режим Dispatcher

Режим Dispatcher сохраняет процесс PHP между запросами, как [режим Worker](/ru/docs/worker). Скрипт инициализирует приложение один раз, а затем получает каждый запрос вызовом API. Rapira не заполняет суперглобальные переменные для запроса. Скрипт читает объект запроса и записывает ответ вызовами методов.

Эта страница - руководство по программированию для HTTP-диспетчера. Сравнение режимов приведено в разделе [Режимы выполнения](/ru/docs/execution-modes). Пул gRPC тоже использует режим Dispatcher. API вызовов gRPC описан в разделе [gRPC](/ru/docs/grpc).

## Цикл получения

Скрипт диспетчера состоит из трёх частей. Первая часть инициализирует приложение. Вторая часть получает диспетчер. Третья часть получает запросы в цикле, пока Rapira не закроет диспетчер.

```php
<?php
// worker.php
use Rapira\Exception\ClosedException;
use Rapira\Exception\WorkDiscardedException;
use Rapira\LogLevel;

require __DIR__ . '/vendor/autoload.php';

$app = new App(); // The worker creates this object once and reuses it.
$dispatcher = \Rapira\get_dispatcher();

while (true) {
    try {
        $exchange = $dispatcher->receive();
    } catch (ClosedException) {
        break; // No more requests arrive for this worker.
    }

    try {
        $body = $app->handle($exchange->getRequest());
        $exchange->writeHead(200, ['content-type' => ['text/plain']]);
        $exchange->writeBody($body); // $eos is true by default, so this call ends the response.
    } catch (WorkDiscardedException) {
        // The client left before the response ended.
    } catch (\Throwable $e) {
        \Rapira\log('request failed', LogLevel::Error, ['exception' => $e]);
    }

    unset($exchange); // If the response did not end, Rapira sends 500 or cuts the response.
}
```

Режим по умолчанию - Dispatcher. Задайте его явно в таблице `[http.pool]` файла `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/worker.php"
mode = "dispatcher"
```

```bash
rapira serve rapira.toml
```

Остальные ключи пула описаны в разделе [Конфигурация](/ru/docs/configuration#http-pool).

## Получение запроса

В HTTP-воркере `\Rapira\get_dispatcher()` возвращает `Rapira\Http\HttpDispatcher`. В режимах Classic и Worker функция бросает `Rapira\Exception\NoDispatcherError`. Используйте `\Rapira\get_mode()`, чтобы проверить режим в скрипте, который поддерживает несколько режимов.

| Метод | Поведение |
| --- | --- |
| `receive(int $timeout = -1): Exchange` | Ожидает следующий запрос. Тайм-аут задаётся в микросекундах. `-1` ожидает без ограничения, а `0` не ожидает. По истечении тайм-аута метод бросает `Rapira\Exception\TimeoutException`. |
| `tryReceive(): ?Exchange` | Возвращает следующий запрос или `null`, если запросов в очереди нет. Метод не ожидает. |
| `getInfo(): HttpDispatcherInfo` | Возвращает `pendingCount()`, число запросов в очереди этого воркера, и `activeCount()`, который равен `0` или `1`. |
| `name(): string` | Возвращает `http`. |

Во время ожидания `receive()` блокирует поток PHP. Во время ожидания воркер не использует процессор. Таймер PHP `max_execution_time` не учитывает это ожидание и запускается заново для каждого запроса. Rapira пропускает запрос из очереди, если его клиент ушёл до того, как запрос попал в PHP.

## Один exchange за раз

Каждый воркер обрабатывает один exchange за раз. Завершите ответ текущего exchange до следующего вызова `receive()` или `tryReceive()`. Иначе вызов бросает `\Error`. Файберы не меняют это правило. Чтобы обрабатывать больше запросов одновременно, увеличьте `http.pool.processes`.

Эти вызовы завершают ответ:

- `writeBody()` или `sendFile()` с `$eos = true`, это значение по умолчанию.
- `writeTrailers()`.

Когда Rapira обнаруживает отмену открытого exchange, `receive()` и `tryReceive()` отбрасывают его перед получением следующей работы. В этом случае они не бросают `\Error` открытого exchange. Когда код удаляет последнюю ссылку на открытый exchange, например вызовом `unset($exchange)`, Rapira завершает ответ. Если заголовок ответа не отправлен, Rapira отправляет `500` с пустым телом. Если заголовок ответа отправлен, Rapira обрывает ответ.

Отправка всех байтов, объявленных в `Content-Length`, с `$eos = false` не завершает exchange. Завершите его перед следующим вызовом получения работы. Закрытие соединения после полной доставки ответа не отменяет exchange. PHP всё ещё может завершить его. Разрыв соединения до полной доставки может отменить его.

`http.pool.request_terminate_timeout_secs` отсчитывается от возврата `receive()` или `tryReceive()`. Rapira завершает и заменяет воркер, который превысил это ограничение. Этот ключ описан в разделе [Конфигурация](/ru/docs/configuration#http-pool).

## Завершение цикла

При остановке, перезагрузке или замене после `http.pool.max_requests` Rapira закрывает диспетчер. Когда диспетчер закрыт и его очередь пуста, `receive()` и `tryReceive()` бросают `Rapira\Exception\ClosedException`. Каждый следующий вызов снова бросает это исключение. Перехватите исключение, выйдите из цикла и дайте входному скрипту завершиться.

Неперехваченное исключение или фатальная ошибка завершает входной скрипт. Затем Rapira снова запускает входной скрипт в том же воркере. Клиент открытого exchange получает ответ с ошибкой или неполный ответ.

::: question Что происходит, если входной скрипт завершается до `ClosedException`?
Если скрипт получил хотя бы один запрос, Rapira снова запускает входной скрипт в том же воркере. Если скрипт завершился до получения запроса, Rapira засчитывает сбой запуска. Если запрос поступает в течение пяти секунд, Rapira отвечает на него `503`. Затем Rapira снова запускает скрипт. После пяти сбоев запуска подряд воркер завершается как неработоспособный.
:::

## Запрос

`$exchange->getRequest()` возвращает `Rapira\Http\Request`, доступный только для чтения. Каждый вызов возвращает тот же объект.

| Свойство | Тип | Значение |
| --- | --- | --- |
| `method` | `string` | Метод запроса, например `GET`. |
| `uri` | `string` | Абсолютный URI, например `http://example.com/a?b=1`. Схема всегда `http`. Без authority Rapira использует адрес сервера. |
| `target` | `string` | Цель запроса. Для запроса в origin-form это путь и строка запроса, например `/a?b=1`. |
| `authority` | `?string` | Значение `Host`. Для запроса HTTP/1.0 без `Host` равно `null`. |
| `protocol` | `string` | `HTTP/1.1` или `HTTP/1.0`. |
| `headers` | `array<string, list<string>>` | Поля запроса. Имена в нижнем регистре. Каждое имя имеет список значений. |
| `body` | `string` или `Multipart` | Полное тело или `Rapira\Http\Multipart` для тела `multipart/form-data`. |
| `remote` | `InetAddress` или `UnixAddress` | Адрес клиента. `Rapira\InetAddress` имеет `ip` и `port`. `Rapira\UnixAddress` имеет `path`. |
| `server` | `InetAddress` или `UnixAddress` | Адрес слушателя. |
| `tls` | `?Rapira\Tls` | Всегда `null`. Rapira не имеет TLS-слушателя. |
| `receivedAt` | `float` | Время Unix в секундах, когда Rapira получил запрос. |

Rapira читает всё тело в память до того, как PHP получает запрос. `http.max_body_size_mb` ограничивает размер тела. Проверки запроса описаны в разделе [HTTP](/ru/docs/http).

В режиме Dispatcher `$_SERVER` сохраняет значения от запуска входного скрипта. Rapira не меняет его для каждого запроса. Смотрите [`$_SERVER` до первого запроса](/ru/docs/execution-modes#server-до-первого-запроса).

## Ответ

`Rapira\Http\Exchange` имеет следующие методы. `$headers` и `$trailers` имеют форму `array<string, list<string>>`: каждое имя поля имеет список значений.

| Метод | Поведение |
| --- | --- |
| `writeHead(int $status, array $headers = []): void` | Задаёт статус и поля. Статус должен быть от 100 до 599. Rapira не передаёт заголовок ответа `1xx`. Статус `101` даёт клиенту `502`. Rapira отправляет заголовок ответа с первой записью тела, с `flush()` или с `writeTrailers()`. |
| `writeBody(string $content, bool $eos = true): void` | Записывает данные тела. Без `writeHead()` статус равен `200`. Задайте `$eos` равным `false`, чтобы записать ещё данные позже. |
| `sendFile(string $path, int $offset = 0, ?int $length = null, bool $eos = true): void` | Отправляет файл или часть файла как данные тела. Смотрите [Отправка файла](#отправка-фаила). |
| `writeTrailers(array $trailers): void` | Завершает ответ. Вызывайте метод после `writeHead()` или записи тела. Rapira не отправляет трейлеры клиенту. |
| `flush(): void` | Сразу отправляет заголовок ответа. Без `writeHead()` статус равен `200`. |
| `isFinalized(): bool` | Возвращает `true`, когда exchange завершён или Rapira обнаружил его отмену. |
| `isCancelled(): bool` | Возвращает `true`, когда Rapira обнаружил отмену exchange. Закрытие соединения после полной доставки ответа не отменяет его. |

Задайте `content-length` в `writeHead()`, если размер тела известен. Запись сверх этой длины отправляет часть, которая помещается, завершает ответ и бросает `ContentLengthExceededError`. Без `content-length` HTTP-сервер сам разбивает тело на фрагменты. Правила разбиения и поля, которые Rapira удаляет, описаны в разделе [Передача ответа](/ru/docs/http#передача-ответа).

Чтобы передавать ответ потоком, вызывайте `writeBody()` с `$eos = false` для каждой части. Затем вызовите `writeBody('')`, чтобы завершить ответ.

Ограничьте каждый фрагмент `writeBody()` размером не более 1 GiB. Более крупный фрагмент бросает `\Error` и завершает ответ как усечённый. Ограничение относится к каждому фрагменту, а не ко всему потоковому ответу.

Медленный клиент может заполнить канал ответа. Тогда запись блокирует поток PHP до появления свободного места или закрытия канала. Это блокирует все файберы PHP в этом воркере.

## Загрузки файлов

Rapira разбирает тело `multipart/form-data` до того, как PHP получает запрос. Тогда `Request::$body` является `Rapira\Http\Multipart`:

| Класс | Свойства |
| --- | --- |
| `Multipart` | `fields`, список `FormField`. `files`, список `UploadedFile`. |
| `FormField` | `name`, `value`, `headers`. |
| `UploadedFile` | `name`, `clientFilename`, `clientMediaType`, `headers`, `tmpPath`, `size`. |

Rapira записывает каждую файловую часть во временный файл в подкаталоге `rapira-spool-<pid>` каталога `http.uploads.dir`. `UploadedFile::$tmpPath` содержит путь этого файла. Rapira удаляет временные файлы после завершения ответа. Чтобы сохранить файл, переместите его с помощью `rename()` до завершения ответа.

Для некорректного тела Rapira возвращает `400`. Если тело превышает ограничение, Rapira возвращает `413`. Скрипт не получает такие запросы. Ограничения описаны в разделе [Таблица `[http.uploads]`](/ru/docs/configuration#таблица-http-uploads).

## Отправка файла

`sendFile()` читает только файлы внутри корня sendfile. Корень по умолчанию - каталог `http.pool.entrypoint`. Rapira разрешает символические ссылки до сравнения пути с корнем. Настройка корня описана в разделе [Таблица `[http.sendfile]`](/ru/docs/configuration#таблица-http-sendfile).

Файл открывает хост. PHP `open_basedir` не ограничивает эту операцию. Путь ограничивает настроенный корень sendfile.

Вызов бросает `Rapira\Http\Exception\FileNotSendableException` и не записывает данные в этих случаях:

- Путь находится вне корня.
- Файл не существует или не является обычным файлом.
- Смещение или длина выходит за конец файла.

Rapira не задаёт для файла `content-type`, `etag` или поля диапазонов. Задайте нужные поля с помощью `writeHead()`.

```php
$exchange->writeHead(200, ['content-type' => ['application/pdf']]);
$exchange->sendFile(__DIR__ . '/files/report.pdf');
```

Поместите `report.pdf` в каталог `files/` рядом с входным скриптом. Этот путь находится внутри корня по умолчанию. Пользовательский корень также должен содержать этот файл.

## Исключения

Каждый класс исключения в пространствах имён `Rapira` реализует `Rapira\Exception\RapiraThrowable`. Обычные `\Error` и `\ValueError` его не реализуют.

| Исключение | Кто бросает | Причина |
| --- | --- | --- |
| `Rapira\Exception\ClosedException` | `receive()`, `tryReceive()` | Rapira закрыл диспетчер. Новые запросы не поступят. |
| `Rapira\Exception\TimeoutException` | `receive()` | Запрос не поступил до истечения тайм-аута. |
| `Rapira\Exception\NoDispatcherError` | `\Rapira\get_dispatcher()` | Процесс работает не в режиме Dispatcher. |
| `Rapira\Exception\WorkDiscardedException` | Методы записи | Rapira отменил exchange до того, как PHP завершил его. |
| `Rapira\Exception\AlreadyFinalizedError` | `writeBody()`, `sendFile()`, `writeTrailers()`, `flush()` | Ответ уже завершён. |
| `Rapira\Http\Exception\HeadAlreadyWrittenError` | `writeHead()` | Заголовок ответа уже задан, или ответ уже завершён. |
| `Rapira\Http\Exception\HeadNotWrittenError` | `writeTrailers()` | Ещё нет ни заголовка ответа, ни данных тела. |
| `Rapira\Http\Exception\ContentLengthExceededError` | `writeBody()`, `sendFile()` | Запись выходит за объявленный `content-length`. |
| `Rapira\Http\Exception\FileNotSendableException` | `sendFile()` | Rapira не может отправить файл. |
| `\Error` | `receive()`, `tryReceive()` | Предыдущий exchange ещё открыт. |
| `\Error` | `writeBody()` | Один фрагмент превышает 1 GiB. Rapira завершает ответ как усечённый. |
| `\Error` | `rapira_finish_request()` | Функция недоступна в режиме Dispatcher. Вместо неё завершите exchange. |
| `\ValueError` | Несколько методов | Аргумент недопустим. Например, статус вне диапазона от 100 до 599, поле, недопустимое для передачи по сети, или поле трейлера, такое как `content-type`. |

## Вывод `echo`

В режиме Dispatcher `echo`, `print` и другой вывод PHP не попадают к клиенту. Rapira записывает каждый вызов вывода в лог в цель `php` с уровнем `info`. Уровень лога по умолчанию `error` скрывает эти записи. Для записи ответа используйте методы exchange. Как показать цель `php`, описано в разделе [Логирование](/ru/docs/logging#уровни-для-отдельных-целеи).

## Стабы для IDE

Rapira объявляет свои функции и классы PHP в файлах стабов. Интерфейсы диспетчера и основные функции находятся в [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php). Типы HTTP и классы исключений HTTP находятся в [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/plugins/http/rapira_http.stub.php). Остальные классы исключений находятся в [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira_exception.stub.php). Добавьте эти файлы в проект, чтобы включить автодополнение в IDE.
