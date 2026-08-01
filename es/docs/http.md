---
title: Peticiones y respuestas HTTP
description: "Cómo convierte Rapira una petición HTTP en superglobales de PHP, y la respuesta de PHP en bytes que salen por la red: correspondencia de nombres de campo, campos repetidos, límites del cuerpo, búfer y rapira_finish_request()."
---

# Peticiones y respuestas HTTP

El frontal HTTP de Rapira está construido sobre [Pingora](https://github.com/cloudflare/pingora) y viene dentro del binario. Acepta conexiones en el socket que abrió el proceso maestro, parsea la petición, se la entrega a PHP y devuelve lo que PHP haya producido. No hay ningún upstream detrás: cada petición se responde aquí mismo, con tu código.

Esta página cubre las partes donde la traducción entre HTTP y PHP no es uno a uno: qué campo de cabecera acaba en qué clave de `$_SERVER`, qué pasa cuando un cliente manda el mismo campo dos veces, cuánto puede ocupar el cuerpo de una petición y cómo se delimita tu respuesta al salir.

::: info
El frontal termina conexiones HTTP en claro. Si necesitas TLS, termínalo en un proxy delante de Rapira: mira [En producción](/es/docs/deployment).
:::

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

Todo lo que escribe PHP se acumula en un búfer hasta que termina la petición, y solo entonces sale la cabecera de la respuesta por la red. Para eso está el búfer: el servidor sabe la longitud exacta del cuerpo, así que puede mandar un `Content-Length` de verdad. Sin un cuerpo delimitado, HTTP/1.1 tiene que recurrir a delimitar por cierre de conexión —la respuesta acaba cuando acaba la conexión—, lo que significa una conexión nueva por cada petición. Con un `Content-Length`, el keep-alive funciona y la conexión se mantiene viva.

Delimitar el cuerpo es, por tanto, tarea del servidor y no de PHP. Un `Content-Length` o un `Transfer-Encoding` que ponga tu código se descarta y se sustituye por lo que mida de verdad el cuerpo acumulado, de modo que una longitud caducada nunca pueda desincronizar la conexión. Las respuestas que por definición no llevan cuerpo —`204` y `304`— no reciben ningún `Content-Length`.

Los campos salto a salto pertenecen a una conexión concreta y no a la respuesta, así que PHP tampoco los pone ([RFC 9110 §7.6.1](https://www.rfc-editor.org/rfc/rfc9110#section-7.6.1)). Estos se eliminan de lo que haya emitido tu código:

`Connection`, `Keep-Alive`, `Upgrade`, `Trailer`, `TE`, `Proxy-Connection` y, además, los dos campos de delimitación, `Content-Length` y `Transfer-Encoding`.

Y si PHP manda una cabecera `Connection`, también se eliminan los campos que nombra —para eso está el valor de `Connection`—, y esa limpieza ocurre antes de que Rapira inserte su propio `Content-Length`, así que un `Connection: content-length` no puede eliminar de la respuesta los campos de delimitación.

Todo lo demás pasa tal y como lo escribió PHP, repeticiones incluidas: `Set-Cookie`, `Vary` y `Link` pueden aparecer legítimamente varias veces y se mandan todas. Una cabecera que no hay forma de representar en la red se descarta con una línea de registro en lugar de tumbar la respuesta, así que el resto de la respuesta se envía igualmente.

## Terminar la respuesta antes de tiempo

A un handler le suele quedar trabajo una vez que la respuesta está lista: un webhook que disparar, una entrada de cola que escribir, una caché que calentar. El cliente no tiene por qué esperar a eso.

`rapira_finish_request()` cierra la respuesta en ese punto. Se vacía la salida acumulada, la respuesta pasa al frontal y sale hacia el cliente, y tu handler sigue ejecutándose con el cliente ya con la respuesta entera en la mano. Es el mismo contrato que `fastcgi_finish_request()`, así que el código escrito para php-fpm se comporta como siempre:

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
