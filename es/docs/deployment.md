---
title: En producción
description: "Cómo ejecutar Rapira en un servidor: una unidad de systemd, la disposición de la configuración, un proxy inverso delante, recargas sin cortes, registros en JSON y reciclado de workers."
---

# En producción

Ejecutar Rapira en un servidor añade lo que un `rapira serve app/worker.php` local no necesita: arrancar al encender la máquina, volver después de una caída, recargar el código nuevo sin tirar ninguna petición y unos registros que puedas leer más tarde. Esta página cubre una unidad de systemd, un sitio para la configuración, un proxy delante y los ajustes que ponen límites a unos workers de vida larga.

Casi nada de esto está compilado en el binario. Nada en Rapira depende de dónde tengas la configuración ni de qué supervise el proceso, así que la disposición de más abajo es una convención que establece esta página y que asume el resto de la documentación. Antes de nada, mete el binario en la máquina: de eso se encarga [Instalación](/es/docs/installation).

## Una unidad de systemd

Rapira ocupa el lugar de php-fpm, y su maestro ya supervisa el pool: crea procesos con fork, recoge los que mueren, los vuelve a crear con backoff, recicla workers y escala el pool. Mantener vivo ese único proceso maestro es el único trabajo de systemd, así que no le queda nada que hacer a un gestor de procesos aparte como supervisord.

Los paquetes `.deb` y `.rpm` instalan el binario y el runtime de PHP que lleva incrustado, y nada más: **ni unidad de servicio ni `php.ini`** (en [Instalación](/es/docs/installation) tienes la lista exacta de archivos). Las dos cosas son política de cada instalación, y un paquete que las trajera te pisaría los cambios en cada actualización.

Escribe la tuya en `/etc/systemd/system/rapira.service`:

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

