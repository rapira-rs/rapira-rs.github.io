---
title: Peticiones y respuestas HTTP
description: "Cómo convierte Rapira una petición HTTP en superglobales de PHP, y la respuesta de PHP en bytes que salen por la red: correspondencia de nombres de campo, campos repetidos, límites del cuerpo, delimitación de la respuesta y rapira_finish_request()."
faqLevel: 2
---

# Peticiones y respuestas HTTP

El frontal HTTP es el componente de Rapira que convierte la conexión de un cliente en una petición de PHP, y la respuesta de PHP en bytes que salen por la red. Está construido sobre la biblioteca [hyper](https://hyper.rs) y viene dentro del binario. Termina conexiones HTTP/1.1 y HTTP/1.0. Acepta conexiones en el socket que abrió el proceso maestro, parsea la petición, se la entrega a PHP y devuelve lo que PHP haya producido. No hay ningún upstream detrás: no se hace proxy de nada y cada petición se responde aquí mismo. Un middleware por delante de PHP puede responder una petición por su cuenta, y así es como se sirven los [archivos estáticos](/es/docs/static-files).

Esta página cubre las partes donde la traducción entre HTTP y PHP no es uno a uno: qué rechaza el frontal antes de que PHP se ejecute, qué campo de cabecera acaba en qué clave de `$_SERVER`, qué pasa cuando un cliente manda el mismo campo dos veces, cuánto puede ocupar el cuerpo de una petición y cómo se delimita tu respuesta al salir.

::: info
El frontal termina conexiones HTTP en claro. Si necesitas TLS, termínalo en un proxy delante de Rapira: mira [En producción](/es/docs/deployment).
:::

## Admisión de peticiones

El frontal revisa cada petición antes de que PHP se ejecute. A una petición que no supera una comprobación la responde el frontal, y PHP no llega a verla.

A una petición `CONNECT` se le responde `501`: el frontal no implementa túneles.

Se acepta un objetivo de petición en forma absoluta, por ejemplo `GET http://host.example/admin?x=1 HTTP/1.1`. La autoridad que va en el objetivo sustituye al campo `Host`, y antes se le quita la parte de userinfo, de modo que `$_SERVER['HTTP_HOST']` no puede contradecir al objetivo. PHP ve en `$_SERVER['REQUEST_URI']` la ruta y la cadena de consulta en forma de origen.

`http.keepalive_timeout_secs` acota todas las lecturas del cliente. Cierra una conexión keep-alive que está ociosa y acota también la lectura de la cabecera de la petición. A un cuerpo de petición que no avanza en ese tiempo se le responde `408`, y la conexión se cierra. Por defecto son 60 segundos.

```toml
[http]
keepalive_timeout_secs = 60
```

## Del nombre de una cabecera a una clave de `$_SERVER`

CGI tiene una única regla para exponerle a un script los campos de la petición: coge el nombre del campo, pásalo a mayúsculas, cambia cada `-` por `_` y ponle delante `HTTP_` ([RFC 3875 §4.1.18](https://www.rfc-editor.org/rfc/rfc3875#section-4.1.18)). Así, `X-Forwarded-For` se convierte en `HTTP_X_FORWARDED_FOR`, y esa es la clave que lee tu código.

Y PHP, al registrar la variable, añade encima una segunda reescritura propia: el `.` también pasa a ser `_`. Dos transformaciones que aplastan caracteres distintos contra el mismo guion bajo y, como resultado, tres nombres diferentes en la red terminan en una sola clave:

| En la red         | En PHP                              |
| ----------------- | ----------------------------------- |
| `X-Forwarded-For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X_Forwarded_For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |
| `X.Forwarded.For` | `$_SERVER['HTTP_X_FORWARDED_FOR']`  |

::: warning
Esta colisión de nombres es un problema de seguridad. Si un proxy de confianza delante de Rapira pone `X-Forwarded-For`, un cliente que mande `X_Forwarded_For` llega a esa misma clave de `$_SERVER`, y el filtro de cabeceras del propio proxy, que borra la grafía con guiones, ni se entera de la del guion bajo. El cliente puede escribir un valor que tu aplicación da por puesto por el proxy.
:::

## Nombres que colisionan con una variable CGI

Por eso Rapira revisa los nombres de campo de la petición antes de que los vea ninguna otra capa. Un nombre se acepta cuando todos sus bytes están en `[A-Za-z0-9-]`. Los caracteres que colisionan son `_` y `.`: los dos caen en la misma clave de `$_SERVER` que la grafía con guiones. La regla es una lista de permitidos y no una lista de esos dos bytes prohibidos, así que un carácter legal pero raro como `~` también se rechaza, y el filtro seguirá siendo correcto si alguna de las dos transformaciones se amplía algún día. Qué pasa con un nombre rechazado lo decide `http.unsafe_field_names`:

- **`drop`** (por defecto) — el campo se elimina antes de que PHP lo vea, y cada eliminación se registra con nivel `warn` en el target `http`.
- **`reject`** — a la petición se le responde `400` y no se sirve nada.

```toml
[http]
unsafe_field_names = "drop"
```

No hay una tercera opción que apague el filtro ni excepciones para un nombre concreto, porque la colisión que el filtro evita es un problema de seguridad. En [Configuración](/es/docs/configuration) puedes ver dónde encaja esta clave entre el resto de ajustes.

Si tus clientes mandan legítimamente un nombre con guion bajo, la solución es renombrarlo a la grafía con `-`. El filtro trata igual los campos del propio proxy: Rapira no puede distinguir un campo con guion bajo escrito por un proxy de confianza de otro falsificado por un cliente, así que el `X_Forwarded_For` que ponga un proxy también se descarta antes de que PHP se ejecute. Un proxy delante de Rapira hace esa reescritura con una línea de su propia configuración, y a partir de ahí el nombre es de lo más corriente y pasa intacto.

::: tip
`drop` registra cada eliminación con nivel `warn`, pero el nivel por defecto es `error`, así que esas líneas no se ven hasta que lo subes. Si a `$_SERVER` le falta inesperadamente una cabecera, sube el nivel y mira primero el target `http`: en [Registros](/es/docs/logging) tienes cómo hacerlo.
:::

## Campos que llegan más de una vez

HTTP permite que un cliente repita un campo, y en CGI solo cabe un valor por variable, así que hay que combinar las repeticiones en un único valor antes de que PHP vea nada. Rapira las combina como diga la gramática de cada campo que pueden combinarse:

- **Campos de lista** — los valores se unen con `, `, que es la recombinación que la [RFC 9110 §5.3](https://www.rfc-editor.org/rfc/rfc9110#section-5.3) permite para un campo definido como lista separada por comas. Dos líneas `Accept` quedan en `text/*, image/*`.
- **`Cookie`** — también es una lista, pero no de comas. Sus repeticiones se unen con `; `, la forma de cookie-string que espera el parser de PHP, y así `$_COOKIE` sale bien.
- **Campos de valor único** — `Authorization`, `Proxy-Authorization`, `Content-Type`, `Content-Length`, `Referer` y `From` conservan solo la **primera** línea; las demás se descartan con un `warn`. Unirlas las estropearía: un segundo `Authorization` combinado con el primero acaba dentro de la credencial que PHP está a punto de decodificar en base64. A un `Content-Length` repetido se le responde `400` antes de combinar nada, así que a esta regla solo llegan los otros cinco.
- **`Host`** — a más de una línea `Host` se le responde `400`; nunca se combinan. La [RFC 9112 §3.2](https://www.rfc-editor.org/rfc/rfc9112#section-3.2) lo marca como obligatorio, y la capa que termina la conexión es la única que puede dar la respuesta correcta.

Los valores de los campos llegan a PHP como bytes en crudo, siempre. Una cookie en latin1 o una cabecera firmada conservan cada octeto que mandó el cliente, porque una conversión a UTF-8 por el camino estropearía justo los valores que no pueden cambiar.

## Cuerpos de petición

El cuerpo de una petición se lee entero en memoria antes de que PHP se ejecute, y `http.max_body_size_mb` pone el tope de cuánto guarda Rapira. Por defecto son 8 MiB, la misma cifra que el `post_max_size` de PHP. A un cuerpo que pase del tope se le responde `413` y, como el resto sigue llegando por la red, esa respuesta además cierra la conexión en lugar de intentar reutilizarla.

El límite se comprueba dos veces:

- Contra el `Content-Length` declarado, antes de leer un solo byte del cuerpo.
- Y otra vez mientras el cuerpo va llegando, trozo a trozo. Una petición chunked no declara ninguna longitud de antemano, así que esa segunda comprobación es la que acota su consumo de memoria.

`Expect: 100-continue` se respeta en las peticiones HTTP/1.1: Rapira escribe la respuesta provisional `100 Continue` y entonces el cliente manda el cuerpo que tenía retenido. El orden importa: la comprobación del `Content-Length` va *primero*, así que a un cliente que anuncia un cuerpo demasiado grande se le responde `413` antes de que suba nada. En una petición HTTP/1.0 la expectativa se ignora, tal y como exige la [RFC 9110 §10.1.1](https://www.rfc-editor.org/rfc/rfc9110#section-10.1.1).

```toml
[http]
max_body_size_mb = 8
```

## Cómo sale la respuesta

El frontal no acumula el cuerpo de la respuesta en ningún búfer. Escribe la cabecera de la respuesta en cuanto PHP la fija, y cada trozo del cuerpo según PHP lo va produciendo. Cuándo los produce PHP lo decide el modo. En los modos Classic y Worker, PHP retiene la respuesta entera y se la pasa al frontal cuando termina la petición, o antes si el script llama a `rapira_finish_request()`. En modo Dispatcher, PHP le pasa al frontal la cabecera y cada trozo del cuerpo según los va escribiendo el código.

Delimitar el cuerpo es tarea del servidor y no de PHP. Un `Transfer-Encoding` que ponga tu código se descarta. Un `Content-Length` que ponga tu código se quita de las líneas de campo, de modo que una longitud caducada nunca pueda desincronizar la conexión. En los modos Classic y Worker, el frontal declara después la longitud del cuerpo que produjo PHP. En modo Dispatcher, el `Content-Length` de la cabecera que escribes es la longitud que declara la respuesta: el frontal manda esa longitud y va descontando de ella el cuerpo. Un cuerpo más corto que la longitud declarada termina la conexión, y uno más largo se corta a esa longitud.

A una respuesta que no declara ninguna longitud la delimita el frontal: un cliente HTTP/1.1 recibe la codificación de transferencia chunked, y un cliente HTTP/1.0, un cuerpo delimitado por el cierre de la conexión.

Las respuestas que por definición no llevan cuerpo, `204` y `304`, no reciben ningún `Content-Length`. La respuesta a una petición `HEAD` se trata igual: el frontal manda la cabecera sin `Content-Length` y sin un solo byte de cuerpo.

Los campos salto a salto pertenecen a una conexión concreta y no a la respuesta, así que PHP tampoco los pone ([RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1)). Estos se eliminan de lo que haya emitido tu código:

`Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE`, `Proxy-Connection` y, además, los dos campos de delimitación, `Content-Length` y `Transfer-Encoding`.

Y si PHP manda una cabecera `Connection`, también se eliminan los campos que nombra —para eso está el valor de `Connection`—, y esa limpieza ocurre antes de que Rapira inserte su propio `Content-Length`, así que un `Connection: content-length` no puede eliminar de la respuesta los campos de delimitación.

Todo lo demás pasa tal y como lo escribió PHP, repeticiones incluidas: `Set-Cookie`, `Vary` y `Link` pueden aparecer legítimamente varias veces y se mandan todas. Una cabecera que no hay forma de representar en la red se descarta con una línea de registro en lugar de tumbar la respuesta, así que el resto de la respuesta se envía igualmente.

Una cabecera de respuesta provisional (1xx) que venga de PHP se descarta, y los trailers de PHP también: el frontal no reenvía ni una cosa ni la otra. El `100 Continue` de una petición con `Expect` no es una cabecera provisional de PHP; esa la escribe el frontal por su cuenta.

Una respuesta truncada corta la conexión sin un cierre limpio. Una respuesta queda truncada cuando el worker muere antes de que acabe el cuerpo, cuando el cuerpo es más corto que la longitud que declaró PHP, o cuando un error fatal o una excepción sin capturar termina el script después de haber escrito salida. El cliente lee entonces un mensaje incompleto, así que puede darse cuenta de que la respuesta se quedó a medias.

Una respuesta de error que escribe el propio frontal lleva `cache-control: private, no-store` y `connection: close`, y no tiene cuerpo. El `413` de un cuerpo demasiado grande y el `501` de un `CONNECT` son respuestas de ese tipo.

::: question ¿Por qué es el frontal, y no PHP, quien pone los campos de delimitación?
A una respuesta la delimitan los bytes que el frontal pone en la red. El frontal toma la longitud que declara la respuesta y va descontando de ella el cuerpo. Un cuerpo más corto que la longitud declarada termina la conexión, así que el cliente no puede leer la respuesta siguiente como si fuera la cola de esta. Un `Content-Length` puesto como una cabecera cualquiera se saltaría esa cuenta, y por eso se quita.
:::

## Terminar la respuesta antes de tiempo

A un handler le suele quedar trabajo una vez que la respuesta está lista: un webhook que disparar, una entrada de cola que escribir, una caché que calentar. El cliente no tiene por qué esperar a eso.

`rapira_finish_request()` cierra la respuesta en ese punto. Los búferes de salida de PHP se vuelcan en la respuesta, esta pasa al frontal y sale hacia el cliente, y tu handler sigue ejecutándose con el cliente ya con la respuesta entera en la mano. Es el mismo contrato que `fastcgi_finish_request()`, así que el código escrito para php-fpm se comporta como siempre:

```php
<?php

header('Content-Type: text/plain');
echo "Order accepted\n";

rapira_finish_request();

// The client already has the response; this still runs.
$mailer->sendConfirmation($order);
$metrics->flush();
```

La firma es `rapira_finish_request(): bool`. Está declarada, junto con todo lo demás que Rapira le expone a PHP, en [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php): apunta tu IDE a ese archivo para tener autocompletado y sugerencias de tipos.

La función se registra para todo el proceso y actúa sobre la petición que se está atendiendo, así que el modo clásico también la admite: el comportamiento es el mismo tanto si el script es residente como si se vuelve a ejecutar en cada petición. En [Modos de ejecución](/es/docs/execution-modes) tienes qué más cambia de un modo a otro.

Dos cosas que conviene tener presentes:

- **Lo que imprimas después de la llamada no se manda.** La respuesta queda cerrada, así que un `echo` posterior se descarta: no se guarda para vaciarlo más tarde. Todo lo que el cliente tenga que ver hay que escribirlo antes de la llamada.
- **El worker sigue ocupado.** Terminar la respuesta libera al *cliente*, no al proceso. Este worker no coge la siguiente petición hasta que tu handler devuelve, así que el trabajo que has movido después de la llamada es trabajo que la siguiente petición sigue esperando; en [Modelo de procesos](/es/docs/process-model) tienes cuántos workers hay para repartir esa espera. La llamada baja la latencia del cliente, pero no añade concurrencia, así que el trabajo pesado va en una cola.
