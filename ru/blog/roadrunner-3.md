---
title: "RoadRunner 3"
date: 2026-10-19
description: "RoadRunner 3: изменения сервера, переименование PHP-пакетов в roadrunner/*, судьба TCP-плагина, DLoad в roadrunner/cli и известная проблема с Composer."
author: Rapira Team
image: /blog/roadrunner-3/preview.png
---

# Вышел RoadRunner 3

Рады сообщить, что мы выпустили [RoadRunner 3](https://github.com/roadrunner-server/roadrunner/releases/tag/v3.0.0).

RoadRunner 3 - последняя мажорная версия в обозримом времени с супер стабильным API. К этому релизу мы закрыли бэклог предыдущих версий RoadRunner и вернули понятную схему версионирования: избавились от календарных версий и вернулись к SemVer. RoadRunner 3 продолжит получать исправления ошибок и обновления безопасности, однако основные силы команды теперь направлены на развитие Rapira.

Ниже описано, что изменилось в сервере и PHP-пакетах и как обновиться.

## Главные изменения

Полный список есть в [заметках к релизу](https://docs.roadrunner.dev/docs/releases/v3-0-0). Основное:

- **Плагины в стандартной сборке.** Добавлены драйвер очередей NSQ, HTTP rate limiting, сжатие Zstd и реестр protobuf (Protoreg). TCP-плагин удалён.
- **HTTP.** Поддержка PROXY protocol v1 и v2 с явным списком доверенных прокси. Middleware `rate_limiter` возвращает `429` с `Retry-After`. В `static` появились настройки кешей и команда `rr reset static`.
- **gRPC.** Server reflection через Protoreg и детали `google.rpc.Status` в логах ошибок.
- **Jobs.** Именованные пулы воркеров: пайплайн можно привязать к отдельному пулу PHP-воркеров. AMQP поддерживает именованные подключения к разным брокерам. Kafka умеет читать выбранные партиции.
- **Lock.** Новый бэкенд Redis для блокировок между несколькими экземплярами RoadRunner.
- **Logger.** Логгер переведён на Go `log/slog`, запись в вывод стала неблокирующей.
- **Unix-сокеты.** Для слушателей и relay воркеров можно задать права, владельца и группу.
- **Status.** `/livez` и `/readyz` работают как алиасы `/health` и `/ready`.

## Ломающие изменения

Пошаговый список - в [руководстве по обновлению с v2025 на v3](https://docs.roadrunner.dev/docs/general/v3-migration). Самое заметное:

| Область              | Что изменилось                                                                                                                                              |
|----------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|
| HTTP middleware      | Запрос проходит `http.middleware` слева направо. Чтобы сохранить прежний порядок, разверните список.                                                        |
| HTTP/2               | Cleartext HTTP/2 работает только через prior knowledge. `Upgrade: h2c` больше не поддерживается.                                                            |
| AMQP                 | Настройки брокера переносятся в именованные подключения, `config.version` удалён.                                                                           |
| Logger               | `file_logger_options` и встроенная ротация удалены. Используйте `output` и внешний инструмент ротации. При переполнении очереди новые записи отбрасываются. |
| Трейсинг             | Нативный экспортер Zipkin удалён. Используйте OTLP.                                                                                                         |
| RPC                  | Goridge v4 не поддерживает MessagePack. Доступны JSON, protobuf, Gob и raw.                                                                                 |
| Jobs                 | Заголовок `pool` зарезервирован для маршрутизации в именованный пул. `pipeline_size` по умолчанию теперь `100000`.                                          |
| NATS                 | При остановке пайплайна стрим по умолчанию сохраняется.                                                                                                     |
| Centrifuge           | Метод `centrifuge.RateLimit` удалён.                                                                                                                        |
| `envfile`            | Корневой `envfile` загружается без experimental-режима. Указанный файл должен существовать.                                                                 |
| `server.on_init.env` | Значения переопределяют унаследованные переменные окружения.                                                                                                |
| TCP-плагин           | Не поддерживается в RoadRunner 3.                                                                                                                           |

В корне `.rr.yaml` по-прежнему указывается `version: "3"`. Для сборки из исходников нужен Go 1.27 или новее. Авторам Go-плагинов нужно перейти на `api-go/v6`, `api-plugins/v6`, `pool/v2`, `goridge/v4` и `*slog.Logger`. Сборщик Velox использует новую конфигурацию модулей, а удалённый сервер сборки и цели Windows из него убраны. Готовые бинарники для Windows в релизе есть.


## PHP-пакеты

Вместе с сервером обновились и PHP-пакеты. Основное:

- Минимальная версия PHP: 8.2.
- Новое имя вендора `roadrunner/*` для всех пакетов (вместо `spiral/*` и `roadrunner-php/*`).
- Неймспейсы классов не изменились ради обратной совместимости.
- Каждый новый пакет объявляет `replace` старого имени с `self.version`. Исключение — метапакет, о нём ниже.
- Метапакет `spiral/roadrunner` теперь называется `roadrunner/roadrunner`. Пакеты `roadrunner/*` требуют `roadrunner/roadrunner ^3.0`.
  Переименование пакета оградило нас от нескольких проблем:
  - Календарные версии 2023.x–2025.x, не соответствующие SemVer, постоянно всплывали как стабильные последние версии.
    CalVer остался в `spiral/roadrunner`.
  - Advisory [CVE-2025-22871](https://github.com/advisories/GHSA-g9pc-8g42-g6vq) отмечена как уязвимость для `spiral/roadrunner < 2025.1.0`, что блокировало установку RoadRunner 3 через Composer. С новым именем этого бремени нет.
- Все пакеты требуют RoadRunner 3. Работа старых версий RoadRunner с новыми пакетами не гарантируется.
- TCP-плагин выпилен из RoadRunner 3. Приложениям с TCP-плагином рекомендуется остаться на RoadRunner v2025.
  Это не касается транспорта `tcp://` для RPC и relay воркеров: он работает как раньше.

Полировка:

- Тесты переписаны на [Testo](https://github.com/php-testo/testo).
- Показатели Code Coverage, Mutation Testing и Static Analysis улучшены.
- RoadRunner CLI 3.0.0 скачивает бинарники через [DLoad](https://github.com/php-internal/dload).

| Старое имя | Новое имя | Статус |
|---|---|---|
| `spiral/roadrunner` | `roadrunner/roadrunner` | [![Версия](https://img.shields.io/packagist/v/roadrunner/roadrunner.svg?label=)](https://packagist.org/packages/roadrunner/roadrunner) |
| `spiral/roadrunner-worker` | `roadrunner/worker` | [![Версия](https://img.shields.io/packagist/v/roadrunner/worker.svg?label=)](https://packagist.org/packages/roadrunner/worker) [![Psalm](https://shepherd.dev/github/roadrunner-php/worker/level.svg)](https://shepherd.dev/github/roadrunner-php/worker) [![Покрытие](https://codecov.io/gh/roadrunner-php/worker/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/worker/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fworker%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/worker/3.x) |
| `spiral/roadrunner-http` | `roadrunner/http` | [![Версия](https://img.shields.io/packagist/v/roadrunner/http.svg?label=)](https://packagist.org/packages/roadrunner/http) [![Psalm](https://shepherd.dev/github/roadrunner-php/http/level.svg)](https://shepherd.dev/github/roadrunner-php/http) [![Покрытие](https://codecov.io/gh/roadrunner-php/http/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/http/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fhttp%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/http/4.x) |
| `spiral/roadrunner-grpc` | `roadrunner/grpc` | [![Версия](https://img.shields.io/packagist/v/roadrunner/grpc.svg?label=)](https://packagist.org/packages/roadrunner/grpc) [![Psalm](https://shepherd.dev/github/roadrunner-php/grpc/level.svg)](https://shepherd.dev/github/roadrunner-php/grpc) [![Покрытие](https://codecov.io/gh/roadrunner-php/grpc/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/grpc/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fgrpc%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/grpc/3.x) |
| `spiral/roadrunner-jobs` | `roadrunner/jobs` | [![Версия](https://img.shields.io/packagist/v/roadrunner/jobs.svg?label=)](https://packagist.org/packages/roadrunner/jobs) [![Psalm](https://shepherd.dev/github/roadrunner-php/jobs/level.svg)](https://shepherd.dev/github/roadrunner-php/jobs) [![Покрытие](https://codecov.io/gh/roadrunner-php/jobs/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/jobs/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fjobs%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/jobs/4.x) |
| `spiral/roadrunner-kv` | `roadrunner/kv` | [![Версия](https://img.shields.io/packagist/v/roadrunner/kv.svg?label=)](https://packagist.org/packages/roadrunner/kv) [![Psalm](https://shepherd.dev/github/roadrunner-php/kv/level.svg)](https://shepherd.dev/github/roadrunner-php/kv) [![Покрытие](https://codecov.io/gh/roadrunner-php/kv/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/kv/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fkv%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/kv/4.x) |
| `spiral/roadrunner-metrics` | `roadrunner/metrics` | [![Версия](https://img.shields.io/packagist/v/roadrunner/metrics.svg?label=)](https://packagist.org/packages/roadrunner/metrics) [![Psalm](https://shepherd.dev/github/roadrunner-php/metrics/level.svg)](https://shepherd.dev/github/roadrunner-php/metrics) [![Покрытие](https://codecov.io/gh/roadrunner-php/metrics/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/metrics/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fmetrics%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/metrics/3.x) |
| `spiral/roadrunner-services` | `roadrunner/services` | [![Версия](https://img.shields.io/packagist/v/roadrunner/services.svg?label=)](https://packagist.org/packages/roadrunner/services) [![Psalm](https://shepherd.dev/github/roadrunner-php/services/level.svg)](https://shepherd.dev/github/roadrunner-php/services) [![Покрытие](https://codecov.io/gh/roadrunner-php/services/branch/2.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/services/branch/2.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fservices%2F2.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/services/2.x) |
| `spiral/goridge` | `roadrunner/goridge` | [![Версия](https://img.shields.io/packagist/v/roadrunner/goridge.svg?label=)](https://packagist.org/packages/roadrunner/goridge) [![Psalm](https://shepherd.dev/github/roadrunner-php/goridge/level.svg)](https://shepherd.dev/github/roadrunner-php/goridge) [![Покрытие](https://codecov.io/gh/roadrunner-php/goridge/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/goridge/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fgoridge%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/goridge/4.x) |
| `spiral/roadrunner-cli` | `roadrunner/cli` | [![Версия](https://img.shields.io/packagist/v/roadrunner/cli.svg?label=)](https://packagist.org/packages/roadrunner/cli) [![Psalm](https://shepherd.dev/github/roadrunner-php/cli/level.svg)](https://shepherd.dev/github/roadrunner-php/cli) [![Покрытие](https://codecov.io/gh/roadrunner-php/cli/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/cli/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fcli%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/cli/3.x) |
| `roadrunner-php/app-logger` | `roadrunner/app-logger` | [![Версия](https://img.shields.io/packagist/v/roadrunner/app-logger.svg?label=)](https://packagist.org/packages/roadrunner/app-logger) [![Psalm](https://shepherd.dev/github/roadrunner-php/app-logger/level.svg)](https://shepherd.dev/github/roadrunner-php/app-logger) [![Покрытие](https://codecov.io/gh/roadrunner-php/app-logger/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/app-logger/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fapp-logger%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/app-logger/1.x) |
| `roadrunner-php/centrifugo` | `roadrunner/centrifugo` | [![Версия](https://img.shields.io/packagist/v/roadrunner/centrifugo.svg?label=)](https://packagist.org/packages/roadrunner/centrifugo) [![Psalm](https://shepherd.dev/github/roadrunner-php/centrifugo/level.svg)](https://shepherd.dev/github/roadrunner-php/centrifugo) [![Покрытие](https://codecov.io/gh/roadrunner-php/centrifugo/branch/2.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/centrifugo/branch/2.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fcentrifugo%2F2.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/centrifugo/2.x) |
| `roadrunner-php/lock` | `roadrunner/lock` | [![Версия](https://img.shields.io/packagist/v/roadrunner/lock.svg?label=)](https://packagist.org/packages/roadrunner/lock) [![Psalm](https://shepherd.dev/github/roadrunner-php/lock/level.svg)](https://shepherd.dev/github/roadrunner-php/lock) [![Покрытие](https://codecov.io/gh/roadrunner-php/lock/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/lock/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Flock%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/lock/1.x) |
| `roadrunner-php/symfony-lock-driver` | `roadrunner/symfony-lock-driver` | [![Версия](https://img.shields.io/packagist/v/roadrunner/symfony-lock-driver.svg?label=)](https://packagist.org/packages/roadrunner/symfony-lock-driver) [![Psalm](https://shepherd.dev/github/roadrunner-php/symfony-lock-driver/level.svg)](https://shepherd.dev/github/roadrunner-php/symfony-lock-driver) [![Покрытие](https://codecov.io/gh/roadrunner-php/symfony-lock-driver/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/symfony-lock-driver/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fsymfony-lock-driver%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/symfony-lock-driver/1.x) |
| `roadrunner-php/version-checker` | `roadrunner/version-checker` | [![Версия](https://img.shields.io/packagist/v/roadrunner/version-checker.svg?label=)](https://packagist.org/packages/roadrunner/version-checker) [![Psalm](https://shepherd.dev/github/roadrunner-php/version-checker/level.svg)](https://shepherd.dev/github/roadrunner-php/version-checker) [![Покрытие](https://codecov.io/gh/roadrunner-php/version-checker/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/version-checker/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fversion-checker%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/version-checker/1.x) |
| `roadrunner-php/roadrunner-api-dto` | `roadrunner/api-dto` | [![Версия](https://img.shields.io/packagist/v/roadrunner/api-dto.svg?label=)](https://packagist.org/packages/roadrunner/api-dto) |

Для миграции замените имена и версии в `composer.json`.

## Ещё стабильнее

RoadRunner и раньше давал самую надёжную интеграцию с PHP: что может быть стабильнее STDIN/STDOUT? Но даже здесь в версии 3 мы нашли, что улучшить: потребление памяти стало ровнее, а производительность ещё немного выросла.

![Потребление памяти RoadRunner v2025, RoadRunner v3 и Rapira dispatcher при растущей нагрузке](/blog/roadrunner-3/benches.png)

Однако если вам нужна максимальная производительность HTTP- или gRPC-эндпоинтов, возможно, пришло время присмотреться к [Rapira](/ru/docs/intro/).
