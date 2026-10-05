---
title: Modos de ejecución
description: "Comportamiento, selección e identificación en tiempo de ejecución de los modos Classic, Worker y Dispatcher."
faqLevel: 2
---

# Modos de ejecución

El pool HTTP ejecuta PHP en uno de tres modos de ejecución. El [pool gRPC](./grpc) usa el modo Dispatcher.

| Modo | Descripción |
| --- | --- |
| [Classic](/es/docs/classic) | El script de entrada se ejecuta cada vez en una petición PHP nueva, como en php-fpm. |
| [Worker](/es/docs/worker) | Un script persistente atiende las peticiones en un bucle. Rapira vuelve a rellenar las superglobales en cada petición. |
| [Dispatcher](/es/docs/dispatcher) | El worker recibe cada petición mediante una llamada a la API y usa un objeto de petición en lugar de las superglobales. |

Los nombres de los modos son los valores de `http.pool.mode` y los casos del enum `Rapira\Mode`. Classic elimina el estado de petición de la aplicación después de cada petición. Worker y Dispatcher mantienen una misma aplicación inicializada durante muchas peticiones. El estado y las dependencias de la API de la aplicación determinan qué modos puede usar.

## Classic

El script de entrada se ejecuta cada vez en una petición PHP nueva, como en php-fpm. Rapira rellena las superglobales, ejecuta el script, envía la respuesta y después elimina el estado de la petición. Las conexiones persistentes y el estado de las extensiones permanecen, porque existen en el proceso worker.

Una aplicación existente puede funcionar sin cambios en el código cuando Rapira sustituye a php-fpm. Rapira integra PHP en el proceso del servidor y no usa FastCGI.

Consulta [Modo Classic](/es/docs/classic) para más información.

## Worker

El modo Worker usa las mismas interfaces de petición y respuesta que Classic. La aplicación lee las superglobales y puede usar `echo` para la respuesta. El script del worker inicializa la aplicación una vez y después entra en un bucle. Para cada petición, Rapira vuelve a rellenar las superglobales y ejecuta el handler. Los objetos que el script crea fuera del bucle permanecen disponibles.

La inicialización se ejecuta una vez por worker, no una vez por petición. Esto puede reducir el tiempo de la petición. Sin embargo, las propiedades estáticas, los singletons y el estado global permanecen para la siguiente petición. Establece [`http.pool.max_requests`](/es/docs/configuration) para sustituir un worker después de un número de peticiones. Esto limita el efecto de una fuga de memoria.

Consulta [Modo Worker](/es/docs/worker) para ver el script del worker y su bucle. Consulta [HTTP](/es/docs/http) para ver cómo Rapira maneja las peticiones y las respuestas.

## Dispatcher

En modo Dispatcher, el script del worker recibe cada unidad de trabajo mediante una llamada a la API. `Rapira\get_dispatcher()` devuelve el dispatcher del pool, y su método `receive()` espera la siguiente unidad. Con el plugin HTTP, cada unidad es un `Rapira\Http\Exchange`. El exchange da un objeto `Rapira\Http\Request` y tiene métodos que escriben la respuesta. Con el plugin gRPC, cada unidad es una `Rapira\Grpc\UnaryCall`.

La aplicación puede pasar el objeto de petición a funciones o middleware. Rapira no rellena las superglobales en este modo. Una aplicación que lee superglobales necesita el modo Worker, o un adaptador que copie los datos de la petición a estas variables. `echo` y otras salidas de PHP no van al cliente. Rapira escribe esta salida en el log con el target `php` y el nivel `info`.

Cada worker procesa una unidad de trabajo cada vez. Finaliza la unidad actual antes de volver a llamar a `receive()`. Para procesar más peticiones al mismo tiempo, aumenta `http.pool.processes`.

Consulta [Modo Dispatcher](/es/docs/dispatcher) para ver el bucle, la API de petición y respuesta y las excepciones. Consulta [gRPC](/es/docs/grpc) para ver la API de llamadas gRPC.

## `$_SERVER` antes de la primera petición

En los modos Worker y Dispatcher, el script de entrada arranca antes de la primera petición. En ese momento, Rapira rellena `$_SERVER` igual que PHP CLI para `php entrypoint.php`.

