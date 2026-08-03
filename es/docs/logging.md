---
title: Registros
description: "Cómo registra Rapira — niveles, ajustes por target, diagnósticos de PHP, registro desde la aplicación, los formatos plain y JSON, y la variable RUST_LOG para depurar."
---

# Registros

Rapira lo escribe todo en un único flujo: los eventos del ciclo de vida del servidor, las decisiones de supervisión del proceso maestro, el frontal HTTP, los diagnósticos de PHP y lo que la propia aplicación registra. Todo por stderr. Una advertencia de PHP es una entrada de ese mismo registro, no una línea en un `error_log` aparte, y se le sube o se le baja el nivel igual que a cualquier otra.

El nivel por defecto es `error`, así que solo pasan los errores y un servidor sano no registra nada. Subirlo es una línea de configuración, o la variable de entorno `RUST_LOG` cuando no quieres editar la configuración para nada.

## Niveles y formato

Los registros se configuran en la sección `[log]` de tu `rapira.toml`:

```toml
[log]
level = "error"   # error (default) | warn | info | debug | trace
format = "plain"  # plain (default) | json
```

`level` es el suelo común a todos los targets a la vez: con `error` solo ves errores, `warn` añade las advertencias, y así hasta `trace`, que lo enseña todo. `format` elige la forma de cada entrada: líneas legibles para una persona o un objeto JSON por línea.

Las dos claves son opcionales, y la sección entera también. El resto del archivo —la escucha, el pool, el supervisor— lo tienes en [Configuración](/es/docs/configuration).

## Ajustes por target

Un único nivel global suele quedarse corto. `[log.targets]` sube o baja targets concretos por encima de él, de modo que los diagnósticos de PHP pueden ir en `debug` sin arrastrar consigo cada detalle interno de la pila HTTP:

```toml
[log]
level = "error"

[log.targets]
php = "debug"
pingora_core = "warn"
```

Cada clave nombra un target y sube o baja solo ese; todo lo demás se queda en `level`. La coincidencia es **por prefijo**, así que `php` cubre también `php_sys` y `php_sys::callbacks`: basta con el prefijo coincidente más corto y nunca hay que enumerar los submódulos uno a uno.

Estos son los targets bajo los que emite el propio Rapira:

| Target   | Qué cubre                                                       |
| -------- | --------------------------------------------------------------- |
| `rapira` | el ciclo de vida del servidor: arranque, vida de los workers, apagado |
| `master` | la supervisión: forks, recogida de procesos, reinicios, recargas, escalado del pool |
| `http`   | el frontal HTTP: los sockets de escucha, el tratamiento de los campos de petición y respuesta, el drenaje |
| `ext`    | cómo acaban las tareas de las extensiones                       |
| `php`    | la salida y los diagnósticos que vienen del propio PHP          |
| `app`    | las entradas que la aplicación escribe con `\Rapira\log()`      |

No hay registro de accesos: Rapira no escribe una línea por petición. Lo que el target `http` informa sobre los campos de una petición o de una respuesta está descrito en [HTTP](/es/docs/http).

Las dependencias registran bajo su propia ruta de módulo —`pingora_core`, `tokio` y las demás— y se filtran exactamente igual. Cada entrada lleva el nombre de su target, así que a una dependencia ruidosa la callas copiando ese nombre en `[log.targets]`.

::: tip
`master` es el target que hay que mirar cuando quieres entender por qué el pool se comporta como se comporta: los reinicios, las recargas y el escalado se registran todos ahí. Qué significa cada uno de esos eventos lo tienes en [Modelo de procesos](/es/docs/process-model).
:::

## Diagnósticos de PHP

Todo lo que informa PHP acaba en el target `php`, y cada diagnóstico saca su nivel del tipo de error: el mismo filtro que controla al servidor decide cuánta salida de PHP llega al registro.

| Diagnóstico                                                                                    | Nivel   |
| ---------------------------------------------------------------------------------------------- | ------- |
| Errores fatales — `E_ERROR`, `E_PARSE`, `E_CORE_ERROR`, `E_COMPILE_ERROR`, `E_USER_ERROR`, `E_RECOVERABLE_ERROR` | `error` |
| Advertencias — `E_WARNING`, `E_CORE_WARNING`, `E_COMPILE_WARNING`, `E_USER_WARNING`            | `warn`  |
| Avisos — `E_NOTICE`, `E_USER_NOTICE`                                                           | `info`  |
| Obsolescencias — `E_DEPRECATED`, `E_USER_DEPRECATED`                                           | `debug` |

Las obsolescencias se quedan en `debug` para que un proyecto con unos cuantos miles de obsolescencias en `vendor` no entierre las advertencias y los errores que se informan junto a ellas.

Un diagnóstico que la máscara de [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) del script deja fuera no desaparece: baja a `trace`. Así que la máscara de siempre hace justo lo que esperas:

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

Con eso, las obsolescencias de `vendor` se quedan fuera del registro en cualquier nivel normal, y `level = "trace"` te las devuelve el día que quieras saber qué se estaba silenciando. Hay dos excepciones. Los errores fatales **nunca** bajan de nivel, diga lo que diga la máscara, porque son la única explicación de por qué se recicló un worker: un `error_reporting(0)` en un directorio de vendor no puede taparlos. `E_CORE_ERROR`/`E_CORE_WARNING` se lanzan antes de que un script pueda fijar máscara alguna, así que a ellos tampoco les llega ninguna.

