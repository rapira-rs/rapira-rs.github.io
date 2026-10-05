---
title: Peticiones y respuestas HTTP
description: "Cómo convierte Rapira las peticiones HTTP en peticiones de PHP y devuelve las respuestas de PHP: campos, límites del cuerpo, delimitación de la respuesta y rapira_finish_request()."
faqLevel: 2
---

# Peticiones y respuestas HTTP

El servidor HTTP convierte una conexión de cliente en una petición de PHP y convierte la respuesta de PHP en datos de red. Usa la biblioteca [hyper](https://hyper.rs) y acepta HTTP/1.1 y HTTP/1.0. No reenvía peticiones a otro servidor.

Un middleware puede responder a una petición antes de ejecutar PHP. Rapira usa middleware para servir [archivos estáticos](/es/docs/static-files).

::: info
El servidor HTTP acepta HTTP sin cifrar. Usa un proxy para terminar TLS. Consulta [En producción](/es/docs/deployment).
:::

## Comprobación de peticiones

El servidor HTTP comprueba cada petición antes de ejecutar PHP. No llama a PHP para una petición que no supera una comprobación.

Rapira devuelve `501` para una petición `CONNECT`. El servidor HTTP no crea túneles.

Rapira acepta un objetivo de petición en forma absoluta, como `GET http://host.example/admin?x=1 HTTP/1.1`. Rapira elimina los datos de usuario de la autoridad del objetivo. Después, la autoridad sustituye al campo `Host`, por lo que `$_SERVER['HTTP_HOST']` y el objetivo coinciden. PHP recibe la ruta y la consulta en forma de origen en `$_SERVER['REQUEST_URI']`.

`http.keepalive_timeout_secs` limita cada lectura del cliente. Se aplica a una conexión inactiva y a las cabeceras de la petición. Rapira devuelve `408` si no recibe datos del cuerpo antes del límite. Después cierra la conexión. El valor predeterminado es 60 segundos.

```toml
[http]
keepalive_timeout_secs = 60
```

## Del nombre de una cabecera a una clave de `$_SERVER`

CGI convierte el nombre de un campo de la petición a mayúsculas, sustituye cada `-` por `_` y añade `HTTP_`. Consulta [RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18). Por tanto, `X-Forwarded-For` se convierte en `HTTP_X_FORWARDED_FOR`.

PHP aplica otra conversión al registrar la variable. También sustituye `.` por `_`. Por tanto, estos tres nombres de campo de red se asignan a una clave de PHP:

| En la red         | En PHP                              |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
Sin la comprobación obligatoria de nombres de campo de Rapira, esta colisión puede crear un riesgo de seguridad. Un proxy puede establecer `X-Forwarded-For` y un cliente puede enviar `X_Forwarded_For`. Ambos nombres se asignan a la misma clave de `$_SERVER`. Un filtro del proxy para el nombre con guiones podría no eliminar el nombre con guiones bajos. La aplicación podría entonces confiar en un valor del cliente.
:::

Rapira también establece las variables de petición de CGI. `SERVER_NAME` viene de `http.server_name`, y el valor predeterminado es `localhost`. `SERVER_PORT` viene de `http.server_port`, y el valor predeterminado es el puerto TCP de `http.listen` o `80` para un socket Unix. Para un cliente en un socket Unix, `REMOTE_ADDR` es `127.0.0.1` y `REMOTE_PORT` es `0`. Rapira no establece `PATH_INFO`.

Rapira solo acepta HTTP sin cifrar. Por tanto, `$_SERVER['HTTPS']` siempre está vacío y `REQUEST_SCHEME` siempre es `http`. Detrás de un proxy TLS, configura la aplicación para leer los campos del proxy.

## Nombres que colisionan con una variable CGI

Rapira solo acepta los bytes `A-Z`, `a-z`, `0-9` y `-` en el nombre de un campo de la petición. Esta regla rechaza `_` y `.`, y también otros caracteres, como `~`. `http.unsafe_field_names` define la acción para un nombre rechazado:

- **`drop`** es el valor predeterminado. En los modos Classic y Worker, Rapira elimina los campos antes de que PHP los reciba. Escribe un registro `warn` por cada petición. En modo Dispatcher, `drop` conserva todos los nombres, porque Rapira no pone los campos de la petición en `$_SERVER` en este modo.
- **`reject`** hace que Rapira devuelva `400` en todos los modos.

```toml
[http]
unsafe_field_names = "drop"
```

No puedes desactivar la comprobación ni añadir excepciones para nombres concretos. Consulta [Configuración](/es/docs/configuration) para ver la referencia completa de ajustes.

Cambia un nombre de campo obligatorio con guiones bajos para que use guiones. Rapira aplica la misma regla a los campos de un proxy. No puede determinar si un cliente o un proxy de confianza envió un campo con guiones bajos. Configura el proxy para cambiar el nombre antes de enviar el campo.

::: tip
`drop` escribe sus registros en el nivel `warn`, pero el nivel de registro predeterminado es `error`. Configura el target `http` como `warn` para ver estos registros. Consulta [Registros](/es/docs/logging) para más información.
:::

## Campos que llegan más de una vez

HTTP permite campos repetidos, pero CGI proporciona un valor por variable. Rapira combina los valores repetidos según la sintaxis del campo:

- **Campos de lista:** Rapira une los valores con una coma y un espacio. Por ejemplo, dos líneas `Accept` se convierten en `text/*, image/*`. [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) permite este formato para campos separados por comas.
- **`Cookie`:** Rapira une los valores con un punto y coma y un espacio. El analizador de cookies de PHP espera este formato.
- **Campos de valor único:** Rapira conserva la primera línea `Authorization`, `Proxy-Authorization`, `Content-Type`, `Referer` o `From`. Ignora las demás líneas, porque un valor combinado tiene otro significado.
- **`Host`:** Rapira devuelve `400` si hay más de una línea `Host`. [RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2) exige este comportamiento.

Antes de este procesamiento, Rapira devuelve `400` para líneas `Content-Length` con valores distintos.

PHP recibe los valores de campo como bytes sin modificar. Por tanto, una cookie Latin-1 o un campo firmado conserva cada byte que envió el cliente.

## Cuerpos de petición

Rapira lee el cuerpo de la petición en memoria antes de ejecutar PHP. `http.max_body_size_mb` limita la memoria para un cuerpo. El valor predeterminado es 8 MiB, igual que el valor predeterminado de `post_max_size` en PHP. Rapira devuelve `413` para un cuerpo mayor y cierra la conexión. No lee el resto de los datos del cuerpo.

Rapira comprueba el límite dos veces:

- Rapira comprueba primero el `Content-Length` declarado antes de leer datos del cuerpo.
- Comprueba otra vez cuando llegan los fragmentos del cuerpo. Esta segunda comprobación limita las peticiones chunked sin longitud declarada.

Rapira admite `Expect: 100-continue` para peticiones HTTP/1.1. Envía `100 Continue` antes de que el cliente envíe el cuerpo. Rapira comprueba primero `Content-Length`. Por tanto, puede devolver `413` antes de que el cliente suba un cuerpo demasiado grande. Rapira ignora esta expectativa para HTTP/1.0, como exige [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1).

```toml
[http]
max_body_size_mb = 8
```

## Transmisión de la respuesta

El modo controla cuándo recibe el servidor HTTP la respuesta de PHP:

- En los modos Classic y Worker, Rapira mantiene la respuesta completa en memoria. Envía la respuesta cuando termina la petición o cuando el script llama a `rapira_finish_request()`.
- En modo Dispatcher, Rapira envía las cabeceras con la primera escritura del cuerpo o con `Exchange::flush()`. Después envía cada fragmento del cuerpo cuando el script lo escribe.

`http.write_timeout_secs` limita el tiempo que una escritura al cliente puede quedar detenida. Cuando el límite expira, Rapira cierra la conexión. El valor predeterminado es 30 segundos.

El servidor controla la delimitación de la respuesta. Por tanto, una longitud incorrecta de PHP no cambia los límites de los mensajes. El servidor elimina estos campos que establece PHP: `Content-Length`, `Transfer-Encoding`, `Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE` y `Proxy-Connection`. [RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1) define estos campos específicos de conexión.

Cuando PHP envía `Connection`, Rapira también elimina cada campo que nombra. Rapira añade su propio `Content-Length` después de este paso. Por tanto, `Connection: content-length` no puede eliminar la delimitación de la respuesta.

Después, Rapira establece la longitud:

- En los modos Classic y Worker, Rapira establece `Content-Length` con la longitud del cuerpo completo.
- En modo Dispatcher, Rapira usa el `Content-Length` que el script declara en las cabeceras. Cierra la conexión cuando el cuerpo es más corto, para que el cliente no lea la siguiente respuesta como parte de esta. Corta un cuerpo más largo.
- En modo Dispatcher, Rapira calcula `Content-Length` cuando el primer `writeBody()` o `sendFile()` finaliza la respuesta antes de enviar la cabecera. Una longitud declarada tiene prioridad. Una respuesta que solo contiene trailers recibe longitud cero.
- Si la cabecera no tiene longitud declarada ni calculada, Rapira usa la codificación de transferencia chunked para HTTP/1.1. Para HTTP/1.0, cierra la conexión después del cuerpo. Esto se aplica a las escrituras en streaming y a una llamada temprana a `Exchange::flush()`.

Para las respuestas PHP, Rapira elimina `Content-Length` y no envía cuerpo en `204`, `304` y `HEAD`. Las respuestas `HEAD` de archivos estáticos conservan la longitud del archivo. Consulta [Archivos estáticos](/es/docs/static-files).

Rapira envía los demás campos de PHP sin cambios, por ejemplo campos `Set-Cookie`, `Vary` y `Link` repetidos. En los modos Classic y Worker, elimina un campo no válido y escribe un registro `debug`, pero envía el resto de la respuesta. Rapira no envía cabeceras provisionales (`1xx`) ni trailers de PHP. Por tanto, `103 Early Hints` no llega al cliente.

Si un worker se detiene antes de completar el cuerpo, el servidor cierra la conexión sin un terminador completo. Un error fatal después de iniciar la salida también puede cortar la respuesta. En modo Worker, una excepción no capturada del handler después de iniciar la salida corta la respuesta, pero el bucle continúa. El cliente puede detectar cada mensaje incompleto.

::: question ¿`flush()` envía la salida antes en los modos Classic y Worker?
No. La función `flush()` de PHP no envía datos al cliente. Usa el modo Dispatcher para transmitir una respuesta por partes. Cuando el cuerpo almacenado supera 1 GiB, Rapira detiene la petición y el cliente recibe una respuesta incompleta.
:::

## Respuestas de error

El servidor HTTP envía una respuesta de error cuando una petición no llega a PHP o PHP no envía las cabeceras de la respuesta. Esta respuesta no tiene cuerpo. Incluye `cache-control: private, no-store` y `connection: close`.

| Estado | Causa |
| --- | --- |
| `400` | La petición tiene más de un campo `Host`. Una petición HTTP/1.1 no tiene campo `Host` o tiene un campo `Host` vacío. Un nombre de campo no es seguro y `unsafe_field_names = "reject"` está configurado. La lectura del cuerpo falló. En modo Dispatcher, un cuerpo multipart no es válido. |
| `408` | No llegaron datos del cuerpo dentro de `http.keepalive_timeout_secs`. |
| `413` | El cuerpo es mayor que `http.max_body_size_mb`, o un cuerpo multipart supera un límite de `[http.uploads]`. |
| `500` | El pool de workers se detuvo. En modo Dispatcher, Rapira no puede escribir un archivo subido en `[http.uploads].dir`. |
| `501` | La petición usa `CONNECT`. |
| `502` | El worker de PHP se detuvo antes de enviar las cabeceras de la respuesta. |
| `503` | La cola de workers estuvo llena durante 30 segundos. |

Rapira envía estos estados sin los dos campos:

- `503` cuando un worker no puede iniciar su script de entrada. Después de cada inicio fallido, el worker responde a una petición en cola con este estado.
- `502` cuando PHP establece un estado final menor que `200`, como `101`.
- `500` cuando un script de Dispatcher libera un exchange antes de que Rapira envíe las cabeceras de la respuesta.

## Modo Dispatcher

En modo Dispatcher, Rapira no pone los campos de la petición en `$_SERVER`. El script lee la petición de un objeto `Rapira\Http\Exchange` y escribe la respuesta con sus métodos. Rapira analiza un cuerpo `multipart/form-data` antes de que el script lo reciba. Consulta [Modo Dispatcher](/es/docs/dispatcher) para ver la API, las subidas de archivos y `sendFile()`.

## Terminar la respuesta antes de tiempo

Un handler puede continuar su trabajo después de preparar la respuesta. Por ejemplo, puede enviar un webhook, escribir una entrada de cola o actualizar datos en caché. El cliente no necesita esperar este trabajo.

`rapira_finish_request()` termina la respuesta en ese punto. PHP vacía sus búferes de salida y entrega la respuesta al servidor HTTP. El servidor HTTP envía la respuesta mientras el handler continúa. La función funciona como la función `fastcgi_finish_request()` de php-fpm. Rapira no proporciona `fastcgi_finish_request()`. Sustituye cada llamada a esta función por `rapira_finish_request()`:

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// Este código se ejecuta después de que el cliente recibe la respuesta.
$mailer->sendConfirmation($order);
$metrics->flush();
```

La firma es `rapira_finish_request(): bool`. El archivo [`crates/sapi/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php) la declara junto con las demás funciones y clases de PHP. Configura el IDE para usar este archivo para el autocompletado y la información de tipos.

`rapira_finish_request()` funciona en los modos Classic y Worker. En modo Dispatcher, la llamada lanza `\Error`. En este modo, finaliza el exchange que devuelve `receive()` y después continúa el trabajo. Consulta [Modo Dispatcher](/es/docs/dispatcher) y [Modos de ejecución](/es/docs/execution-modes) para más información.

La función tiene estos límites:

- **Rapira descarta la salida después de la llamada.** Escribe toda la salida para el cliente antes de la llamada.
- **El worker sigue ejecutando el handler.** No puede aceptar su siguiente petición hasta que el handler termina. Por tanto, la llamada puede reducir el tiempo de espera del cliente, pero no añade concurrencia. Pon las operaciones largas en una cola. Consulta [Modelo de procesos](/es/docs/process-model) para ver la concurrencia de los workers.
