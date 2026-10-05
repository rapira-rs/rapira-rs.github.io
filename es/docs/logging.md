---
title: Registros
description: "Niveles de registro de Rapira, ajustes por target, diagnósticos de PHP, registros de la aplicación, formatos y la variable RUST_LOG."
---

# Registros

Rapira escribe los registros en stderr. Incluyen eventos del servidor, decisiones del proceso maestro, eventos HTTP y gRPC, diagnósticos PHP y mensajes de la aplicación. PHP envía sus diagnósticos a este registro cuando el ajuste ini `error_log` está vacío. Este es el valor predeterminado.

El nivel predeterminado es `error`, por lo que stderr solo contiene errores. Cambia la sección `[log]` o establece `RUST_LOG` para elegir otro nivel.

## Niveles y formato

La sección `[log]` de `rapira.toml` controla los registros de stderr:

```toml
[log]
level = "error"   # Use error, warn, info, debug, or trace. Default: error.
format = "plain"  # Use plain or json. Default: plain.
```

`level` establece el nivel mínimo para todos los targets. `error` muestra solo errores y cada nivel siguiente añade registros. `trace` muestra todos los registros. `format` selecciona líneas legibles o un objeto JSON por línea.

Las dos claves y la sección completa son opcionales. Consulta [Configuración](/es/docs/configuration) para ver las demás secciones del archivo de configuración.

## Ajustes por target

`[log.targets]` sustituye el nivel global para targets concretos. Por ejemplo, puede activar los registros de depuración de PHP y mantener desactivados los registros de depuración de HTTP:

```toml
[log]
level = "error"

[log.targets]
php = "debug"
http = "warn"
```

Cada clave nombra un target. Los demás targets usan `level`. La clave coincide **por prefijo**, por lo que `h2` también coincide con las rutas de módulo `h2::codec` y `h2::proto` de una dependencia. No necesitas enumerar submódulos.

Rapira usa estos targets:

| Target          | Qué cubre                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `rapira`        | la inicialización del servidor, el ciclo de vida de los workers, el apagado                     |
| `master`        | estado de pools, errores de creación de procesos, advertencias de disponibilidad durante recargas y de tiempo de espera de peticiones |
| `http`          | las escuchas HTTP, el tratamiento de los campos de petición y respuesta, el apagado             |
| `grpc`          | las escuchas gRPC, los fallos de transporte, el apagado                                         |
| `net`           | el bucle de aceptación de las escuchas HTTP y gRPC, los fallos de aceptación                    |
| `observability` | el [proceso de métricas y sondas](/es/docs/observability): la escucha, el drenaje de peticiones, los fallos |
| `php`           | la salida y los diagnósticos del propio PHP                                                     |
| `app`           | los registros que la aplicación escribe con `\Rapira\log()`                                     |

Rapira no escribe un registro de acceso con una línea por petición. La página [HTTP](/es/docs/http) enumera los registros de campos del target `http`.

Una dependencia escribe registros de traza bajo su ruta de módulo. El mismo filtro por prefijo se aplica a estos registros. Cada registro contiene el nombre de su target. Añade ese nombre a `[log.targets]` para cambiar su nivel.

::: tip
El target `master` informa del estado de pools, errores de creación de procesos, advertencias de disponibilidad durante recargas y de tiempo de espera de peticiones. Consulta [Modelo de procesos](/es/docs/process-model) para ver la supervisión de pools.
:::

## Diagnósticos de PHP

Rapira asigna los diagnósticos PHP al target `php`. Cada tipo de error de PHP se corresponde con un nivel de registro:

| Diagnóstico                                                                                    | Nivel   |
| ---------------------------------------------------------------------------------------------- | ------- |
| Errores fatales: `E_ERROR`, `E_PARSE`, `E_CORE_ERROR`, `E_COMPILE_ERROR`, `E_USER_ERROR`, `E_RECOVERABLE_ERROR` | `error` |
| Advertencias: `E_WARNING`, `E_CORE_WARNING`, `E_COMPILE_WARNING`, `E_USER_WARNING`            | `warn`  |
| Avisos: `E_NOTICE`, `E_USER_NOTICE`                                                           | `info`  |
| Obsolescencias: `E_DEPRECATED`, `E_USER_DEPRECATED`                                           | `debug` |

