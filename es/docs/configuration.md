---
title: Configuración
description: "Todas las claves de rapira.toml, sus tipos, valores predeterminados y reglas de validación."
---

# Configuración

Rapira requiere un archivo de configuración. El comando `rapira serve` toma su ruta como único argumento. Cualquier nombre de archivo es válido, y esta documentación usa `rapira.toml`:

```bash
rapira serve /etc/rapira/rapira.toml
```

El archivo define la dirección, los workers, la sustitución, el pidfile y el nivel de registro. Un valor del archivo sustituye el valor predeterminado.

`[http]` y `[grpc]` configuran escuchas y pools de workers PHP separados. Configura al menos una de estas secciones. `[supervisor]` configura el proceso maestro. `[log]` configura la salida a stderr.

Cada escucha activada requiere un script de entrada PHP. Define `http.pool.entrypoint`, `grpc.pool.entrypoint` o ambos.

## Un rapira.toml completo

El siguiente archivo de configuración activa ambos protocolos y muestra las tablas admitidas. La mayoría de las claves ausentes usan su valor predeterminado. Cada pool requiere `entrypoint`. El escalado dinámico requiere `min_spare` y `max_spare`. La tabla `[http.static]` requiere `http.static.root`.

Algunas claves deben aparecer juntas. La tabla `[http.static]` requiere la entrada `"static"` de `middleware`, y la entrada requiere la tabla. Elimina `min_spare` y `max_spare` cuando el escalado no sea `dynamic`. Rapira rechaza estas claves con `static` y `ondemand`.

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
root = "public"                       # Optional. Uses the entry script directory by default.

[http.uploads]                        # Optional. Sets multipart limits in Dispatcher mode.
dir = "/var/spool/rapira"             # Optional. Uses the system temporary directory by default.
max_file_size_mb = 2                  # Optional. Limits one file part.
max_field_size_kb = 256               # Optional. Limits one field part.
max_files = 20                        # Optional. Limits file parts in one request.
max_parts = 1024                      # Optional. Limits all parts in one request.
max_part_headers = 32                 # Optional. Limits fields in one part.

[http.pool]                           # The worker pool behind the http listener.
entrypoint = "index.php"              # Relative paths use this file's directory.
mode = "dispatcher"                   # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
processes = 4                         # Sets the worker count and the scaling maximum.
scaling = "dynamic"                   # Use "static", "dynamic", or "ondemand". Default: "static".
min_spare = 1                         # For dynamic scaling. Sets the minimum idle worker count.
max_spare = 3                         # For dynamic scaling. Sets the maximum idle worker count.
max_requests = 0                      # Replaces a worker after this request count. Zero disables the limit.
process_idle_timeout_secs = 10        # For ondemand scaling. Removes workers after this idle time.
request_terminate_timeout_secs = 0    # Replaces a worker when one request exceeds this time. Zero disables the limit.

[grpc]
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"          # Required. A FileDescriptorSet with its imports.
services = ["example.v1.Echo"]        # Optional. Default: the services of the files that no other file imports.
reflection = false
default_timeout_secs = 30             # Optional. Deadline of a call without a client timeout.
max_timeout_secs = 60                 # Optional. Upper limit for a client timeout.

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"                   # Required mode for gRPC.
processes = 4
scaling = "static"
max_requests = 0
process_idle_timeout_secs = 10
request_terminate_timeout_secs = 0

[supervisor]                          # Optional. Sets master process behavior.
pidfile = "/run/rapira.pid"           # Optional. Relative paths use this file's directory.
process_control_timeout_secs = 30     # Waits after SIGQUIT before SIGTERM. SIGKILL follows one second later.

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
| `listen` | cadena | `"127.0.0.1:8000"` | La dirección de escucha. Usa `host:port` con una dirección IP, `:port` para todas las interfaces IPv4, o `unix:/run/rapira.sock` para un socket Unix. `:8080` es igual a `0.0.0.0:8080`. Usa `[::]:8080` para todas las interfaces IPv6. Pon una IPv6 literal entre corchetes, como en `[::1]:8000`. Rapira rechaza un puerto sin dirección y rechaza los nombres de host. |
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
| `root` | cadena | el directorio de `http.pool.entrypoint` | El único directorio del que puede leer `sendFile()`. Una ruta relativa se resuelve respecto al directorio donde está el archivo de configuración. |

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

### La tabla `[http.pool]` {#http-pool}

Los workers son los procesos que ejecutan PHP de verdad, y esta tabla dice qué ejecutan, cuántos hay y cuándo el maestro retira a alguno. Qué hace el maestro con estos números lo explica el [modelo de procesos](/es/docs/process-model).

