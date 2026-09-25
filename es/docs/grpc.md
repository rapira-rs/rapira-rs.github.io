---
title: gRPC
description: "Atiende llamadas unarias gRPC, gRPC-Web y Connect desde un dispatcher PHP y llámalas con grpcurl o curl."
---

# gRPC

Rapira atiende llamadas RPC unarias desde PHP. Una sola escucha acepta llamadas gRPC, gRPC-Web y Connect sobre HTTP/1.1 o HTTP/2 sin cifrar, mediante sockets TCP o Unix. Una llamada unaria tiene un mensaje de petición y un mensaje de respuesta.

El pool gRPC usa el modo Dispatcher. Rapira gestiona el transporte y entrega mensajes protobuf binarios a PHP. Cada worker PHP procesa una llamada cada vez. No se admiten métodos en streaming. La escucha no termina TLS.

## Ejecutar un servicio de eco

Instala Rapira. Instala [buf](https://buf.build/docs/installation/) para generar el descriptor set, y [grpcurl](https://github.com/fullstorydev/grpcurl#installation) para ejecutar los comandos de cliente. Este ejemplo devuelve los bytes de la petición como respuesta. No necesita clases PHP generadas ni la extensión gRPC de PHP.

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

La ruta es `/example.v1.Echo/Echo`. El contexto PHP entrega el método como `example.v1.Echo/Echo`, sin la barra inicial.

### Generar el descriptor set

Rapira lee el esquema desde un descriptor set: un `google.protobuf.FileDescriptorSet` binario que contiene todos los archivos importados. Genéralo desde `app/`:

```sh
buf build proto --as-file-descriptor-set -o api.binpb
```

`protoc` también puede generarlo. Añade `--include_imports`, porque sin esta opción `protoc` no incluye los archivos importados:

```sh
protoc --include_imports --descriptor_set_out=api.binpb -I proto proto/echo.proto
```

Rapira no necesita el ejecutable `protoc` durante la ejecución.

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

La petición y la respuesta usan un mismo tipo de mensaje, por lo que el handler puede devolver los bytes directamente. `ClosedException` termina el bucle durante el apagado. `WorkDiscardedException` indica que el host ya ha cancelado la llamada.

### Configurar la escucha y el pool

Guarda esta configuración en `rapira.toml`:

```toml
[grpc]
listen = "127.0.0.1:50051"
descriptor_set = "api.binpb"
reflection = true

[grpc.pool]
entrypoint = "grpc.php"
mode = "dispatcher"
processes = 2
```

`descriptor_set` usa como base el directorio del archivo de configuración. Una configuración que solo usa gRPC no necesita la sección `[http]`.

Inicia el servidor desde `app/`:

```sh
rapira serve rapira.toml
```

### Llamar al servicio

Enumera los servicios desde otro terminal:

```sh
grpcurl -plaintext 127.0.0.1:50051 list
```

Llama al método de eco:

```sh
grpcurl -plaintext -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

La respuesta es:

```json
{
  "text": "hello"
}
```

grpcurl obtiene el esquema mediante reflexión. Añade `-v` antes de la dirección para ver las cabeceras y los trailers de la respuesta.

Un cliente Connect puede enviar JSON. Rapira convierte la petición JSON a protobuf binario antes de que PHP la reciba, y convierte la respuesta binaria de nuevo a JSON:

```sh
curl -H 'Content-Type: application/json' -d '{"text":"hello"}' http://127.0.0.1:50051/example.v1.Echo/Echo
```

## Usar mensajes PHP generados

Genera clases PHP cuando un handler deba leer o modificar campos de un mensaje. Instala `protoc` y Composer para este paso de compilación.

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

Reinicia el servidor del ejemplo. La misma llamada del cliente ahora devuelve `{"text":"HELLO"}`. En un handler de la aplicación, captura las excepciones de análisis protobuf y envía `StatusCode::InvalidArgument`.

La [guía de código PHP generado](https://protobuf.dev/reference/php/php-generated/) describe los métodos de acceso a los mensajes y su serialización. Esta API de servidor no necesita la extensión gRPC de PHP.

## Contrato del dispatcher

`Rapira\get_dispatcher()` devuelve un `Rapira\Grpc\GrpcDispatcher` en un worker gRPC. Inicia el autoloader y los servicios compartidos de la aplicación antes del bucle.

| API | Comportamiento |
| --- | --- |
| `receive(int $timeout = -1)` | Devuelve la siguiente `UnaryCall`. El tiempo de espera se expresa en microsegundos. `-1` espera sin límite. Al alcanzar el límite, lanza `Rapira\Exception\TimeoutException`. |
| `tryReceive()` | Devuelve una `UnaryCall`, o `null` cuando no hay ninguna llamada en espera. No espera. |
| `getServices()` | Enumera los servicios atendidos con sus métodos, tipos de entrada, tipos de salida y clases de método. La lista incluye los métodos en streaming. Está disponible antes de la primera llamada. |
| `$call->getContext()` | Devuelve el método, los metadatos, la dirección del par, el protocolo, la hora de recepción y el plazo de la llamada. |
| `$call->getMessage()` | Devuelve el mensaje de la petición como protobuf binario en una cadena PHP. |
| `$call->respond(string $message)` | Termina la llamada con una respuesta protobuf serializada. |
| `$call->fail(Status $status)` | Termina la llamada con un estado de error gRPC. |
| `$call->isCancelled()` | Indica si el cliente ha cancelado la llamada, si la conexión se ha cerrado o si ha vencido el plazo. |
| `$call->isFinalized()` | Indica si la llamada ha terminado. |

Finaliza la llamada actual antes de recibir la siguiente. Mientras la llamada está abierta, `receive()` lanza `\Error`. Una segunda finalización lanza `Rapira\Exception\AlreadyFinalizedError`. Una respuesta después de una cancelación lanza `WorkDiscardedException`.

Una llamada que PHP no finaliza se pierde. El cliente recibe entonces `INTERNAL` con el mensaje `internal error`. Un throwable no capturado también hace perder la llamada, y el cliente no ve su mensaje.

Usa `$call->getContext()->method` para seleccionar un handler cuando el esquema tenga varios métodos. `$call->getContext()->protocol` es `Grpc`, `GrpcWeb` o `Connect`. Limpia el estado de la aplicación de una llamada antes de la siguiente iteración. El dispatcher no rellena las superglobales HTTP.

## Devolver errores y detalles

Usa `fail()` para un error previsto de la aplicación. Ejecuta este código en el handler de la llamada actual:

```php
$call->fail(new Rapira\Grpc\Status(
    Rapira\Grpc\StatusCode::InvalidArgument,
    'text is required',
));
```

`StatusCode` contiene los códigos de estado gRPC. Un `respond()` correcto envía el estado `OK`. `fail()` es la única forma de enviar un estado de error.

El tercer argumento opcional de `Status` es una lista de objetos `Rapira\Grpc\ErrorDetail`. Cada objeto contiene una URL de tipo protobuf y los bytes del mensaje serializado. En gRPC y gRPC-Web, Rapira envía los detalles en `grpc-status-details-bin`. En Connect, los envía en el cuerpo JSON del error.

Rapira no captura `Rapira\Grpc\Exception\GrpcException`. Captúrala y pasa su propiedad `$status` a `fail()`.

El cliente recibe `UNAVAILABLE` cuando Rapira rechaza una llamada antes de que PHP la reciba. Esto ocurre cuando la cola de workers permanece llena durante 30 segundos, cuando el pool se detiene o cuando el arranque PHP del worker ha fallado.

## Metadatos

Lee los metadatos de la petición desde `$call->getContext()->metadata`. `values($name)` devuelve todos los valores de un nombre, en orden de llegada, sin distinguir mayúsculas en el nombre. El array de solo lectura `entries` tiene los nombres en minúsculas.

Rapira elimina de los metadatos de la petición los nombres de transporte, por ejemplo `grpc-timeout`, `content-type` y `te`. Descarta un valor de texto que no sea ASCII imprimible. Para un nombre que termina en `-bin`, Rapira divide el valor por `,` y decodifica cada fragmento desde base64. PHP recibe los bytes sin procesar. Se descarta un fragmento que no se puede decodificar.

Añade metadatos de respuesta antes de `respond()` o `fail()`:

```php
$requestId = $call->getContext()->metadata->values('x-request-id')[0] ?? '';
$metadata = $call->getResponseMetadata();
$metadata->addHeader('x-request-id', $requestId);
$metadata->addBinaryHeader('x-token-bin', "\x00\xff");
$metadata->addTrailer('x-result', 'completed');
```

`addHeader()` y `addTrailer()` aceptan valores ASCII imprimibles. Se permite un valor vacío. Rapira elimina los espacios iniciales y finales de un valor de texto cuando lo envía. Usa `addBinaryHeader()` o `addBinaryTrailer()` para valores binarios. El nombre de un valor binario debe terminar en `-bin`.

Un nombre de metadatos solo puede contener `0-9`, `a-z`, `_`, `-` y `.`, como especifica el [protocolo gRPC](https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md#requests). Un nombre de transporte, un nombre no válido o un valor no válido lanza `\ValueError`. Un nombre repetido añade un valor.

`headers()` y `trailers()` devuelven instantáneas. En Connect, cada trailer es una cabecera con el prefijo `trailer-`. Envía metadatos de petición con la opción `-H 'x-request-id: demo-1'` de grpcurl.

## Plazos y cancelación

Un cliente establece un tiempo de espera con `grpc-timeout` (gRPC y gRPC-Web) o `connect-timeout-ms` (Connect). `grpc.default_timeout_secs` establece el tiempo de espera de una llamada que no tiene tiempo de espera del cliente. `grpc.max_timeout_secs` reduce a su valor un tiempo de espera del cliente más largo. Ambas claves están sin definir por defecto, por lo que una llamada sin tiempo de espera del cliente no tiene plazo.

`$call->getContext()->deadline` es el plazo como marca de tiempo Unix en segundos, o `null`. `receivedAt` es el momento en que Rapira ha leído el mensaje de petición completo.

Por ejemplo, establece un plazo de dos segundos en el cliente:

```sh
grpcurl -plaintext -max-time 2 -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

Cuando vence el plazo, el cliente recibe `DEADLINE_EXCEEDED` e `isCancelled()` devuelve `true`. Rapira no puede detener el código PHP, así que PHP continúa la llamada. Comprueba `isCancelled()` durante las operaciones largas. Captura `WorkDiscardedException` alrededor de los métodos de respuesta, porque una cancelación puede ocurrir después de la comprobación.

El tiempo de espera de `receive()` establece cuánto espera PHP por trabajo nuevo. No está relacionado con el plazo de una llamada. `grpc.pool.request_terminate_timeout_secs` es un mecanismo de vigilancia del proceso. Sustituye un worker cuando una llamada dura más que el límite.

## Servicios y reflexión

El maestro carga el descriptor set antes de crear los workers con fork. Un conjunto no válido, un conjunto sin sus importaciones o un servicio desconocido impide el arranque. Un conjunto modificado requiere detener y volver a iniciar Rapira. Una recarga conserva el conjunto anterior.

Por defecto, el pool atiende los servicios de los archivos que ningún otro archivo del conjunto importa. Un archivo que otro archivo importa es una dependencia, por ejemplo `google/longrunning/operations.proto`. Sus servicios no se atienden. Define `grpc.services` para nombrar los servicios atendidos, por ejemplo `["billing.v1.InvoiceService"]`. Usa esta clave cuando varias instancias de Rapira comparten un mismo conjunto, o para atender un servicio de un archivo importado.

Un método en streaming, un método de un servicio que el pool no atiende y un método desconocido devuelven `UNIMPLEMENTED`. Al arrancar, Rapira registra una advertencia por cada método en streaming de un servicio atendido.

La reflexión está desactivada por defecto. Con `reflection = true`, Rust atiende `grpc.reflection.v1` y `grpc.reflection.v1alpha`. `ListServices` devuelve los servicios atendidos. Todos los archivos y símbolos del descriptor set están disponibles, así que cualquier cliente puede leer el conjunto completo.

Con `reflection = false`, proporciona el esquema al cliente:

```sh
grpcurl -plaintext -import-path proto -proto echo.proto -d '{"text":"hello"}' 127.0.0.1:50051 example.v1.Echo/Echo
```

## Comprobaciones de salud

Rust atiende el [protocolo de comprobación de salud de gRPC](https://github.com/grpc/grpc/blob/master/doc/health-checking.md) (`grpc.health.v1.Health`) en cada worker. `Check` y `Watch` informan `SERVING` para el nombre vacío `""` y para cada servicio atendido. Durante el apagado, informan `NOT_SERVING`.

El servicio de salud no comprueba PHP. Un worker cuyo arranque PHP ha fallado informa `SERVING`, y sus llamadas reciben `UNAVAILABLE`. `grpc.services` no puede nombrar los servicios de salud ni de reflexión, porque Rapira los atiende por sí mismo.

La reflexión no enumera el servicio de salud. Una petición JSON de Connect no necesita esquema:

```sh
curl -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:50051/grpc.health.v1.Health/Check
```

## Protocolos y límites

- Una petición JSON de Connect que no se puede decodificar devuelve `INVALID_ARGUMENT`, y PHP no recibe la llamada. El decodificador JSON ignora los campos desconocidos. No ignora un nombre de valor enum que el descriptor set no declara.
- Un método con `option idempotency_level = NO_SIDE_EFFECTS;` también acepta una petición GET de Connect.
- Los mensajes pueden usar compresión gzip. Una petición con otra codificación de mensajes devuelve `UNIMPLEMENTED`.
- El límite de tamaño de mensaje es 4 MiB. Una petición más grande devuelve `RESOURCE_EXHAUSTED`.
- `$call->getContext()->tls` siempre es `null`. Coloca un proxy TLS delante de la escucha cuando los clientes necesiten TLS. Para gRPC nativo, el proxy debe usar HTTP/2 en su conexión con Rapira.
- Rapira envía un PING keepalive de HTTP/2 a una conexión inactiva cada 10 segundos. Cierra una conexión que no responde en 10 segundos.

::: warning Una conexión usa un worker
Un único proceso worker atiende cada conexión. Un cliente gRPC suele enviar todas las llamadas de un canal por una sola conexión HTTP/2. Ese cliente obtiene el rendimiento de un worker, sea cual sea el tamaño del pool. Para usar más workers, abre varias conexiones o usa un balanceador de carga L7 que reparta las llamadas.
:::

## HTTP y gRPC juntos

Una configuración puede contener `[http]` y `[grpc]`. Cada plugin tiene su propia escucha, script de entrada PHP y pool de workers. El maestro supervisa los dos pools. El pool gRPC acepta los ajustes de escalado y reciclaje del pool HTTP, con `mode = "dispatcher"`.

Consulta [Configuración](./configuration#grpc) para ver todos los ajustes gRPC y [Modelo de procesos](./process-model) para la supervisión de pools.

## Windows

La [compilación para Windows](https://github.com/rapira-rs/rapira-windows) ofrece la misma escucha gRPC y la misma API PHP. Se aplican estas diferencias:

- `grpc.listen` solo acepta una dirección TCP.
- El pool gRPC es un pool estático de hilos de intérprete PHP en un solo proceso. `grpc.pool.processes` establece el número de hilos.
- `getmypid()` devuelve el mismo ID de proceso en cada intérprete.
- Un fallo de arranque PHP en cualquiera de los dos pools detiene el servidor con el código de salida 70.
