---
title: En producción
description: "Una unidad de systemd para producción, la estructura de configuración, un proxy inverso, el proceso de recarga, registros JSON, comprobaciones de estado, métricas y la sustitución de workers."
---

# En producción

Una instalación de producción debe mantener Rapira disponible después de los reinicios y de los cambios de código. Inicia Rapira durante el arranque del sistema y lo reinicia después de un fallo. También recarga el código sin perder peticiones y conserva los registros. Esta página describe una unidad de systemd, un proxy inverso, las comprobaciones de estado, las métricas y los ajustes persistentes de los workers.

Rapira no define una estructura de despliegue. Tampoco requiere una ruta de configuración o un supervisor de procesos específicos. Esta página establece la convención que usa el resto de la documentación. Instala primero el binario según [Instalación](/es/docs/intro/installation).

Rapira también está disponible como imagen `ghcr.io/rapira-rs/rapira`. Copia sus archivos en la imagen de la aplicación mediante `COPY --from`. Un contenedor usa la política de reinicio de su runtime en lugar de la unidad de systemd. Los demás ajustes de configuración no cambian. Consulta [Docker](/es/docs/intro/installation#docker) para obtener más información.

## Una unidad de systemd

Rapira puede sustituir a php-fpm. Su proceso maestro crea, supervisa y sustituye workers. Cada pool ejecuta un número fijo de workers, definido por `processes`. Systemd solo debe supervisar el proceso maestro. No es necesario otro gestor de procesos.

Los paquetes `.deb` y `.rpm` instalan el binario y el runtime PHP integrado. No instalan una unidad de servicio ni `php.ini`. Estos archivos contienen ajustes específicos del sitio. Las actualizaciones de paquetes no deben sustituirlos. Consulta [Instalación](/es/docs/intro/installation) para ver los archivos instalados.

Crea `/etc/systemd/system/rapira.service`:

```ini
[Unit]
Description=Rapira PHP application server
After=network.target

[Service]
Type=exec
WorkingDirectory=/srv/app
ExecStart=/usr/bin/rapira serve /etc/rapira/rapira.toml
ExecReload=/bin/kill -USR2 $MAINPID
KillMode=mixed
Restart=on-failure
RuntimeDirectory=rapira
Environment=PHPRC=/etc/rapira

[Install]
WantedBy=multi-user.target
```

Recarga la configuración de systemd:

```bash
sudo systemctl daemon-reload
```

Activa Rapira con `--now`:

```bash
sudo systemctl enable --now rapira
```

La unidad usa estos ajustes:

- `Type=exec`: Rapira se ejecuta en **primer plano**. El proceso que inicia systemd es el maestro, por lo que `$MAINPID` lo identifica.
- `ExecReload`: `systemctl reload rapira` envía `SIGUSR2` al maestro. Esta señal inicia el proceso de recarga que se describe a continuación.
- `KillMode=mixed`: systemd envía la señal de parada solo al maestro. Después, el maestro envía `SIGQUIT` a los workers y espera. Después de `TimeoutStopSec`, systemd envía `SIGKILL` a todo el grupo. Sin `KillMode=mixed`, una parada puede terminar las peticiones actuales.
- `Restart=on-failure`: systemd reinicia Rapira después de un fallo. No reinicia Rapira después de una parada normal.
- `RuntimeDirectory=rapira`: systemd crea `/run/rapira` durante el inicio y lo elimina durante la parada. Los ejemplos siguientes guardan el pidfile y el socket Unix en este directorio.
- `Environment=PHPRC`: PHP usa este directorio para encontrar `php.ini`.

::: tip Ejecución con un usuario que no sea root
Añade `User=` y `Group=` al bloque `[Service]`. Systemd asigna a esa cuenta la propiedad de `RuntimeDirectory`. La cuenta puede crear el pidfile y el socket Unix en `/run/rapira/`. Normalmente, no puede crear archivos directamente en `/run`.
:::

Dos aplicaciones en un host requieren archivos de configuración, unidades y direcciones de escucha independientes. Una unidad de plantilla de systemd, como `rapira@.service`, puede definirlas. Cada instancia inicia PHP y crea un pool de workers independiente.

## Rutas de configuración

Esta guía usa `/etc/rapira/rapira.toml` para los ajustes de Rapira. Guarda `php.ini` en el mismo directorio y define `PHPRC=/etc/rapira`. Rapira no contiene estas rutas en el binario. El argumento `CONFIG` acepta cualquier ruta. PHP usa `PHPRC` para buscar su configuración. Usa otras rutas cuando el sistema las requiera.

Rapira puede funcionar sin `php.ini`. Sus valores predeterminados envían los diagnósticos de PHP al registro y no a las respuestas HTTP. Crea `/etc/rapira/php.ini` para configurar OPcache, un límite de memoria o una zona horaria. Consulta [Registros](/es/docs/logging) para ver los ajustes de diagnóstico.

En PHP 8.4, OPcache es un archivo `opcache.so` independiente. Cárgalo con una línea `zend_extension` en `php.ini`, como se describe en [php.ini](/es/docs/intro/installation#php-ini). PHP 8.5 incluye OPcache en `libphp`.

Un `http.pool.entrypoint` relativo usa como base el **directorio del archivo de configuración**. Por tanto, `entrypoint = "index.php"` significa `/etc/rapira/index.php` en esta estructura. Usa una ruta absoluta para el script de entrada en producción. `supervisor.pidfile` usa la misma regla de resolución.

Cada worker cambia su directorio de trabajo al directorio del script de entrada antes de ejecutar PHP. Las operaciones de archivos de PHP con rutas relativas usan ese directorio. PHP no busca `php.ini` en el directorio de trabajo, por lo que debes definir `PHPRC`. El ajuste `WorkingDirectory=` solo se aplica al maestro. El maestro lo usa como base para una ruta `CONFIG` relativa y para una ruta de escucha `unix:` relativa. Consulta [Configuración](/es/docs/configuration) para ver todas las claves y sus valores predeterminados.

## Proxy inverso

Rapira acepta HTTP sin cifrar y no ofrece ajustes de TLS. Un [proxy de terminación TLS](https://en.wikipedia.org/wiki/TLS_termination_proxy) recibe HTTPS del cliente, descifra la conexión y envía HTTP sin cifrar a Rapira. Usa nginx, Caddy, HAProxy o un balanceador de carga en la nube para esta tarea. Conecta el proxy a Rapira mediante la interfaz de loopback o un socket Unix. Una dirección pública de Rapira también usa HTTP sin cifrar.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Rapira crea el socket Unix con el modo `0666`. Cualquier proceso que pueda acceder al directorio de ejecución puede conectarse al socket. Rapira no configura el modo del socket. Usa los permisos del directorio para restringir el acceso. Para esta unidad, establece `RuntimeDirectoryMode=0750`. Establece `Group=` en un grupo que incluya la cuenta del proxy.

Reenvía los campos con guiones, como `X-Forwarded-For`. No uses nombres como `X_Forwarded_For`. En los modos Classic y Worker, un nombre con `_` o `.` se puede asignar a la misma clave de `$_SERVER` que el nombre con guiones. En estos modos, Rapira elimina de forma predeterminada cada nombre con un carácter que no sea una letra ASCII, un dígito o un guion. La [página de HTTP](/es/docs/http) explica la asignación y `http.unsafe_field_names`.

Rapira puede servir archivos estáticos con el [middleware de archivos estáticos](/es/docs/static-files). El proxy no necesita una segunda copia de la raíz de documentos. Como alternativa, un proxy o una CDN pueden servir los archivos.

## Despliegues sin cortes

Despliega el código nuevo. Después, recarga Rapira:

```bash
sudo systemctl reload rapira
```

El comando envía `SIGUSR2` al proceso maestro. El maestro sustituye un worker cada vez y deja que las peticiones actuales terminen. Si un worker supera `process_control_timeout_secs`, el maestro envía `SIGTERM` y después `SIGKILL`. Esto termina la petición actual. Consulta [Modelo de procesos](/es/docs/process-model) para ver la secuencia de sustitución.

Envía la señal directamente cuando systemd no gestione el proceso. Define `supervisor.pidfile` para guardar el identificador del proceso maestro. Crea el directorio del pidfile antes de iniciar Rapira. También puedes seleccionar un directorio existente. El proceso maestro no se inicia si no puede escribir el archivo.

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Solo el maestro escribe el pidfile. Elimina el archivo durante una salida controlada. Un archivo restante puede indicar un `SIGKILL`, un fallo del proceso o un fallo del sistema.

`process_control_timeout_secs` limita la espera inicial de parada y cada espera de disponibilidad de un worker de sustitución. Después de la espera de parada, el maestro envía `SIGTERM`. Envía `SIGKILL` un segundo después. Establece `TimeoutStopSec` de systemd por encima de este intervalo completo.

Las conexiones tienen un plazo de drenaje más corto: el tiempo límite de control menos el menor valor entre cinco segundos y la mitad de ese límite. El plazo predeterminado es de 25 segundos. Las respuestas que superen este plazo pueden interrumpirse durante la parada o la recarga.

::: warning Lo que una recarga no hace
Una recarga sustituye los workers, pero no el maestro. El maestro conserva el binario de Rapira y los ajustes de `rapira.toml` y `php.ini`. También conserva el conjunto de descriptores de gRPC, el archivo de tokens de `[grpc.auth]` y la memoria compartida de OPcache. Reinicia Rapira después de cambiar uno de estos archivos. Reinícialo también cuando `opcache.validate_timestamps = 0`. Una recarga no sustituye los opcodes en caché con esta configuración.
:::

## Registros

Rapira escribe los registros filtrados en **stderr**. Systemd envía stderr al journal. En producción, usa JSON para stderr:

```toml
[log]
level = "info"
format = "json"
```

Cada línea contiene un objeto con `timestamp`, `level`, `target` y `fields`. El objeto `fields` contiene `message` y otros campos del evento. La marca de tiempo usa UTC según RFC 3339. Rapira escapa los caracteres de nueva línea de los mensajes. Journald envía el objeto a los recolectores de registros sin cambios.

```bash
journalctl -u rapira -f
```

Configura un recolector de registros para leer el journal de la unidad. Como alternativa, envía stderr de Rapira directamente al recolector. El recolector puede analizar cada registro como JSON sin expresiones regulares. Consulta [Registros](/es/docs/logging) para obtener información sobre los niveles por target y la sustitución con `RUST_LOG`.

## Comprobaciones de estado y métricas

Añade una tabla `[observability]` para servir las sondas de estado y las métricas de Prometheus. Rapira inicia entonces un proceso adicional, que no ejecuta PHP. `GET /livez` indica que el maestro se ejecuta. `GET /readyz` indica que cada pool de PHP tiene un worker inactivo o activo. `GET /metrics` devuelve las métricas en el formato de texto de Prometheus.

```toml
[observability]
listen = "127.0.0.1:9180"

[observability.metrics]

[observability.probes]
```

Los endpoints no tienen autenticación ni TLS. Usa una dirección de loopback o un socket Unix. Consulta [Métricas y comprobaciones de estado](/es/docs/observability) para ver los códigos de estado, ejemplos de sondas y la referencia de métricas.

## Reciclado de workers y tiempos límite de petición

En los [modos Worker y Dispatcher](/es/docs/execution-modes), un worker conserva el estado de la aplicación entre peticiones. Por tanto, una fuga de memoria puede aumentar la memoria del worker con el tiempo. Usa estos dos ajustes para limitar el efecto:

```toml
[http.pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

La tabla `[grpc.pool]` acepta las mismas claves.

`max_requests` sustituye un worker después del número definido de peticiones. Rapira añade a cada worker un número aleatorio de hasta la mitad del límite para evitar la sustitución simultánea de workers. Este ajuste limita el efecto de una fuga de memoria, pero no la corrige.

`request_terminate_timeout_secs` limita el tiempo transcurrido de una petición. Rapira termina y sustituye un worker que supera el límite. El valor predeterminado de los dos ajustes es cero, que los desactiva. Actívalos en producción.

Consulta [Modelo de procesos](/es/docs/process-model) para ver el dimensionamiento del pool, las esperas de sustitución y el procesamiento de fallos de workers.