El plugin `http` es dueño de este pool de workers PHP. La escucha gRPC usa una tabla `[grpc.pool]` separada.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `entrypoint` | cadena | ninguno - obligatorio | El script PHP que ejecuta cada worker. Una ruta relativa se resuelve respecto al directorio donde está el archivo de configuración. Tienes que darle un valor. |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | Cómo ejecuta un worker el script de entrada. `classic` lo vuelve a ejecutar desde cero en cada petición. `worker` lo mantiene residente y rellena de nuevo las superglobales en cada petición. `dispatcher` lo mantiene residente y le da un objeto dispatcher del que el script va sacando cada petición. Consulta los [modos de ejecución](/es/docs/execution-modes). |
| `processes` | entero | uno por CPU lógica | Cuántos procesos worker crear con fork. Con el escalado `dynamic` y con el `ondemand` esto es el techo, no la cantidad. Tiene que ser 1 como mínimo. |
| `scaling` | `"static"` \| `"dynamic"` \| `"ondemand"` | `"static"` | Cómo se dimensiona el pool. `static` mantiene vivos `processes` workers todo el tiempo; `dynamic` escala entre los umbrales de reserva, con `processes` como techo; `ondemand` solo hace fork cuando hay trabajo y deja que se retiren los workers ociosos. |
| `min_spare` | entero | ninguno | Solo con el escalado `dynamic`, y ahí obligatoria: mantén al menos este número de workers ociosos y listos. |
| `max_spare` | entero | ninguno | Solo con el escalado `dynamic`, y ahí obligatoria: recorta hasta dejar como mucho este número de workers ociosos. El par tiene que cumplir `1 <= min_spare <= max_spare <= processes`; ponerlas con otro valor de escalado es un error. |
| `max_requests` | entero | `0` | Recicla el worker cuando haya atendido este número de peticiones, más un pequeño margen aleatorio para que el pool entero no se renueve de golpe. `0` significa nunca. |
| `process_idle_timeout_secs` | entero | `10` | Con el escalado `ondemand`, el maestro retira un worker después de este tiempo de inactividad. |
| `request_terminate_timeout_secs` | entero | `0` | El tiempo real máximo para una sola petición. Al worker que siga con ella pasado ese límite se le mata y se le sustituye. Con `0` no se comprueba nada. |

`mode` y `scaling` son dos ejes distintos: `mode` dice qué hace un worker con el script de entrada, y `scaling`, cuántos workers hay.

Los umbrales de reserva se comprueban contra el valor de `processes`.

## La sección `[grpc]` {#grpc}

Esta sección activa llamadas unarias gRPC, gRPC-Web y Connect en una sola escucha. Consulta [gRPC](./grpc) para ver un servicio PHP completo y comandos de cliente.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `listen` | cadena | `"127.0.0.1:50051"` | Dirección TCP o ruta de socket `unix:`. Usa la misma sintaxis de dirección que `http.listen`. |
| `descriptor_set` | cadena | ninguna, obligatoria | Ruta de un `google.protobuf.FileDescriptorSet` binario que contiene todos los archivos importados. Genéralo con `buf build --as-file-descriptor-set` o `protoc --include_imports`. |
| `services` | lista de cadenas | sin definir | Nombres completos de los servicios atendidos. Si no se define, el pool atiende los servicios de los archivos que ningún otro archivo del conjunto importa. La lista no puede estar vacía. |
| `reflection` | booleano | `false` | Activa los servicios `grpc.reflection.v1` y `v1alpha`. |
| `default_timeout_secs` | entero | sin definir | Plazo de una llamada que no tiene tiempo de espera del cliente. Si no se define, esa llamada no tiene plazo. |
| `max_timeout_secs` | entero | sin definir | Límite superior del tiempo de espera del cliente. Si no se define, no hay límite. |

El maestro carga el descriptor set antes de crear los workers con fork. Estos errores impiden la inicialización: un conjunto que Rapira no puede leer ni decodificar, un conjunto sin sus importaciones y un conjunto sin ningún servicio que atender. También la impiden una entrada de `services` que no está en el conjunto, una entrada duplicada y una entrada que nombra el servicio de salud o el de reflexión. `default_timeout_secs` no puede ser mayor que `max_timeout_secs`.

### La tabla `[grpc.pool]` {#grpc-pool}

