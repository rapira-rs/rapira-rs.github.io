---
title: En producción
description: Una unidad de systemd, un sitio para la configuración, un proxy inverso delante, recargas sin cortes y registros en JSON — Rapira en un servidor de verdad.
---

# En producción

En tu portátil, con `rapira serve app/worker.php` ya está todo dicho. En un servidor quieres unas cuantas cosas más: que arranque solo al encender la máquina, que vuelva después de una caída, que recoja el código nuevo sin tirar ni una petición y que deje los registros en algún sitio donde de verdad puedas leerlos. Esta página es la mitad operativa de todo eso: una unidad de systemd, un sitio para la configuración, un proxy delante y el puñado de ajustes que mantienen sanos a unos workers que viven mucho tiempo.

Casi nada de lo que viene aquí está grabado en el binario. A Rapira le da igual dónde tengas la configuración y quién la supervise, así que la disposición de más abajo es una convención que establece esta página y que el resto de la documentación da por buena. Antes de nada, mete el binario en la máquina: de eso se encarga [Instalación](/es/docs/installation).

## Una unidad de systemd

Los paquetes `.deb` y `.rpm` instalan el binario y el runtime de PHP que lleva incrustado, y nada más: **ni unidad de servicio ni `php.ini`** (en [Instalación](/es/docs/installation) tienes la lista exacta de archivos). Es a propósito: las dos cosas son decisiones tuyas, y un paquete que las trajera se dedicaría a pisarte los cambios en cada actualización.

Así que escríbela tú. Copia esto en `/etc/systemd/system/rapira.service`:

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

Seis de esas líneas merecen un comentario:

- `Type=exec` — Rapira se ejecuta en **primer plano** y nunca hace fork para pasar a segundo plano. No hay modo demonio ni hace falta: el proceso que arranca systemd *es* el maestro, así que `$MAINPID` es justo el pid al que quieres mandar señales.
- `ExecReload` — convierte `systemctl reload rapira` en un `SIGUSR2` al maestro, que es la recarga sin cortes de la que se habla más abajo.
- `KillMode=mixed` — por defecto systemd manda la señal de parada a todos los procesos del cgroup, y un worker se toma un `SIGTERM` como una muerte inmediata. Con `mixed` la señal va solo al maestro, que a partir de ahí hace el vaciado ordenado con `SIGQUIT` que se describe más abajo; el `SIGKILL` de `TimeoutStopSec` sigue cubriendo al grupo entero. Sin esta línea, `systemctl stop` y `systemctl restart` se llevan por delante las peticiones en curso.
- `Restart=on-failure` — un vaciado limpio termina con código cero y se queda parado, así que esto solo levanta el servidor otra vez tras una caída o un arranque fallido.
- `RuntimeDirectory=rapira` — systemd crea `/run/rapira` al arrancar y lo borra al parar. Ahí es donde viven el pidfile y el socket Unix de los ejemplos de más abajo.
- `Environment=PHPRC` — dónde busca PHP su `php.ini`; lo cuenta la sección siguiente.

::: tip ¿No quieres ejecutarlo como root?
Añade `User=` y `Group=` al bloque `[Service]`: systemd le cambia el dueño del `RuntimeDirectory` a esa cuenta, así que el pidfile y el socket Unix de dentro de `/run/rapira/` siguen funcionando. Las rutas de fuera —`/run/rapira.pid` y compañía— están en un directorio que pertenece a root y no se podrán abrir.
:::

## Dónde vive la configuración

La convención es `/etc/rapira/rapira.toml` para los ajustes propios de Rapira y un `php.ini` al lado, que se encuentra gracias a `PHPRC=/etc/rapira`. Ninguna de las dos rutas está compilada en el binario. A `--config` le vale cualquier ruta que le des, y `PHPRC` ni siquiera es cosa de Rapira: la búsqueda de ini de PHP se queda tal cual, así que PHP mira primero en `$PHPRC` exactamente igual que bajo cualquier otro SAPI. Si tu distribución o tu rol de Ansible prefieren otro sitio, apunta las dos a donde quieras.

Antes de escribir ese archivo conviene saber una cosa: un `pool.entrypoint` relativo se resuelve contra el directorio **del archivo de configuración**, no contra el directorio de trabajo. Con la disposición de arriba, `entrypoint = "index.php"` querría decir `/etc/rapira/index.php`, que no es donde está tu aplicación. En producción, dale al entrypoint una ruta absoluta y la duda no aparece nunca. Todo lo *demás* que se resuelva de forma relativa cae en el directorio de trabajo, y Rapira nunca hace `chdir`: systemd arranca el servicio en `/` salvo que pongas `WorkingDirectory=`, y por eso la unidad de arriba lo pone (la búsqueda de ini de PHP incluye `.`, así que también mira ahí). Cada clave, con su valor por defecto, está en [Configuración](/es/docs/configuration).

## Detrás de un proxy inverso

El listener de Rapira habla HTTP en claro: en la configuración no hay ninguna sección de TLS, y es a propósito. Termina el TLS en el proxy que ya tienes montado —nginx, Caddy, HAProxy, un balanceador de tu nube— y deja que llegue a Rapira por loopback o por un socket Unix. Escuchar en una interfaz pública se puede hacer, pero sin TLS en ese listener rara vez es lo que quieres.

```toml
[http]
listen = "127.0.0.1:8000"
# listen = "unix:/run/rapira/rapira.sock"
```