Después cárgala y actívala:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now rapira
```

Seis de esas líneas necesitan explicación:

- `Type=exec` — Rapira se ejecuta en **primer plano** y nunca hace fork para pasar a segundo plano. No hay modo demonio ni hace falta: el proceso que arranca systemd *es* el maestro, así que `$MAINPID` es justo el pid al que quieres mandar señales.
- `ExecReload` — convierte `systemctl reload rapira` en un `SIGUSR2` al maestro, que es la recarga sin cortes de la que se habla más abajo.
- `KillMode=mixed` — por defecto systemd manda la señal de parada a todos los procesos del cgroup, y un worker se toma un `SIGTERM` como una muerte inmediata. Con `mixed` la señal va solo al maestro, que a partir de ahí hace el vaciado ordenado con `SIGQUIT` que se describe más abajo; el `SIGKILL` de `TimeoutStopSec` sigue cubriendo al grupo entero. Sin esta línea, `systemctl stop` y `systemctl restart` se llevan por delante las peticiones en curso.
- `Restart=on-failure` — un vaciado limpio termina con código cero y se queda parado, así que esto solo levanta el servidor otra vez tras una caída o un arranque fallido.
- `RuntimeDirectory=rapira` — systemd crea `/run/rapira` al arrancar y lo borra al parar. Ahí es donde viven el pidfile y el socket Unix de los ejemplos de más abajo.
- `Environment=PHPRC` — dónde busca PHP su `php.ini`; lo cuenta la sección siguiente.

::: tip Ejecución con un usuario que no sea root
Añade `User=` y `Group=` al bloque `[Service]`: systemd le cambia el dueño del `RuntimeDirectory` a esa cuenta, así que el pidfile y el socket Unix de dentro de `/run/rapira/` siguen funcionando. Las rutas de fuera —`/run/rapira.pid` y compañía— están en un directorio que pertenece a root y no se podrán abrir.
:::

Dos aplicaciones en una misma máquina llevan dos configuraciones, dos unidades y dos direcciones de escucha; para eso usa una unidad plantilla de systemd (`rapira@.service`). Cada instancia arranca su propio PHP y su propio pool de workers, y no comparte nada con la otra instancia salvo la máquina.

## Dónde vive la configuración

La convención es `/etc/rapira/rapira.toml` para los ajustes propios de Rapira y un `php.ini` al lado, que se encuentra gracias a `PHPRC=/etc/rapira`. Ninguna de las dos rutas está compilada en el binario. A `--config` le vale cualquier ruta que le des, y `PHPRC` ni siquiera es cosa de Rapira: la búsqueda de ini de PHP se queda tal cual, así que PHP mira primero en `$PHPRC` exactamente igual que bajo cualquier otro SAPI. Apunta las dos a otro sitio si tu distribución o tu rol de Ansible usa rutas distintas.

Rapira funciona sin ningún `php.ini`: sus valores de ini por defecto mandan los diagnósticos de PHP al registro en lugar de a tus respuestas, como cuenta [Registros](/es/docs/logging). Escribe el tuyo en `/etc/rapira` cuando quieras ajustar OPcache, poner un límite de memoria o una zona horaria; lo que defina ahí manda.

Un `pool.entrypoint` relativo se resuelve contra el directorio **del archivo de configuración**, no contra el directorio de trabajo. Con la disposición de arriba, `entrypoint = "index.php"` querría decir `/etc/rapira/index.php`, que no es donde está tu aplicación. En producción, dale al entrypoint una ruta absoluta y la duda no aparece nunca. `supervisor.pidfile` sigue la misma regla: las dos rutas de la configuración cuelgan del directorio del archivo de configuración. Lo que sí se resuelve contra el directorio de trabajo es el argumento posicional `SCRIPT` y cualquier ruta relativa que tu código PHP abra en tiempo de ejecución, y Rapira nunca hace `chdir`: systemd arranca el servicio en `/` salvo que pongas `WorkingDirectory=`, y por eso la unidad de arriba lo pone (la búsqueda de ini de PHP incluye `.`, así que también mira ahí). Cada clave, con su valor por defecto, está en [Configuración](/es/docs/configuration).

## Detrás de un proxy inverso

El listener de Rapira habla HTTP en claro y la configuración no tiene ninguna sección de TLS. Termina el TLS en el proxy que ya tienes montado —nginx, Caddy, HAProxy, un balanceador de tu nube— y deja que llegue a Rapira por loopback o por un socket Unix. Puedes escuchar en una interfaz pública, pero ese listener sigue sirviendo HTTP en claro.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

El socket Unix se crea con permisos `0666`, así que cualquier proceso local con acceso al directorio donde está puede conectarse y mandarle peticiones a tu aplicación. Rapira no tiene ningún ajuste para esos permisos, de modo que los del directorio son lo único que limita quién llega hasta el socket. Si eso te importa, restringe el directorio: en la unidad de arriba, `RuntimeDirectoryMode=0750` y un `Group=` al que pertenezca el usuario del proxy dejan `/run/rapira` fuera del alcance de los demás.

Los campos reenviados tienen que llegar a Rapira con la grafía normal, la del guion: `X-Forwarded-For`, nunca `X_Forwarded_For`. Las variantes con guion bajo o con punto caen en la misma clave de `$_SERVER` que la buena, que es justo por donde un cliente sobrescribiría lo que tu proxy acaba de poner, así que Rapira las descarta antes de que PHP las vea. La [página de HTTP](/es/docs/http) explica la correspondencia y el ajuste `http.unsafe_field_names` que la gobierna.

## Despliegues sin cortes

Despliega el código nuevo y luego:

```bash
sudo systemctl reload rapira
```

Eso es un `SIGUSR2` al maestro, que responde con una **recarga progresiva**: el pool se reemplaza de worker en worker y las peticiones en curso llegan hasta el final; no se pierde nada mientras ningún worker se pase de `process_control_timeout_secs`. Al que se pasa se le escala a `SIGTERM` y luego a `SIGKILL`, y su petición en curso se pierde (lo tienes más abajo). Cómo solapa el relevo al worker nuevo con el viejo lo tienes en [Modelo de procesos](/es/docs/process-model).

Sin systemd —un entrypoint de contenedor, un script de despliegue— mándale la señal al maestro tú mismo. Define `supervisor.pidfile` y tendrás el pid a mano; eso sí, fuera de systemd nadie crea `/run/rapira`, así que crea antes el directorio o elige una ruta que exista: el maestro se niega a arrancar si no puede escribir ese archivo.

```toml
[supervisor]
pidfile = "/run/rapira/rapira.pid"
process_control_timeout_secs = 30
```

```bash
kill -USR2 "$(cat /run/rapira/rapira.pid)"
```

Ese archivo lo escribe solo el maestro —los workers no lo pueden tocar— y el maestro lo borra en todos los caminos de salida que controla, así que uno que se queda ahí significa que el maestro murió sin ejecutar su propio apagado: un `SIGKILL`, una caída dura o la máquina apagándose.

`process_control_timeout_secs` es el tiempo que le da el maestro a un worker para que termine antes de escalar, y también limita cada paso de una recarga progresiva, para que un worker atascado no pare el relevo entero; la secuencia de escalada y la tabla completa de señales están en [Modelo de procesos](/es/docs/process-model). Mantenlo holgadamente por debajo del `TimeoutStopSec` de systemd, o será el tiempo de espera de systemd el que se agote primero y mate al maestro a media escalada.

::: warning Lo que una recarga no hace
El maestro se queda con los ajustes con los que arrancó, y la memoria compartida de OPcache también es suya, así que sobrevive a todas las generaciones de workers. Para cambiar `rapira.toml` hace falta `systemctl restart rapira`. Y si has puesto `opcache.validate_timestamps = 0`, una recarga seguirá sirviendo los opcodes viejos: ahí toca reiniciar.
:::

## Registros

Rapira escribe cada registro en **stderr**, una escritura por registro, así que la salida del maestro y la de los workers nunca se mezclan a mitad de línea. La stderr de una unidad de systemd va al journal sin configurar absolutamente nada, con lo que lo único que queda por elegir es el formato. En producción, usa JSON:

```toml
[log]
level = "info"
format = "json"
```

Un objeto por línea, con `timestamp` en RFC 3339 UTC más `level`, `message` y `target`; los saltos de línea dentro de un mensaje se escapan, así que un registro siempre ocupa exactamente una línea. Es la forma que esperan los colectores de registros, y journald la deja pasar sin cambios.

```bash
journalctl -u rapira -f
```

Para sacarlos de la máquina, apunta tu colector al journal de la unidad o ejecuta Rapira con su stderr entubada directamente en el agente si prefieres saltarte journald. En ambos casos el registro ya viene estructurado, así que el colector no tiene que parsearlo con expresiones regulares. Para los niveles por target y el `RUST_LOG` que sustituye el filtro entero durante una sesión de depuración, mira [Registros](/es/docs/logging).

## Reciclado de workers y tiempos límite de petición

En [modo worker](/es/docs/execution-modes) el proceso se queda residente, así que una fuga lenta que bajo php-fpm pasa desapercibida se va acumulando petición tras petición. De eso te protegen dos ajustes:

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` jubila al worker tras ese número de peticiones y crea otro nuevo con fork, con algo de jitter para que el pool entero no se recicle a la vez. No arregla ninguna fuga; lo que hace es evitar que una fuga que nadie ha encontrado acabe en una caída del servicio. `request_terminate_timeout_secs` es un techo de tiempo real para una sola petición: al worker que se lo salte se le mata y se le vuelve a crear, así que una petición atascada no ocupa un worker de forma permanente. Los dos vienen desactivados de fábrica; actívalos antes de salir a producción.

El resto del pool —el dimensionado static, dynamic y ondemand, el backoff al recrear procesos y qué hace el maestro cuando muere un worker— está en [Modelo de procesos](/es/docs/process-model).
