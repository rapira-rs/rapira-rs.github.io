---
title: "RoadRunner 3"
date: 2026-10-19
description: "RoadRunner 3: novedades del servidor, paquetes PHP renombrados a roadrunner/*, qué pasa con el plugin TCP, DLoad en roadrunner/cli y un problema conocido con Composer."
author: Rapira Team
image: /blog/roadrunner-3/preview.png
---

# Ya está aquí RoadRunner 3

Nos alegra anunciar que hemos publicado [RoadRunner 3](https://github.com/roadrunner-server/roadrunner/releases/tag/v3.0.0).

RoadRunner 3 será la última versión mayor durante mucho tiempo y llega con una API muy estable. Para esta versión hemos cerrado el backlog pendiente de las versiones anteriores y hemos recuperado un esquema de versionado claro: dejamos atrás las versiones basadas en calendario y volvemos a SemVer. RoadRunner 3 seguirá recibiendo correcciones de errores y parches de seguridad, pero a partir de ahora el equipo dedica la mayor parte de su esfuerzo a Rapira.

A continuación repasamos qué ha cambiado en el servidor y en los paquetes PHP, y cómo actualizar.

## Principales novedades

La lista completa está en las [notas de la versión](https://docs.roadrunner.dev/docs/releases/v3-0-0). Lo más destacado:

- **Plugins incluidos en la build estándar.** Se añaden el driver de colas NSQ, rate limiting para HTTP, compresión Zstd y el registro de protobuf (Protoreg). Se elimina el plugin TCP.
- **HTTP.** Soporte de PROXY protocol v1 y v2 con una lista explícita de proxies de confianza. El middleware `rate_limiter` responde con `429` y la cabecera `Retry-After`. `static` admite ahora configurar la caché y añade el comando `rr reset static`.
- **gRPC.** Server reflection a través de Protoreg y detalles de `google.rpc.Status` en los logs de errores.
- **Jobs.** Pools de workers con nombre: un pipeline se puede asignar a su propio pool de workers PHP. AMQP admite conexiones con nombre a distintos brokers. Kafka puede consumir solo las particiones que elijas.
- **Lock.** Nuevo backend de Redis para compartir locks entre varias instancias de RoadRunner.
- **Logger.** El logger usa ahora `log/slog` de Go y la escritura en la salida ya no es bloqueante.
- **Sockets Unix.** Puedes definir permisos, propietario y grupo para los listeners y para el relay de los workers.
- **Status.** `/livez` y `/readyz` funcionan como alias de `/health` y `/ready`.

## Cambios incompatibles

La lista detallada, paso a paso, está en la [guía de migración de v2025 a v3](https://docs.roadrunner.dev/docs/general/v3-migration). Lo más relevante:

| Área | Qué ha cambiado |
|---|---|
| HTTP middleware | La petición recorre `http.middleware` de izquierda a derecha. Para conservar el orden anterior, invierte la lista. |
| HTTP/2 | HTTP/2 sin TLS (cleartext) solo funciona con prior knowledge. `Upgrade: h2c` deja de estar soportado. |
| AMQP | La configuración del broker pasa a conexiones con nombre y se elimina `config.version`. |
| Logger | Se eliminan `file_logger_options` y la rotación integrada. Usa `output` y una herramienta de rotación externa. Si la cola se llena, se descartan las entradas nuevas. |
| Tracing | Se elimina el exportador nativo de Zipkin. Usa OTLP. |
| RPC | Goridge v4 no soporta MessagePack. Están disponibles JSON, protobuf, Gob y raw. |
| Jobs | La cabecera `pool` queda reservada para enrutar a un pool con nombre. El valor por defecto de `pipeline_size` pasa a ser `100000`. |
| NATS | Al detener un pipeline, el stream se conserva por defecto. |
| Centrifuge | Se elimina el método `centrifuge.RateLimit`. |
| `envfile` | El `envfile` de la raíz se carga sin necesidad del modo experimental. El fichero indicado tiene que existir. |
| `server.on_init.env` | Sus valores sobrescriben las variables de entorno heredadas. |
| Plugin TCP | No está soportado en RoadRunner 3. |

En la raíz de `.rr.yaml` se sigue indicando `version: "3"`. Para compilar desde el código fuente hace falta Go 1.27 o superior. Quienes desarrollen plugins en Go tienen que migrar a `api-go/v6`, `api-plugins/v6`, `pool/v2`, `goridge/v4` y `*slog.Logger`. El builder Velox usa una nueva configuración de módulos y pierde el servidor de build remoto y los targets de Windows. Aun así, la release incluye binarios precompilados para Windows.

## Paquetes PHP

Los paquetes PHP se han actualizado junto con el servidor. Lo principal:

- La versión mínima de PHP es la 8.2.
- Todos los paquetes pasan al nuevo vendor `roadrunner/*` (en lugar de `spiral/*` y `roadrunner-php/*`).
- Los namespaces de las clases no cambian, para mantener la retrocompatibilidad.
- Cada paquete nuevo declara un `replace` del nombre antiguo con `self.version`. La excepción es el metapaquete, del que hablamos a continuación.
- El metapaquete `spiral/roadrunner` pasa a llamarse `roadrunner/roadrunner`. Los paquetes `roadrunner/*` requieren `roadrunner/roadrunner ^3.0`. Con el cambio de nombre nos quitamos de encima varios problemas:
  - Las versiones de calendario 2023.x–2025.x, que no siguen SemVer, aparecían una y otra vez como las últimas versiones estables. CalVer se queda en `spiral/roadrunner`.
  - El advisory [CVE-2025-22871](https://github.com/advisories/GHSA-g9pc-8g42-g6vq) marca `spiral/roadrunner < 2025.1.0` como vulnerable, y eso impedía instalar RoadRunner 3 con Composer. Con el nombre nuevo, ese lastre desaparece.
- Todos los paquetes requieren RoadRunner 3. No garantizamos que las versiones antiguas de RoadRunner funcionen con los paquetes nuevos.
- El plugin TCP se ha eliminado de RoadRunner 3. Si tu aplicación usa el plugin TCP, te recomendamos quedarte en RoadRunner v2025. Esto no afecta al transporte `tcp://` para RPC y para el relay de los workers, que sigue funcionando igual que antes.

Además, hemos pulido varios detalles:

- Los tests se han reescrito con [Testo](https://github.com/php-testo/testo).
- Han mejorado las métricas de code coverage, mutation testing y análisis estático.
- RoadRunner CLI 3.0.0 descarga los binarios con [DLoad](https://github.com/php-internal/dload).

| Nombre antiguo | Nombre nuevo | Estado |
|---|---|---|
| `spiral/roadrunner` | `roadrunner/roadrunner` | [![Versión](https://img.shields.io/packagist/v/roadrunner/roadrunner.svg?label=)](https://packagist.org/packages/roadrunner/roadrunner) |
| `spiral/roadrunner-worker` | `roadrunner/worker` | [![Versión](https://img.shields.io/packagist/v/roadrunner/worker.svg?label=)](https://packagist.org/packages/roadrunner/worker) [![Psalm](https://shepherd.dev/github/roadrunner-php/worker/level.svg)](https://shepherd.dev/github/roadrunner-php/worker) [![Cobertura](https://codecov.io/gh/roadrunner-php/worker/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/worker/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fworker%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/worker/3.x) |
| `spiral/roadrunner-http` | `roadrunner/http` | [![Versión](https://img.shields.io/packagist/v/roadrunner/http.svg?label=)](https://packagist.org/packages/roadrunner/http) [![Psalm](https://shepherd.dev/github/roadrunner-php/http/level.svg)](https://shepherd.dev/github/roadrunner-php/http) [![Cobertura](https://codecov.io/gh/roadrunner-php/http/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/http/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fhttp%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/http/4.x) |
| `spiral/roadrunner-grpc` | `roadrunner/grpc` | [![Versión](https://img.shields.io/packagist/v/roadrunner/grpc.svg?label=)](https://packagist.org/packages/roadrunner/grpc) [![Psalm](https://shepherd.dev/github/roadrunner-php/grpc/level.svg)](https://shepherd.dev/github/roadrunner-php/grpc) [![Cobertura](https://codecov.io/gh/roadrunner-php/grpc/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/grpc/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fgrpc%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/grpc/3.x) |
| `spiral/roadrunner-jobs` | `roadrunner/jobs` | [![Versión](https://img.shields.io/packagist/v/roadrunner/jobs.svg?label=)](https://packagist.org/packages/roadrunner/jobs) [![Psalm](https://shepherd.dev/github/roadrunner-php/jobs/level.svg)](https://shepherd.dev/github/roadrunner-php/jobs) [![Cobertura](https://codecov.io/gh/roadrunner-php/jobs/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/jobs/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fjobs%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/jobs/4.x) |
| `spiral/roadrunner-kv` | `roadrunner/kv` | [![Versión](https://img.shields.io/packagist/v/roadrunner/kv.svg?label=)](https://packagist.org/packages/roadrunner/kv) [![Psalm](https://shepherd.dev/github/roadrunner-php/kv/level.svg)](https://shepherd.dev/github/roadrunner-php/kv) [![Cobertura](https://codecov.io/gh/roadrunner-php/kv/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/kv/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fkv%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/kv/4.x) |
| `spiral/roadrunner-metrics` | `roadrunner/metrics` | [![Versión](https://img.shields.io/packagist/v/roadrunner/metrics.svg?label=)](https://packagist.org/packages/roadrunner/metrics) [![Psalm](https://shepherd.dev/github/roadrunner-php/metrics/level.svg)](https://shepherd.dev/github/roadrunner-php/metrics) [![Cobertura](https://codecov.io/gh/roadrunner-php/metrics/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/metrics/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fmetrics%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/metrics/3.x) |
| `spiral/roadrunner-services` | `roadrunner/services` | [![Versión](https://img.shields.io/packagist/v/roadrunner/services.svg?label=)](https://packagist.org/packages/roadrunner/services) [![Psalm](https://shepherd.dev/github/roadrunner-php/services/level.svg)](https://shepherd.dev/github/roadrunner-php/services) [![Cobertura](https://codecov.io/gh/roadrunner-php/services/branch/2.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/services/branch/2.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fservices%2F2.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/services/2.x) |
| `spiral/goridge` | `roadrunner/goridge` | [![Versión](https://img.shields.io/packagist/v/roadrunner/goridge.svg?label=)](https://packagist.org/packages/roadrunner/goridge) [![Psalm](https://shepherd.dev/github/roadrunner-php/goridge/level.svg)](https://shepherd.dev/github/roadrunner-php/goridge) [![Cobertura](https://codecov.io/gh/roadrunner-php/goridge/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/goridge/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fgoridge%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/goridge/4.x) |
| `spiral/roadrunner-cli` | `roadrunner/cli` | [![Versión](https://img.shields.io/packagist/v/roadrunner/cli.svg?label=)](https://packagist.org/packages/roadrunner/cli) [![Psalm](https://shepherd.dev/github/roadrunner-php/cli/level.svg)](https://shepherd.dev/github/roadrunner-php/cli) [![Cobertura](https://codecov.io/gh/roadrunner-php/cli/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/cli/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fcli%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/cli/3.x) |
| `roadrunner-php/app-logger` | `roadrunner/app-logger` | [![Versión](https://img.shields.io/packagist/v/roadrunner/app-logger.svg?label=)](https://packagist.org/packages/roadrunner/app-logger) [![Psalm](https://shepherd.dev/github/roadrunner-php/app-logger/level.svg)](https://shepherd.dev/github/roadrunner-php/app-logger) [![Cobertura](https://codecov.io/gh/roadrunner-php/app-logger/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/app-logger/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fapp-logger%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/app-logger/1.x) |
| `roadrunner-php/centrifugo` | `roadrunner/centrifugo` | [![Versión](https://img.shields.io/packagist/v/roadrunner/centrifugo.svg?label=)](https://packagist.org/packages/roadrunner/centrifugo) [![Psalm](https://shepherd.dev/github/roadrunner-php/centrifugo/level.svg)](https://shepherd.dev/github/roadrunner-php/centrifugo) [![Cobertura](https://codecov.io/gh/roadrunner-php/centrifugo/branch/2.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/centrifugo/branch/2.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fcentrifugo%2F2.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/centrifugo/2.x) |
| `roadrunner-php/lock` | `roadrunner/lock` | [![Versión](https://img.shields.io/packagist/v/roadrunner/lock.svg?label=)](https://packagist.org/packages/roadrunner/lock) [![Psalm](https://shepherd.dev/github/roadrunner-php/lock/level.svg)](https://shepherd.dev/github/roadrunner-php/lock) [![Cobertura](https://codecov.io/gh/roadrunner-php/lock/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/lock/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Flock%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/lock/1.x) |
| `roadrunner-php/symfony-lock-driver` | `roadrunner/symfony-lock-driver` | [![Versión](https://img.shields.io/packagist/v/roadrunner/symfony-lock-driver.svg?label=)](https://packagist.org/packages/roadrunner/symfony-lock-driver) [![Psalm](https://shepherd.dev/github/roadrunner-php/symfony-lock-driver/level.svg)](https://shepherd.dev/github/roadrunner-php/symfony-lock-driver) [![Cobertura](https://codecov.io/gh/roadrunner-php/symfony-lock-driver/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/symfony-lock-driver/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fsymfony-lock-driver%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/symfony-lock-driver/1.x) |
| `roadrunner-php/version-checker` | `roadrunner/version-checker` | [![Versión](https://img.shields.io/packagist/v/roadrunner/version-checker.svg?label=)](https://packagist.org/packages/roadrunner/version-checker) [![Psalm](https://shepherd.dev/github/roadrunner-php/version-checker/level.svg)](https://shepherd.dev/github/roadrunner-php/version-checker) [![Cobertura](https://codecov.io/gh/roadrunner-php/version-checker/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/version-checker/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fversion-checker%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/version-checker/1.x) |
| `roadrunner-php/roadrunner-api-dto` | `roadrunner/api-dto` | [![Versión](https://img.shields.io/packagist/v/roadrunner/api-dto.svg?label=)](https://packagist.org/packages/roadrunner/api-dto) |

Para migrar, cambia los nombres y las versiones de los paquetes en `composer.json`.

## Aún más estable

RoadRunner ya ofrecía la integración con PHP más fiable posible: ¿qué hay más estable que STDIN/STDOUT? Aun así, en la versión 3 encontramos margen de mejora: el consumo de memoria es ahora más uniforme y el rendimiento ha vuelto a subir un poco.

![Consumo de memoria de RoadRunner v2025, RoadRunner v3 y el dispatcher de Rapira con carga creciente](/blog/roadrunner-3/benches.png)

Sin embargo, si necesitas el máximo rendimiento en endpoints HTTP o gRPC, quizá haya llegado el momento de probar [Rapira](/es/docs/intro/).
