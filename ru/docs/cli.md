---
title: Командная строка
description: "Команда rapira serve, её аргумент с файлом конфигурации и разрешение пути к входному скрипту."
---

# Командная строка

Rapira - это один бинарник с единственной подкомандой:

```bash
rapira serve <CONFIG>
```

Команда `serve` запускает PHP, регистрирует встроенные расширения и принимает запросы. `CONFIG` - это путь к файлу конфигурации. Он обязателен. Имя файла может быть любым, а эта документация использует `rapira.toml`. Запустите `rapira` без аргументов, чтобы показать справку. Запустите `rapira serve --help`, чтобы показать справку по команде. Запустите `rapira --version`, чтобы показать установленную версию.

Файл конфигурации содержит все настройки сервера. Значение в файле переопределяет встроенное значение по умолчанию. `RUST_LOG` и `NO_COLOR` меняют только вывод stderr. Все ключи и форматы адреса `listen` перечислены в разделе [Конфигурация](/ru/docs/configuration).

## Разрешение пути к входному скрипту

`http.pool.entrypoint` задаёт входной PHP-скрипт. Относительный путь разрешается относительно каталога файла конфигурации. Rapira преобразует путь в абсолютный до создания воркеров. Поэтому последующие изменения рабочего каталога не влияют на путь.

```toml
[http.pool]
entrypoint = "public/index.php"
```

Эта настройка в `/etc/rapira/rapira.toml` разрешается в `/etc/rapira/public/index.php`. Текущий каталог не влияет на результат.

## Примеры

Каждый пример - это полный файл `rapira.toml`. Режим по умолчанию - Dispatcher:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/dispatcher.php"
mode = "dispatcher"
```

Режим Worker:

```toml
[http]
listen = ":8080"

[http.pool]
entrypoint = "app/worker.php"
mode = "worker"
```

Режим Classic:

```toml
[http]
listen = "unix:/run/rapira.sock"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

Запустите сервер с путём к файлу:

```bash
rapira serve rapira.toml
rapira serve /etc/rapira/rapira.toml
```

Первый пример слушает `127.0.0.1:8000`. Отправьте запрос этой командой:

```bash
curl http://127.0.0.1:8000/
```

Входные скрипты для режимов Classic и Worker есть в разделе [Быстрый старт](/ru/docs/intro/quickstart). Входной скрипт для режима Dispatcher возьмите в каталоге [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) репозитория: это `dispatcher-sync.php` или `dispatcher-async.php`.

## Остановка сервера

Первый `SIGINT` или `SIGTERM` позволяет завершить текущие запросы. Затем сервер выключает расширения и завершается. Второй сигнал прекращает ожидание и принудительно завершает процесс. Отправляйте сигналы мастер-процессу. Полная таблица сигналов находится в разделе [Модель процессов](/ru/docs/process-model).
