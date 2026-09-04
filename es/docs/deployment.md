---
title: En producción
description: "Una unidad de systemd para producción, la estructura de configuración, un proxy inverso, el proceso de recarga, registros JSON y la sustitución de workers."
---

# En producción

Una instalación de producción debe iniciar Rapira después de un reinicio y recuperarse de los fallos. También debe actualizar el código sin perder peticiones y conservar los registros. Esta página describe una unidad de systemd, un proxy inverso y los ajustes de los workers.

Rapira no define una estructura de despliegue. Tampoco requiere una ruta de configuración o un supervisor de procesos específicos. Esta página establece la convención que usa el resto de la documentación. Instala primero el binario según [Instalación](/es/docs/intro/installation).

Rapira también está disponible como imagen `ghcr.io/rapira-rs/rapira`. Copia sus archivos en la imagen de la aplicación mediante `COPY --from`. En un contenedor, usa la política de reinicio del runtime en lugar de systemd. Los demás ajustes no cambian. Consulta [Docker](/es/docs/intro/installation#docker).

## Una unidad de systemd

Rapira puede sustituir a php-fpm. Su proceso maestro crea, supervisa, sustituye y elimina workers. También cambia el tamaño del pool. Systemd solo debe supervisar el proceso maestro. No es necesario otro gestor de procesos.

Los paquetes `.deb` y `.rpm` instalan el binario y el runtime PHP integrado. No instalan una unidad de servicio ni `php.ini`. Estos archivos contienen ajustes específicos del sitio. Las actualizaciones de paquetes no deben sustituirlos. Consulta [Instalación](/es/docs/intro/installation) para ver los archivos instalados.

Crea `/etc/systemd/system/rapira.service`:

```ini
[Unit]
Description=Rapira PHP application server
After=network.target

[Service]
Type=exec
WorkingDirectory=/srv/app
ExecStart=/usr/bin/rapira serve --config /etc/rapira/rapira.toml
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

Esta guía usa `/etc/rapira/rapira.toml` para los ajustes de Rapira. Guarda `php.ini` en el mismo directorio y define `PHPRC=/etc/rapira`. Rapira no contiene estas rutas en el binario. La opción `--config` acepta cualquier ruta. PHP usa `PHPRC` para buscar su configuración. Usa otras rutas cuando el sistema las requiera.

Rapira puede funcionar sin `php.ini`. Sus valores predeterminados envían los diagnósticos de PHP al registro y no a las respuestas HTTP. Crea `/etc/rapira/php.ini` para configurar OPcache, un límite de memoria o una zona horaria. Consulta [Registros](/es/docs/logging).

Un `pool.entrypoint` relativo usa como base el directorio del archivo de configuración. Por tanto, `entrypoint = "index.php"` significa `/etc/rapira/index.php` en esta estructura. Usa una ruta absoluta para el script de entrada en producción. `supervisor.pidfile` usa la misma regla. El argumento `SCRIPT` y las operaciones de PHP usan el directorio de trabajo. Rapira no cambia este directorio. Systemd usa `/` de forma predeterminada, por lo que la unidad define `WorkingDirectory=/srv/app`. PHP también busca un archivo ini en este directorio. Consulta [Configuración](/es/docs/configuration).

## Proxy inverso

Rapira acepta HTTP sin cifrar y no ofrece ajustes de TLS. Un [proxy de terminación TLS](https://en.wikipedia.org/wiki/TLS_termination_proxy) recibe HTTPS del cliente, descifra la conexión y envía HTTP sin cifrar a Rapira. Usa nginx, Caddy, HAProxy o un balanceador de carga en la nube para esta tarea. Conecta el proxy a Rapira mediante la interfaz de loopback o un socket Unix. Una dirección pública de Rapira también usa HTTP sin cifrar.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

Rapira crea el socket Unix con el modo `0666`. Cualquier proceso que pueda acceder al directorio de ejecución puede conectarse al socket. Rapira no configura el modo del socket. Usa los permisos del directorio para restringir el acceso. Para esta unidad, establece `RuntimeDirectoryMode=0750`. Establece `Group=` en un grupo que incluya la cuenta del proxy.

Reenvía los campos con guiones, como `X-Forwarded-For`. No uses nombres como `X_Forwarded_For`. Los nombres con guiones bajos o puntos se pueden asignar a la misma clave de `$_SERVER`. Rapira elimina estos nombres antes de que PHP los reciba. La [página de HTTP](/es/docs/http) explica la asignación y `http.unsafe_field_names`.

Rapira puede servir archivos estáticos con el [middleware de archivos estáticos](/es/docs/static-files). El proxy no necesita una segunda copia de la raíz de documentos. Como alternativa, un proxy o una CDN pueden servir los archivos.

## Despliegues sin cortes

Despliega el código nuevo. Después, recarga Rapira:

```bash
sudo systemctl reload rapira
```

El comando envía `SIGUSR2` al proceso maestro. El maestro sustituye un worker cada vez y termina las peticiones actuales. Si un worker supera `process_control_timeout_secs`, el maestro envía `SIGTERM` y después `SIGKILL`. Esto termina la petición actual. Consulta [Modelo de procesos](/es/docs/process-model) para ver la secuencia de sustitución.

Envía la señal al proceso maestro cuando systemd no gestione el proceso. Define `supervisor.pidfile` para guardar el identificador del proceso. Crea el directorio del pidfile antes de iniciar Rapira. También puedes seleccionar un directorio existente. El proceso maestro no se inicia si no puede escribir el archivo.

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Solo el maestro escribe el pidfile. Elimina el archivo durante una salida controlada. Un archivo restante puede indicar un `SIGKILL`, un fallo del proceso o un fallo del sistema.

`process_control_timeout_secs` limita cada espera de un worker durante la parada y la recarga. Después del límite, el maestro envía la siguiente señal de terminación. Establece este valor por debajo de `TimeoutStopSec` de systemd. De lo contrario, systemd puede terminar el maestro antes de que finalice la secuencia. Consulta [Modelo de procesos](/es/docs/process-model) para ver la secuencia de señales.

::: warning Lo que una recarga no hace
El maestro conserva sus ajustes iniciales y la memoria compartida de OPcache durante una recarga. Reinicia Rapira después de cambiar `rapira.toml`. Reinícialo también cuando `opcache.validate_timestamps = 0`. Una recarga no sustituye los opcodes en caché con esta configuración.
:::

## Registros

Rapira escribe cada registro en **stderr**. La salida stderr de una unidad de systemd se envía al journal sin configuración adicional. En producción, usa JSON:

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

## Reciclado de workers y tiempos límite de petición

En [modo Worker](/es/docs/execution-modes), el proceso conserva el estado de la aplicación entre peticiones. Por tanto, una fuga de memoria puede aumentar la memoria del proceso con el tiempo. Usa estos dos ajustes para limitar el efecto:

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` sustituye un worker después del número definido de peticiones. Rapira añade un valor aleatorio para evitar sustituir todo el pool a la vez. Este ajuste limita el efecto de una fuga, pero no la corrige. `request_terminate_timeout_secs` limita el tiempo de una petición. Rapira sustituye un worker que supera este valor. Los dos ajustes están desactivados de forma predeterminada. Actívalos antes de usar producción.

Consulta [Modelo de procesos](/es/docs/process-model) para ver el dimensionamiento del pool, las esperas de sustitución y el procesamiento de fallos de workers.