Las obsolescencias usan `debug`. Así, las obsolescencias de dependencias no ocultan las advertencias y los errores.

Rapira establece el nivel de un diagnóstico en `trace` cuando [`error_reporting`](https://www.php.net/manual/en/function.error-reporting.php) lo excluye. Por ejemplo:

```php
<?php
error_reporting(E_ALL & ~E_DEPRECATED & ~E_USER_DEPRECATED);
```

Esta máscara excluye las obsolescencias de dependencias. Establece `level = "trace"` para escribirlas.

PHP no escribe un diagnóstico enmascarado. En los modos Worker y Dispatcher, Rapira escribe el último diagnóstico PHP en puntos fijos. El modo Worker lo hace después de la ejecución de arranque, después de cada trabajo y cuando termina el script de entrada. El modo Dispatcher lo hace solo cuando termina el script de entrada. Por tanto, Rapira escribe un diagnóstico enmascarado solo cuando es el último diagnóstico antes de uno de estos puntos. El modo Classic no escribe diagnósticos enmascarados.

Los errores fatales siempre mantienen el nivel `error`, por lo que `error_reporting(0)` no los oculta. La máscara tampoco se aplica a `E_CORE_ERROR` y `E_CORE_WARNING`, porque PHP los genera antes de que un script pueda establecer una máscara.

::: info
Rapira envía los diagnósticos al registro, no a las respuestas. Establece el valor predeterminado de `display_errors` en `0` y el de `log_errors` en `1`. Un valor de `php.ini` sustituye estos valores predeterminados.
:::

La salida de PHP fuera de una respuesta va al target `php` con el nivel `info`. Por ejemplo, `echo` en la ejecución de arranque del modo Worker va al registro. En el [modo Dispatcher](/es/docs/dispatcher), toda la salida de `echo` va al registro, porque las respuestas usan la API del dispatcher. El nivel predeterminado `error` oculta estos registros. Establece `php = "info"` en `[log.targets]` para mostrarlos.

::: question ¿Por qué una advertencia de PHP aparece dos veces en el registro?
En los modos Worker y Dispatcher, Rapira también escribe el último diagnóstico PHP. Si este diagnóstico no está enmascarado, PHP también lo escribe. Por tanto, el registro contiene dos registros con el mismo nivel y distintos formatos de texto.
:::

## Registro desde la aplicación

`\Rapira\log()` escribe un registro en el target `app`. Recibe un mensaje, un nivel opcional y un array de contexto opcional. La función está disponible en todos los modos de ejecución:

```php
<?php

\Rapira\log('order placed');
\Rapira\log('payment declined', \Rapira\LogLevel::Warning);
\Rapira\log('cache miss', \Rapira\LogLevel::Debug, ['key' => 'user:42', 'ttl' => 300]);
```

El nivel es un caso del enum `\Rapira\LogLevel`. Cada caso se corresponde con un nivel de registro de Rapira:

| Caso de `LogLevel` | Nivel del registro  |
| ------------------ | ------------------- |
| `Error`         | `error`      |
| `Warning`       | `warn`       |
| `Info`          | `info`       |
| `Debug`         | `debug`      |
| `Trace`         | `trace`      |

`\Rapira\log()` usa `Info` cuando omites `level`. El nivel predeterminado `error` oculta los registros `Info`. Establece `app = "info"` en `[log.targets]` para escribirlos.

Rapira codifica el array de contexto como texto JSON y lo añade como campo `context`. En la salida JSON, `fields.context` es una cadena, no un objeto anidado. El texto JSON conserva los nombres de clave y la estructura de los arrays anidados. Decodifica esta cadena en el recolector de registros para leer las claves:

```php
<?php

\Rapira\log('checkout failed', \Rapira\LogLevel::Error, [
    'order' => 41,
    'totals' => ['net' => 1250, 'tax' => 250],
]);
```

Rapira expande un `Throwable` que es un valor de primer nivel del contexto. Lo hace porque `json_encode()` devuelve un objeto vacío para un `Throwable`. Rapira no expande un `Throwable` dentro de un array anidado, por lo que lo codifica como un objeto vacío. El valor expandido contiene la clase, el mensaje, el código, el archivo y la línea. También contiene hasta cuatro excepciones `previous`. No contiene la traza de la pila:

```php
<?php

try {
    $gateway->charge($order);
} catch (\Throwable $e) {
    \Rapira\log('charge failed', \Rapira\LogLevel::Error, ['exception' => $e]);
}
```

`\Rapira\log()` no lanza excepciones. Si una llamada a `jsonSerialize()` del contexto lanza una excepción, Rapira escribe `null` para ese valor. Conserva las demás claves.

::: question ¿Cómo serializa Rapira los contextos de registro grandes?
Rapira codifica el contexto con la opción `JSON_PARTIAL_OUTPUT_ON_ERROR`. Un recurso o una cadena UTF-8 no válida se convierte en `null`. `NAN` e `INF` se convierten en `0`. Los demás campos se mantienen en el registro.

Rapira no acorta los arrays ni las cadenas. Pasa identificadores en lugar de objetos grandes.
:::

## Formatos

Rapira escribe ambos formatos en stderr. Los registros grandes de distintos procesos pueden intercalarse cuando estos procesos escriben en la misma tubería de stderr.

Redirige stderr para escribir los registros en un archivo. Un gestor de servicios puede recoger stderr. Consulta [En producción](/es/docs/deployment) para más información.

**`plain`** es una salida legible para el terminal. Contiene una marca de tiempo, el nivel, el target y el mensaje:

```text
2026-07-30T09:12:34.567890Z ERROR php: …
```

Rapira usa colores solo cuando stderr es un terminal. Establece [`NO_COLOR`](https://no-color.org/) en un valor no vacío para desactivar los colores del terminal.

**`json`** da un objeto por línea para un recolector de registros:

```text
{"timestamp":…,"level":"ERROR","fields":{"message":…},"target":…}
```

`timestamp` usa RFC 3339, UTC y microsegundos. El objeto `fields` contiene el mensaje y otros campos del registro. Por ejemplo, puede contener el campo `context` de la aplicación. Rapira escapa los saltos de línea de los mensajes, como las trazas de pila de PHP. Por tanto, cada registro ocupa exactamente una línea. La salida JSON no usa colores.

## `RUST_LOG`

`RUST_LOG` establece el filtro de registros de stderr desde el entorno. Los comandos siguientes cambian el filtro y no modifican el archivo de configuración:

```sh
RUST_LOG=info rapira serve rapira.toml
RUST_LOG=error,rapira=debug,php=info rapira serve rapira.toml
RUST_LOG=warn,rapira=trace,master=trace rapira serve rapira.toml
```

El primer comando establece todos los targets en `info`. El segundo establece `rapira` en `debug`, `php` en `info` y todos los demás targets en `error`. El tercero establece todos los targets en `warn`, y `rapira` y `master` en `trace`.

Un target que el valor no cubre no escribe registros. Por ejemplo, `RUST_LOG=php=info` oculta todos los errores de los targets `master` y `http`. Añade un nivel sin nombre de target, como `error`, para mantener los registros de los demás targets.

::: warning
Un valor no vacío de `RUST_LOG` **sustituye** `level` y `[log.targets]`. Rapira no combina los filtros del entorno y del archivo. Elimina la variable para usar los ajustes del archivo de configuración. También puedes establecer la variable en un valor vacío. `RUST_LOG` no afecta a `format`.
:::
