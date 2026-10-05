---
title: Métricas y comprobaciones de estado
description: "El proceso [observability]: los endpoints /livez, /readyz y /metrics, las sondas de Kubernetes, un scrape de Prometheus y la referencia de métricas."
faqLevel: 2
---

# Métricas y comprobaciones de estado

La sección `[observability]` inicia un proceso más que sirve sondas de estado y métricas de Prometheus. Este proceso no ejecuta PHP. Lee el estado de los workers PHP desde la memoria compartida. El maestro lo supervisa, lo recarga y lo detiene junto con los workers PHP. Consulta [Modelo de procesos](/es/docs/process-model) para ver el maestro y sus workers.

Sin una sección `[observability]`, Rapira no inicia este proceso. La compilación para Windows no admite la sección y la rechaza como un campo desconocido.

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

El proceso escribe registros con el target `observability`. Consulta [Registros](/es/docs/logging) para ver los niveles por target.

## Endpoints

El proceso sirve HTTP/1.1 sin TLS. Solo responde a estas peticiones:

| Petición | Se activa con | Estado | Cuerpo |
| --- | --- | --- | --- |
| `GET /livez` | `[observability.probes]` | Siempre `200` | `ok` |
| `GET /readyz` | `[observability.probes]` | `200` o `503` | `ok`, o una línea `pool <name>: no ready worker` por cada pool que no está listo |
| `GET /metrics` | `[observability.metrics]` | `200` | El formato de texto de Prometheus |

Cualquier otro método o ruta recibe `404` con un cuerpo vacío. La ruta de una subtabla desactivada también recibe `404`. Cada línea del cuerpo termina con un salto de línea. Las sondas usan el tipo de contenido `text/plain; charset=utf-8`. `/metrics` usa `text/plain; version=0.0.4; charset=utf-8`.

## Liveness y readiness

`/livez` no hace comprobaciones. Devuelve `200` cuando el proceso responde. Cuando el maestro se detiene, el proceso de observabilidad también se detiene. Por tanto, una respuesta `200` indica que el maestro se ejecuta. El maestro sustituye él mismo los workers PHP que fallan, así que `/livez` no los comprueba.

`/readyz` comprueba cada pool de PHP: primero `http`, después `grpc`. Un pool está listo cuando al menos uno de sus workers está inactivo u ocupado con una petición. Los workers que arrancan o que drenan no cuentan. `/readyz` devuelve `503` en estos casos:

- Los workers de un pool arrancan y todavía no esperan una petición. En los modos Worker y Dispatcher, el script de entrada debe inicializarse primero.
- El script de entrada no se inicializa. El worker lo intenta de nuevo, y el pool queda listo después de una inicialización correcta. No es necesaria ninguna petición.
- Una recarga inicia workers nuevos que no se inicializan. Después de `process_control_timeout_secs`, el maestro detiene los workers antiguos de todos modos.
- Durante un tiempo corto, todos los workers de un pool drenan, por ejemplo después de `max_requests`, y ningún sustituto espera todavía una petición.

