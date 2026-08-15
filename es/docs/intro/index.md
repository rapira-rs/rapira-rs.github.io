---
title: ¿Qué es Rapira?
description: "Rapira es un servidor de aplicaciones PHP rápido y seguro, escrito en Rust: recibe las peticiones HTTP directamente y admite los modos clásico, worker y despachador."
---

# ¿Qué es Rapira?

Rapira es un servidor de aplicaciones PHP rápido y seguro, escrito en Rust.

En su diseño hemos volcado los años que llevamos manteniendo RoadRunner: queríamos que el trato con PHP fuera lo más eficiente y estable posible, y que ni el desarrollo ni el día a día en producción costaran esfuerzo de más.

Rapira no se queda en HTTP. Tenemos en la hoja de ruta la compatibilidad con todos los plugins populares de RoadRunner; sigue las novedades en nuestro [blog](/es/blog/).

## HTTP

La primera tarea de un servidor PHP es atender peticiones HTTP. Gracias a la tecnología de Cloudflare, Rapira las recibe directamente, sin nginx ni Apache, y admite todos los estándares modernos de HTTP y de cifrado.

Del lado de PHP se admiten todos los modelos de ejecución:

- Clásico (SAPI): cada petición levanta la aplicación desde cero, igual que bajo php-fpm.
- Worker (SAPI Worker): la aplicación arranca una sola vez y después atiende una petición tras otra en un bucle, a través de la interfaz SAPI (las superglobales de PHP se rellenan de nuevo en cada petición).
- Despachador: la aplicación no muere y las peticiones y respuestas viajan por una API aparte. En este modo eres libre de atenderlas de una en una (como en RoadRunner) o de forma concurrente, con [fibras](https://www.php.net/manual/language.fibers.php).

::: info
En [Modos de ejecución](/es/docs/execution-modes) encontrarás en detalle en qué se diferencian los modos y cómo elegir el que necesitas.
:::
