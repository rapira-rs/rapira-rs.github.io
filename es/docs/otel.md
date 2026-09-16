---
title: OpenTelemetry
description: "Trazas, registros y métricas nativos, exportación OTLP y contexto de traza en PHP."
---

# OpenTelemetry

El plugin `otel` exporta trazas, registros y métricas nativos mediante OTLP sobre HTTP/protobuf. El plugin `http` es dueño del pool de workers PHP. El plugin `otel` es dueño de un proceso exportador.

## Activar la telemetría

Añade esta sección a `rapira.toml`:

```toml
[otel]
enabled = true
endpoint = "http://localhost:4318"
service_name = "rapira"
sample_ratio = 1.0
```

El valor predeterminado de `enabled` es `false`. Cuando la telemetría está desactivada, las API de contexto de traza PHP devuelven arrays vacíos. Rapira lee sus ajustes de telemetría de TOML. No lee las variables de entorno `OTEL_*`. La configuración del SDK PHP es independiente.

La feature de Cargo `otel` del paquete raíz está activada por defecto. El crate `otel` está en `crates/plugins/otel`. Para compilar sin el SDK ni el exportador, usa:

```sh
cargo build --release --no-default-features
```

Este binario rechaza `[otel].enabled = true`. Consulta [Configuración](./configuration#otel) para ver todos los valores predeterminados y las reglas de validación.

El endpoint es una URL base HTTP o HTTPS. Rapira añade `/v1/traces`, `/v1/logs` o `/v1/metrics` después del prefijo de ruta. Por ejemplo, `https://collector.example/tenant` envía trazas a `https://collector.example/tenant/v1/traces`.

## Procesos y entrega

El maestro supervisa un proceso hijo que se inicia mediante `exec`. Este exportador agrupa registros, reintenta peticiones y envía OTLP. El maestro de un solo hilo no ejecuta un exportador de red ni hilos del SDK en segundo plano.

Los workers envían registros directamente al exportador mediante flujos Unix locales no bloqueantes. Los registros del maestro usan el mismo exportador. Los búferes limitados descartan registros ante una sobrecarga o si el exportador no está disponible. La ejecución de las peticiones no espera a la exportación. Cada registro IPC codificado ocupa menos de 1 MiB.

- Los registros completos que el exportador ya aceptó permanecen allí tras un fallo del worker.
- Los registros no enviados y los spans incompletos se pierden con el worker.
- El exportador mantiene las colas en memoria, sin almacenamiento persistente.
- Un fallo del exportador pierde los registros de sus colas. El maestro sustituye al exportador y los productores se conectan de nuevo.
- El apagado normal envía los registros pendientes dentro de `export_timeout_secs`.
- Los registros de fallos de procesos contienen `worker_pid`, `pool` y `exit_code` o `signal`.

Rapira no captura instantáneas de peticiones ni reconstruye trazas desde memoria compartida. El maestro no traza la actividad de PHP.

## Contexto de traza y muestreo

Rapira continúa una traza entrante a partir de las cabeceras W3C `traceparent` y `tracestate`. Un padre ausente o inválido inicia una traza nueva. Rapira combina los campos `tracestate` repetidos. Las operaciones nativas reciben nuevos ID de span locales. PHP recibe el contexto del span nativo `php.execute`.

`sample_ratio` controla el muestreo de las trazas raíz. El muestreador ParentBased respeta el estado sampled o unsampled entrante. Solo usa `sample_ratio` para las trazas sin padre. `traces`, `logs` y `metrics` son interruptores de exportación independientes. Con `traces = false`, Rapira sigue propagando el contexto.

::: info Restricción del SDK
El SDK Rust `opentelemetry` 0.32 rechaza claves multi-tenant válidas de `tracestate` cuyo ID de sistema tiene exactamente 14 caracteres, como `tenant@abcdefghijklmn`. Esto descarta todo el `tracestate`. El ID de traza y el indicador sampled siguen propagándose. Consulta la [validación en el código del SDK](https://docs.rs/opentelemetry/0.32.0/src/opentelemetry/trace/span_context.rs.html) y la [gramática de claves W3C](https://www.w3.org/TR/trace-context/#key).
:::

## Señales nativas

Los spans nativos cubren el arranque, la admisión de peticiones, el middleware, la recogida del cuerpo, el análisis multipart, `queue.wait` y `php.execute`. También cubren el envío de respuestas en streaming, sendfile, el drenaje y el apagado de workers.

| Métrica | Tipo y unidad | Atributos |
| --- | --- | --- |
| `http.server.request.duration` | Histograma, segundos (`s`) | `http.request.method`, `http.response.status_code` |
| `rapira.operation.duration` | Histograma, segundos (`s`) | `rapira.operation` |
| `rapira.otel.dropped_records` | Contador, registros | Ninguno |

Las peticiones y operaciones nativas completadas generan instantáneas acumulativas de métricas. Los recursos OTLP contienen `service.name`, `process.pid` y `rapira.role`. Cada proceso también tiene un `service.instance.id` aleatorio y estable. Los recursos de los workers también contienen `rapira.pool`.

Los registros se correlacionan con el span nativo activo. `[log]` y `RUST_LOG` controlan solo el filtrado de stderr. OTLP usa sus propios interruptores de señales. Los spans nativos continúan por debajo del nivel de registro de stderr.

Los diagnósticos del exportador y del SDK interno permanecen en stderr y no vuelven a entrar en OTLP. Todos los procesos usan los mismos ajustes de filtro y formato de stderr. Consulta [Registros](./logging).

## Spans de la aplicación PHP

Rapira proporciona dos portadores de contexto de tipo `array<string, string>`:

- `Rapira\Http\Request::$traceContext` contiene el portador nativo. `Request` es una clase `final readonly`. El último argumento de su constructor público es `array $traceContext`.
- Los objetos de petición creados por el host capturan su propio portador. La creación diferida o un objeto de petición retenido conserva el contexto de esa petición.
- `Rapira\trace_context(): array` devuelve el portador del callback Worker o del intercambio Dispatcher activo. Devuelve un array vacío fuera del trabajo activo.

El modo Worker mantiene el ámbito nativo durante el apagado y la liberación de recursos de cada tarea. El ámbito Dispatcher termina cuando finaliza el intercambio. Rust mantiene el contexto de la petición mientras se ejecuta PHP. PHP no devuelve un ID de span a Rust.

PHP gestiona sus spans hijos, la activación del contexto, el SDK, el muestreo, el vaciado y el exportador. Rapira no instrumenta automáticamente el código PHP ni su planificador de Fibers. Usa el [soporte de contexto del SDK PHP](https://opentelemetry.io/docs/languages/php/context/#context-in-asynchronous-environments) para Fibers concurrentes.

### Ejemplo de Dispatcher

Configura el SDK PHP antes de ejecutar este ejemplo. Pon la configuración en `instrumentation.php`. Sigue las guías oficiales de [configuración del SDK](https://opentelemetry.io/docs/languages/php/instrumentation/#initialize-the-sdk) y [exportadores](https://opentelemetry.io/docs/languages/php/exporters/). Registra el proveedor de trazas antes del bucle de peticiones. Configura el muestreo y el vaciado PHP para tu aplicación.

El ejemplo extrae un padre para cada petición y crea un span hijo PHP. Sigue la [API estándar de propagación PHP](https://opentelemetry.io/docs/languages/php/propagation/#manual-context-propagation).

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

Extrae el contexto para cada petición. Activa el contexto para esa petición. Desactiva el ámbito en `finally`. Termina el span en el mismo bloque. Un padre global del proceso fijado una vez al arrancar el worker no puede identificar las peticiones posteriores.

### Portador de Worker

Dentro del callback de `Rapira\handle_request()`, usa esta extracción del padre con el mismo patrón de span hijo y `finally`:

```php
$parent = TraceContextPropagator::getInstance()->extract(\Rapira\trace_context(), null, Context::getRoot());
```

Usa funciones de respuesta Worker como `header()` y `echo` dentro de ese callback. Consulta [Modo Worker](./worker) para ver el bucle.