Esta tabla usa las [claves y los valores predeterminados del pool HTTP](#http-pool), con un `entrypoint` obligatorio y `mode = "dispatcher"`. Se rechazan los modos Classic y Worker. El escalado, los límites de reserva, el reciclaje y el mecanismo de vigilancia del proceso se aplican a este pool de forma independiente.

HTTP y gRPC pueden ejecutarse juntos. Cada escucha usa su propio pool y script de entrada. Reinicia Rapira para cargar un descriptor set modificado. Una recarga conserva el conjunto anterior.

## La sección `[supervisor]`

Las reglas del proceso maestro: el que es dueño del socket de escucha, supervisa a los workers y recibe tus señales. También es con quien habla un sistema de init, así que estas son las claves que suele fijar un archivo de unidad; lo tienes en [En producción](/es/docs/deployment).

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `pidfile` | cadena | ninguno | Dónde escribe el maestro su propio pid. Una ruta relativa se resuelve respecto al directorio donde está el archivo de configuración. A ese pid es al que van las señales, y la [página del modelo de procesos](/es/docs/process-model) tiene la tabla completa de qué hace cada una. |
| `process_control_timeout_secs` | entero | `30` | Cuánto espera el maestro después de `SIGQUIT` antes de enviar `SIGTERM`. El maestro envía `SIGKILL` un segundo después de `SIGTERM`. |

## La sección `[log]`

Esta sección controla el nivel y el formato de los registros de stderr. Consulta [Registros](/es/docs/logging) para ver los targets, los formatos y los niveles de diagnóstico PHP.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | El nivel de detalle, aplicado a todos los targets a la vez. |
| `format` | `"plain"` \| `"json"` | `"plain"` | La forma de cada entrada: líneas legibles para una persona (con color cuando stderr es un terminal), o un objeto JSON por línea para un recolector de registros. |
| `[log.targets]` | tabla de target → nivel | vacía | Ajustes por target que se aplican encima de `level`. Cada clave nombra uno de los targets bajo los que Rapira emite: `php` lleva la salida del propio PHP. `http` y `grpc` contienen la salida de los servidores de protocolo. `net` contiene los registros del bucle de aceptación. La coincidencia es por prefijo, así que `php` cubre también `php_sys::callbacks` y todo lo que cuelgue de ahí. En [Registros](/es/docs/logging) están todos los targets. |

Una clave de `[log.targets]` puede usar letras, dígitos, `_`, `:`, `.` y `-`. Debe empezar con una letra, un dígito o `_`. Rapira rechaza otros caracteres porque el filtro puede interpretarlos como sintaxis. Una clave de target que contiene `:` o `.` debe ir entre comillas porque TOML no permite estos caracteres en una clave simple sin comillas. Por ejemplo:

```toml
[log.targets]
"php_sys::callbacks" = "debug"
```

`RUST_LOG` y `NO_COLOR` solo afectan a la salida de stderr. `RUST_LOG` sustituye el filtro completo de stderr durante una ejecución. Un valor no vacío de `NO_COLOR` desactiva los colores del formato `plain`.

## Las claves desconocidas se rechazan

Rapira solo acepta las tablas y claves documentadas. Por ejemplo, `[htttp]` o `lissten = ":8000"` impiden la inicialización. El error identifica el nombre desconocido. Rapira no lo ignora. Cada clave pertenece a una tabla. Por ejemplo, `max_requests` pertenece a `[http.pool]` y `pidfile` pertenece a `[supervisor]`.

Rapira también valida los valores. Rechaza los valores no admitidos en lugar de usar los predeterminados. Por ejemplo, rechaza `level = "verbose"`, `format = "pretty"` y `unsafe_field_names = "allow"`. Los valores numéricos tienen límites. Los workers, cuerpos, tiempos HTTP y límites de carga deben ser como mínimo 1. Cada clave `*_secs` tiene un máximo de `86400`, que equivale a un día.

::: warning
La validación ocurre antes de que arranque nada, así que una clave que no se reconoce corta el arranque en vez de degradar la ejecución en silencio. Editar `rapira.toml` en una máquina que está sirviendo ahora mismo no le hace nada al proceso en marcha, pero el siguiente arranque es el que tiene que salir bien.
:::

## Rutas relativas

Las rutas del sistema de archivos incluyen los scripts de entrada de ambos pools, `grpc.descriptor_set`, `supervisor.pidfile`, `http.static.root`, `http.sendfile.root` y `http.uploads.dir`. Cada ruta relativa usa como base el directorio del archivo de configuración. Las rutas relativas de escucha `unix:` también usan este directorio. Por ejemplo, `entrypoint = "app/worker.php"` en `/etc/rapira/rapira.toml` produce `/etc/rapira/app/worker.php`.

::: tip
Guarda `rapira.toml` dentro de la aplicación. Escribe sus rutas respecto al archivo. Este diseño permite mover el directorio de la aplicación sin cambiar las rutas.
:::
