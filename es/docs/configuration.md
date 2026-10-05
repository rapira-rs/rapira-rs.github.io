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

`[http]` y `[grpc]` configuran escuchas y pools de workers PHP separados. Configura al menos una de estas secciones. La sección opcional `[observability]` configura una escucha para métricas y comprobaciones de salud. `[supervisor]` configura el proceso maestro. `[log]` configura la salida a stderr.

Cada pool HTTP o gRPC activado requiere un script de entrada PHP. Define `http.pool.entrypoint`, `grpc.pool.entrypoint` o ambos.

## Un rapira.toml completo

El siguiente archivo de configuración activa ambos protocolos y muestra las tablas admitidas. La mayoría de las claves ausentes usan su valor predeterminado. Cada pool requiere `entrypoint`. La tabla `[http.static]` requiere `http.static.root`.

Algunas claves deben aparecer juntas. La tabla `[http.static]` requiere la entrada `"static"` de `middleware`, y la entrada requiere la tabla. La tabla `[grpc.auth]` y la entrada `"auth"` de `interceptors` siguen la misma regla.

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
processes = 4                         # Sets the fixed worker count.
max_requests = 0                      # Replaces a worker after this request count. Zero disables the limit.
request_terminate_timeout_secs = 0    # Replaces a worker when one request exceeds this time. Zero disables the limit.

[grpc]
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"          # Required. A FileDescriptorSet with its imports.
services = ["example.v1.Echo"]        # Optional. Default: the services of the files that no other file imports.
reflection = false
default_timeout_secs = 30             # Optional. Deadline of a call without a client timeout.
max_timeout_secs = 60                 # Optional. Upper limit for a client timeout.
keepalive_interval_secs = 10          # Optional. Idle time before an HTTP/2 PING.
keepalive_timeout_secs = 10           # Optional. Closes a connection that does not answer the PING.
interceptors = ["auth"]               # Optional. Rapira uses the list order.

[grpc.auth]                           # Required when interceptors contains "auth".
tokens_file = "grpc-tokens"           # Required. One bearer token on each line.

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"                   # Required mode for gRPC.
processes = 4
max_requests = 0
request_terminate_timeout_secs = 0

[observability]                       # Optional. Starts one process without PHP for metrics and probes.
listen = "127.0.0.1:9180"             # Required.
keepalive_timeout_secs = 60           # Optional.

[observability.metrics]               # Enables GET /metrics. Set this table, the probes table, or both.

[observability.probes]                # Enables GET /livez and GET /readyz.

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

## La sección `[http]`

Esta sección define la escucha y los datos del servidor que recibe PHP. También define los límites del cuerpo de la petición y el middleware que se ejecuta antes que PHP.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `listen` | cadena | `"127.0.0.1:8000"` | La dirección de escucha. Usa `host:port` con una dirección IP, `:port` para todas las interfaces IPv4, o `unix:/run/rapira.sock` para un socket Unix. Usa `[::]:8080` para todas las interfaces IPv6. Pon una IPv6 literal entre corchetes, como en `[::1]:8000`. Rapira rechaza los nombres de host y un puerto sin dos puntos, como `8000`. |
| `server_name` | cadena | `"localhost"` | Lo que PHP lee en `$_SERVER['SERVER_NAME']`. |
| `server_port` | entero | el puerto de escucha, `80` con `unix:` | El valor de `$_SERVER['SERVER_PORT']`. Defínelo cuando el puerto del proxy es distinto del puerto de Rapira. |
| `max_body_size_mb` | entero | `8` | El cuerpo de petición más grande, en MiB. Rapira devuelve `413` para un cuerpo más grande. El mínimo es 1. |
| `write_timeout_secs` | entero | `30` | El tiempo máximo sin avance durante la escritura de una respuesta. Después, Rapira cierra la conexión. El rango es de 1 a `86400`. |
| `keepalive_timeout_secs` | entero | `60` | El tiempo límite para recibir las cabeceras de la petición. Incluye la espera en una conexión inactiva. También es el tiempo máximo entre dos frames del cuerpo de la petición. Después del límite, Rapira cierra la conexión. Un cuerpo de petición detenido recibe antes `408`. El rango es de 1 a `86400`. |
| `unsafe_field_names` | `"drop"` \| `"reject"` | `"drop"` | El tratamiento de un nombre de campo fuera de `[A-Za-z0-9-]`. `"reject"` devuelve `400`. En los modos Classic y Worker, `"drop"` elimina el campo y lo registra. En modo Dispatcher, `"drop"` conserva el campo. Consulta la [página de HTTP](/es/docs/http). |
| `middleware` | lista de cadenas | vacía | El middleware que se ejecuta antes que PHP, en el orden de la lista. Solo `"static"` está disponible. Rapira rechaza los nombres duplicados y los nombres sin tabla de configuración. También rechaza las tablas de middleware que la lista no usa. |

