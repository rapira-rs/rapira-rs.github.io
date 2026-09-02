---
title: Configuración
description: "La referencia completa de rapira.toml: todas las claves de [http], [pool], [supervisor] y [log], con su tipo, su valor por defecto y las reglas que rechazan un valor inválido."
---

# Configuración

Rapira arranca sin ningún archivo de configuración: `rapira serve --mode worker app/worker.php` elige un valor por defecto para todo. Añades un `rapira.toml` cuando esos valores se te quedan cortos — otra dirección de escucha, un número fijo de workers, una política de reciclaje, un pidfile que tu sistema de init pueda leer, un nivel de registro más detallado. Apunta el servidor al archivo y el servidor lee de ahí sus ajustes:

```bash
rapira serve --config /etc/rapira/rapira.toml
```

El archivo tiene cuatro secciones y todas son opcionales: `[http]` configura la escucha, `[pool]` los procesos worker, `[supervisor]` el proceso maestro y `[log]` lo que se escribe en stderr. La única clave sin valor por defecto es el script de entrada de PHP: o lo pones aquí en `pool.entrypoint`, o lo pasas como argumento posicional en la línea de comandos.

::: info
Los ajustes van por capas: una opción de la línea de comandos gana al archivo de configuración, y el archivo gana al valor por defecto. Por eso `--processes 8` se impone a un `processes = 4` del archivo, y una configuración que tienes en el control de versiones se puede sobrescribir para una ejecución suelta. Las variables de entorno quedan fuera de esas capas: salvo dos que solo afectan a los registros, los ajustes salen del archivo y de las opciones, y de nada más. Las opciones en sí están documentadas en la [página de la línea de comandos](/es/docs/cli).
:::

## Un rapira.toml completo

Todas las claves que Rapira entiende, en un solo archivo. Nada de lo que hay abajo es obligatorio: borra cualquier línea y entra su valor por defecto. Con cuatro excepciones. `pool.entrypoint` no tiene ningún valor por defecto al que recurrir. `min_spare` y `max_spare` son obligatorias mientras esté puesto `scaling = "dynamic"`. Y `http.static.root` es obligatoria mientras esté presente la tabla `[http.static]`.

Hay además dos grupos de claves que van juntas, así que borrar solo una parte corta el arranque. Borra a la vez la tabla `[http.static]` y la entrada `"static"` de `middleware`: Rapira rechaza la tabla sin la entrada, y rechaza la entrada sin la tabla. Y borra `min_spare` y `max_spare` a la vez que `scaling = "dynamic"`: Rapira rechaza las dos claves de reserva con el escalado `static` y con el `ondemand`.

```toml
[http]
listen = "127.0.0.1:8000"
server_name = "localhost"             # Optional. Sets SERVER_NAME for PHP.
server_port = 8000                    # Optional. Uses the TCP listen port by default.
max_body_size_mb = 8                  # Optional. Rapira returns 413 for larger request bodies.
write_timeout_secs = 30               # Optional. Closes a connection after a response write times out.
keepalive_timeout_secs = 60           # Optional. Limits idle periods and read operations.
unsafe_field_names = "drop"           # Optional. Use "drop" or "reject". Default: "drop".
middleware = ["static"]               # Optional. Rapira uses the list order.

[http.static]                         # Required when middleware contains "static".
root = "public"                       # Required. Relative paths use this file's directory.
forbid = [".php"]                     # Optional. Rapira does not serve these suffixes.

[http.sendfile]                       # Optional. Sets the sendFile() root in Dispatcher mode.
root = "public"                       # Optional. Uses the entrypoint directory by default.

[http.uploads]                        # Optional. Sets multipart limits in Dispatcher mode.
dir = "/var/spool/rapira"             # Optional. Uses the system temporary directory by default.
max_file_size_mb = 2                  # Optional. Limits one file part.
max_field_size_kb = 256               # Optional. Limits one field part.
max_files = 20                        # Optional. Limits file parts in one request.
max_parts = 1024                      # Optional. Limits all parts in one request.
max_part_headers = 32                 # Optional. Limits fields in one part.

[pool]
entrypoint = "index.php"              # Relative paths use this file's directory.
mode = "dispatcher"                   # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
processes = 4                         # Sets the worker count and the scaling maximum.
scaling = "dynamic"                   # Use "static", "dynamic", or "ondemand". Default: "static".
min_spare = 1                         # For dynamic scaling. Sets the minimum idle worker count.
max_spare = 3                         # For dynamic scaling. Sets the maximum idle worker count.
max_requests = 0                      # Replaces a worker after this request count. Zero disables the limit.
process_idle_timeout_secs = 10        # For ondemand scaling. Removes workers after this idle time.
request_terminate_timeout_secs = 0    # Replaces a worker when one request exceeds this time. Zero disables the limit.

[supervisor]                          # Optional. Sets master process behavior.
pidfile = "/run/rapira.pid"           # Optional. Relative paths use this file's directory.
process_control_timeout_secs = 30     # Sets the stop timeout before QUIT, TERM, and KILL.

[log]                                 # Optional. Sets the level and record format.
level = "error"                       # Use error, warn, info, debug, or trace. Default: error.
format = "plain"                      # Use plain or json. Default: plain.

[log.targets]                         # Optional. Overrides the level for each target.
php = "debug"
http = "warn"
```

