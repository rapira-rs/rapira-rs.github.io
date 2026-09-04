---
title: En producción
description: "Cómo ejecutar Rapira en un servidor: una unidad de systemd, la disposición de la configuración, un proxy inverso delante, recargas sin cortes, registros en JSON y reciclado de workers."
---

# En producción

Una instalación de producción debe iniciar Rapira después de un reinicio y recuperarse de los fallos.
También debe actualizar el código sin perder peticiones y conservar los registros. Esta página describe una unidad de systemd, un proxy inverso y los ajustes de los workers.

Rapira no define una estructura de despliegue. Tampoco requiere una ruta de configuración o un supervisor de procesos específicos.
Esta página establece la convención que usa el resto de la documentación. Instala primero el binario según [Instalación](/es/docs/intro/installation).

Rapira también está disponible como imagen `ghcr.io/rapira-rs/rapira`. Copia sus archivos en la imagen de la aplicación mediante `COPY --from`.
En un contenedor, usa la política de reinicio del runtime en lugar de systemd. Los demás ajustes no cambian.
Consulta [Docker](/es/docs/intro/installation#docker).

## Una unidad de systemd

Rapira puede sustituir a php-fpm. Su proceso maestro crea, supervisa, sustituye y elimina workers. También cambia el tamaño del pool.
Systemd solo debe supervisar el proceso maestro. No es necesario otro gestor de procesos.

Los paquetes `.deb` y `.rpm` instalan el binario y el runtime PHP integrado. No instalan una unidad de servicio ni `php.ini`.
Estos archivos contienen ajustes específicos del sitio. Las actualizaciones de paquetes no deben sustituirlos.
Consulta [Instalación](/es/docs/intro/installation) para ver los archivos instalados.

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

- `Type=exec` - Rapira se ejecuta en **primer plano** y nunca hace fork para pasar a segundo plano. No hay modo demonio ni hace falta: el proceso que arranca systemd *es* el maestro, así que `$MAINPID` es justo el pid al que quieres mandar señales.
- `ExecReload` - convierte `systemctl reload rapira` en un `SIGUSR2` al maestro, que es la recarga sin cortes de la que se habla más abajo.
- `KillMode=mixed` - por defecto systemd manda la señal de parada a todos los procesos del cgroup, y un worker se toma un `SIGTERM` como una muerte inmediata. Con `mixed` la señal va solo al maestro, que a partir de ahí hace el vaciado ordenado con `SIGQUIT` que se describe más abajo; el `SIGKILL` de `TimeoutStopSec` sigue cubriendo al grupo entero. Sin esta línea, `systemctl stop` y `systemctl restart` se llevan por delante las peticiones en curso.
- `Restart=on-failure` - un vaciado limpio termina con código cero y se queda parado, así que esto solo levanta el servidor otra vez tras una caída o un arranque fallido.
- `RuntimeDirectory=rapira` - systemd crea `/run/rapira` al arrancar y lo borra al parar. Ahí es donde viven el pidfile y el socket Unix de los ejemplos de más abajo.
- `Environment=PHPRC` - dónde busca PHP su `php.ini`; lo cuenta la sección siguiente.

::: tip Ejecución con un usuario que no sea root
Añade `User=` y `Group=` al bloque `[Service]`: systemd le cambia el dueño del `RuntimeDirectory` a esa cuenta, así que el pidfile y el socket Unix de dentro de `/run/rapira/` siguen funcionando. Las rutas de fuera -`/run/rapira.pid` y compañía- están en un directorio que pertenece a root y no se podrán abrir.
:::

Dos aplicaciones en una misma máquina llevan dos configuraciones, dos unidades y dos direcciones de escucha; para eso usa una unidad plantilla de systemd (`rapira@.service`). Cada instancia arranca su propio PHP y su propio pool de workers, y no comparte nada con la otra instancia salvo la máquina.

## Rutas de configuración

Esta guía usa `/etc/rapira/rapira.toml` para los ajustes de Rapira. Guarda `php.ini` en el mismo directorio y define `PHPRC=/etc/rapira`.
Rapira no contiene estas rutas en el binario. La opción `--config` acepta cualquier ruta.
PHP usa `PHPRC` para buscar su configuración. Usa otras rutas cuando el sistema las requiera.

Rapira puede funcionar sin `php.ini`. Sus valores predeterminados envían los diagnósticos de PHP al registro y no a las respuestas HTTP.
Crea `/etc/rapira/php.ini` para configurar OPcache, un límite de memoria o una zona horaria. Consulta [Registros](/es/docs/logging).

Un `pool.entrypoint` relativo usa como base el directorio del archivo de configuración. Por tanto, `entrypoint = "index.php"` significa `/etc/rapira/index.php` en esta estructura.
Usa una ruta absoluta para el script de entrada en producción. `supervisor.pidfile` usa la misma regla.
El argumento `SCRIPT` y las operaciones de PHP usan el directorio de trabajo. Rapira no cambia este directorio.
Systemd usa `/` de forma predeterminada, por lo que la unidad define `WorkingDirectory=/srv/app`. PHP también busca un archivo ini en este directorio.
Consulta [Configuración](/es/docs/configuration).

## Proxy inverso

Rapira acepta HTTP sin cifrar y no ofrece ajustes de TLS.
Un [proxy de terminación TLS](https://en.wikipedia.org/wiki/TLS_termination_proxy) recibe HTTPS del cliente, descifra la conexión y envía HTTP sin cifrar a Rapira.
Usa nginx, Caddy, HAProxy o un balanceador de carga en la nube para esta tarea.
Conecta el proxy a Rapira mediante la interfaz de bucle invertido o un socket Unix. Una dirección pública de Rapira también usa HTTP sin cifrar.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

El socket Unix se crea con permisos `0666`, así que cualquier proceso local con acceso al directorio donde está puede conectarse y mandarle peticiones a tu aplicación. Rapira no tiene ningún ajuste para esos permisos, de modo que los del directorio son lo único que limita quién llega hasta el socket. Si eso te importa, restringe el directorio: en la unidad de arriba, `RuntimeDirectoryMode=0750` y un `Group=` al que pertenezca el usuario del proxy dejan `/run/rapira` fuera del alcance de los demás.

Los campos reenviados tienen que llegar a Rapira con la grafía normal, la del guion: `X-Forwarded-For`, nunca `X_Forwarded_For`. Las variantes con guion bajo o con punto caen en la misma clave de `$_SERVER` que la buena, que es justo por donde un cliente sobrescribiría lo que tu proxy acaba de poner, así que Rapira las descarta antes de que PHP las vea. La [página de HTTP](/es/docs/http) explica la correspondencia y el ajuste `http.unsafe_field_names` que la gobierna.

Cuando activas el [middleware de archivos estáticos](/es/docs/static-files), Rapira sirve él mismo los archivos estáticos, así que el proxy no tiene que guardar una segunda copia del document root. Poner delante un proxy o una CDN sigue siendo una opción.

## Despliegues sin cortes

Despliega el código nuevo. Después, recarga Rapira:

```bash
sudo systemctl reload rapira
```

El comando envía `SIGUSR2` al proceso maestro. El maestro sustituye un worker cada vez y termina las peticiones actuales.
Si un worker supera `process_control_timeout_secs`, el maestro envía `SIGTERM` y después `SIGKILL`. Esto termina la petición actual.
Consulta [Modelo de procesos](/es/docs/process-model) para ver la secuencia de sustitución.

Envía la señal al proceso maestro cuando systemd no gestione el proceso. Define `supervisor.pidfile` para guardar el identificador del proceso.
Crea el directorio del pidfile antes de iniciar Rapira. También puedes seleccionar un directorio existente.
El proceso maestro no se inicia si no puede escribir el archivo.

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Ese archivo lo escribe solo el maestro -los workers no lo tocan- y el maestro lo borra en todos los caminos de salida que controla, así que uno que se queda ahí significa que el maestro murió sin ejecutar su propio apagado: un `SIGKILL`, una caída dura o la máquina apagándose.

`process_control_timeout_secs` es el tiempo que le da el maestro a un worker para que termine antes de escalar, y también limita cada paso de una recarga progresiva, para que un worker atascado no pare el relevo entero; la secuencia de escalada y la tabla completa de señales están en [Modelo de procesos](/es/docs/process-model). Mantenlo holgadamente por debajo del `TimeoutStopSec` de systemd, o será el tiempo de espera de systemd el que se agote primero y mate al maestro a media escalada.

::: warning Lo que una recarga no hace
El maestro se queda con los ajustes con los que arrancó, y la memoria compartida de OPcache también es suya, así que sobrevive a todas las generaciones de workers. Para cambiar `rapira.toml` hace falta `systemctl restart rapira`. Y si has puesto `opcache.validate_timestamps = 0`, una recarga seguirá sirviendo los opcodes viejos: ahí toca reiniciar.
:::

## Registros

Rapira escribe cada registro en **stderr**. La salida stderr de una unidad de systemd se envía al journal sin configuración adicional.
En producción, usa JSON:

```toml
[log]
level = "info"
format = "json"
```

Cada línea contiene un objeto con `timestamp`, `level`, `target` y `fields`. El objeto `fields` contiene `message` y otros campos del evento.
La marca de tiempo usa UTC según RFC 3339.

```bash
journalctl -u rapira -f
```

Para sacarlos de la máquina, apunta tu colector al journal de la unidad o ejecuta Rapira con su stderr entubada directamente en el agente si prefieres saltarte journald. En ambos casos el registro ya viene estructurado, así que el colector no tiene que parsearlo con expresiones regulares. Para los niveles por target y el `RUST_LOG` que sustituye el filtro entero durante una sesión de depuración, mira [Registros](/es/docs/logging).

## Reciclado de workers y tiempos límite de petición

En [modo Worker](/es/docs/execution-modes) el proceso se queda residente, así que una fuga lenta que bajo php-fpm pasa desapercibida se va acumulando petición tras petición. De eso te protegen dos ajustes:

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` sustituye un worker después del número definido de peticiones. Rapira añade un valor aleatorio para evitar sustituir todo el pool a la vez.
Este ajuste limita el efecto de una fuga, pero no la corrige.
`request_terminate_timeout_secs` limita el tiempo de una petición. Rapira sustituye un worker que supera este valor.
Los dos ajustes están desactivados de forma predeterminada. Actívalos antes de usar producción.

El resto del pool -el dimensionado static, dynamic y ondemand, el backoff al recrear procesos y qué hace el maestro cuando muere un worker- está en [Modelo de procesos](/es/docs/process-model).