::: info
Los diagnósticos van al registro, no dentro de las respuestas: Rapira pone [`display_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.display-errors) a `0` y [`log_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.log-errors) a `1` por defecto. Son *valores por defecto*, no imposiciones: si tu php.ini define cualquiera de los dos, manda el php.ini.
:::

## Registro desde la aplicación

`\Rapira\log()` escribe una entrada desde PHP en el target `app`. Recibe un mensaje, un nivel opcional y un array de contexto opcional, y está disponible en todos los modos de ejecución:

```php
<?php

\Rapira\log('order placed');
\Rapira\log('payment declined', \Rapira\LogLevel::Warning);
\Rapira\log('cache miss', \Rapira\LogLevel::Debug, ['key' => 'user:42', 'ttl' => 300]);
```

El nivel es un caso del enum `\Rapira\LogLevel`, y cada caso se corresponde con el nivel que ya usa el resto del registro:

| Caso de `LogLevel` | Nivel de la entrada |
| ------------------ | ------------------- |
| `Error`         | `error`      |
| `Warning`       | `warn`       |
| `Info`          | `info`       |
| `Debug`         | `debug`      |
| `Trace`         | `trace`      |

Si se omite el nivel, la entrada se escribe con `Info`. Como son los mismos niveles que en todo lo demás, `[log.targets]` y `RUST_LOG` filtran las entradas de la aplicación igual que las del propio servidor: `app = "debug"` en `[log.targets]` sube las entradas de la aplicación sin tocar nada a su alrededor.

El array de contexto se serializa a JSON y se adjunta a la entrada en un campo `context`. Las claves se conservan tal cual y los arrays anidados mantienen su estructura:

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

Un `Throwable` en el contexto se expande antes de serializar, porque `json_encode()` ve una excepción como un objeto vacío: su estado vive en propiedades privadas de `Exception` y `Error`. La expansión lleva el nombre de la clase, el mensaje, el código, el archivo y la línea, y recorre la cadena `previous`; la traza de pila no se incluye:

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

Conviene conocer dos límites al decidir qué poner en un contexto. Un valor que JSON no puede representar —un recurso, un closure, `NAN` o `INF`, una cadena que no es UTF-8 válido— se sustituye por un marcador en lugar de costarte la entrada, así que las claves de alrededor sí llegan. Y el contexto no tiene límite de tamaño: un array grande o una cadena larga se serializan enteros y producen una entrada igual de grande, así que pasa identificadores en vez de los objetos que identifican.

## Formatos

Los dos formatos se escriben en stderr, con una escritura por entrada. Esa regla de una sola escritura es lo que evita que el maestro y una docena de workers, todos escribiendo en el mismo descriptor de archivo, se mezclen a mitad de entrada: cada una se escribe entera en lugar de montarse a trozos.

Rapira no escribe en ningún otro sitio, así que redirigir el stderr del proceso es lo que lleva el registro a un archivo, y un gestor de servicios lo recoge sin ninguna configuración. Consulta [En producción](/es/docs/deployment) para más información.

**`plain`** está pensado para leerlo en un terminal: marca de tiempo, nivel, target y mensaje:

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

Sale coloreado cuando stderr es un terminal y nunca cuando lo rediriges a un archivo, así que un registro capturado queda limpio de secuencias de escape. Con [`NO_COLOR`](https://no-color.org/) puesta a cualquier valor no vacío el color se apaga incluso en un terminal.

**`json`** está pensado para un recolector de registros: un objeto por línea:

```text
{"timestamp":…,"level":"ERROR","message":…,"target":…}
```

`timestamp` es RFC 3339 en UTC con milisegundos. Los saltos de línea dentro de un mensaje van escapados, así que una entrada ocupa siempre exactamente una línea, incluida una traza de pila de PHP de varias líneas. Las entradas que salen del motor de proxy incorporado traen además campos `log.*` con la procedencia de la llamada. La salida JSON no lleva color nunca, haya terminal o no.

## `RUST_LOG`

`RUST_LOG` fija el filtro de registro desde el entorno, así que una sesión de depuración puntual no necesita editar la configuración:

```sh
RUST_LOG=info rapira serve worker.php
RUST_LOG=rapira=debug,php=info rapira serve worker.php
RUST_LOG=warn,rapira=trace rapira serve worker.php
```

La primera lo sube todo a `info`. La segunda apunta a dos sitios concretos: el target `rapira` en `debug` y PHP en `info`. La tercera calla a las dependencias en `warn` y sube el target `rapira` —arranque, vida de los workers, apagado— hasta `trace`. Los demás targets se nombran igual, cada uno por el suyo, así que añádelos cuando la pregunta esté en otra parte: `RUST_LOG=warn,rapira=trace,master=trace`.

::: warning
Cuando `RUST_LOG` trae un valor no vacío, **reemplaza** por completo a `level` y a `[log.targets]`: el filtro entero, sin mezclas. Tus entradas de `[log.targets]` no quedan debajo como una capa de fondo; sencillamente no se consultan. Deja la variable sin definir (o vacía) para volver a lo que diga la configuración. A `format` no le afecta nunca.
:::
