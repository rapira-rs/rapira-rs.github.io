---
title: Configuración
description: "La referencia completa de rapira.toml: todas las claves de [http], [pool], [supervisor] y [log], con su tipo, su valor por defecto y las reglas que rechazan un valor inválido."
---

# Configuración

Rapira arranca sin ningún archivo de configuración: `rapira serve app/worker.php` elige un valor por defecto para todo. Añades un `rapira.toml` cuando esos valores se te quedan cortos — otra dirección de escucha, un número fijo de workers, una política de reciclaje, un pidfile que tu sistema de init pueda leer, un nivel de registro más detallado. Apunta el servidor al archivo y el servidor lee de ahí sus ajustes:

```bash
rapira serve --config /etc/rapira/rapira.toml
```

El archivo tiene cuatro secciones y todas son opcionales: `[http]` configura la escucha, `[pool]` los procesos worker, `[supervisor]` el proceso maestro y `[log]` lo que se escribe en stderr. La única clave sin valor por defecto es el script de entrada de PHP: o lo pones aquí en `pool.entrypoint`, o lo pasas como argumento posicional en la línea de comandos.

::: info
Los ajustes van por capas: una opción de la línea de comandos gana al archivo de configuración, y el archivo gana al valor por defecto. Por eso `--processes 8` se impone a un `processes = 4` del archivo, y una configuración que tienes en el control de versiones se puede sobrescribir para una ejecución suelta. Las opciones en sí están documentadas en la [página de la línea de comandos](/es/docs/cli).
:::

## Un rapira.toml completo

Todas las claves que Rapira entiende, en un solo archivo. Nada de lo que hay abajo es obligatorio: borra cualquier línea y entra su valor por defecto. Con dos excepciones — `pool.entrypoint` no tiene ningún valor por defecto al que recurrir, y `min_spare`/`max_spare` son obligatorias mientras esté puesto `mode = "dynamic"`.

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # optional; SERVER_NAME reported to PHP
server_port = 8000                    # optional; defaults to the listen TCP port (80 for unix:)
max_body_size_mb = 8                  # optional; larger request bodies get a 413
unsafe_field_names = "drop"           # optional; drop (default) | reject

[pool]
entrypoint = "index.php"              # relative → resolved against this file's directory
processes = 4                         # worker processes to fork (max_children for mode = dynamic/ondemand)
classic = false                       # optional; default false
mode = "dynamic"                      # static (default) | dynamic | ondemand
min_spare = 1                         # dynamic only: keep at least this many idle workers
max_spare = 3                         # dynamic only: trim to at most this many idle workers (rejected under other modes)
max_requests = 0                      # recycle a worker after N requests (+jitter); 0 = unlimited
process_idle_timeout_secs = 10        # ondemand: retire an idle worker after this long
request_terminate_timeout_secs = 0    # kill a worker whose single request runs longer (wall clock); 0 = off

[supervisor]                          # optional; master-process policy
pidfile = "/run/rapira.pid"           # optional; relative paths resolve against this file's dir
process_control_timeout_secs = 30     # graceful-stop budget before QUIT → TERM → KILL

[log]                                 # optional; verbosity and record shape
level = "error"                       # error (default) | warn | info | debug | trace
format = "plain"                      # plain (default) | json