El socket Unix se crea con permisos `0666`, así que cualquier cosa que alcance esa ruta puede conectarse. Si eso te importa, mete el socket en un directorio donde solo pueda entrar el usuario del proxy.

Tu proxy tiene una sola obligación a la entrada: los campos que reenvíe deben ir con la grafía normal, la del guion —`X-Forwarded-For`, nunca `X_Forwarded_For`—. Las variantes con guion bajo o con punto caen en la misma clave de `$_SERVER` que la buena, que es justo por donde un cliente sobrescribiría lo que tu proxy acaba de poner, así que Rapira las descarta antes de que PHP las vea. La [página de HTTP](/es/docs/http) explica la correspondencia y el ajuste `http.unsafe_field_names` que la gobierna.

## Despliegues sin cortes

Despliega el código nuevo y luego:

```bash
sudo systemctl reload rapira
```

Eso es un `SIGUSR2` al maestro, que responde con una **recarga progresiva**: el pool se reemplaza de worker en worker, las peticiones en curso llegan hasta el final y no se corta ninguna conexión. Cómo solapa el relevo al worker nuevo con el viejo lo tienes en [Modelo de procesos](/es/docs/process-model).

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

`process_control_timeout_secs` es la paciencia que le da el maestro a un worker para que termine antes de subir de tono, y también limita cada paso de una recarga progresiva, para que un worker atascado no pare el relevo entero; los pasos de la escalada y la tabla completa de señales están en [Modelo de procesos](/es/docs/process-model). Mantenlo holgadamente por debajo del `TimeoutStopSec` de systemd, o será la paciencia de systemd la que se agote primero y mate al maestro a media escalada.

::: warning Una recarga renueva los workers, no relee nada
El maestro se queda con los ajustes con los que arrancó, y la memoria compartida de OPcache también es suya, así que sobrevive a todas las generaciones de workers. Para cambiar `rapira.toml` hace falta `systemctl restart rapira`. Y si has puesto `opcache.validate_timestamps = 0`, una recarga te seguirá sirviendo tan tranquila los opcodes viejos: ahí toca reiniciar.
:::

## Registros

Rapira escribe cada registro en **stderr**, una escritura por registro, así que la salida del maestro y la de los workers nunca se mezclan a mitad de línea. La stderr de una unidad de systemd va al journal sin configurar absolutamente nada, con lo que lo único que queda por decidir es el formato, y en producción eso es JSON:

```toml
[log]
level = "info"
format = "json"
```

Un objeto por línea, con `timestamp` en RFC 3339 UTC más `level`, `message` y `target`; los saltos de línea dentro de un mensaje se escapan, así que un registro siempre ocupa exactamente una línea. Es la forma que quiere cualquier colector de registros y aguanta intacta el viaje por journald.

```bash
journalctl -u rapira -f
```

Para sacarlos de la máquina, apunta tu colector al journal de la unidad o ejecuta Rapira con su stderr entubada directamente en el agente si prefieres saltarte journald. En ambos casos el registro ya viene estructurado: nada de parsear con expresiones regulares al otro lado. Para los niveles por target y el `RUST_LOG` que sustituye el filtro entero durante una sesión de depuración, mira [Registros](/es/docs/logging).

## Higiene del worker

Un proceso residente es toda la gracia de los [peldaños de worker](/es/docs/execution-modes), y también la razón de que de pronto importe una fuga lenta que con php-fpm no habrías notado nunca. La red de seguridad son dos ajustes:

```toml
[pool]
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` jubila al worker tras ese número de peticiones y crea otro nuevo con fork, con algo de jitter para que el pool entero no se recicle a la vez. No arregla ninguna fuga; lo que hace es evitar que una fuga que nadie ha encontrado acabe en un incidente a las tres de la mañana. `request_terminate_timeout_secs` es un techo de tiempo real para una sola petición: al worker que se lo salte se le mata y se le vuelve a crear, y así una petición atascada deja de costarte un worker para siempre. Los dos vienen desactivados de fábrica y los dos merecen activarse antes de salir a producción.

El resto del pool —el dimensionado static, dynamic y ondemand, el backoff al recrear procesos y qué hace el maestro cuando muere un worker— está en [Modelo de procesos](/es/docs/process-model).

::: question ¿Sigo necesitando php-fpm o un gestor de procesos como supervisord?
Ninguno de los dos. Rapira ocupa el lugar de php-fpm, y su maestro ya supervisa el pool: crea procesos con fork, recoge los que mueren, los vuelve a crear con backoff, recicla workers y escala el pool. El único trabajo de systemd es mantener vivo ese único proceso maestro.
:::

::: question ¿Puedo ejecutar dos aplicaciones en la misma máquina?
Sí: dos configuraciones, dos unidades, dos direcciones de escucha. Lo más limpio es una unidad plantilla de systemd (`rapira@.service`). Cada instancia arranca su propio PHP y su propio pool de workers; no comparten nada más que la máquina.
:::

::: question ¿Por qué el paquete no instala un php.ini?
Porque es justo el archivo que seguro que vas a editar, y un archivo de configuración empaquetado que alguien edita es un conflicto de fusión en cada actualización. Además, Rapira funciona perfectamente sin él: sus valores de ini por defecto mandan los diagnósticos de PHP al registro en lugar de a tus respuestas, como cuenta [Registros](/es/docs/logging). Escribe tu propio `php.ini` en `/etc/rapira` cuando quieras ajustar OPcache, poner un límite de memoria o una zona horaria; lo que defina ahí manda.
:::
