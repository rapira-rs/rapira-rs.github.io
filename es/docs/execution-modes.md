---
title: Modos de ejecución
description: "Los tres modos de ejecución de Rapira: qué hacen Classic, Worker y Dispatcher, cómo se selecciona uno y cómo leer desde PHP el modo actual."
faqLevel: 2
---

# Modos de ejecución

Rapira ejecuta PHP en uno de sus tres modos de ejecución. Los tres modos están disponibles.

| Modo | Estado | Descripción |
| --- | --- | --- |
| [Classic](/es/docs/classic) | Disponible | El script de entrada se ejecuta desde cero en cada petición, igual que con php-fpm. |
| [Worker](/es/docs/worker) | Disponible | Un script residente arranca una vez y atiende las peticiones en un bucle; las superglobales se vuelven a rellenar en cada petición. |
| Dispatcher | Disponible | El worker pide cada petición mediante una llamada a la API y trabaja con ella como un valor, no a través de las superglobales. |

Los nombres de los modos son los valores de `pool.mode` y los casos del enum `Rapira\Mode`. Classic descarta el estado que crea el script durante una petición. Worker y Dispatcher mantienen viva una misma aplicación durante muchas peticiones. El estado y las dependencias de la aplicación determinan qué modos puede usar.

## Classic <Badge type="tip" text="disponible" />

El script de entrada se ejecuta en una petición PHP nueva, como en php-fpm. Rapira rellena las superglobales y ejecuta el script.
Después, Rapira envía la respuesta y elimina el estado de la petición. Las conexiones persistentes y el estado de las extensiones permanecen en el proceso worker.

Una aplicación existente puede funcionar sin cambios en el código. Rapira integra PHP en el proceso del servidor y no usa FastCGI.

Consulta [Modo Classic](/es/docs/classic) para más información.

## Worker <Badge type="tip" text="disponible" />

Worker usa las mismas interfaces de petición y respuesta que Classic. La aplicación lee las superglobales y puede usar `echo`.
El worker permanece activo después de una petición. Inicializa el script una vez y después entra en un bucle.
Para cada petición, Rapira rellena las superglobales y ejecuta el handler. Los objetos externos al bucle permanecen disponibles.

La aplicación se inicializa una vez por worker y no una vez por petición. Esto puede reducir el tiempo de ejecución.
Las propiedades estáticas, los singletons y el estado global permanecen para la siguiente petición.
Rapira puede sustituir un worker después de un número determinado de peticiones. Esta sustitución limita el efecto de una fuga de memoria.

En [Modo Worker](/es/docs/worker) está el script del worker y su bucle; en [Configuración](/es/docs/configuration), el límite de reciclado; y en [HTTP](/es/docs/http), cómo se manejan las peticiones y las respuestas.

## Dispatcher <Badge type="tip" text="disponible" />

En Dispatcher, el script del worker solicita cada unidad mediante una llamada a la API. `Rapira\get_dispatcher()` devuelve el dispatcher del pool.
`receive(int $timeout = -1)` espera la siguiente unidad. El límite usa microsegundos y `-1` lo desactiva.
Un límite agotado lanza `Rapira\Exception\TimeoutException`. `tryReceive()` devuelve una unidad o `null` sin esperar.
Con el plugin HTTP, cada unidad es un `Rapira\Http\Exchange`.
Su método `getRequest()` devuelve un `Rapira\Http\Request` con el método, objetivo, cabeceras, cuerpo y direcciones.
Los métodos `writeHead()`, `writeBody()` y `sendFile()` escriben la respuesta.

La aplicación puede pasar el objeto de petición a funciones o middleware. Rapira no rellena las superglobales en este modo.
Una aplicación que usa superglobales necesita Worker. También puede usar un adaptador para copiar los datos.
Selecciona el modo con `pool.mode` o `--mode`.

El script controla el número de unidades de trabajo activas. Un bucle secuencial procesa una unidad cada vez.
Llama a `receive()`, responde a la petición y vuelve a llamar a `receive()`.
Un script concurrente inicia una [fibra](https://www.php.net/manual/en/language.fibers.php) por petición. Llama a `tryReceive()` mientras haya fibras activas.
Cuando no hay fibras activas, el bucle espera en `receive()`. Procesa una unidad cada vez si una biblioteca no admite fibras.

::: info
Dispatcher es el valor predeterminado de `pool.mode`. Todavía no tiene una guía propia.
[`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) documenta las interfaces `Dispatcher` y `Work`.
[`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_http.stub.php) documenta los tipos HTTP.
[`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) contiene `dispatcher-sync.php` y `dispatcher-async.php`.
:::

## Leer el modo en tiempo de ejecución

`Rapira\get_mode()` devuelve el modo del proceso como un caso de `Rapira\Mode`. Los casos son `Classic`, `Worker` y `Dispatcher`.
El caso coincide con el `pool.mode` inicial y no cambia durante el proceso. Compara los casos con `===`.
La función no recibe argumentos ni lanza excepciones. Un script de entrada puede usarla para admitir varios modos:

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
El host lee `pool.mode` y fija el modo antes de iniciar el intérprete. Todas las peticiones del worker devuelven el mismo caso.
Reinicia el servidor para cambiar el modo.
:::

## Selección del modo

El valor por defecto de `pool.mode` es `dispatcher`. Fija el modo de forma explícita en `rapira.toml`, o con `--mode` en la línea de comandos.

```toml
[pool]
entrypoint = "public/index.php"
mode = "classic"                      # Use "classic", "worker", or "dispatcher". Default: "dispatcher".
```

```sh
rapira serve --mode classic public/index.php
```

Rapira ofrece los tres modos a cada aplicación. El código y las dependencias de la aplicación pueden limitar la selección.
Usa Classic si el estado global no puede permanecer entre peticiones. El código que usa superglobales necesita un adaptador para Dispatcher.
Algunas integraciones de frameworks admiten Worker. Consulta [Frameworks](/es/docs/frameworks/).

El modo se aplica a toda la instancia, no a rutas individuales. Una instancia no puede usar distintos modos.
Ejecuta las rutas incompatibles en otra instancia Classic.

Worker y Dispatcher necesitan un script de entrada persistente. Classic no lo necesita.
Para seleccionar Classic, establece `mode = "classic"` o pasa `--mode classic`. Después especifica el script normal.
El servidor, el binario y el [modelo de procesos](/es/docs/process-model) no cambian.
Consulta [Configuración](/es/docs/configuration) y la [referencia CLI](/es/docs/cli).

::: tip
Empieza con Classic cuando sustituyas php-fpm. Comprueba el funcionamiento de la aplicación.
Selecciona Worker después de comprobar la inicialización y el estado entre peticiones.
:::