El resto de la página documenta esas claves sección por sección.

## La sección `[http]`

Esta sección cubre dónde escucha Rapira, qué le dice a PHP el entorno de la petición sobre el servidor en el que corre, cuánto cuerpo de petición lee y qué middleware se ejecuta antes que PHP.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `listen` | cadena | `"127.0.0.1:8000"` | La dirección de escucha, en una de estas tres formas: `host:port` con una IP literal (`127.0.0.1:8000`, `[::1]:8000`), `:port` para todas las interfaces, o `unix:/run/rapira.sock` para un socket Unix. Un puerto suelto y un nombre de host se rechazan los dos: la dirección tiene que decir a qué interfaz se refiere. |
| `server_name` | cadena | `"localhost"` | Lo que PHP lee en `$_SERVER['SERVER_NAME']`. |
| `server_port` | entero | el puerto de escucha, `80` con `unix:` | Lo que PHP lee en `$_SERVER['SERVER_PORT']`. Ponlo cuando el proxy que hay delante de Rapira termina en un puerto distinto del que abre Rapira. |
| `max_body_size_mb` | entero | `8` | El cuerpo de petición más grande que acepta Rapira, en MiB (1024 × 1024 bytes). Todo lo que pase de ahí se responde con un `413`. Tiene que ser 1 como mínimo. |
| `write_timeout_secs` | entero | `30` | Cuánto tiempo puede estar una escritura de la respuesta sin avanzar. Rapira cierra la conexión cuando un cliente deja de leer durante más tiempo que este. Tiene que ser 1 como mínimo y `86400` como máximo. |
| `keepalive_timeout_secs` | entero | `60` | Cuánto tiempo puede estar una conexión sin avanzar en una petición. Acota una conexión keepalive ociosa que espera la petición siguiente, la lectura de una cabecera de petición y la lectura de un trozo del cuerpo. A un cuerpo que se para pasado el límite se le responde `408`. Tiene que ser 1 como mínimo y `86400` como máximo. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | Qué pasa con un campo de la petición cuyo nombre no encaja en `[A-Za-z0-9-]`: se elimina antes de que PHP lo vea, registrando cada eliminación en `warn`, o se responde `400`. El porqué y el mapeo CGI que hay detrás están en la [página de HTTP](/es/docs/http). |
| `middleware` | lista de cadenas | vacía | Qué middleware atiende una petición antes que PHP. El orden de la lista es el orden de la cadena. Por ahora, `"static"` es el único nombre que Rapira conoce. Un nombre repetido se rechaza, un nombre de la lista sin su tabla se rechaza, y una tabla configurada que la lista no menciona también, así que la lista es el único interruptor de cada middleware. |

`server_name` y `server_port` solo dan forma a lo que PHP ve en `$_SERVER`; ninguna de las dos cambia dónde abre el servidor, que lo decide `listen` y nada más.

### La tabla `[http.static]`

El middleware `static` responde a una petición desde un directorio del disco antes de que la petición llegue a PHP. Atiende `GET` y `HEAD`; cualquier otro método va a PHP. Una ruta que no nombra ningún archivo sigue hasta PHP. Una ruta con algún segmento que empieza por un punto, también. Y la URL de un directorio, igual: el middleware no sirve ningún archivo de índice.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `root` | cadena | ninguno, obligatoria | El directorio que sirve el middleware. Una ruta relativa se resuelve respecto al directorio donde está el archivo de configuración. El directorio tiene que existir cuando arranca el servidor, y el proceso del servidor necesita permiso para entrar en él. Si no, el arranque falla. |
| `forbid` | lista de cadenas | `[".php"]` | Los sufijos de nombre de archivo que el middleware no sirve nunca. Cada entrada empieza por un punto, tiene dos caracteres como mínimo y no lleva ni `/` ni espacios en blanco. La comparación no distingue mayúsculas. Una lista explícita sustituye al valor por defecto, así que con `forbid = []` se sirve cualquier archivo bajo la raíz, fuentes PHP incluidas. |

