---
title: Métricas y comprobaciones de estado
description: "La escucha [observability]: los endpoints /livez, /readyz y /metrics, las sondas de Kubernetes, un scrape de Prometheus y la referencia de métricas."
faqLevel: 2
---

# Métricas y comprobaciones de estado

La sección `[observability]` inicia una escucha en un hilo separado (`rapira-obs`) dentro del proceso del servidor para servir sondas de estado y métricas de Prometheus. Este hilo no ejecuta PHP y lee los contadores del pool directamente desde el estado en proceso. Consulta [Modelo de procesos](/es/docs/process-model) para ver la arquitectura del servidor.

Sin una sección `[observability]`, Rapira no inicia esta escucha. La compilación para Windows no admite la sección y la rechaza como un campo desconocido.

## Activar los endpoints

Añade la sección `[observability]` y al menos una de sus subtablas. La configuración también debe contener `[http]` o `[grpc]`. Este `rapira.toml` mínimo activa todos los endpoints:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "index.php"

[observability]
listen = "127.0.0.1:9180"

[observability.metrics]   # GET /metrics

[observability.probes]    # GET /livez y GET /readyz
```

`[observability.metrics]` y `[observability.probes]` no aceptan claves. Usa una dirección `listen` que las escuchas `http` y `grpc` no usen. Consulta [la sección `[observability]`](/es/docs/configuration#observability) para ver todas las claves.

Inicia el servidor. Después, envía una petición a cada endpoint:

```bash
curl -i http://127.0.0.1:9180/livez
curl -i http://127.0.0.1:9180/readyz
curl http://127.0.0.1:9180/metrics
```

La escucha escribe registros con el target `observability`. Consulta [Registros](/es/docs/logging) para ver los niveles por target.

## Endpoints

La escucha sirve HTTP/1.1 sin TLS. Solo responde a estas peticiones:

| Petición | Se activa con | Estado | Cuerpo |
| --- | --- | --- | --- |
| `GET /livez` | `[observability.probes]` | Siempre `200` | `ok` |
| `GET /readyz` | `[observability.probes]` | `200` o `503` | `ok`, o una línea `pool <name>: no ready worker` por cada pool que no está listo |
| `GET /metrics` | `[observability.metrics]` | `200` | El formato de texto de Prometheus |

Cualquier otro método o ruta recibe `404` con un cuerpo vacío. La ruta de una subtabla desactivada también recibe `404`. Cada línea del cuerpo termina con un salto de línea. Las sondas usan el tipo de contenido `text/plain; charset=utf-8`. `/metrics` usa `text/plain; version=0.0.4; charset=utf-8`.

## Liveness y readiness

`/livez` no hace comprobaciones. Devuelve `200` cuando el servidor responde. Durante el apagado, la escucha de observabilidad se detiene con el servidor.

`/readyz` comprueba cada pool de PHP: primero `http`, después `grpc`. Un pool está listo cuando al menos uno de sus workers está inactivo u ocupado con una unidad. Los workers que arrancan o que drenan no cuentan. `/readyz` devuelve `503` en estos casos:

- Los workers de un pool arrancan y todavía no esperan una unidad. En los modos Worker y Dispatcher, el script de entrada debe inicializarse primero.
- El script de entrada no se inicializa. El worker lo intenta de nuevo con espera progresiva, y el pool queda listo después de una inicialización correcta. No es necesaria ninguna petición.
- Todos los workers de un pool están drenando.

Una recarga mantiene `/readyz` en `200`, porque los hilos worker siguen ejecutándose. Consulta [Señales](/es/docs/process-model#signals) para la recarga.

Algunos casos no dan ninguna respuesta. Al inicio de una parada, la escucha de observabilidad deja de aceptar conexiones. Si un worker alcanza `max_boot_failures` antes de que su pool atienda una unidad, el servidor sale con el código `70`. Consulta [Códigos de salida](/es/docs/cli#exit-codes).

### Sondas de Kubernetes

El kubelet envía las sondas a la dirección IP del pod, así que una dirección de loopback no funciona. Vincula la escucha a todas las interfaces del pod. No añadas el puerto a un Service.

```toml
[observability]
listen = ":9180"

[observability.probes]
```

```yaml
containers:
  - name: app
    image: registry.example.com/app:latest
    livenessProbe:
      httpGet:
        path: /livez
        port: 9180
      periodSeconds: 10
    readinessProbe:
      httpGet:
        path: /readyz
        port: 9180
      periodSeconds: 5
```

## Métricas de Prometheus

Un servidor Prometheus en el mismo host puede hacer scrape de la dirección de loopback. Prometheus usa `/metrics` como `metrics_path` predeterminado.

```yaml
scrape_configs:
  - job_name: rapira
    static_configs:
      - targets: ["127.0.0.1:9180"]
```

La salida contiene estas métricas. La etiqueta `pool` es `http` o `grpc`. Una unidad de trabajo es un intercambio HTTP o una llamada gRPC.

| Métrica | Tipo | Etiquetas | Significado |
| --- | --- | --- | --- |
| `rapira_workers` | gauge | `pool`, `state` | Workers en cada estado. Los valores de `state` son `starting`, `idle`, `active` y `draining`. |
| `rapira_workers_configured` | gauge | `pool` | El valor `workers` del pool. |
| `rapira_requests_total` | counter | `pool` | Unidades de trabajo que procesó un worker o que rechazó el host. |
| `rapira_requests_failed_total` | counter | `pool` | Unidades de trabajo que el host no pudo completar, por ejemplo una llamada perdida o una unidad rechazada tras la saturación de la cola. |
| `rapira_requests_failed_on_full_queue_total` | counter | `pool` | Unidades de trabajo que encontraron llena la cola del pool y nunca entraron en ella. Rapira rechaza una unidad así cuando la cola sigue llena durante 30 segundos. |
| `rapira_requests_queued` | gauge | `pool` | Unidades de trabajo que esperan a un worker en el pool. |
| `rapira_script_restarts_total` | counter | `pool` | Reciclajes de la aplicación en los hilos worker, por ejemplo después de `max_requests`, de una recarga o de un error fatal. |
| `rapira_build_info` | gauge | `version`, `php_version` | La versión de Rapira y la versión del PHP enlazado. El valor siempre es `1`. |

Los contadores de peticiones describen el trabajo PHP, no todo el tráfico de la escucha. Excluyen los rechazos de autenticación, las peticiones JSON no válidas, las comprobaciones de salud y la reflexión, que la capa de protocolo procesa antes de enviarlos a PHP. El host cuenta una respuesta gRPC `fail()` completada como atendida sin fallo del host. Un fallo posterior de conversión de la respuesta a JSON no aumenta el contador de fallos. Por tanto, `rapira_requests_failed_total` no cuenta los estados gRPC distintos de OK.

Los contadores vuelven a cero solo cuando el servidor se reinicia. Los scrapes y las sondas leen contadores en el proceso y no leen archivos de `/proc`.

## Seguridad

Los endpoints no tienen autenticación ni TLS. `/metrics` muestra las versiones de Rapira y de PHP y las métricas del pool. Vincula la escucha a una dirección de loopback o a una dirección de red privada. Una dirección `:port` se vincula a todas las interfaces IPv4.

Una escucha `unix:` crea su socket con el modo `0666`. Usa los permisos del directorio del socket para controlar el acceso.

Consulta [En producción](/es/docs/deployment) para ver la configuración de producción.
