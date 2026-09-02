---
title: ¿Qué es Rapira?
description: "Rapira es un servidor de aplicaciones PHP rápido y seguro, escrito en Rust: recibe las peticiones HTTP directamente y admite los modos Classic, Worker y Dispatcher."
---

# ¿Qué es Rapira?

Rapira es un servidor de aplicaciones PHP rápido y seguro, escrito en Rust.

En su diseño hemos volcado los años que llevamos manteniendo RoadRunner: queríamos que el trato con PHP fuera lo más eficiente y estable posible, y que ni el desarrollo ni el día a día en producción costaran esfuerzo de más.

Rapira no se queda en HTTP. Tenemos en la hoja de ruta la compatibilidad con todos los plugins populares de RoadRunner; sigue las novedades en nuestro [blog](/es/blog/).

## HTTP

Rapira tiene su propio frontal HTTP, construido sobre la biblioteca [hyper](https://hyper.rs). El frontal acepta conexiones HTTP en claro directamente, así que no hace falta poner nada delante para llegar a tu aplicación PHP. El frontal no termina TLS: si lo necesitas, termínalo en un proxy delante de Rapira; ese montaje está en [En producción](/es/docs/deployment).

Del lado de PHP se admiten todos los modelos de ejecución:

- Classic: cada petición levanta la aplicación desde cero, igual que bajo php-fpm.
- Worker: la aplicación arranca una sola vez, al iniciar, y después atiende una petición tras otra en un bucle. Rapira vuelve a rellenar las superglobales de PHP en cada petición.
- Dispatcher: la aplicación arranca una vez y se queda viva. El script va sacando cada petición mediante una llamada a la API y trabaja con ella como un valor, no a través de las superglobales. Atiende una petición cada vez, o varias a la vez con [fibras](https://www.php.net/manual/en/language.fibers.php).

::: info
En [Modos de ejecución](/es/docs/execution-modes) encontrarás en detalle en qué se diferencian los modos y cómo elegir el que necesitas.
:::