| Clave | Valor |
| --- | --- |
| Cada variable del entorno del proceso | El valor del entorno |
| `PHP_SELF`, `SCRIPT_NAME`, `SCRIPT_FILENAME`, `PATH_TRANSLATED` | La ruta absoluta del script de entrada |
| `DOCUMENT_ROOT` | Una cadena vacía |
| `REQUEST_TIME`, `REQUEST_TIME_FLOAT` | La hora de inicio del script de entrada |
| `argv` | Una lista que contiene la ruta absoluta del script de entrada |
| `argc` | `1` |

`$_SERVER` recibe las variables de entorno cuando `variables_order` contiene `S`. `$_ENV` las recibe solo cuando `variables_order` contiene `E`. El valor de producción `GPCS` no contiene `E`. La ruta del script de entrada sustituye a una variable de entorno con el mismo nombre, como `SCRIPT_FILENAME`. Las variables globales `$argv` y `$argc` contienen los mismos valores que `$_SERVER`.

En modo Dispatcher, `$_SERVER` conserva estos valores hasta que el script de entrada arranca de nuevo. Los datos de la petición están en el objeto de petición. En modo Worker, Rapira vuelve a rellenar `$_SERVER` con los datos de cada petición. Los valores de la petición no contienen las variables de entorno, y `SCRIPT_NAME` contiene el nombre del script de entrada con una barra inicial.

## Leer el modo en tiempo de ejecución

`Rapira\get_mode()` devuelve el modo del proceso como un caso del enum `Rapira\Mode`. Los casos son `Classic`, `Worker` y `Dispatcher`. El caso es el modo del pool del worker y no cambia mientras el proceso está en marcha. La función no recibe argumentos y no lanza excepciones. Un script de entrada puede usarla para admitir más de un modo.

```php
<?php
// entry.php

use Rapira\Mode;

$app = require __DIR__ . '/bootstrap.php';

match (\Rapira\get_mode()) {
    Mode::Classic => $app->handleOnce(),
    Mode::Worker => $app->runWorkerLoop(),
    Mode::Dispatcher => $app->runDispatcherLoop(),
};
```

::: question ¿Por qué el modo no cambia nunca mientras el proceso está en marcha?
Rapira lee el modo del pool antes de iniciar el intérprete. Todas las peticiones de ese worker devuelven el mismo caso. Una recarga no vuelve a leer `rapira.toml`. Para cambiar el modo, reinicia Rapira.
:::

## Selección del modo

La clave `mode` de la tabla del pool selecciona el modo. El valor por defecto es `dispatcher`. Establece el modo de forma explícita en `rapira.toml`.

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"                      # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
```

```sh
rapira serve rapira.toml
```

El pool HTTP admite los tres modos. El pool gRPC admite solo `dispatcher`. Otro valor de `grpc.pool.mode` detiene Rapira en el arranque con un error.

En los modos Worker y Dispatcher, el script de entrada debe recibir las peticiones en un bucle. Si el script termina antes de recibir una petición, el arranque falla. Un script de entrada normal de php-fpm falla de esta forma con el modo por defecto. Consulta [Modelo de procesos](/es/docs/process-model) para ver qué hace Rapira después de un arranque fallido.

El código y las dependencias de la aplicación pueden limitar la selección. Usa Classic si el estado global no puede permanecer entre peticiones. El código que lee superglobales no puede usar Dispatcher sin un adaptador. Algunas integraciones de frameworks admiten el modo Worker. Consulta [Frameworks](/es/docs/frameworks/) para ver las integraciones documentadas.

El modo se aplica a un pool completo, así que todas las rutas de ese pool usan el mismo modo. Los pools HTTP y gRPC pueden usar modos distintos en un mismo servidor. Ejecuta las rutas HTTP incompatibles en otra instancia de Rapira en modo Classic. Consulta [Configuración](/es/docs/configuration) y la [referencia CLI](/es/docs/cli) para más información.

::: tip
Empieza con Classic cuando sustituyas php-fpm. Comprueba que la aplicación funciona correctamente. Selecciona Worker después de confirmar que la aplicación se inicializa correctamente y no conserva estado de la petición.
:::