Cada proceso worker guarda en memoria los archivos que sirve: 16MiB como mucho, y ningún archivo suelto de más de 256KiB. Una entrada se mantiene fresca durante un segundo, así que un archivo reescrito llega a los clientes un segundo después de la escritura.

Consulta [Archivos estáticos](/es/docs/static-files) para más información.

### La tabla `[http.sendfile]`

La raíz de sendfile es el directorio del que lee `sendFile()`. Rapira canonicaliza tanto la raíz como la ruta pedida, y rechaza toda ruta que resuelva fuera de la raíz. `sendFile()` es un método de `Rapira\Http\Exchange`, y solo el modo Dispatcher le entrega un `Exchange` al script, así que esta tabla solo surte efecto en modo Dispatcher. Los modos Classic y Worker aceptan la tabla y no la leen nunca.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `root` | cadena | el directorio donde está `pool.entrypoint` | El único directorio del que puede leer `sendFile()`. Una ruta relativa se resuelve respecto al directorio donde está el archivo de configuración. |

Una raíz que no existe cuando arranca el servidor no se puede canonicalizar, y entonces `sendFile()` rechaza cualquier ruta. Crea el directorio antes de arrancar el servidor.

### La tabla `[http.uploads]`

La tabla `[http.uploads]` acota el análisis de `multipart/form-data` que hace el host. Rapira analiza un cuerpo multipart en el host solo en modo Dispatcher. Los modos Classic y Worker lo analizan en PHP, donde los límites los pone `php.ini`, así que esta tabla bajo cualquiera de los dos corta el arranque.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `dir` | cadena | el directorio temporal del sistema | La raíz donde se depositan las partes de tipo archivo. Una ruta relativa se resuelve respecto al directorio donde está el archivo de configuración. Rapira crea el directorio al arrancar, comprueba que se puede escribir en él y le da a cada worker su propio subdirectorio `rapira-spool-<pid>`, que el worker borra al salir. |
| `max_file_size_mb` | entero | `2` | La parte de tipo archivo más grande, en MiB. |
| `max_field_size_kb` | entero | `256` | La parte de tipo campo más grande, en KiB. |
| `max_files` | entero | `20` | Cuántas partes de tipo archivo puede llevar una petición. |
| `max_parts` | entero | `1024` | Cuántas partes puede llevar una petición, sumando las de archivo y las de campo. |
| `max_part_headers` | entero | `32` | Cuántos campos de cabecera puede llevar una parte. |

Todos estos límites tienen que ser 1 como mínimo. A una petición que se pase de cualquiera de ellos se le responde `413`.

## La sección `[pool]`

Los workers son los procesos que ejecutan PHP de verdad, y esta sección dice qué ejecutan, cuántos hay y cuándo el maestro retira a alguno. Qué hace el maestro con estos números lo explica el [modelo de procesos](/es/docs/process-model).

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `entrypoint` | cadena | ninguno — obligatorio | El script PHP que ejecuta cada worker. Una ruta relativa se resuelve respecto al directorio donde está el archivo de configuración. Un argumento `SCRIPT` en la línea de comandos lo sustituye, y uno de los dos tiene que estar o el servidor se niega a arrancar. |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | Cómo ejecuta un worker el script de entrada. `classic` lo vuelve a ejecutar desde cero en cada petición. `worker` lo mantiene residente y rellena de nuevo las superglobales en cada petición. `dispatcher` lo mantiene residente y le da un objeto dispatcher del que el script va sacando cada petición. La opción `--mode` de la línea de comandos se impone a esta clave en los dos sentidos. Consulta los [modos de ejecución](/es/docs/execution-modes). |
| `processes` | entero | uno por CPU lógica | Cuántos procesos worker crear con fork. Con el escalado `dynamic` y con el `ondemand` esto es el techo, no la cantidad. Tiene que ser 1 como mínimo. |
| `scaling` | `"static"` \| `"dynamic"` \| `"ondemand"` | `"static"` | Cómo se dimensiona el pool. `static` mantiene vivos `processes` workers todo el tiempo; `dynamic` escala entre los umbrales de reserva, con `processes` como techo; `ondemand` solo hace fork cuando hay trabajo y deja que se retiren los workers ociosos. |
| `min_spare` | entero | ninguno | Solo con el escalado `dynamic`, y ahí obligatoria: mantén al menos este número de workers ociosos y listos. |
| `max_spare` | entero | ninguno | Solo con el escalado `dynamic`, y ahí obligatoria: recorta hasta dejar como mucho este número de workers ociosos. El par tiene que cumplir `1 <= min_spare <= max_spare <= processes`; ponerlas con otro valor de escalado es un error. |
| `max_requests` | entero | `0` | Recicla el worker cuando haya atendido este número de peticiones, más un pequeño margen aleatorio para que el pool entero no se renueve de golpe. `0` significa nunca. |
| `process_idle_timeout_secs` | entero | `10` | La lee el escalado `ondemand`: cuánto tiempo puede estar un worker ocioso antes de que el maestro lo retire. |
| `request_terminate_timeout_secs` | entero | `0` | El tiempo real máximo para una sola petición. Al worker que siga con ella pasado ese límite se le mata y se le sustituye. Con `0` no se comprueba nada. |