### La tabla `[http.static]`

El middleware `static` puede devolver un archivo antes de que PHP reciba la petición. Atiende `GET` y `HEAD`. PHP recibe los demás métodos y las rutas que no identifican un archivo. PHP también recibe las rutas ocultas y las rutas de directorio. El middleware no sirve archivos de índice.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `root` | cadena | ninguno, obligatoria | El directorio servido. Una ruta relativa usa como base el directorio del archivo de configuración. El directorio debe existir y ser accesible durante la inicialización. |
| `forbid` | lista de cadenas | `[".php"]` | Los sufijos de nombre de archivo que el middleware no sirve. Cada entrada empieza por un punto y tiene al menos dos caracteres. No puede contener `/` ni espacios en blanco. La comparación no distingue mayúsculas. Una lista explícita sustituye el valor predeterminado. |

Consulta [Archivos estáticos](/es/docs/static-files) para ver la caché de archivos y otros detalles.

### La tabla `[http.sendfile]`

La raíz de sendfile es el directorio que `sendFile()` puede leer. Rapira resuelve la raíz y la ruta pedida a rutas canónicas. Rechaza una ruta fuera de la raíz.

`sendFile()` es un método de `Rapira\Http\Exchange`. Solo el modo Dispatcher da un exchange al script. Por eso, esta tabla solo afecta al modo Dispatcher. Los modos Classic y Worker la aceptan, pero no la usan.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `root` | cadena | el directorio de `http.pool.entrypoint` | El único directorio que `sendFile()` puede leer. Una ruta relativa usa como base el directorio que contiene el archivo de configuración. |

Si la raíz no existe al arrancar, Rapira registra un aviso y `sendFile()` rechaza todas las rutas. Crea el directorio antes de arrancar el servidor.

### La tabla `[http.uploads]`

La tabla `[http.uploads]` define los límites del análisis de `multipart/form-data` en el host. Solo el modo Dispatcher analiza los cuerpos multipart en el host. Los modos Classic y Worker los analizan en PHP y usan los límites de `php.ini`. Rapira rechaza esta tabla en estos dos modos.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `dir` | cadena | el directorio temporal del sistema | El directorio de almacenamiento de las partes de tipo archivo. Una ruta relativa usa como base el directorio del archivo de configuración. Rapira crea y comprueba este directorio. Cada worker crea un subdirectorio `rapira-spool-<pid>` y lo elimina al terminar. |
| `max_file_size_mb` | entero | `2` | La parte de tipo archivo más grande, en MiB. |
| `max_field_size_kb` | entero | `256` | La parte de tipo campo más grande, en KiB. |
| `max_files` | entero | `20` | Las partes de tipo archivo permitidas en una petición. |
| `max_parts` | entero | `1024` | Las partes de tipo archivo y de tipo campo permitidas en una petición. |
| `max_part_headers` | entero | `32` | Los campos de cabecera permitidos en una parte. |

Cada límite debe ser como mínimo 1. Rapira devuelve `413` cuando una petición supera un límite.

### La tabla `[http.pool]` {#http-pool}

Los workers ejecutan PHP. Esta tabla define qué ejecutan, cuántos se ejecutan y cuándo el maestro retira uno. El [modelo de procesos](/es/docs/process-model) explica cómo usa el maestro estos valores.