[log.targets]                         # optional; per-target overrides on top of level
php = "debug"
pingora_core = "warn"
```

El resto de la página es ese mismo archivo, clave por clave.

## La sección `[http]`

Esta sección cubre dónde escucha Rapira, qué le dice a PHP el entorno de la petición sobre el servidor en el que corre y cuánto cuerpo de petición lee.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `listen` | cadena | `"127.0.0.1:8000"` | La dirección de escucha, en una de estas tres formas: `host:port` con una IP literal (`127.0.0.1:8000`, `[::1]:8000`), `:port` para todas las interfaces, o `unix:/run/rapira.sock` para un socket Unix. Un puerto suelto y un nombre de host se rechazan los dos: la dirección tiene que decir a qué interfaz se refiere. |
| `server_name` | cadena | `"localhost"` | Lo que PHP lee en `$_SERVER['SERVER_NAME']`. |
| `server_port` | entero | el puerto de escucha, `80` con `unix:` | Lo que PHP lee en `$_SERVER['SERVER_PORT']`. Ponlo cuando el proxy que hay delante de Rapira termina en un puerto distinto del que abre Rapira. |
| `max_body_size_mb` | entero | `8` | El cuerpo de petición más grande que acepta Rapira, en MiB (1024 × 1024 bytes). Todo lo que pase de ahí se responde con un `413`. Tiene que ser 1 como mínimo. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | Qué pasa con un campo de la petición cuyo nombre no encaja en `[A-Za-z0-9-]`: se elimina antes de que PHP lo vea, registrando cada eliminación en `warn`, o se responde `400`. El porqué y el mapeo CGI que hay detrás están en la [página de HTTP](/es/docs/http). |

`server_name` y `server_port` solo dan forma a lo que PHP ve en `$_SERVER`; ninguna de las dos cambia dónde abre el servidor de verdad. De eso se encarga `listen`, y nada más.

## La sección `[pool]`

Los workers son los procesos que ejecutan PHP de verdad, y esta sección dice qué ejecutan, cuántos hay y cuándo el maestro retira a alguno. Qué hace el maestro con estos números lo explica el [modelo de procesos](/es/docs/process-model); aquí son solo claves.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `entrypoint` | cadena | ninguno — obligatorio | El script PHP que ejecuta cada worker. Una ruta relativa se resuelve respecto al directorio donde está el archivo de configuración. Un argumento `SCRIPT` en la línea de comandos lo sustituye, y uno de los dos tiene que estar o el servidor se niega a arrancar. |
| `processes` | entero | uno por CPU lógica | Cuántos procesos worker crear con fork. Con `dynamic` y `ondemand` esto es el techo, no la cantidad. Tiene que ser 1 como mínimo. |
| `classic` | booleano | `false` | Con `false` el worker se queda residente entre peticiones (el peldaño SAPI Worker); con `true` el script de entrada se vuelve a ejecutar desde cero en cada petición, igual que haría php-fpm. Consulta los [modos de ejecución](/es/docs/execution-modes). `--classic` solo sirve para activarlo: un `true` puesto aquí no se puede anular desde la línea de comandos. |
| `mode` | `"static"` \| `"dynamic"` \| `"ondemand"` | `"static"` | Cómo se dimensiona el pool. `static` mantiene vivos `processes` workers todo el tiempo; `dynamic` escala entre los umbrales de reserva, con `processes` como techo; `ondemand` solo hace fork cuando hay trabajo y deja que se retiren los workers ociosos. |
| `min_spare` | entero | ninguno | Solo para `dynamic`, y ahí obligatoria: mantén al menos este número de workers ociosos y listos. |
| `max_spare` | entero | ninguno | Solo para `dynamic`, y ahí obligatoria: recorta hasta dejar como mucho este número de workers ociosos. El par tiene que cumplir `1 <= min_spare <= max_spare <= processes`; ponerlas bajo otro modo es un error de verdad, no un detalle que Rapira se salte. |
| `max_requests` | entero | `0` | Recicla el worker cuando haya atendido este número de peticiones, más un pequeño margen aleatorio para que el pool entero no se renueve de golpe. `0` significa nunca. |
| `process_idle_timeout_secs` | entero | `10` | La lee `ondemand`: cuánto tiempo puede estar un worker ocioso antes de que el maestro lo retire. |
| `request_terminate_timeout_secs` | entero | `0` | El tiempo real máximo para una sola petición. Al worker que siga con ella pasado ese límite se le mata y se le sustituye. Con `0` no se comprueba nada. |

## La sección `[supervisor]`

Las reglas del proceso maestro: el que es dueño del socket de escucha, supervisa a los workers y recibe tus señales. También es con quien habla un sistema de init, así que esta suele ser la sección que rellenas cuando escribes un archivo de unidad; lo tienes en [En producción](/es/docs/deployment).

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `pidfile` | cadena | ninguno | Dónde escribe el maestro su propio pid. Una ruta relativa se resuelve respecto al directorio donde está el archivo de configuración. A ese pid es al que van las señales, y la [página del modelo de procesos](/es/docs/process-model) tiene la tabla completa de qué hace cada una. |
| `process_control_timeout_secs` | entero | `30` | Cuánto le deja el maestro a un worker para terminar por las buenas antes de escalar QUIT → TERM → KILL. |

## La sección `[log]`

Rapira lo escribe todo en stderr, con una escritura por entrada, para que la salida del maestro y la de los workers nunca se mezclen a mitad de línea. Esta sección decide cuánto detalle tiene ese flujo y qué forma tiene cada entrada; en [Registros](/es/docs/logging) están los targets uno a uno, los formatos y cómo se corresponden los diagnósticos de PHP con los niveles.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | El nivel de detalle, aplicado a todos los targets a la vez. |
| `format` | `"plain"` \| `"json"` | `"plain"` | La forma de cada entrada: líneas legibles para una persona (con color cuando stderr es un terminal), o un objeto JSON por línea para un recolector de registros. |
| `[log.targets]` | tabla de target → nivel | vacía | Ajustes por target que se aplican encima de `level`: `php = "debug"` mientras todo lo demás se mantiene callado, por ejemplo. La coincidencia es por prefijo, así que `php` cubre también `php_sys::callbacks` y todo lo que cuelgue de ahí. |

Una clave de `[log.targets]` tiene que parecerse a una ruta de módulo: letras, dígitos y `_` `:` `.` `-`, empezando por letra, dígito o `_`. Con las claves se monta una cadena de filtro, así que cualquier cosa fuera de esa forma se leería como sintaxis del filtro en lugar de como nombre de target, y por eso se rechaza de entrada.

## Las claves desconocidas se rechazan

Rapira analiza `rapira.toml` de forma estricta. Cada tabla y cada clave dentro de ella tiene que ser una que el servidor conozca, así que un `[htttp]` o un `lissten = ":8000"` tumban el arranque con un mensaje que dice qué no ha reconocido, en lugar de quedarse en una línea ignorada sin avisar. Cada clave tiene además una única tabla: `max_requests` es de `[pool]` y de ningún otro sitio, `pidfile` de `[supervisor]` y de ningún otro sitio, y colocar una bajo la tabla equivocada falla igual que una errata.

Los valores se comprueban igual. `level = "verbose"`, `format = "pretty"` y `unsafe_field_names = "allow"` son errores que impiden arrancar, no una vuelta silenciosa al valor por defecto: una errata que rebaja en silencio un ajuste de seguridad es peor que una que corta el arranque. Los números también tienen límites: `pool.processes` y `http.max_body_size_mb` tienen que ser 1 como mínimo, y toda clave `*_secs` topa en `86400`, un día.

::: warning
La validación ocurre antes de que arranque nada, así que una clave que no se reconoce corta el arranque en vez de degradar la ejecución en silencio. Tenlo presente cuando edites `rapira.toml` en una máquina que está sirviendo ahora mismo: al proceso en marcha no le pasa nada, pero el siguiente arranque es el que tiene que salir bien.
:::

## Rutas relativas

Dos claves guardan una ruta del sistema de archivos, `pool.entrypoint` y `supervisor.pidfile`, y las dos se resuelven respecto al directorio que contiene el archivo de configuración, no respecto al directorio de trabajo de quien arrancó el servidor. Con `/etc/rapira/rapira.toml` y `entrypoint = "app/worker.php"`, el script es `/etc/rapira/app/worker.php` da igual desde dónde se haya lanzado `rapira serve`.

El argumento posicional `SCRIPT` funciona justo al revés. Es un valor de la línea de comandos, así que una ruta relativa ahí se resuelve respecto al directorio actual, exactamente igual que con cualquier otro programa al que le escribes un nombre de archivo.

::: tip
Guarda `rapira.toml` dentro de la aplicación y escribe sus rutas en relativo. Así, mover el directorio se lleva consigo toda la configuración, y nada depende del directorio en el que al servicio le toque arrancar.
:::

::: question ¿Necesito siquiera un archivo de configuración?
No. Con `rapira serve`, un script y una opción o dos tienes cubierto el caso habitual, y a todo lo que dejes sin poner se le aplican los valores por defecto documentados aquí arriba. El archivo empieza a salir a cuenta cuando hay más ajustes de los que te apetece recordar, o cuando quieres que pasen por revisión y vivan en el control de versiones junto a la aplicación.
:::

::: question ¿Puedo configurar Rapira con variables de entorno?
No: los ajustes salen del archivo de configuración y de las opciones de la línea de comandos, y de nada más. Las excepciones son dos variables que solo tocan los registros. `RUST_LOG` es un atajo para depurar que reemplaza el filtro de registro entero, así que una sesión ruidosa no te obliga a editar la configuración; `NO_COLOR` le quita el color al formato `plain`, y cualquier valor no vacío lo desactiva, incluso en un terminal. Las dos están descritas en la [página de registros](/es/docs/logging).
:::

::: question ¿Por qué no arranca el servidor con `mode = "dynamic"`?
Lo más probable es que sean los contadores de reserva. `dynamic` necesita `min_spare` y `max_spare`, y las dos tienen que cumplir `1 <= min_spare <= max_spare <= processes`; ojo, que una opción `--processes` baja el techo contra el que se comprueban. Con `static` o `ondemand` esas mismas claves se rechazan de plano, lo que casi siempre significa que la línea `mode` dice algo distinto de lo que se pretendía.
:::
