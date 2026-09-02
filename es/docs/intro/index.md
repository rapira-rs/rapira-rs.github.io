---
title: ¿Qué es Rapira?
description: Rapira es un servidor de aplicaciones PHP escrito en Rust. Admite los modos Classic, Worker y Dispatcher.
---

# ¿Qué es Rapira?

Rapira es un servidor de aplicaciones PHP escrito en Rust.

Los responsables de RoadRunner diseñan e implementan Rapira. Rapira llama a PHP directamente en el proceso del servidor.

Rapira admite HTTP actualmente. El proyecto planea admitir más funciones de plugins de RoadRunner.
El [blog](/es/blog/) contiene las novedades del proyecto.

## HTTP

Rapira incluye un servidor HTTP que usa la biblioteca [hyper](https://hyper.rs). Acepta directamente conexiones HTTP sin cifrar.
El servidor no termina TLS. Un [proxy de terminación TLS](https://en.wikipedia.org/wiki/TLS_termination_proxy) acepta HTTPS del cliente, descifra la conexión y envía HTTP sin cifrar a Rapira.
Consulta [En producción](/es/docs/deployment) para configurar el proxy.

Rapira admite tres modos de ejecución de PHP:

- Classic: Rapira inicializa la aplicación para cada petición, como hace php-fpm.
- Worker: Rapira inicializa la aplicación una vez. Un bucle procesa las peticiones y Rapira vuelve a llenar las superglobales de PHP para cada petición.
- Dispatcher: Rapira inicializa la aplicación una vez. El script recibe objetos de petición mediante una llamada a la API. Puede procesar peticiones de forma secuencial o concurrente con [fibras](https://www.php.net/manual/en/language.fibers.php).

::: info
Consulta [Modos de ejecución](/es/docs/execution-modes) para conocer el comportamiento y los criterios de selección de cada modo.
:::