El plugin `http` es dueño de este pool de workers PHP. La escucha gRPC usa una tabla `[grpc.pool]` separada.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `entrypoint` | cadena | ninguno, obligatorio | El script PHP que ejecuta cada worker. Una ruta relativa se resuelve respecto al directorio donde está el archivo de configuración. La ruta debe identificar un archivo regular que se pueda leer. |
| `mode` | `"classic"` \| `"worker"` \| `"dispatcher"` | `"dispatcher"` | Cómo ejecuta un worker el script de entrada. `classic` inicia una nueva petición PHP cada vez. `worker` conserva el script y rellena de nuevo las superglobales. `dispatcher` conserva el script y le da un objeto dispatcher. Consulta los [modos de ejecución](/es/docs/execution-modes). |
| `processes` | entero | paralelismo disponible, o `1` si no se puede determinar | El número de workers. El maestro mantiene este número de workers en marcha. El mínimo es 1. La suma de `processes` de todos los pools no puede ser mayor que 2048. Una sección `[observability]` añade un proceso a esta suma. |
| `max_requests` | entero | `0` | El límite de peticiones antes de sustituir el worker. Rapira varía un poco el límite para evitar sustituciones simultáneas. `0` desactiva el límite. |
| `request_terminate_timeout_secs` | entero | `0` | El límite de tiempo real para una petición. Rapira termina y sustituye un worker que supera este límite. `0` desactiva la comprobación. |

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
| `keepalive_interval_secs` | entero | `10` | El tiempo de inactividad antes de que Rapira envíe un PING keepalive de HTTP/2. No se aplica a los clientes HTTP/1.1. El rango es de 1 a `86400`. |
| `keepalive_timeout_secs` | entero | `10` | El tiempo que Rapira espera la respuesta al PING. Si no llega ninguna respuesta en este tiempo, Rapira cierra la conexión. El rango es de 1 a `86400`. |
| `interceptors` | lista de cadenas | vacía | Los interceptores que se ejecutan antes que PHP, en el orden de la lista. Solo `"auth"` está disponible. Rapira rechaza los nombres duplicados, los nombres desconocidos y los nombres sin tabla de configuración. También rechaza una tabla `[grpc.auth]` que la lista no nombra. |

El maestro carga el descriptor set antes de crear los workers con fork. Estos errores impiden la inicialización: un conjunto que Rapira no puede leer o no puede decodificar, un conjunto sin sus importaciones y un conjunto sin ningún servicio que atender. También la impiden una entrada de `services` que no está en el conjunto, una entrada duplicada y una entrada que nombra el servicio de salud o el de reflexión. `default_timeout_secs` no puede ser mayor que `max_timeout_secs`.

### La tabla `[grpc.auth]` {#grpc-auth}

