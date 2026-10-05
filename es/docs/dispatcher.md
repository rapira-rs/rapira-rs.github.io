---
title: Modo Dispatcher
description: "El bucle del dispatcher HTTP de Rapira, la API de Request y Exchange, las subidas de archivos, sendFile() y las excepciones del dispatcher."
faqLevel: 2
---

# Modo Dispatcher

El modo Dispatcher mantiene activo el proceso de PHP entre peticiones, como el [modo Worker](/es/docs/worker). El script inicializa la aplicación una vez y después recibe cada petición mediante una llamada a la API. Rapira no rellena las superglobales para una petición. El script lee un objeto de petición y escribe la respuesta con llamadas a métodos.

Esta página es la guía de programación del dispatcher HTTP. Consulta [Modos de ejecución](/es/docs/execution-modes) para comparar los modos. El pool gRPC también usa el modo Dispatcher. Consulta [gRPC](/es/docs/grpc) para ver la API de llamadas gRPC.

## El bucle de recepción

El script inicializa la aplicación y obtiene el dispatcher. Después recibe peticiones en un bucle hasta que Rapira cierra el dispatcher.

```php
<?php
// worker.php
use Rapira\Exception\ClosedException;
use Rapira\Exception\WorkDiscardedException;
use Rapira\LogLevel;

require __DIR__ . '/vendor/autoload.php';

$app = new App(); // The worker creates this object once and reuses it.
$dispatcher = \Rapira\get_dispatcher();

while (true) {
    try {
        $exchange = $dispatcher->receive();
    } catch (ClosedException) {
        break; // No more requests arrive for this worker.
    }

    try {
        $body = $app->handle($exchange->getRequest());
        $exchange->writeHead(200, ['content-type' => ['text/plain']]);
        $exchange->writeBody($body); // $eos is true by default, so this call ends the response.
    } catch (WorkDiscardedException) {
        // The client left before the response ended.
    } catch (\Throwable $e) {
        \Rapira\log('request failed', LogLevel::Error, ['exception' => $e]);
    }

    unset($exchange); // If the response did not end, Rapira sends 500 or cuts the response.
}
```

Dispatcher es el modo predeterminado. Establécelo de forma explícita en la tabla `[http.pool]` de un `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/worker.php"
mode = "dispatcher"
```

```bash
rapira serve rapira.toml
```

