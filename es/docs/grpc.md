---
title: gRPC
description: "Configura un servicio gRPC unario, escribe un dispatcher PHP y llama al servicio con grpcurl."
---

# gRPC

Rapira ofrece gRPC nativo sobre HTTP/2 sin cifrar mediante sockets TCP o Unix. Cada worker PHP procesa una llamada unaria cada vez. Una llamada unaria tiene un mensaje de petición y un mensaje de respuesta.

El pool gRPC usa el modo Dispatcher. Rapira gestiona el transporte y pasa mensajes protobuf binarios a PHP. No se admiten métodos de aplicación en streaming, gRPC-Web ni Connect. Un proxy TLS debe usar HTTP/2 en su conexión con Rapira.

## Ejecutar un servicio de eco

Instala Rapira con soporte nativo de gRPC. Instala [grpcurl](https://github.com/fullstorydev/grpcurl#installation) para ejecutar los comandos de cliente. Este ejemplo devuelve los bytes de la petición como respuesta. No necesita clases PHP generadas ni la extensión gRPC de PHP.

Crea esta estructura de directorios:

```text
app/
├── proto/
│   └── echo.proto
├── grpc.php
└── rapira.toml
```

### Definir el servicio

Guarda este esquema en `proto/echo.proto`:

```protobuf
syntax = "proto3";

package example.v1;

option php_namespace = "Example\\V1";
option php_metadata_namespace = "Example\\Metadata";

service Echo {
  rpc Echo(EchoMessage) returns (EchoMessage);
}

message EchoMessage {
  string text = 1;
}
```

Rapira analiza el esquema al arrancar. La ruta es `/example.v1.Echo/Echo`. El contexto PHP expone el método como `example.v1.Echo/Echo`, sin la barra inicial.

### Escribir el dispatcher PHP

Guarda este script en `grpc.php`:

```php
<?php

use Rapira\Exception\ClosedException;
use Rapira\Exception\WorkDiscardedException;

$dispatcher = Rapira\get_dispatcher();

try {
    while (true) {
        $call = $dispatcher->receive();

        try {
            $metadata = $call->getResponseMetadata();
            $metadata->addHeader('x-worker', (string) getmypid());
            $metadata->addTrailer('x-result', 'echoed');
            $call->respond($call->getMessage());
        } catch (WorkDiscardedException) {
            continue;
        }
    }
} catch (ClosedException) {
    return;
}
```

La petición y la respuesta comparten un tipo de mensaje, por lo que el handler puede devolver los bytes directamente. `ClosedException` termina el bucle durante el apagado. `WorkDiscardedException` indica que el host ya ha cancelado la llamada.

### Configurar la escucha y el pool

Guarda esta configuración en `rapira.toml`:

```toml
[grpc]
listen = "127.0.0.1:9001"
protos = ["proto"]
reflection = true

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"
processes = 2
```

`protos` contiene directorios. Rapira busca archivos `.proto` de forma recursiva en ellos. Las rutas relativas usan como base el directorio del archivo de configuración. Una configuración que solo usa gRPC no necesita la sección `[http]`.

Inicia el servidor desde `app/`:

```sh
rapira serve rapira.toml
```

### Llamar al servicio

Enumera los servicios desde otro terminal:

```sh
grpcurl -plaintext 127.0.0.1:9001 list
```

Llama al método de eco:

```sh
grpcurl -plaintext -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

La respuesta es:

```json
{
  "text": "hello"
}
```

Estos comandos obtienen sus esquemas mediante reflexión. Añade `-v` antes de la dirección para examinar las cabeceras y los trailers de la respuesta.

## Usar mensajes PHP generados

Genera clases PHP cuando un handler necesite leer o modificar campos de un mensaje. Instala `protoc` y Composer para este paso de compilación. El servidor analiza los archivos `.proto` por sí mismo y no necesita el ejecutable `protoc` durante la ejecución.

Instala el runtime protobuf de PHP en `app/`:

```sh
composer require google/protobuf
```

Crea el directorio de salida:

```sh
mkdir -p generated
```

Genera las clases:

```sh
protoc --proto_path=proto --php_out=generated proto/echo.proto
```

Añade estas correspondencias de espacios de nombres al objeto `autoload.psr-4` de `composer.json`:

```json
{
  "autoload": {
    "psr-4": {
      "Example\\V1\\": "generated/Example/V1/",
      "Example\\Metadata\\": "generated/Example/Metadata/"
    }
  }
}
```

Actualiza el autoloader:

```sh
composer dump-autoload
```

Cárgalo antes del bucle del dispatcher en `grpc.php`:

```php
require __DIR__ . '/vendor/autoload.php';
```

Sustituye la línea de `respond()` dentro del bloque `try` interno por este código:

```php
$message = new Example\V1\EchoMessage();
$message->mergeFromString($call->getMessage());
$message->setText(strtoupper($message->getText()));
$call->respond($message->serializeToString());
```

Reinicia el servidor del ejemplo. La misma llamada del cliente ahora devuelve `{"text":"HELLO"}`. Captura las excepciones de análisis protobuf en un handler de la aplicación y conviértelas en `StatusCode::InvalidArgument`.

La [guía de código PHP generado](https://protobuf.dev/reference/php/php-generated/) describe los métodos de acceso a los mensajes y su serialización. Esta API de servidor no requiere la extensión gRPC de PHP.

## Contrato del dispatcher

`Rapira\get_dispatcher()` devuelve un `Rapira\Grpc\GrpcDispatcher` en un worker gRPC. Inicializa el autoloader y los servicios compartidos de la aplicación antes del bucle.

| API | Comportamiento |
| --- | --- |
| `receive(int $timeout = -1)` | Devuelve la siguiente `UnaryCall`. El tiempo de espera se expresa en microsegundos. `-1` espera indefinidamente. Al agotarse el tiempo, lanza `Rapira\Exception\TimeoutException`. |
| `tryReceive()` | Devuelve una `UnaryCall` o `null` de inmediato. |
| `getServices()` | Enumera los servicios de la aplicación y sus métodos, tipos de entrada, tipos de salida y clases de método. Está disponible antes de la primera llamada. |
| `$call->getContext()` | Devuelve el método, los metadatos, la dirección del par, el protocolo, la hora de recepción y el plazo de la llamada. |
| `$call->getMessage()` | Devuelve los bytes protobuf de la petición como una cadena PHP. |
| `$call->respond(string $message)` | Completa la llamada con una respuesta protobuf serializada. |
| `$call->fail(Status $status)` | Completa la llamada con un error gRPC. |
| `$call->isCancelled()` | Indica si el cliente ha cancelado la llamada o si ha vencido el plazo. |
| `$call->isFinalized()` | Indica si la llamada ha terminado. |

Finaliza la llamada activa antes de recibir otra. Una finalización repetida lanza `Rapira\Exception\AlreadyFinalizedError`. Una respuesta después de la cancelación lanza `WorkDiscardedException`. Si se descarta una llamada sin finalizar, el cliente recibe `INTERNAL`.

Usa `$call->getContext()->method` para seleccionar un handler cuando el esquema defina varios métodos. Limpia el estado de la aplicación específico de cada llamada entre iteraciones. El dispatcher mantiene la aplicación PHP en memoria y no rellena las superglobales HTTP.

## Devolver errores y detalles

Usa `fail()` para un error previsto de la aplicación. Ejecuta este código en el handler de la llamada activa:

```php
$call->fail(new Rapira\Grpc\Status(
    Rapira\Grpc\StatusCode::InvalidArgument,
    'text is required',
));
```

`StatusCode` contiene los códigos de error gRPC. Un `respond()` correcto proporciona el estado `OK`. Rapira devuelve un estado `INTERNAL` sin detalles internos cuando una excepción no capturada abandona una llamada.

El tercer argumento opcional de `Status` es una lista de objetos `Rapira\Grpc\ErrorDetail`. Cada objeto acepta una URL de tipo protobuf y los bytes de un mensaje serializado. Rapira codifica estos detalles en `grpc-status-details-bin`. Una `Rapira\Grpc\Exception\GrpcException` expone una propiedad `$status` que un bloque catch de la aplicación puede pasar a `fail()`.

## Metadatos

Lee los metadatos de la petición desde `$call->getContext()->metadata`. `values($name)` devuelve todos los valores de un nombre sin distinguir mayúsculas. El array de solo lectura `entries` almacena los nombres en minúsculas. Los nombres que terminan en `-bin` contienen valores binarios sin procesar en PHP.

Añade metadatos de respuesta antes de `respond()` o `fail()`:

```php
$requestId = $call->getContext()->metadata->values('x-request-id')[0] ?? '';
$metadata = $call->getResponseMetadata();
$metadata->addHeader('x-request-id', $requestId);
$metadata->addBinaryHeader('x-token-bin', "\x00\xff");
$metadata->addTrailer('x-result', 'completed');
```

`addHeader()` y `addTrailer()` aceptan valores ASCII imprimibles. Usa `addBinaryHeader()` o `addBinaryTrailer()` para valores binarios. Si añades varios valores, se conserva cada uno. Se rechazan los nombres reservados por el transporte, como `grpc-status`.

`headers()` y `trailers()` devuelven instantáneas inmutables. Los metadatos de respuesta quedan fijados cuando termina la llamada. Pasa metadatos de petición con la opción `-H 'x-request-id: demo-1'` de grpcurl.

## Plazos y cancelación

El cliente proporciona el plazo de la llamada mediante `grpc-timeout`. Rapira comprueba este plazo mientras recibe la petición y espera a PHP. `$call->getContext()->deadline` es una marca de tiempo Unix en segundos, o `null`. `receivedAt` es la marca de tiempo de recepción en segundos.

Por ejemplo, establece un plazo de dos segundos en el cliente:

```sh
grpcurl -plaintext -max-time 2 -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

El código PHP puede continuar después de la cancelación. Comprueba `isCancelled()` durante las operaciones largas. Captura `WorkDiscardedException` alrededor de los métodos de respuesta porque la cancelación puede ocurrir después de la comprobación.

El tiempo de espera de `receive()` limita cuánto espera PHP por trabajo nuevo. Es independiente del plazo de una llamada. `grpc.pool.request_terminate_timeout_secs` es un mecanismo de vigilancia del proceso que termina y sustituye un worker cuando una llamada activa supera su límite.

## Esquemas y reflexión

El maestro carga los esquemas proto2 y proto3 antes de crear los workers con fork. Los archivos encontrados bajo `protos` registran servicios de la aplicación. Los archivos encontrados únicamente mediante `import_paths` proporcionan tipos de dependencias y datos de reflexión.

Los directorios raíz de importación siguen el orden de la configuración: primero `protos` y después `import_paths`. Las importaciones estándar de `google/protobuf` están integradas. Las importaciones ausentes, las definiciones en conflicto y los métodos de aplicación en streaming impiden la inicialización. Reinicia Rapira después de cambiar los esquemas.

La reflexión está activada por defecto. Implementa `grpc.reflection.v1` y `grpc.reflection.v1alpha` en Rust. Enumera los servicios de la aplicación y de reflexión, y proporciona descriptores con sus opciones personalizadas. `getServices()` de PHP enumera solo los servicios de la aplicación.

Con `reflection = false`, proporciona el esquema al cliente:

```sh
grpcurl -plaintext -import-path proto -proto echo.proto -d '{"text":"hello"}' 127.0.0.1:9001 example.v1.Echo/Echo
```

## Compresión y límites de mensajes

Se aceptan peticiones gzip. Las respuestas gzip están desactivadas por defecto. Activa la compresión de respuestas de la aplicación con:

```toml
[grpc.compression.gzip]
enabled = true
```

El cliente también debe anunciar gzip en `grpc-accept-encoding`. Ambos límites de mensajes tienen un valor predeterminado de 4 MiB. Establece `grpc.max_request_message_size_mb` y `grpc.max_response_message_size_mb` para cambiarlos. Tanto el contenido comprimido como el descomprimido deben respetar su límite configurado. Configura los límites del cliente para aceptar el tamaño de respuesta previsto.

## HTTP y gRPC juntos

Una configuración puede contener tanto `[http]` como `[grpc]`. Cada plugin tiene su propia escucha, script de entrada PHP y pool de workers. El maestro supervisa ambos pools. El pool gRPC admite los mismos ajustes de escalado y reciclaje que el pool HTTP, con `mode = "dispatcher"`.

El binario independiente acepta una lista `grpc.interceptors` vacía. Los hosts Rust pueden proporcionar interceptores mediante la API compartida `Middleware`. Consulta [Configuración](./configuration#grpc) para ver todos los ajustes gRPC y [Modelo de procesos](./process-model) para la supervisión de pools.
