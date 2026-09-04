---
title: Registros
description: "Cómo registra Rapira - niveles, ajustes por target, diagnósticos de PHP, registro desde la aplicación, los formatos plain y JSON, y la variable RUST_LOG para depurar."
---

# Registros

Rapira escribe todos los registros en stderr. Incluyen eventos del servidor, decisiones del proceso maestro, eventos HTTP, diagnósticos PHP y mensajes de la aplicación. Rapira envía los diagnósticos PHP a este registro en lugar de un destino `error_log` separado. El filtro de nivel configurado determina qué registros escribe.

El nivel predeterminado es `error`, por lo que el servidor solo escribe errores. Cambia la configuración o establece `RUST_LOG` para elegir otro nivel.

## Niveles y formato

La sección `[log]` de `rapira.toml` controla los registros:

```toml
[log]
level = "error"   # Use error, warn, info, debug, or trace. Default: error.
format = "plain"  # Use plain or json. Default: plain.
```

`level` establece el nivel mínimo para todos los targets. `error` muestra solo errores y cada nivel siguiente añade registros. `trace` muestra todos los registros. `format` selecciona líneas legibles o un objeto JSON por línea.

Las dos claves y la sección completa son opcionales. Consulta [Configuración](/es/docs/configuration) para ver las demás secciones.

## Ajustes por target

`[log.targets]` sustituye el nivel global para targets concretos. Por ejemplo, puede activar la depuración de PHP sin activar la de HTTP:

```toml
[log]
level = "error"

[log.targets]
php = "debug"
http = "warn"
```

Cada clave nombra un target. Los demás targets usan `level`. La clave coincide **por prefijo**, por lo que `php` también coincide con `php_sys` y `php_sys::callbacks`. No necesitas enumerar submódulos.

Estos son los targets bajo los que emite el propio Rapira:

| Target   | Qué cubre                                                       |
| -------- | --------------------------------------------------------------- |
| `rapira` | el ciclo de vida del servidor: arranque, vida de los workers, apagado |
| `master` | la supervisión: forks, recogida de procesos, reinicios, recargas, escalado del pool |
| `http`   | el frontal HTTP: los sockets de escucha, el tratamiento de los campos de petición y respuesta, el drenaje |
| `ext`    | cómo acaban las tareas de las extensiones                       |
| `php`    | la salida y los diagnósticos que vienen del propio PHP          |
| `app`    | las entradas que la aplicación escribe con `\Rapira\log()`      |

Rapira no escribe un registro de acceso por petición. Los registros del target `http` se describen en [HTTP](/es/docs/http).

Una dependencia escribe trazas bajo su ruta de módulo. Se aplica el mismo filtro por prefijo. Cada registro contiene el nombre del target. Añade ese nombre a `[log.targets]` para reducir su salida.

::: tip
El target `master` contiene sustituciones de workers, recargas y escalado. Consulta [Modelo de procesos](/es/docs/process-model) para ver estos eventos.
:::

## Diagnósticos de PHP

Rapira asigna los diagnósticos PHP al target `php`. El tipo de error determina el nivel:

| Diagnóstico                                                                                    | Nivel   |
| ---------------------------------------------------------------------------------------------- | ------- |
| Errores fatales - `E_ERROR`, `E_PARSE`, `E_CORE_ERROR`, `E_COMPILE_ERROR`, `E_USER_ERROR`, `E_RECOVERABLE_ERROR` | `error` |
| Advertencias - `E_WARNING`, `E_CORE_WARNING`, `E_COMPILE_WARNING`, `E_USER_WARNING`            | `warn`  |
| Avisos - `E_NOTICE`, `E_USER_NOTICE`                                                           | `info`  |
| Obsolescencias - `E_DEPRECATED`, `E_USER_DEPRECATED`                                           | `debug` |

Las obsolescencias usan `debug`. Así, muchos mensajes de dependencias no ocultan las advertencias y los errores.