Consulta [Configuración](/es/docs/configuration#http-pool) para ver las demás claves del pool.

## Recibir una petición

`\Rapira\get_dispatcher()` devuelve un `Rapira\Http\HttpDispatcher` en un worker HTTP. Lanza `Rapira\Exception\NoDispatcherError` en los modos Classic y Worker. Usa `\Rapira\get_mode()` para comprobar el modo en un script que admite más de un modo.

| Método | Comportamiento |
| --- | --- |
| `receive(int $timeout = -1): Exchange` | Espera la siguiente petición. El tiempo de espera está en microsegundos. `-1` espera sin límite y `0` no espera. Al llegar al límite, lanza `Rapira\Exception\TimeoutException`. |
| `tryReceive(): ?Exchange` | Devuelve la siguiente petición, o `null` cuando no hay ninguna petición en espera. No espera. |
| `getInfo(): HttpDispatcherInfo` | Devuelve `pendingCount()`, las peticiones en la cola de este worker, y `activeCount()`, que es `0` o `1`. |
| `name(): string` | Devuelve `http`. |

`receive()` bloquea el hilo de PHP mientras espera. El worker no usa CPU durante la espera. El temporizador `max_execution_time` de PHP no cuenta esta espera y empieza de nuevo para cada petición. Rapira omite una petición en cola cuando su cliente se fue antes de que la petición llegara a PHP.

## Un exchange a la vez

Cada worker procesa un exchange a la vez. Finaliza la respuesta del exchange actual antes de llamar de nuevo a `receive()` o `tryReceive()`. Si no, la llamada lanza `\Error`. Los fibers no cambian esta regla. Para procesar más peticiones al mismo tiempo, aumenta `http.pool.processes`.

Estas llamadas finalizan la respuesta:

- `writeBody()` o `sendFile()` con `$eos = true`, que es el valor predeterminado.
- `writeTrailers()`.

Cuando Rapira detecta la cancelación de un exchange abierto, `receive()` y `tryReceive()` lo descartan antes de recibir más trabajo. En este caso, no lanzan el `\Error` de exchange abierto. Cuando el código elimina la última referencia a un exchange abierto, por ejemplo con `unset($exchange)`, Rapira finaliza la respuesta. Si la cabecera no se envió, Rapira envía `500` con un cuerpo vacío. Si la cabecera se envió, Rapira corta la respuesta.

Enviar todos los bytes declarados en `Content-Length` con `$eos = false` no finaliza el exchange. Finalízalo antes de la siguiente llamada de recepción. Cerrar la conexión después de entregar la respuesta completa no cancela el exchange. PHP todavía puede finalizarlo. Una desconexión antes de la entrega completa puede cancelarlo.

`http.pool.request_terminate_timeout_secs` cuenta desde el retorno de `receive()` o `tryReceive()`. Rapira termina y sustituye un worker que supera este límite. Consulta [Configuración](/es/docs/configuration#http-pool) para ver esta clave.

## Cómo termina el bucle

Durante una detención, una recarga o una sustitución después de `http.pool.max_requests`, Rapira cierra el dispatcher. Cuando el dispatcher está cerrado y su cola está vacía, `receive()` y `tryReceive()` lanzan `Rapira\Exception\ClosedException`. Cada llamada posterior la lanza de nuevo. Captura esta excepción, sal del bucle y deja que el script de entrada termine.

Una excepción no capturada o un error fatal termina el script de entrada. Después, Rapira ejecuta de nuevo el script de entrada en el mismo worker. El cliente del exchange abierto recibe una respuesta de error o una respuesta incompleta.

::: question ¿Qué ocurre cuando el script de entrada termina antes de `ClosedException`?
Si el script recibió al menos una petición, Rapira ejecuta de nuevo el script de entrada en el mismo worker. Si el script terminó antes de recibir una petición, Rapira cuenta un fallo de arranque. Si llega una petición en un plazo de cinco segundos, Rapira la responde con `503`. Después, Rapira ejecuta de nuevo el script. Después de cinco fallos de arranque consecutivos, el worker sale como no saludable.
:::

## La petición

`$exchange->getRequest()` devuelve un `Rapira\Http\Request` de solo lectura. Cada llamada devuelve el mismo objeto.

| Propiedad | Tipo | Valor |
| --- | --- | --- |
| `method` | `string` | El método de la petición, por ejemplo `GET`. |
| `uri` | `string` | La URI absoluta, por ejemplo `http://example.com/a?b=1`. El esquema es siempre `http`. Sin una autoridad, Rapira usa la dirección del servidor. |
| `target` | `string` | El destino de la petición. Para una petición en forma de origen, es la ruta y la consulta, por ejemplo `/a?b=1`. |
| `authority` | `?string` | El valor de `Host`. Es `null` para una petición HTTP/1.0 sin `Host`. |
| `protocol` | `string` | `HTTP/1.1` o `HTTP/1.0`. |
| `headers` | `array<string, list<string>>` | Los campos de la petición. Los nombres están en minúsculas. Cada nombre tiene una lista de valores. |
| `body` | `string` o `Multipart` | El cuerpo completo, o un `Rapira\Http\Multipart` para un cuerpo `multipart/form-data`. |
| `remote` | `InetAddress` o `UnixAddress` | La dirección del cliente. `Rapira\InetAddress` tiene `ip` y `port`. `Rapira\UnixAddress` tiene `path`. |
| `server` | `InetAddress` o `UnixAddress` | La dirección de la escucha. |
| `tls` | `?Rapira\Tls` | Siempre `null`. Rapira no tiene escucha TLS. |
| `receivedAt` | `float` | El tiempo Unix en segundos en que Rapira recibió la petición. |

Rapira lee el cuerpo completo en memoria antes de que PHP reciba la petición. `http.max_body_size_mb` limita el tamaño del cuerpo. Consulta [HTTP](/es/docs/http) para ver las comprobaciones de la petición.

En modo Dispatcher, `$_SERVER` conserva los valores del inicio del script de entrada. Rapira no lo cambia para cada petición. Consulta [`$_SERVER` antes de la primera petición](/es/docs/execution-modes#server-antes-de-la-primera-peticion).

## La respuesta

`Rapira\Http\Exchange` tiene estos métodos. `$headers` y `$trailers` usan la forma `array<string, list<string>>`: cada nombre de campo tiene una lista de valores.

| Método | Comportamiento |
| --- | --- |
| `writeHead(int $status, array $headers = []): void` | Establece el estado y los campos. El estado debe estar entre 100 y 599. Rapira no reenvía una cabecera `1xx`. El estado `101` da al cliente un `502`. Rapira envía la cabecera con la primera escritura del cuerpo, `flush()` o `writeTrailers()`. |
| `writeBody(string $content, bool $eos = true): void` | Escribe datos del cuerpo. Sin `writeHead()`, el estado es `200`. Establece `$eos` en `false` para escribir más datos después. |
| `sendFile(string $path, int $offset = 0, ?int $length = null, bool $eos = true): void` | Envía un archivo o una parte de un archivo como datos del cuerpo. Consulta [Enviar un archivo](#enviar-un-archivo). |
| `writeTrailers(array $trailers): void` | Finaliza la respuesta. Llámalo después de `writeHead()` o de una escritura del cuerpo. Rapira no envía los trailers al cliente. |
| `flush(): void` | Envía la cabecera inmediatamente. Sin `writeHead()`, el estado es `200`. |
| `isFinalized(): bool` | Devuelve `true` cuando el exchange está finalizado o Rapira detecta su cancelación. |
| `isCancelled(): bool` | Devuelve `true` cuando Rapira detecta la cancelación del exchange. Cerrar la conexión después de entregar la respuesta completa no lo cancela. |

Establece `content-length` en `writeHead()` cuando conoces el tamaño del cuerpo. Una escritura que supera esta longitud envía la parte que cabe, finaliza la respuesta y lanza `ContentLengthExceededError`. Sin `content-length`, el servidor HTTP delimita el cuerpo. Consulta [Transmisión de la respuesta](/es/docs/http#transmision-de-la-respuesta) para ver las reglas de delimitación y los campos que Rapira elimina.

Para enviar una respuesta en streaming, llama a `writeBody()` con `$eos = false` para cada parte. Después, llama a `writeBody('')` para finalizar la respuesta.

Limita cada fragmento de `writeBody()` a 1 GiB como máximo. Un fragmento mayor lanza `\Error` y termina la respuesta truncada. Este límite se aplica a cada fragmento, no a la respuesta completa en streaming.

Un cliente lento puede llenar el canal de respuesta. Una escritura bloquea entonces el hilo PHP hasta que haya espacio disponible o se cierre el canal. Esto bloquea todos los Fibers de PHP en ese worker.

## Subidas de archivos

Rapira analiza un cuerpo `multipart/form-data` antes de que PHP reciba la petición. `Request::$body` es entonces un `Rapira\Http\Multipart`:

| Clase | Propiedades |
| --- | --- |
| `Multipart` | `fields`, una lista de `FormField`. `files`, una lista de `UploadedFile`. |
| `FormField` | `name`, `value`, `headers`. |
| `UploadedFile` | `name`, `clientFilename`, `clientMediaType`, `headers`, `tmpPath`, `size`. |

Rapira escribe cada parte de archivo en un archivo temporal en el subdirectorio `rapira-spool-<pid>` de `http.uploads.dir`. `UploadedFile::$tmpPath` contiene la ruta de este archivo. Rapira elimina los archivos temporales cuando la respuesta finaliza. Para conservar un archivo, muévelo con `rename()` antes de que la respuesta finalice.

Rapira devuelve `400` para un cuerpo mal formado. Devuelve `413` cuando el cuerpo supera un límite. El script no recibe estas peticiones. Consulta [La tabla `[http.uploads]`](/es/docs/configuration#la-tabla-http-uploads) para ver los límites.

## Enviar un archivo

`sendFile()` lee solo archivos dentro de la raíz de sendfile. La raíz predeterminada es el directorio de `http.pool.entrypoint`. Rapira resuelve los enlaces simbólicos antes de comparar la ruta con la raíz. Consulta [La tabla `[http.sendfile]`](/es/docs/configuration#la-tabla-http-sendfile) para establecer la raíz.

El host abre el archivo. PHP `open_basedir` no restringe esta operación. La raíz de sendfile configurada restringe la ruta.

La llamada lanza `Rapira\Http\Exception\FileNotSendableException` y no escribe datos en estas condiciones:

- La ruta está fuera de la raíz.
- El archivo no existe o no es un archivo regular.
- El desplazamiento o la longitud supera el final del archivo.

Rapira no establece `content-type`, `etag` ni campos de rango para el archivo. Establece los campos necesarios con `writeHead()`.

```php
$exchange->writeHead(200, ['content-type' => ['application/pdf']]);
$exchange->sendFile(__DIR__ . '/files/report.pdf');
```

Coloca `report.pdf` en el directorio `files/` junto al script de entrada. Esta ruta está dentro de la raíz predeterminada. Una raíz personalizada también debe contener el archivo.

## Excepciones

Cada clase de excepción de los espacios de nombres `Rapira` implementa `Rapira\Exception\RapiraThrowable`. `\Error` y `\ValueError` simples no la implementan.

| Excepción | Lanzada por | Causa |
| --- | --- | --- |
| `Rapira\Exception\ClosedException` | `receive()`, `tryReceive()` | Rapira cerró el dispatcher. No llegan más peticiones. |
| `Rapira\Exception\TimeoutException` | `receive()` | No llegó ninguna petición antes del tiempo de espera. |
| `Rapira\Exception\NoDispatcherError` | `\Rapira\get_dispatcher()` | El proceso no se ejecuta en modo Dispatcher. |
| `Rapira\Exception\WorkDiscardedException` | Los métodos de escritura | Rapira canceló el exchange antes de que PHP lo finalizara. |
| `Rapira\Exception\AlreadyFinalizedError` | `writeBody()`, `sendFile()`, `writeTrailers()`, `flush()` | La respuesta ya finalizó. |
| `Rapira\Http\Exception\HeadAlreadyWrittenError` | `writeHead()` | La cabecera ya está establecida, o la respuesta ya finalizó. |
| `Rapira\Http\Exception\HeadNotWrittenError` | `writeTrailers()` | Todavía no existen ni cabecera ni datos del cuerpo. |
| `Rapira\Http\Exception\ContentLengthExceededError` | `writeBody()`, `sendFile()` | La escritura supera el `content-length` declarado. |
| `Rapira\Http\Exception\FileNotSendableException` | `sendFile()` | Rapira no puede enviar el archivo. |
| `\Error` | `receive()`, `tryReceive()` | El exchange anterior todavía está abierto. |
| `\Error` | `writeBody()` | Un fragmento supera 1 GiB. Rapira termina la respuesta truncada. |
| `\Error` | `rapira_finish_request()` | La función no está disponible en modo Dispatcher. Finaliza el exchange en su lugar. |
| `\ValueError` | Varios métodos | Un argumento no es válido. Algunos ejemplos son un estado fuera del rango de 100 a 599, un campo que no es válido en la red o un campo de trailer como `content-type`. |

## Salida de `echo`

En modo Dispatcher, `echo`, `print` y otra salida de PHP no van al cliente. Rapira escribe cada llamada de salida en el registro, en el target `php` con el nivel `info`. El nivel de registro predeterminado `error` oculta estos registros. Usa los métodos del exchange para escribir la respuesta. Consulta [Registros](/es/docs/logging#ajustes-por-target) para mostrar el target `php`.

## Los stubs para el IDE

Rapira declara sus funciones y clases de PHP en archivos stub. Las interfaces del dispatcher y las funciones principales están en [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php). Los tipos HTTP y las clases de excepción HTTP están en [`rapira_http.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/plugins/http/rapira_http.stub.php). Las demás clases de excepción están en [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira_exception.stub.php). Añade estos archivos al proyecto para activar el autocompletado del IDE.
