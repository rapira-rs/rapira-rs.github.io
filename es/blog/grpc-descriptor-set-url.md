---
title: "Cargar el descriptor set de gRPC desde una URL"
date: 2026-11-17
description: "La clave descriptor_set de la escucha gRPC acepta una ruta local o una URL HTTP o HTTPS. Este artículo compara las dos formas y enumera los límites de la forma URL."
author: Rapira Team
image: /blog/grpc-descriptor-set-url/preview.png
---

# Cargar el descriptor set de gRPC desde una URL

Rapira lee el esquema gRPC desde un descriptor set. Es un archivo binario que contiene los archivos `.proto` compilados con sus importaciones. Buf llama imagen a este archivo. La clave `descriptor_set` de `[grpc]` ahora acepta dos formas: una ruta local y una URL HTTP o HTTPS.

::: info
La forma URL necesita una versión de Rapira posterior a la 0.9.2.
:::

## Qué hace Rapira con el conjunto

Rapira usa el conjunto para encontrar los servicios y sus métodos, para convertir los mensajes JSON de Connect y para responder a las peticiones de reflexión. El proceso maestro carga el conjunto una vez al arrancar, antes de crear los workers con fork. Un conjunto que Rapira no puede cargar impide el arranque. Rapira no necesita el ejecutable `protoc` para esto.

## La forma de ruta

```toml
[grpc]
descriptor_set = "api.binpb"
```

Una ruta relativa usa como base el directorio de `rapira.toml`. El archivo debe estar en el host o en el contenedor antes de que Rapira arranque. Hay tres métodos habituales para ponerlo ahí:

- Genera el conjunto en el pipeline de la aplicación y cópialo en la imagen del contenedor.
- Monta el conjunto desde un volumen o un ConfigMap. Un ConfigMap [no puede contener más de 1 MiB](https://kubernetes.io/docs/concepts/configuration/configmap/#motivation).
- Descarga el conjunto en un [init container](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) o en un script de entrypoint.

Con los dos primeros métodos, Rapira lee un archivo local al arrancar y no envía ninguna petición. Con el tercer método, el arranque necesita el host del archivo, como con la forma URL. Cuando el conjunto está en la imagen, el conjunto y el código de la aplicación se despliegan como un único artefacto. El coste es un paso más para cada servicio: una etapa de compilación con `buf` o `protoc`, o un script que obtiene el archivo.

## La forma URL

```toml
[grpc]
descriptor_set = "https://schemas.example.com/billing/v42/api.binpb"
```

Un valor que empieza por `http://` o `https://` es una URL. El proceso maestro descarga el conjunto con una petición GET al arrancar. Las [entradas de imagen de Buf](https://buf.build/docs/reference/inputs/#image-formats) aceptan una ubicación remota de la misma forma.

Con esta forma, puedes guardar los descriptor sets de todos los servicios en una ubicación. El pipeline del repositorio de `.proto` genera cada conjunto una vez:

```sh
buf build proto --as-file-descriptor-set -o api.binpb
```

Después, el pipeline sube `api.binpb` a un host que responde a una petición GET. Un bucket de almacenamiento de objetos, un repositorio de artefactos y un servidor de archivos estáticos son ejemplos. Cada instancia de Rapira indica la URL en `rapira.toml`.

El propio Rapira hace la descarga. La imagen de la aplicación no contiene ningún descriptor set ni ningún paso que lo genere. Un pod no necesita un init container ni un volumen para el esquema. La misma configuración funciona en un contenedor, en una máquina virtual y en el ordenador de un desarrollador.

## Cómo funciona la descarga

- Rapira envía una petición GET y sigue un máximo de 10 redirecciones. Un estado de respuesta de 400 o superior detiene el arranque.
- HTTPS usa el almacén de certificados del sistema. En Linux, `SSL_CERT_FILE` y `SSL_CERT_DIR` sustituyen ese almacén, por ejemplo para una autoridad de certificación privada. En macOS, el almacén es el llavero (keychain), y las dos variables no tienen efecto.
- Rapira envía la información de usuario de la URL (`https://user:password@host/api.binpb`) como credenciales HTTP Basic. Los mensajes de registro muestran la URL sin la información de usuario y sin la consulta.
- La descarga usa el proxy que indica `ALL_PROXY`, `HTTPS_PROXY` o `HTTP_PROXY`.
- La conexión, las cabeceras de la respuesta y el cuerpo tienen cada uno un límite de tiempo de 30 segundos. El tamaño máximo del conjunto es de 64 MiB.

## Límites de la forma URL

La forma URL mueve una dependencia de la compilación al arranque de cada instancia. Lee estos límites antes de usarla.

- El arranque necesita el host del esquema. Si la descarga falla, Rapira termina con el código de salida 1. No lo intenta otra vez y no guarda una copia local. Tu supervisor de procesos o tu orquestador debe iniciarlo otra vez. Las instancias en ejecución no se ven afectadas, porque no vuelven a descargar el conjunto.
- Un conjunto modificado necesita un reinicio. Una recarga conserva el conjunto cargado. Si sustituyes el archivo en una URL, las instancias con horas de arranque distintas pueden usar conjuntos distintos. Pon una versión en la ruta de la URL y cambia la URL en cada versión del esquema.
- Rapira no verifica el contenido. No comprueba ninguna suma de comprobación ni ninguna firma. Usa HTTPS y un host en el que confíes. Con `http://`, cada host del camino de red puede cambiar el conjunto. Rapira también sigue una redirección de una URL `https://` a una URL `http://`.
- La autenticación es simple. Rapira puede enviar credenciales HTTP Basic desde la información de usuario de la URL. La consulta de la URL también puede contener credenciales, como en una URL prefirmada. Rapira no puede enviar un token bearer y no puede firmar una petición para la API de un almacenamiento en la nube. Una URL prefirmada tiene una hora de caducidad, y un arranque después de esa hora falla. Las credenciales están en `rapira.toml`, así que protege ese archivo.
- El formato es fijo. El cuerpo de la respuesta debe ser el conjunto binario. Buf también puede leer una imagen comprimida como `image.binpb.gz`, pero Rapira no.
- Rapira no usa la API de un registro de esquemas. Envía una petición GET simple. Exporta el conjunto desde el registro y súbelo a un host que responda a una petición GET.
- Las clases PHP generadas siguen en la aplicación. Una aplicación que usa clases de mensajes generadas todavía las genera dentro de su imagen. La forma URL solo quita el descriptor set de la imagen. Mantén las clases y el conjunto en la misma versión del esquema.

## Qué forma usar

Usa una ruta cuando el conjunto se distribuye con la aplicación, o cuando Rapira debe arrancar sin acceso a la red. Usa una URL cuando muchos servicios o instancias comparten una ubicación del esquema, y esa ubicación tiene la disponibilidad que tus despliegues necesitan.

Consulta [gRPC](/es/docs/grpc#descriptor-set-url) para ver la referencia.