Una recarga normal mantiene `/readyz` en `200`. El maestro inicia un worker nuevo antes de detener uno antiguo. Consulta [Señales](/es/docs/process-model#senales) para ver la secuencia de recarga.

Algunos casos no dan ninguna respuesta. Al inicio de una parada, el proceso de observabilidad deja de aceptar conexiones. Si los workers de un pool no se inicializan antes de que el pool atienda una petición, el maestro termina con el código `70`. Consulta [Códigos de salida](/es/docs/cli#codigos-de-salida).

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

La salida contiene estas métricas. La etiqueta `pool` es `http` o `grpc`. Las métricas no incluyen el proceso de observabilidad. Una unidad de trabajo es una petición HTTP o una llamada gRPC.

| Métrica | Tipo | Etiquetas | Significado |
| --- | --- | --- | --- |
| `rapira_workers` | gauge | `pool`, `state` | Workers en cada estado. Los valores de `state` son `starting`, `idle`, `active` y `draining`. |
| `rapira_workers_configured` | gauge | `pool` | El valor `processes` del pool. |
| `rapira_requests_total` | counter | `pool` | Unidades de trabajo que los workers terminaron. Incluye las unidades fallidas. |
| `rapira_requests_failed_total` | counter | `pool` | Unidades de trabajo que el host no pudo completar, por ejemplo una llamada perdida o una unidad rechazada tras la saturación de la cola. |
| `rapira_requests_failed_on_full_queue_total` | counter | `pool` | Unidades de trabajo que encontraron llena la cola del worker y nunca entraron en ella. Rapira rechaza una unidad así cuando la cola sigue llena durante 30 segundos. |
| `rapira_requests_queued` | gauge | `pool` | Unidades de trabajo que esperan al hilo PHP de un worker. |
| `rapira_script_restarts_total` | counter | `pool` | Reinicios del script de entrada dentro de un proceso worker, por ejemplo después de un error fatal. |
| `rapira_worker_exits_total` | counter | `pool`, `reason` | Salidas de procesos worker. Consulta los motivos más abajo. |
| `rapira_worker_rss_bytes` | gauge | `pool`, `worker` | La memoria residente de un worker en bytes. Solo Linux. |
| `rapira_worker_pss_bytes` | gauge | `pool`, `worker` | La memoria proporcional de un worker en bytes. Solo Linux. |
| `rapira_build_info` | gauge | `version`, `php_version` | La versión de Rapira y la versión del PHP enlazado. El valor siempre es `1`. |

Los contadores de peticiones describen el trabajo PHP, no todo el tráfico de la escucha. Excluyen los rechazos de autenticación, las peticiones JSON no válidas, las comprobaciones de salud y la reflexión, que la capa de protocolo procesa antes de enviarlos a PHP. El host cuenta una respuesta gRPC `fail()` completada como atendida sin fallo del host. Un fallo posterior de conversión de la respuesta a JSON no aumenta el contador de fallos. Por tanto, `rapira_requests_failed_total` no cuenta los estados gRPC distintos de OK.

La etiqueta `reason` de `rapira_worker_exits_total` tiene estos valores:

| Motivo | Significado |
| --- | --- |
| `drained` | El worker terminó con el código `0`, por ejemplo después de una parada o una recarga. |
| `recycled` | El worker alcanzó `max_requests`. |
| `unhealthy` | El worker informó de que no puede atender peticiones, por ejemplo después de fallos de inicialización repetidos. |
| `timeout` | Una petición se ejecutó más tiempo que `request_terminate_timeout_secs`, y el maestro detuvo el worker. |
| `crashed` | El worker terminó con otro código o por una señal. |

Los contadores conservan sus valores cuando el maestro sustituye o recarga un worker. Vuelven a cero solo cuando el maestro arranca de nuevo. Un scrape lee un archivo de `/proc` por cada worker vivo. Las sondas no leen archivos.

::: question ¿Por qué la etiqueta worker no es un identificador de proceso?
La etiqueta `worker` es el número de slot del worker en su pool. Un worker sustituto puede usar el mismo slot, así que las series continúan después de una sustitución. Cada pool tiene dos slots por cada worker. Por tanto, los números van de `0` a dos veces `processes` menos uno.
:::

::: question ¿Por qué un pool muestra más workers que rapira_workers_configured?
Durante una recarga, el maestro inicia un worker nuevo antes de detener uno antiguo. Los dos workers aparecen en `rapira_workers` hasta que el worker antiguo termina.
:::

## Seguridad

Los endpoints no tienen autenticación ni TLS. `/metrics` muestra las versiones de Rapira y de PHP y la memoria de cada worker. Vincula la escucha a una dirección de loopback o a una dirección de red privada. Una dirección `:port` se vincula a todas las interfaces IPv4.

Una escucha `unix:` crea su socket con el modo `0666`. Usa los permisos del directorio del socket para controlar el acceso.

Consulta [En producción](/es/docs/deployment) para ver la configuración de producción.