El interceptor `auth` acepta una llamada solo con un token bearer válido. PHP no recibe una llamada rechazada. Consulta [Autenticación en gRPC](/es/docs/grpc#authentication) para ver el lado del cliente y el servicio de salud.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `tokens_file` | cadena | ninguno, obligatorio | El archivo con los tokens aceptados. Una ruta relativa usa como base el directorio del archivo de configuración. Escribe un token en cada línea. Rapira omite las líneas vacías y las líneas que empiezan por `#`. Cada token debe ser un [token bearer de RFC 6750](https://www.rfc-editor.org/rfc/rfc6750#section-2.1). El archivo debe contener al menos un token. |

### La tabla `[grpc.pool]` {#grpc-pool}

Esta tabla usa las [claves y los valores predeterminados del pool HTTP](#http-pool), con un `entrypoint` obligatorio y `mode = "dispatcher"`. Se rechazan los modos Classic y Worker. El número de workers, el reciclaje y el mecanismo de vigilancia del proceso se aplican a este pool de forma independiente.

HTTP y gRPC pueden ejecutarse juntos. Cada escucha usa su propio pool y script de entrada. El maestro lee el descriptor set y el archivo de tokens una vez al arrancar. Reinicia Rapira para cargar un archivo modificado. Una recarga conserva los archivos anteriores.

## La sección `[observability]` {#observability}

Esta sección inicia un proceso más que sirve métricas y sondas de salud por HTTP. Este proceso no ejecuta código PHP. La sección no es una tabla de plugin, así que el archivo sigue necesitando `[http]` o `[grpc]`. Consulta [Métricas y comprobaciones de salud](/es/docs/observability) para ver los endpoints y las métricas.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `listen` | cadena | ninguno, obligatorio | La dirección de escucha. Usa la misma sintaxis que `http.listen`. Usa una dirección que las escuchas `http` y `grpc` no usan. |
| `keepalive_timeout_secs` | entero | `60` | El tiempo límite para recibir las cabeceras de la petición. Incluye la espera en una conexión inactiva. El rango es de 1 a `86400`. |
| `[observability.metrics]` | tabla vacía | ausente | Activa `GET /metrics` en el formato de texto de Prometheus. |
| `[observability.probes]` | tabla vacía | ausente | Activa `GET /livez` y `GET /readyz`. |

Define al menos una de las dos subtablas. Las subtablas no aceptan claves.

## La sección `[supervisor]`

Esta sección define la política del proceso maestro. El maestro es dueño de los sockets de escucha, supervisa a los workers y recibe las señales. El sistema de init controla el maestro. Consulta [En producción](/es/docs/deployment) para ver un archivo de unidad.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `pidfile` | cadena | ninguno | El archivo del identificador del proceso maestro. Una ruta relativa usa como base el directorio del archivo de configuración. Envía las señales de proceso a este identificador. Consulta el [modelo de procesos](/es/docs/process-model). |
| `process_control_timeout_secs` | entero | `30` | Cuánto espera el maestro después de `SIGQUIT` antes de enviar `SIGTERM`. El maestro envía `SIGKILL` un segundo después de `SIGTERM`. |

Las conexiones tienen un plazo de drenaje más corto: el tiempo límite de control menos el menor valor entre cinco segundos y la mitad de ese límite. El plazo predeterminado es de 25 segundos. Se aplica durante la parada y la recarga.

## La sección `[log]`

Esta sección controla el nivel y el formato de los registros de stderr. Consulta [Registros](/es/docs/logging) para ver los targets, los formatos y los niveles de diagnóstico PHP.

| Clave | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `level` | `"error"` \| `"warn"` \| `"info"` \| `"debug"` \| `"trace"` | `"error"` | El nivel de detalle, aplicado a todos los targets a la vez. |
| `format` | `"plain"` \| `"json"` | `"plain"` | El formato de los registros. La salida plain contiene líneas legibles y puede usar colores. La salida JSON contiene un objeto en cada línea. |
| `[log.targets]` | tabla de target → nivel | vacía | Ajustes del nivel de registro por target. Las claves coinciden con prefijos de target. Consulta [Registros](/es/docs/logging#ajustes-por-target) para ver la lista de targets. |

Una clave de `[log.targets]` puede usar letras, dígitos, `_`, `:`, `.` y `-`. Debe empezar con una letra, un dígito o `_`. Rapira rechaza otros caracteres porque el filtro puede interpretarlos como sintaxis. Una clave de target que contiene `:` o `.` debe ir entre comillas porque TOML no permite estos caracteres en una clave simple sin comillas. Por ejemplo:

```toml
[log.targets]
"h2::proto" = "debug"
```

`RUST_LOG` y `NO_COLOR` solo afectan a la salida de stderr. `RUST_LOG` sustituye el filtro completo de stderr durante una ejecución. Un valor no vacío de `NO_COLOR` desactiva los colores del formato `plain`.

## Las claves desconocidas se rechazan

Rapira solo acepta las tablas y claves documentadas. Por ejemplo, `[htttp]` o `lissten = ":8000"` impiden la inicialización. El error identifica el nombre desconocido. Cada clave pertenece a una tabla. Por ejemplo, `max_requests` pertenece a `[http.pool]` y `pidfile` pertenece a `[supervisor]`.

Rapira también valida los valores. Rechaza los valores no admitidos en lugar de usar los predeterminados. Por ejemplo, rechaza `level = "verbose"`, `format = "pretty"` y `unsafe_field_names = "allow"`. El número de workers, los tamaños de cuerpo y los límites de carga deben ser como mínimo 1. Cada clave `*_secs` debe estar entre 1 y `86400`. Solo `request_terminate_timeout_secs` acepta también `0`.

::: warning
Rapira lee el archivo de configuración solo al arrancar. Una recarga con `SIGHUP` o `SIGUSR2` no lo vuelve a leer. Reinicia Rapira para aplicar un archivo modificado.
:::

## Rutas relativas

Las rutas del sistema de archivos incluyen los scripts de entrada de ambos pools, `grpc.descriptor_set`, `grpc.auth.tokens_file`, `supervisor.pidfile`, `http.static.root`, `http.sendfile.root` y `http.uploads.dir`. Cada ruta relativa usa como base el directorio del archivo de configuración. Por ejemplo, define `entrypoint = "app/worker.php"` en `/etc/rapira/rapira.toml`. Rapira usa entonces `/etc/rapira/app/worker.php`.

Una ruta relativa de escucha `unix:` usa como base el directorio de trabajo del proceso Rapira. Usa una ruta absoluta para un socket Unix.

::: tip
Guarda el archivo de configuración `rapira.toml` dentro de la aplicación. Escribe sus rutas respecto al archivo de configuración. Puedes mover el directorio de la aplicación. Estas rutas no cambian.
:::
