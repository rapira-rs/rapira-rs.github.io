---
title: Modos de ejecución
description: "Los tres modos de ejecución de Rapira: qué hacen Classic, Worker y Dispatcher, cómo se selecciona uno y cómo leer desde PHP el modo actual."
faqLevel: 2
---

# Modos de ejecución

Rapira ejecuta PHP en uno de sus tres modos de ejecución. Los tres están disponibles hoy.

| Modo | Estado | Descripción |
| --- | --- | --- |
| [Classic](/es/docs/classic) | Disponible | El script de entrada se ejecuta desde cero en cada petición, igual que con php-fpm. |
| [Worker](/es/docs/worker) | Disponible | Un script residente arranca una vez y atiende las peticiones en un bucle; las superglobales se vuelven a rellenar en cada petición. |
| Dispatcher | Disponible | El worker pide cada petición mediante una llamada a la API y trabaja con ella como un valor, no a través de las superglobales. |

Los nombres de los modos son los valores de `pool.mode` en el archivo de configuración y los casos del enum `Rapira\Mode` en PHP. La lista va ordenada según cuánto control tiene PHP sobre el ciclo de vida de la petición. Classic descarta al final de cada petición todo lo que haya creado el script. Worker y Dispatcher mantienen viva una misma aplicación ya arrancada durante muchas peticiones, así que le exigen más al código.

## Classic <Badge type="tip" text="disponible" />

El script de entrada se ejecuta desde cero en cada petición, igual que haría con php-fpm: se rellenan las superglobales, arranca el front controller, sale la respuesta y todo se destruye. No se arrastra nada de lo que crea el script, así que el estado de la aplicación no puede filtrarse de una petición a la siguiente. Valen las mismas excepciones que con php-fpm: las conexiones persistentes y el estado que vive dentro de una extensión están en el proceso worker, no en la petición.

Una aplicación que ya existe funciona tal cual, porque Rapira ocupa el lugar de php-fpm sin que toques el código. PHP va incrustado en el proceso del servidor, así que no hay ningún salto FastCGI entre el frontal HTTP y el intérprete.

Consulta [Modo clásico](/es/docs/classic) para más información.

## Worker <Badge type="tip" text="disponible" />

El modo Worker tiene la misma forma que Classic —sigues leyendo las superglobales, sigues haciendo `echo` de la respuesta— salvo que el worker no se destruye al terminar la petición. Un script residente arranca todo una vez y entra en un bucle: el servidor vuelve a rellenar `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` y las demás en cada petición nueva, ejecuta tu handler y te pasa la siguiente. Autoloader, contenedor de DI, configuración, conexiones a la base de datos: todo lo que crees fuera del bucle se queda caliente.

El arranque ocurre una vez por worker en lugar de una vez por petición y, en una aplicación moderna, ese arranque suele ser la parte más cara de la petición. El proceso ya no arranca limpio en cada petición, así que todo lo que tu aplicación deje en propiedades estáticas, singletons o estado global seguirá ahí en la siguiente. Rapira puede reciclar un worker cada cierto número de peticiones, de modo que una fuga lenta en tu aplicación o en alguna de sus dependencias no acabe en una caída mientras la localizas.

En [Modo worker](/es/docs/worker) está el script del worker y su bucle; en [Configuración](/es/docs/configuration), el límite de reciclado; y en [HTTP](/es/docs/http), cómo se manejan las peticiones y las respuestas.

## Dispatcher <Badge type="tip" text="disponible" />

El modo Dispatcher invierte la dirección de la llamada: en lugar de esperar a que lo llamen, el script del worker le pide a Rapira la siguiente unidad de trabajo mediante una llamada a la API. `Rapira\get_dispatcher()` devuelve el dispatcher que sirve el pool. `receive(int $timeout = -1)` espera a la siguiente unidad de trabajo, con el límite de tiempo en microsegundos: el valor por defecto, `-1`, espera sin límite, y un límite que se agota lanza `Rapira\Exception\TimeoutException`. `tryReceive()` devuelve la siguiente unidad de trabajo o `null`, y no espera nunca. Con el plugin HTTP la unidad de trabajo es un `Rapira\Http\Exchange`: su `getRequest()` devuelve un objeto `Rapira\Http\Request` con el método, el objetivo de la petición, las cabeceras, el cuerpo y las direcciones de ambos extremos, y sus métodos `writeHead()`, `writeBody()` y `sendFile()` escriben la respuesta.

