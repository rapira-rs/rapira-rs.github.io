---
title: Modos de ejecución
description: "Qué hacen los cuatro modos de ejecución de Rapira —Classic, SAPI Worker, PSR Worker y Async— y qué decide cuál puede usar una aplicación."
---

# Modos de ejecución

Rapira ejecuta PHP en uno de sus cuatro modos de ejecución. Dos ya están disponibles; los otros dos están previstos.

| Modo | Estado | Descripción |
| --- | --- | --- |
| [Classic](/es/docs/classic) | Disponible | El script de entrada se ejecuta desde cero en cada petición, igual que con php-fpm. |
| [SAPI Worker](/es/docs/worker) | Disponible | Un script residente arranca una vez y atiende las peticiones en un bucle; las superglobales se vuelven a rellenar en cada petición. |
| PSR Worker | Previsto | El worker pide cada petición mediante una llamada a la API y puede trabajar con un mensaje PSR-7 en lugar de las superglobales. |
| Async | Previsto | El worker atiende varias peticiones de forma concurrente en un mismo intérprete, con fibras. |

Los modos aparecen ordenados según cuánto control tiene PHP sobre el ciclo de vida de la petición. Los nombres indican si el worker sigue vivo entre peticiones y qué contrato habla. Cada modo mantiene caliente más parte del proceso que el anterior cuando llega una petición, y le exige más al código.

## Classic <Badge type="tip" text="disponible" />

El script de entrada se ejecuta desde cero en cada petición, igual que haría con php-fpm: se rellenan las superglobales, arranca el front controller, sale la respuesta y todo se destruye. No se arrastra nada de lo que crea el script, así que el estado de la aplicación no puede filtrarse de una petición a la siguiente. Valen las mismas excepciones que con php-fpm: las conexiones persistentes y el estado que vive dentro de una extensión están en el proceso worker, no en la petición.

Una aplicación que ya existe funciona tal cual, porque Rapira ocupa el lugar de php-fpm sin que toques el código. PHP va incrustado en el proceso del servidor, así que no hay ningún salto FastCGI entre el frontal HTTP y el intérprete.

Consulta [Modo clásico](/es/docs/classic) para más información.

## SAPI Worker <Badge type="tip" text="disponible" />

El modo SAPI Worker tiene la misma forma que Classic —sigues leyendo las superglobales, sigues haciendo `echo` de la respuesta— salvo que el worker no se destruye al terminar la petición. Un script residente arranca todo una vez y entra en un bucle: el servidor vuelve a rellenar `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` y las demás en cada petición nueva, ejecuta tu handler y te pasa la siguiente. Autoloader, contenedor de DI, configuración, conexiones a la base de datos: todo lo que crees fuera del bucle se queda caliente.

El arranque ocurre una vez por worker en lugar de una vez por petición y, en una aplicación moderna, ese arranque suele ser la parte más cara de la petición. El proceso ya no arranca limpio en cada petición, así que todo lo que tu aplicación deje en propiedades estáticas, singletons o estado global seguirá ahí en la siguiente. Rapira puede reciclar un worker cada cierto número de peticiones, de modo que una fuga lenta en tu aplicación o en alguna de sus dependencias no acabe en una caída mientras la localizas.

En [Modo worker](/es/docs/worker) está el script del worker y su bucle; en [Configuración](/es/docs/configuration), el límite de reciclado; y en [HTTP](/es/docs/http), cómo se manejan las peticiones y las respuestas.

## PSR Worker <Badge type="warning" text="previsto" />

El control se invierte: en lugar de esperar a que lo llamen, el worker le pide una petición a Rapira mediante una llamada a la API y decide qué hacer con ella. Puede rellenar las superglobales por compatibilidad, o saltárselas del todo y trabajar con un mensaje PSR-7 que entrega directamente al kernel HTTP del framework. Atiende una petición cada vez, igual que SAPI Worker.

La petición deja de ser estado global ambiental y se convierte en un valor que puedes pasar de un lado a otro, envolver o entregar a una pila de middleware.

::: info
El modo PSR Worker no está implementado. Hoy no hay nada de él disponible y ni su configuración ni su API del lado de PHP están diseñadas, así que todavía no hay nombres de funciones ni claves de configuración que enseñar.
:::

## Async <Badge type="warning" text="previsto" />

El modo Async usa la misma API que el modo PSR Worker, salvo que el worker pide más de una petición a la vez y las atiende de forma concurrente dentro de un mismo intérprete. Esto lo hacen posible las fibras de PHP 8.1: una petición que está esperando a la E/S puede ceder el paso mientras otra avanza, sin hilos y sin un segundo proceso.

Async es el más exigente de los cuatro modos, porque la concurrencia dentro de un solo intérprete implica que cada biblioteca que intervenga en la petición tiene que funcionar correctamente cuando se la suspende a mitad de ejecución.

::: info
El modo Async tampoco está implementado. No hay nada que instalar ni nada que configurar. La sección de arriba describe la dirección prevista, no algo que puedas ejecutar hoy.
:::

## Selección del modo

Rapira arranca en modo SAPI Worker por defecto y Classic hay que pedirlo. Los cuatro modos están abiertos a cualquier aplicación, y lo que limita la elección es el stack de la propia aplicación. Un estado global que no sobrevive a una segunda petición mantiene la aplicación en Classic. Una biblioteca que no es segura con fibras descarta Async. Un framework con integración de runtime deja disponible el modo SAPI Worker casi sin trabajo extra; en [Frameworks](/es/docs/frameworks/) están los que ya tienen una integración documentada.

El modo se elige por instancia del servidor, no por ruta, así que una misma instancia no puede atender unas rutas desde un worker y el resto en Classic. Si una parte de tu aplicación no es segura en modo worker, ponla detrás de su propia instancia de Rapira en modo Classic.

Pasar a un modo worker cuesta trabajo del lado de PHP, porque un worker necesita un script de entrada residente que Classic no pide. Volver atrás no cuesta nada: activas Classic con un flag en la línea de comandos o con una sola clave en el archivo de configuración, apuntas Rapira a tu front controller de siempre y tienes el mismo servidor, el mismo binario y el mismo [modelo de procesos](/es/docs/process-model) por debajo. Consulta [Configuración](/es/docs/configuration) y la [referencia de la línea de comandos](/es/docs/cli) para más detalles.

::: tip
Empieza por Classic si vienes a sustituir php-fpm y lo primero que quieres es tenerlo todo funcionando. Pasa a SAPI Worker cuando sepas que tu aplicación arranca limpia y no guarda entre peticiones estado que no debería guardar.
:::