`mode` y `scaling` son dos ejes distintos: `mode` dice qué hace un worker con el script de entrada, y `scaling`, cuántos workers hay.

Los umbrales de reserva se comprueban contra el valor efectivo de `processes`, así que una opción `--processes` en la línea de comandos baja el techo bajo el que tiene que caber `max_spare`.

## La sección `[supervisor]`

Las reglas del proceso maestro: el que es dueño del socket de escucha, supervisa a los workers y recibe tus señales. También es con quien habla un sistema de init, así que estas son las claves que suele fijar un archivo de unidad; lo tienes en [En producción](/es/docs/deployment).

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
| `[log.targets]` | tabla de target → nivel | vacía | Ajustes por target que se aplican encima de `level`. Cada clave nombra uno de los targets bajo los que Rapira emite: `php` lleva la salida del propio PHP, y `http`, el frontal HTTP. La coincidencia es por prefijo, así que `php` cubre también `php_sys::callbacks` y todo lo que cuelgue de ahí. En [Registros](/es/docs/logging) están todos los targets. |

Una clave de `[log.targets]` tiene que parecerse a una ruta de módulo: letras, dígitos y `_` `:` `.` `-`, empezando por letra, dígito o `_`. Con las claves se monta una cadena de filtro, así que cualquier cosa fuera de esa forma se leería como sintaxis del filtro en lugar de como nombre de target, y por eso se rechaza de entrada.

`RUST_LOG` y `NO_COLOR` son las únicas variables de entorno que Rapira lee, y las dos afectan solo a los registros: `RUST_LOG` reemplaza el filtro entero durante una ejecución, así que una sesión ruidosa de depuración no obliga a editar la configuración, y `NO_COLOR` le quita el color al formato `plain` con cualquier valor no vacío, incluso cuando stderr es un terminal.

## Las claves desconocidas se rechazan

Rapira analiza `rapira.toml` de forma estricta. Cada tabla y cada clave dentro de ella tiene que ser una que el servidor conozca, así que un `[htttp]` o un `lissten = ":8000"` tumban el arranque con un mensaje que dice qué no ha reconocido, en lugar de quedarse en una línea ignorada sin avisar. Cada clave tiene además una única tabla: `max_requests` es de `[pool]` y de ningún otro sitio, `pidfile` de `[supervisor]` y de ningún otro sitio, y colocar una bajo la tabla equivocada falla igual que una errata.

Los valores se comprueban igual. `level = "verbose"`, `format = "pretty"` y `unsafe_field_names = "allow"` son errores que impiden arrancar, no una vuelta silenciosa al valor por defecto, de modo que una errata no puede rebajar en silencio un ajuste de seguridad. Los números también tienen límites: `pool.processes`, `http.max_body_size_mb`, los dos tiempos límite de `[http]` y todos los límites de `[http.uploads]` tienen que ser 1 como mínimo, y toda clave `*_secs` topa en `86400`, un día.

::: warning
La validación ocurre antes de que arranque nada, así que una clave que no se reconoce corta el arranque en vez de degradar la ejecución en silencio. Editar `rapira.toml` en una máquina que está sirviendo ahora mismo no le hace nada al proceso en marcha, pero el siguiente arranque es el que tiene que salir bien.
:::

## Rutas relativas

Cinco claves guardan una ruta del sistema de archivos, y todas se resuelven respecto al directorio que contiene el archivo de configuración y no respecto al directorio de trabajo de quien arrancó el servidor: `pool.entrypoint`, `supervisor.pidfile`, `http.static.root`, `http.sendfile.root` y `http.uploads.dir`. Con `/etc/rapira/rapira.toml` y `entrypoint = "app/worker.php"`, el script es `/etc/rapira/app/worker.php` da igual desde dónde se haya lanzado `rapira serve`.

El argumento posicional `SCRIPT` funciona justo al revés. Es un valor de la línea de comandos, así que una ruta relativa ahí se resuelve respecto al directorio de trabajo actual.

::: tip
Guarda `rapira.toml` dentro de la aplicación y escribe sus rutas en relativo. Así, mover el directorio se lleva consigo toda la configuración, y nada depende del directorio en el que al servicio le toque arrancar.
:::