La petición es un valor que puedes pasar a una función, envolver o entregarle a una pila de middleware. En este modo las superglobales no se rellenan. Una aplicación que lee `$_GET` o `$_SERVER` directamente necesita el modo Worker, o bien un adaptador que copie el objeto de la petición a la forma que ella espera. El modo lo fija `pool.mode` o `--mode`, no el código de la aplicación.

Cuántas unidades de trabajo hay en curso a la vez lo decide el script. Un bucle sencillo atiende una cada vez: llama a `receive()`, responde la petición y vuelve a llamar a `receive()`. Esa misma API permite además tener varias unidades entre manos. Un script así abre una [fibra](https://www.php.net/manual/en/language.fibers.php) por petición: sondea con `tryReceive()` mientras queden fibras en curso y aparca el bucle en `receive()` cuando no queda ninguna. Así conviven varias peticiones en un mismo intérprete. Aquí la concurrencia es cooperativa: otra petición solo avanza cuando el código en ejecución suspende su fibra, de modo que una biblioteca que no es segura con fibras deja al script atendiendo una unidad de trabajo cada vez.

::: info
El modo Dispatcher es el valor por defecto de `pool.mode`. Todavía no tiene una guía propia. Por ahora, la API del lado de PHP está documentada en los archivos de stubs para el IDE: [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) para las interfaces `Dispatcher` y `Work`, y [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_http.stub.php) para los tipos HTTP. En [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) tienes además dos scripts listos para ejecutar: `dispatcher-sync.php` y `dispatcher-async.php`.
:::

## Leer el modo en tiempo de ejecución

`Rapira\get_mode()` devuelve el modo con el que el host lanzó el proceso, como un caso del enum `Rapira\Mode`. `Mode` es un enum puro con tres casos: `Classic`, `Worker` y `Dispatcher`. El caso es el `pool.mode` con el que arrancó el proceso, y no cambia mientras el proceso viva. Los casos de un enum son objetos únicos, así que se comparan con `===`. La función no recibe argumentos y nunca lanza una excepción, así que puedes llamarla sin problema al principio de un script de entrada que sirve en más de un modo:

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
El host lee `pool.mode` al arrancar y fija el modo antes de poner en marcha el intérprete, así que la primera petición y la última de un worker informan del mismo caso. Cambiar de modo exige reiniciar el servidor.
:::

## Selección del modo

El valor por defecto de `pool.mode` es `dispatcher`. Fija el modo de forma explícita en `rapira.toml`, o con `--mode` en la línea de comandos.

```toml
[pool]
entrypoint = "public/index.php"
mode = "classic"                      # "classic" | "worker" | "dispatcher" (the default)
```

```sh
rapira serve --mode classic public/index.php
```

Los tres modos están abiertos a cualquier aplicación, y lo que limita la elección es el stack de la propia aplicación. Un estado global que no sobrevive a una segunda petición mantiene la aplicación en Classic. Un código que lee las superglobales directamente la deja fuera de Dispatcher mientras no haya un adaptador que cubra ese hueco. Un framework con integración de runtime deja disponible el modo Worker casi sin trabajo extra; en [Frameworks](/es/docs/frameworks/) están los que ya tienen una integración documentada.

El modo se elige por instancia del servidor, no por ruta, así que una misma instancia no puede atender unas rutas desde un worker y el resto en Classic. Si una parte de tu aplicación no es segura en modo worker, ponla detrás de su propia instancia de Rapira en modo Classic.

Pasar a Worker o a Dispatcher cuesta trabajo del lado de PHP, porque los dos necesitan un script de entrada residente que Classic no pide. Volver atrás no cuesta nada: pon `mode = "classic"` en el archivo de configuración o pasa `--mode classic`, apunta Rapira a tu front controller de siempre y tienes el mismo servidor, el mismo binario y el mismo [modelo de procesos](/es/docs/process-model) por debajo. Consulta [Configuración](/es/docs/configuration) y la [referencia de la línea de comandos](/es/docs/cli) para más detalles.

::: tip
Empieza por Classic si vienes a sustituir php-fpm y lo primero que quieres es tenerlo todo funcionando. Pasa a Worker cuando sepas que tu aplicación arranca limpia y no guarda entre peticiones estado que no debería guardar.
:::
