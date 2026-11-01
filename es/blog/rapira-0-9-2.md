---
title: "Rapira 0.9.2"
date: 2026-11-01
description: "Reinicios de aplicaciones dentro de los procesos worker, límites de memoria por worker, correcciones de HTTP y gRPC, y Sodium en las compilaciones de la versión."
author: Rapira Team
image: /blog/rapira-0-9-2/preview.jpg
---

# Rapira 0.9.2

Rapira 0.9.2 mejora cómo los workers reinician las aplicaciones, gestionan el crecimiento de la memoria y completan las peticiones. Esta versión también reduce el coste de procesar peticiones y añade Sodium a los paquetes PHP.

## Reiniciar la aplicación y conservar las conexiones

En los modos Worker y Dispatcher, `max_requests` ahora reinicia la aplicación PHP dentro del mismo proceso worker. El worker vuelve a ejecutar el script de entrada. Las conexiones abiertas y las peticiones en cola siguen disponibles para la siguiente instancia de la aplicación.

Las recargas mediante SIGHUP o SIGUSR2 al maestro usan el mismo mecanismo. El modo Classic ignora estas señales de reinicio de la aplicación y `max_requests`, porque cada petición ya inicia un nuevo ciclo de petición PHP.

Una recarga conserva la configuración y los descriptores gRPC actuales. Reinicia Rapira para cargar los archivos de configuración o de descriptores modificados.

Cuando un worker debe detenerse, puede responder a la siguiente petición de cada conexión HTTP/1.1 existente antes de cerrarla. Esto también se aplica a las llamadas Connect y gRPC-Web, dentro del tiempo de espera configurado para el drenaje.

## Establecer un límite de memoria por worker

El nuevo ajuste `max_memory_mb` en `[http.pool]` y `[grpc.pool]` establece un umbral de memoria residente (RSS) en MiB. El maestro comprueba la RSS una vez por segundo. Un worker que supera el umbral drena sus conexiones y termina. Después, el maestro inicia un proceso de sustitución. Establece el valor en `0` para desactivar el umbral.

Esto complementa los reinicios de la aplicación: sustituir el proceso libera memoria que puede seguir asignada entre instancias de la aplicación.

## Peticiones más fiables y menos trabajo de procesamiento

En modo Worker, la desconexión de un cliente termina la petición actual sin reiniciar la aplicación. Los tiempos de espera de PHP `max_execution_time` mantienen vivo el proceso worker. El modo Classic también completa las respuestas en streaming cuando un manejador de excepciones llama a `exit()`.

Las correcciones de HTTP cubren las subidas, las comprobaciones de longitud de `sendFile()` y las respuestas HEAD. Los archivos estáticos procesan `If-Range` correctamente. Los cuerpos de petición sin procesar y los codificados como URL llegan a PHP mediante un flujo en memoria. Las lecturas de archivos usan bloques más grandes y los workers inactivos liberan memoria no utilizada del asignador después de dos segundos.

Las respuestas gRPC y gRPC-Web usan gzip solo cuando la petición usó gzip. Las respuestas Connect pueden usar gzip cuando el cliente lo acepta.

## Antes de actualizar

- Elimina `unsafe_field_names` de `[http]`. Las configuraciones que lo contienen fallan al arrancar. Los modos Classic y Worker siempre descartan los nombres de cabecera que pueden entrar en conflicto en las variables CGI.
- Elimina las referencias a `Rapira\Grpc\Call\Protocol::Rest`. Los casos admitidos son `Grpc`, `GrpcWeb` y `Connect`.
- Comprueba el `memory_limit` de PHP en las aplicaciones que aceptan cuerpos de petición grandes. Los cuerpos sin procesar y los codificados como URL ahora cuentan para ese límite en los modos Classic y Worker.

Las compilaciones de la versión y las imágenes Docker ahora incluyen la extensión Sodium. Los archivos de distribución para Linux también incluyen las bibliotecas necesarias de `libphp.so`.

Consulta las [notas de la versión](https://github.com/rapira-rs/rapira/pull/211) para ver la lista completa de cambios.
