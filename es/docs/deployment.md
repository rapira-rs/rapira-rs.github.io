---
title: En producción
description: "Una unidad de systemd para producción, la estructura de configuración, un proxy inverso, el proceso de recarga, registros JSON, comprobaciones de estado, métricas y la sustitución de workers."
---

# En producción

Una instalación de producción debe mantener Rapira disponible después de los reinicios y de los cambios de código. Inicia Rapira durante el arranque del sistema y lo reinicia después de un fallo. También recarga el código sin perder peticiones y conserva los registros. Esta página describe una unidad de systemd, un proxy inverso, las comprobaciones de estado, las métricas y los ajustes persistentes de los workers.

Rapira no define una estructura de despliegue. Tampoco requiere una ruta de configuración o un supervisor de procesos específicos. Esta página establece la convención que usa el resto de la documentación. Instala primero el binario según [Instalación](/es/docs/intro/installation).

Rapira también está disponible como imagen `ghcr.io/rapira-rs/rapira`. La imagen contiene PHP, y tú añades tu aplicación a ella. Inicia el contenedor con `--init` para que un proceso init elimine los procesos hijos finalizados. Un contenedor usa la política de reinicio de su runtime en lugar de la unidad de systemd. Los demás ajustes de configuración no cambian. Consulta [Docker](/es/docs/intro/installation#docker) para obtener más información.

## Una unidad de systemd

Rapira puede sustituir a php-fpm. Un único proceso del servidor gestiona todas las escuchas y los hilos worker de PHP. Cada pool ejecuta un número fijo de workers, definido por `workers`. Systemd supervisa ese único proceso del servidor. No es necesario un gestor de procesos separado.

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

- `Type=exec`: Rapira se ejecuta en **primer plano**, de modo que `$MAINPID` identifica el proceso del servidor.
- `ExecReload`: `systemctl reload rapira` envía `SIGUSR2` al servidor. Esta señal inicia el proceso de recarga que se describe a continuación.
- `Restart=on-failure`: systemd reinicia Rapira después de un fallo. No reinicia Rapira después de una parada normal.
- `RuntimeDirectory=rapira`: systemd crea `/run/rapira` durante el inicio y lo elimina durante la parada. Los ejemplos siguientes guardan el pidfile y el socket Unix en este directorio.
- `Environment=PHPRC`: PHP usa este directorio para encontrar `php.ini`.

Establece límites de memoria y CPU en la unidad de servicio o en el contenedor, por ejemplo `MemoryMax=` y `CPUQuota=`.

::: tip Ejecución con un usuario que no sea root
Añade `User=` y `Group=` al bloque `[Service]`. Systemd asigna a esa cuenta la propiedad de `RuntimeDirectory`. La cuenta puede crear el pidfile y el socket Unix en `/run/rapira/`. Normalmente, no puede crear archivos directamente en `/run`.
:::

Dos aplicaciones en un host requieren archivos de configuración, unidades y direcciones de escucha independientes. Una unidad de plantilla de systemd, como `rapira@.service`, puede definirlas. Cada instancia inicializa PHP y crea sus propios pools de workers.

## Rutas de configuración

Esta guía usa `/etc/rapira/rapira.toml` para los ajustes de Rapira. Guarda `php.ini` en el mismo directorio y define `PHPRC=/etc/rapira`. Rapira no contiene estas rutas en el binario. El argumento `CONFIG` acepta cualquier ruta. PHP usa `PHPRC` para buscar su configuración. Usa otras rutas cuando el sistema las requiera.

Rapira puede funcionar sin `php.ini`. Sus valores predeterminados envían los diagnósticos de PHP al registro y no a las respuestas HTTP. Crea `/etc/rapira/php.ini` para configurar OPcache, un límite de memoria o una zona horaria. Consulta [Registros](/es/docs/logging) para ver los ajustes de diagnóstico.

En PHP 8.4, OPcache es un archivo `opcache.so` independiente. Cárgalo con una línea `zend_extension` en `php.ini`, como se describe en [php.ini](/es/docs/intro/installation#php-ini). PHP 8.5 y PHP 8.6 incluyen OPcache en `libphp`.

Un `http.pool.entrypoint` relativo usa el **directorio del archivo de configuración** como base. En esta estructura, `entrypoint = "index.php"` significa `/etc/rapira/index.php`. Usa una ruta absoluta para el script de entrada en producción. `server.pidfile` y las rutas de escucha `unix:` relativas usan la misma regla de resolución.

Cada petición Classic y cada instancia de la aplicación Worker o Dispatcher comienza en el directorio del script de entrada resuelto. Las operaciones de archivos de PHP con rutas relativas usan ese directorio local al hilo. PHP no busca `php.ini` en el directorio de trabajo, así que define `PHPRC`. En ZTS, `proc_open()` sin argumento `$cwd` inicia el hijo en el `WorkingDirectory=` del servidor; pasa `getcwd()` como `$cwd` para usar el directorio de la aplicación. Consulta [Configuración](/es/docs/configuration) para ver todas las claves y sus valores predeterminados.

## Proxy inverso

Rapira acepta HTTP sin cifrar y no ofrece ajustes de TLS. Un [proxy de terminación TLS](https://en.wikipedia.org/wiki/TLS_termination_proxy) recibe HTTPS del cliente, descifra la conexión y envía HTTP sin cifrar a Rapira. Usa nginx, Caddy, HAProxy o un balanceador de carga en la nube para esta tarea. Conecta el proxy a Rapira mediante la interfaz de loopback o un socket Unix. Una dirección pública de Rapira también usa HTTP sin cifrar.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Rapira crea el socket Unix con el modo `0666`. Cualquier proceso que pueda acceder al directorio de ejecución puede conectarse al socket. Rapira no configura el modo del socket. Usa los permisos del directorio para restringir el acceso. Para esta unidad, establece `RuntimeDirectoryMode=0750`. Establece `Group=` en un grupo que incluya la cuenta del proxy.

Reenvía los campos con guiones, como `X-Forwarded-For`. No uses nombres como `X_Forwarded_For`. En los modos Classic y Worker, un nombre con `_` o `.` se puede asignar a la misma clave de `$_SERVER` que el nombre con guiones. En estos modos, Rapira siempre elimina cada nombre con un carácter que no sea una letra ASCII, un dígito o un guion. La [página de HTTP](/es/docs/http) explica la asignación.

Rapira puede servir archivos estáticos con el [middleware de archivos estáticos](/es/docs/static-files). El proxy no necesita una segunda copia de la raíz de documentos. Como alternativa, un proxy o una CDN pueden servir los archivos.

## Despliegues sin cortes

Despliega el código nuevo. Después, recarga Rapira:

```bash
sudo systemctl reload rapira
```

Este comando envía `SIGUSR2` al servidor. Cada worker recicla su aplicación en el mismo hilo, y la aplicación nueva atiende las peticiones posteriores. Ninguna conexión se cierra y ninguna petición se pierde. Consulta [Modelo de procesos](/es/docs/process-model#a-reload-restarts-the-apps) para más información.

Envía la señal directamente cuando systemd no gestione el proceso. Define `server.pidfile` para registrar el identificador del proceso del servidor. Crea el directorio del pidfile antes de iniciar Rapira. Como alternativa, selecciona un directorio que exista. El servidor no se inicia si no puede escribir el archivo.

```toml
[server]
pidfile = "/run/rapira/rapira.pid"
stop_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Rapira elimina el pidfile en una parada normal y en salidas directas del host (`70`, `101`, `124`, `130`). Un archivo restante indica `SIGKILL`, una señal de fallo fatal o un fallo del sistema; el siguiente arranque lo sobrescribe.

`stop_timeout_secs` limita la espera total de apagado (por defecto `30` segundos). Las conexiones abiertas drenan durante `stop_timeout_secs` menos cinco segundos, o la mitad del tiempo límite si es menor de diez segundos. Establece `TimeoutStopSec` de systemd por encima de `stop_timeout_secs`.

Un despliegue puede poner cada versión de la aplicación en su propio directorio y cambiar un enlace simbólico de la ruta del script de entrada al directorio nuevo. Una recarga después del cambio mueve cada worker de cada pool a la versión nueva: el código, el directorio de trabajo y la raíz predeterminada de sendfile. Recarga Rapira inmediatamente después del cambio. Antes de la recarga, una aplicación que se recicla por otra causa, por ejemplo después de `max_requests`, arranca en la versión nueva. Por tanto, el pool ejecuta dos versiones hasta la recarga.

Una recarga vacía OPcache, así que también carga el código PHP nuevo cuando `opcache.validate_timestamps = 0`, salvo que `opcache.file_cache` esté definido. Un worker reinicia OPcache mientras sus pares esperan, y las peticiones posteriores vuelven a compilar sus archivos.

::: warning Lo que una recarga no hace
Una recarga recicla las aplicaciones, pero no reinicia el proceso del servidor. Rapira conserva el binario y los ajustes de `rapira.toml` y `php.ini`. También conserva el descriptor set de gRPC y el archivo de tokens de `[grpc.auth]`. Una recarga no vuelve a descargar un descriptor set desde su URL. Reinicia Rapira después de cambiar uno de estos archivos. Reinícialo también después de cambiar un archivo que carga `opcache.preload`. PHP carga estos archivos una vez cuando arranca el servidor.

Cuando `opcache.restrict_api` está definido, una recarga no vacía OPcache. Con este ajuste y `opcache.validate_timestamps = 0`, reinicia Rapira después de cada despliegue.

Con `opcache.file_cache` y `opcache.validate_timestamps = 0`, ni una recarga ni un reinicio cargan el código nuevo de un archivo modificado. Una recarga vacía solo la memoria compartida de OPcache. OPcache lee entonces el script antiguo desde la caché de archivos y no comprueba la hora del archivo. Después de reemplazar los archivos, vacía el directorio `opcache.file_cache`. Después recarga o reinicia Rapira. Como alternativa, despliega cada versión en un directorio nuevo, de modo que cada archivo modificado tenga una ruta nueva.
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

Añade una tabla `[observability]` para servir las sondas de estado y las métricas de Prometheus. Rapira ejecuta esta escucha en un hilo separado sin PHP. `GET /livez` indica que el servidor se ejecuta. `GET /readyz` indica que cada pool de PHP tiene un worker inactivo o activo. `GET /metrics` devuelve las métricas en el formato de texto de Prometheus.

```toml
[observability]
listen = "127.0.0.1:9180"

[observability.metrics]

[observability.probes]
```

Los endpoints no tienen autenticación ni TLS. Usa una dirección de loopback o un socket Unix. Consulta [Métricas y comprobaciones de estado](/es/docs/observability) para ver los códigos de estado, ejemplos de sondas y la referencia de métricas.

## Reciclaje y tiempos límite de petición

En los [modos Worker y Dispatcher](/es/docs/execution-modes), un worker conserva el estado de la aplicación entre peticiones. Por tanto, una fuga de memoria puede aumentar la memoria del worker con el tiempo. Usa estos ajustes para limitar el efecto:

```toml
[http.pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

La tabla `[grpc.pool]` acepta las mismas claves.

`max_requests` recicla la aplicación en un hilo worker después del número de unidades indicado. Las escuchas, las conexiones y la cola del pool se mantienen, así que ninguna petición se pierde. Rapira añade a cada worker un número aleatorio de hasta la mitad del límite para evitar reciclajes simultáneos. El reciclaje libera la memoria PHP de la aplicación. No libera la memoria que una extensión o una biblioteca C pierde fuera de PHP. El modo Classic ignora este ajuste.

`request_terminate_timeout_secs` establece un límite de tiempo real del watchdog para una unidad. Al alcanzarse el límite, el watchdog interrumpe PHP y despierta una escritura de respuesta bloqueada. La E/S nativa puede seguir esperando, por lo que debes configurar tiempos límite en los sockets y en las llamadas a bases de datos. Después de cinco segundos más, Rapira registra una vez un worker que sigue bloqueado mientras los demás workers siguen atendiendo peticiones. Rapira sale con el código `124` solo si todos los workers de un pool permanecen bloqueados después del plazo de gracia.

Define `memory_limit` en `php.ini` y define límites de memoria del contenedor o de systemd para el proceso de Rapira. Consulta [Modelo de procesos](/es/docs/process-model) para ver el dimensionamiento del pool, los reintentos por fallo de arranque, `SIGRTMAX` y `execution_clock`.