Un diagnóstico excluido por [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) cambia a `trace`. Por ejemplo:

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

Esta máscara excluye las obsolescencias de dependencias en niveles normales. Establece `level = "trace"` para incluirlas. Los errores fatales no bajan de nivel porque explican la terminación de un worker. Por tanto, `error_reporting(0)` no los oculta. PHP genera `E_CORE_ERROR` y `E_CORE_WARNING` antes de establecer la máscara. La máscara no se aplica a ellos.

::: info
Rapira envía los diagnósticos al registro, no a las respuestas. Los valores predeterminados son `display_errors = 0` y `log_errors = 1`. Los valores de `php.ini` sustituyen estos valores predeterminados.
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

`\Rapira\log()` usa `Info` cuando se omite `level`. El filtro global `error` descarta este registro a menos que se cambie el filtro. `[log.targets]` y `RUST_LOG` filtran igual los registros de la aplicación y del servidor. Por ejemplo, `app = "debug"` cambia solo el target de la aplicación.

Rapira serializa el array de contexto a JSON y lo añade como campo `context`. En JSON, este campo está dentro de `fields`. Conserva los nombres de clave y la estructura de los arrays anidados:

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

Rapira expande un `Throwable` antes de serializarlo porque `json_encode()` devuelve un objeto vacío. El valor contiene la clase, el mensaje, el código, el archivo, la línea y la cadena `previous`. No contiene la traza:

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

`\Rapira\log()` no lanza excepciones. Si `jsonSerialize()` lanza una excepción, Rapira escribe `null` para ese valor. Conserva las demás claves.

Rapira sustituye los valores que JSON no puede representar. Incluyen recursos, closures, `NAN`, `INF` y cadenas UTF-8 no válidas. Conserva los demás campos. Rapira no limita el tamaño del contexto. Pasa identificadores en lugar de objetos grandes.

## Formatos

Rapira escribe ambos formatos en stderr. Los registros grandes de distintos procesos pueden intercalarse cuando estos procesos escriben en la misma tubería de stderr.

Rapira no escribe registros en otros destinos. Redirige stderr para escribirlos en un archivo. Un gestor de servicios puede recoger stderr. Consulta [En producción](/es/docs/deployment).

**`plain`** está pensado para leerlo en un terminal: marca de tiempo, nivel, target y mensaje:

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

Rapira usa colores cuando stderr es un terminal. No usa colores cuando stderr es un archivo. Establece [`NO_COLOR`](https://no-color.org/) en un valor no vacío para desactivar los colores del terminal.

**`json`** está pensado para un recolector de registros: un objeto por línea:

```text
{"timestamp":…,"level":"ERROR","fields":{"message":…},"target":…}
```

`timestamp` usa RFC 3339, UTC y milisegundos. El objeto `fields` contiene el mensaje y otros campos. Rapira escapa los saltos de línea. Por tanto, cada registro ocupa una línea. La salida JSON no usa colores.

## `RUST_LOG`

`RUST_LOG` establece el filtro desde el entorno. Permite cambiarlo sin editar la configuración:

```sh
RUST_LOG=info rapira serve --mode worker worker.php
RUST_LOG=rapira=debug,php=info rapira serve --mode worker worker.php
RUST_LOG=warn,rapira=trace rapira serve --mode worker worker.php
```

El primer comando establece todos los targets en `info`. El segundo establece `rapira` en `debug` y `php` en `info`. El tercero establece todos los targets en `warn` y `rapira` en `trace`. El target `rapira` contiene registros de inicialización, workers y apagado. Cuando necesites registros del maestro, usa `RUST_LOG=warn,rapira=trace,master=trace`.

::: warning
Un valor no vacío de `RUST_LOG` **sustituye** `level` y `[log.targets]`. Rapira no combina los filtros del entorno y del archivo. Elimina la variable o usa un valor vacío para aplicar el archivo. `RUST_LOG` no afecta a `format`.
:::
