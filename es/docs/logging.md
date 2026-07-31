---
title: Registros
description: Cómo registra Rapira — niveles, ajustes por target, diagnósticos de PHP, los formatos plain y JSON, y la variable RUST_LOG para depurar.
---

# Registros

Rapira lo escribe todo en un único flujo: los eventos del ciclo de vida del servidor, las decisiones de supervisión del proceso maestro, el frontal HTTP y los diagnósticos de PHP. Todo por stderr y todo pasado por el mismo filtro. PHP no es una excepción: una advertencia de PHP no es algo que tengas que ir a buscar a un `error_log` aparte, es una entrada más del mismo registro que todo lo demás, y le subes o le bajas el nivel igual que a cualquier otra.

El valor por defecto es callado a propósito. De fábrica solo pasa `error`, porque un servidor que escribe sin parar en producción produce un registro que no lee nadie. Subir el nivel es una línea de configuración y, si no quieres tocar la configuración para nada, tienes una variable de entorno.

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

Un único nivel global suele quedarse corto. Cuando vas detrás de un problema en PHP quieres los diagnósticos de PHP en `debug`, pero sin subir a la vez cada detalle interno de la pila HTTP. Para eso está `[log.targets]`:

```toml
[log]
level = "error"

[log.targets]
php = "debug"
pingora_core = "warn"
```

Cada clave nombra un target y sube o baja solo ese; todo lo demás se queda en `level`. La coincidencia es **por prefijo**, así que `php` cubre también `php_sys` y `php_sys::callbacks`: escribes el prefijo más corto que abarque lo que te interesa y nunca tienes que enumerar submódulos.

Estos son los targets bajo los que emite el propio Rapira:

| Target   | Qué cubre                                                       |
| -------- | --------------------------------------------------------------- |
| `rapira` | el ciclo de vida del servidor: arranque, vida de los workers, apagado |
| `master` | la supervisión: forks, recogida de procesos, reinicios, recargas, escalado del pool |
| `http`   | el frontal HTTP: los sockets de escucha, el tratamiento de los campos de petición y respuesta, el drenaje |
| `ext`    | cómo acaban las tareas de las extensiones                       |
| `php`    | la salida y los diagnósticos que vienen del propio PHP          |

Las dependencias registran bajo su propia ruta de módulo —`pingora_core`, `tokio` y las demás— y se filtran exactamente igual. Si en tus registros asoma una biblioteca ruidosa, el nombre de su target está ahí mismo, en la propia entrada, listo para usarlo en `[log.targets]`.

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

Las obsolescencias se quedan en `debug` para que un proyecto con unos cuantos miles de obsolescencias en `vendor` no entierre las dos advertencias que de verdad necesitabas ver.

Un diagnóstico que la máscara de [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) del script deja fuera no desaparece: baja a `trace`. Así que la máscara de siempre hace justo lo que esperas:

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

Con eso, las obsolescencias de `vendor` se quedan fuera del registro en cualquier nivel normal, y `level = "trace"` te las devuelve el día que quieras saber qué se estaba silenciando. Hay dos excepciones que conviene conocer. Los errores fatales **nunca** bajan de nivel, diga lo que diga la máscara: son la única explicación de por qué se recicló un worker, y un `error_reporting(0)` enterrado en un directorio de vendor no puede taparla. Y `E_CORE_ERROR`/`E_CORE_WARNING` se lanzan antes de que un script pueda fijar máscara alguna, así que a ellos tampoco les llega ninguna.

::: info
Los diagnósticos van al registro, no dentro de las respuestas. Rapira pone [`display_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.display-errors) a `0` y [`log_errors`](https://www.php.net/manual/en/errorfunc.configuration.php#ini.log-errors) a `1` por defecto: un servidor no debería filtrar trazas de pila dentro de una página. Son *valores por defecto*, no imposiciones: si tu php.ini define cualquiera de los dos, manda el php.ini.
:::

## Formatos

Los dos formatos se escriben en stderr, con una escritura por entrada. Esa regla de una sola escritura es lo que evita que el maestro y una docena de workers, todos escribiendo en el mismo descriptor de archivo, se mezclen a mitad de entrada: cada una se escribe entera en lugar de montarse a trozos.

**`plain`** es el que quieres en un terminal: marca de tiempo, nivel, target y mensaje:

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

Sale coloreado cuando stderr es un terminal y nunca cuando lo rediriges a un archivo, así que un registro capturado queda limpio de secuencias de escape. Con [`NO_COLOR`](https://no-color.org/) puesta a cualquier valor no vacío el color se apaga incluso en un terminal.

**`json`** es el que quieres delante de un recolector de registros: un objeto por línea:

```text
{"timestamp":…,"level":"ERROR","message":…,"target":…}
```

`timestamp` es RFC 3339 en UTC con milisegundos. Los saltos de línea dentro de un mensaje van escapados, así que una entrada ocupa siempre exactamente una línea y una traza de pila de PHP de varias líneas no acaba convertida en cuatro que nadie puede parsear. Las entradas que salen del motor de proxy incorporado traen además campos `log.*` con la procedencia de la llamada. La salida JSON no lleva color nunca, haya terminal o no.

## `RUST_LOG`

Editar un archivo de configuración para responder a una sola pregunta y luego dejarlo como estaba es un ciclo penoso, así que hay una variable de entorno que se lo salta:

```sh
RUST_LOG=info rapira serve worker.php
RUST_LOG=rapira=debug,php=info rapira serve worker.php
RUST_LOG=warn,rapira=trace rapira serve worker.php
```

La primera lo sube todo a `info`. La segunda apunta a dos sitios concretos: el target `rapira` en `debug` y PHP en `info`. La tercera calla a las dependencias en `warn` y sube el target `rapira` —arranque, vida de los workers, apagado— hasta `trace`. Los demás targets se nombran igual, cada uno por el suyo, así que añádelos cuando la pregunta esté en otra parte: `RUST_LOG=warn,rapira=trace,master=trace`.

::: warning
Cuando `RUST_LOG` trae un valor no vacío, **reemplaza** por completo a `level` y a `[log.targets]`: el filtro entero, sin mezclas. Tus entradas de `[log.targets]` no quedan debajo como una capa de fondo; sencillamente no se consultan. Deja la variable sin definir (o vacía) para volver a lo que diga la configuración. A `format` no le afecta nunca.
:::

::: question Mis registros están vacíos, ¿se ha roto algo?
Casi seguro que no: `level` vale `error` por defecto, así que un servidor sano no registra nada. Arráncalo con `RUST_LOG=info` y verás el arranque, la escucha y la vida de los workers.
:::

::: question ¿Cómo escribo los registros en un archivo?
Redirige el stderr del proceso. Rapira solo escribe ahí, y eso significa además que un gestor de servicios te los recoge sin que configures nada: lo tienes en [En producción](/es/docs/deployment).
:::

::: question ¿Por qué sigo viendo una obsolescencia que enmascaré con `error_reporting()`?
Los diagnósticos enmascarados bajan a `trace` en vez de desaparecer, así que solo reaparecen con `level = "trace"`. Si estás corriendo en `trace` y no los quieres ver, sube el nivel.
:::

::: question ¿Hay un registro de accesos?
No: no existe ningún registro con una línea por petición. El target `http` informa de los sockets de escucha, del drenaje y de cualquier cosa rara en los campos de una petición o de una respuesta; qué hace con ellos lo tienes en [HTTP](/es/docs/http).
:::
