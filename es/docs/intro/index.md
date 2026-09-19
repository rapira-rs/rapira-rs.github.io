---
title: ¿Qué es Rapira?
description: Rapira es un servidor de aplicaciones PHP escrito en Rust. Admite los modos Classic, Worker y Dispatcher.
---

# ¿Qué es Rapira?

Rapira es un servidor de aplicaciones PHP escrito en Rust.

Los responsables de RoadRunner diseñan e implementan Rapira. Rapira llama a PHP directamente en el proceso del servidor.

Rapira admite HTTP y [gRPC](../grpc). Cada protocolo tiene su propia escucha y pool de workers PHP.

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

## gRPC

Rapira atiende llamadas gRPC unarias sobre HTTP/2 sin cifrar. La aplicación PHP recibe y devuelve mensajes protobuf binarios mediante un dispatcher. El maestro carga los esquemas de servicio desde archivos `.proto` antes de iniciar los workers.

El pool gRPC usa el modo Dispatcher. HTTP y gRPC pueden ejecutarse juntos con scripts de entrada separados. Consulta [gRPC](../grpc) para ver un servicio completo, la generación de clases protobuf y comandos de cliente.
