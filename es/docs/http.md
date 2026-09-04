---
title: Peticiones y respuestas HTTP
description: "Cómo convierte Rapira una petición HTTP en superglobales de PHP, y la respuesta de PHP en bytes que salen por la red: correspondencia de nombres de campo, campos repetidos, límites del cuerpo, delimitación de la respuesta y rapira_finish_request()."
faqLevel: 2
---

# Peticiones y respuestas HTTP

El servidor HTTP convierte una conexión de cliente en una petición de PHP. Convierte la respuesta de PHP en datos de red. Usa la biblioteca [hyper](https://hyper.rs) dentro del binario de Rapira. Acepta HTTP/1.1 y HTTP/1.0 en el socket del proceso maestro. El servidor analiza cada petición, la envía a PHP y escribe la respuesta. No reenvía peticiones a otro servidor. Un middleware puede responder antes de ejecutar PHP. Rapira usa este método para servir [archivos estáticos](/es/docs/static-files).

Esta página explica la validación, las claves de `$_SERVER`, los campos repetidos, los límites del cuerpo y la delimitación de respuestas.

::: info
El servidor acepta HTTP sin cifrar. Usa un proxy para terminar TLS. Consulta [En producción](/es/docs/deployment).
:::

## Comprobación de peticiones

El servidor HTTP comprueba cada petición antes de ejecutar PHP. Responde a una petición no válida sin llamar a PHP.

Rapira devuelve `501` para una petición `CONNECT`. El servidor HTTP no crea túneles.

Rapira acepta un objetivo absoluto, como `GET http://host.example/admin?x=1 HTTP/1.1`. La autoridad del objetivo sustituye al campo `Host`. Rapira elimina primero los datos de usuario de la autoridad. Así evita un conflicto en `$_SERVER['HTTP_HOST']`. PHP recibe la ruta y la consulta en `$_SERVER['REQUEST_URI']`.

`http.keepalive_timeout_secs` limita cada lectura del cliente. Se aplica a una conexión inactiva y a las cabeceras. Rapira devuelve `408` si la lectura del cuerpo no avanza antes del límite. Después cierra la conexión. El valor predeterminado es 60 segundos.

```toml
[http]
keepalive_timeout_secs = 60
```

## Del nombre de una cabecera a una clave de `$_SERVER`

CGI convierte el nombre de un campo a mayúsculas. Sustituye cada `-` por `_` y añade `HTTP_`. Consulta [RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18). Por tanto, `X-Forwarded-For` se convierte en `HTTP_X_FORWARDED_FOR`.

PHP aplica otra conversión al registrar la variable. También sustituye `.` por `_`. Por tanto, tres nombres de red se asignan a una clave de PHP:

| En la red         | En PHP                              |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
Sin la comprobación obligatoria de nombres de campo de Rapira, esta colisión puede crear un riesgo de seguridad. Un proxy puede establecer `X-Forwarded-For` y un cliente puede enviar `X_Forwarded_For`. Ambos nombres se asignan a la misma clave de `$_SERVER`. Un filtro del proxy para el nombre con guiones podría no eliminar el nombre con guiones bajos. La aplicación podría confiar en el valor del cliente.
:::

## Nombres que colisionan con una variable CGI

Rapira comprueba los nombres de campo antes de otro procesamiento. Solo acepta bytes de `[A-Za-z0-9-]`. Los caracteres `_` y `.` pueden producir la misma clave de `$_SERVER` que `-`. La lista también rechaza otros caracteres, como `~`. `http.unsafe_field_names` controla los nombres rechazados:

- **`drop`** (por defecto) - el campo se elimina antes de que PHP lo vea, y cada eliminación se registra con nivel `warn` en el target `http`.
- **`reject`** - a la petición se le responde `400` y no se sirve nada.

```toml
[http]
unsafe_field_names = "drop"
```

No puedes desactivar la comprobación ni añadir excepciones para nombres concretos. Consulta [Configuración](/es/docs/configuration) para ver todos los ajustes.

Cambia un nombre de campo obligatorio con guiones bajos para que use guiones. Rapira aplica la misma regla a los campos del proxy. Rapira no puede determinar el origen de un campo con guiones bajos. Configura el proxy para cambiar el nombre antes de enviarlo.

::: tip
`drop` registra cada eliminación en `warn`, pero el nivel predeterminado es `error`. Configura el target `http` como `warn` para ver estos registros. Consulta [Registros](/es/docs/logging).
:::

## Campos que llegan más de una vez

HTTP permite campos repetidos, pero CGI proporciona un valor por variable. Rapira combina los valores según la sintaxis del campo:

- **Campos de lista:** Rapira une los valores con una coma y un espacio. Consulta [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3).
- Por ejemplo, dos líneas `Accept` se convierten en `text/*, image/*`.
- **`Cookie`:** Rapira une los valores con un punto y coma y un espacio. El analizador de cookies de PHP espera este formato.
- **Campos de valor único:** Rapira conserva la primera línea `Authorization`, `Proxy-Authorization`, `Content-Type`, `Referer` o `From`.
- Elimina las líneas adicionales y escribe un registro `warn`. Devuelve `400` para campos `Content-Length` repetidos.
- **`Host`:** Rapira devuelve `400` si hay varias líneas `Host`. Consulta [RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2).

PHP recibe los valores de campo como bytes sin modificar. Por tanto, una cookie Latin-1 o un campo firmado conserva cada byte.

## Cuerpos de petición

Rapira lee el cuerpo en memoria antes de ejecutar PHP. `http.max_body_size_mb` limita la memoria para un cuerpo. El valor predeterminado es 8 MiB, igual que `post_max_size` en PHP. Rapira devuelve `413` para un cuerpo mayor y cierra la conexión. No lee los datos restantes.

El límite se comprueba dos veces:

- Primero comprueba el `Content-Length` declarado antes de leer el cuerpo.
- Después comprueba cada fragmento. Esta comprobación limita las peticiones chunked sin longitud declarada.

Rapira admite `Expect: 100-continue` para HTTP/1.1. Envía `100 Continue` antes de que el cliente envíe el cuerpo. Rapira comprueba primero `Content-Length`. Por tanto, puede devolver `413` antes de subir un cuerpo demasiado grande. Ignora esta expectativa para HTTP/1.0, como exige [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1).

```toml
[http]
max_body_size_mb = 8
```

## Transmisión de la respuesta

El servidor HTTP no almacena el cuerpo de respuesta. Escribe las cabeceras cuando PHP las confirma. Después escribe cada fragmento cuando PHP lo produce. El modo controla cuándo PHP entrega los datos. En Classic y Worker, PHP suele entregar la respuesta completa al final. `rapira_finish_request()` la entrega antes. En Dispatcher, PHP entrega las cabeceras y los fragmentos cuando el código los escribe.

El servidor controla la delimitación. Elimina los campos `Transfer-Encoding` y `Content-Length` establecidos por PHP. En Classic y Worker, el servidor establece la longitud del cuerpo completo. En Dispatcher, usa el `Content-Length` declarado por PHP y lo compara con el cuerpo. Cierra la conexión para un cuerpo corto. Corta un cuerpo largo en la longitud declarada.

Para una respuesta sin longitud, el servidor usa transferencia chunked en HTTP/1.1. En HTTP/1.0, cierra la conexión después del cuerpo.

El servidor omite `Content-Length` en respuestas `204` y `304`. También omite este campo y el cuerpo en respuestas `HEAD`.

El servidor elimina los campos específicos de conexión que establece PHP. Este comportamiento se define en [RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1):

`Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE`, `Proxy-Connection` y, además, los dos campos de delimitación, `Content-Length` y `Transfer-Encoding`.

Cuando PHP envía `Connection`, Rapira también elimina los campos que nombra. Esto ocurre antes de añadir su propio `Content-Length`. Por tanto, `Connection: content-length` no puede eliminar la delimitación.

El servidor envía los demás campos de PHP sin cambios, incluidos `Set-Cookie`, `Vary` y `Link` repetidos. Elimina un campo de red no válido y escribe un registro. Envía el resto de la respuesta.

Rapira elimina las respuestas provisionales y los trailers de PHP. El servidor HTTP crea la respuesta `100 Continue` para una petición `Expect`.

Si un worker termina antes de completar el cuerpo, el servidor cierra la conexión sin un terminador completo. El servidor también cierra la conexión si el cuerpo es menor que la longitud declarada por PHP. Un error fatal después de iniciar la salida puede terminar el script y truncar la respuesta. En modo Worker, una excepción no capturada del handler después de iniciar la salida trunca la respuesta, pero el bucle continúa. Cada caso produce un mensaje incompleto que el cliente puede detectar.

Una respuesta de error del servidor HTTP no tiene cuerpo. Incluye `cache-control: private, no-store` y `connection: close`. Algunos ejemplos son `413` para un cuerpo grande y `501` para `CONNECT`.

::: question ¿Por qué es el frontal, y no PHP, quien pone los campos de delimitación?
El servidor HTTP compara el tamaño del cuerpo con la longitud declarada. Cierra la conexión cuando el cuerpo es demasiado corto. Así, el cliente no puede leer la siguiente respuesta como parte de la actual. El servidor elimina un `Content-Length` de PHP porque podría evitar esta cuenta.
:::

## Terminar la respuesta antes de tiempo

Un handler puede continuar después de preparar la respuesta. Por ejemplo, puede enviar un webhook, escribir una entrada de cola o actualizar datos en caché. El cliente no necesita esperar este trabajo.

`rapira_finish_request()` termina la respuesta en ese punto. PHP vacía sus búferes de salida y entrega la respuesta al servidor HTTP. El servidor envía la respuesta mientras el handler continúa. La función tiene el mismo contrato que `fastcgi_finish_request()`:

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// This code runs after the client receives the response.
$mailer->sendConfirmation($order);
$metrics->flush();
```

La firma es `rapira_finish_request(): bool`. El archivo [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php) la declara junto con las demás API de PHP. Añade este archivo al IDE para obtener autocompletado e información de tipos.

Rapira registra la función para todo el proceso. La función actúa sobre la petición actual. Por tanto, Classic también la admite. Consulta [Modos de ejecución](/es/docs/execution-modes).

La función tiene estos límites:

- **La salida posterior a la llamada no se envía.** Rapira descarta la salida después de cerrar la respuesta.
- Escribe toda la salida necesaria antes de la llamada.
- **El worker sigue ocupado.** No acepta otra petición hasta que termina el handler.
- La llamada reduce la latencia del cliente, pero no añade concurrencia. Envía el trabajo largo a una cola.
