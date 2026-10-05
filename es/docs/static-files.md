---
title: Archivos estáticos
description: "Servir archivos antes de que una petición llegue a PHP: las claves de [http.static], las reglas del middleware y la caché de archivos de cada worker."
faqLevel: 2
---

# Archivos estáticos

El middleware de archivos estáticos sirve archivos de un directorio antes de que una petición llegue a PHP. Responde a una petición que corresponde a un archivo dentro de su raíz. Envía las demás peticiones a PHP sin cambios.

## Configuración del middleware

Dos partes de `rapira.toml` activan el middleware. Añade `static` a la lista de middleware de `[http]`. Después añade una tabla `[http.static]` que define el directorio de archivos.

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # Obligatorio. Las rutas relativas usan el directorio de este archivo.
forbid = [".php"]   # Opcional. Esta lista sustituye el valor predeterminado.
```

`middleware` guarda la cadena de middleware en el orden de la lista. Por ahora, `static` es el único nombre que admite.

`root` define el directorio que contiene los archivos que se sirven. No tiene valor predeterminado, por lo que la tabla debe definirlo. Una ruta relativa usa como base el directorio del archivo de configuración, igual que `http.pool.entrypoint`.

`forbid` contiene sufijos de nombres de archivo que el middleware no sirve. El valor predeterminado es `[".php"]`. Una lista explícita sustituye este valor. Por ejemplo, `forbid = [".php", ".env"]` bloquea ambos sufijos.

::: danger
El valor `forbid = []` permite todos los archivos de la raíz, incluido el código fuente PHP. No uses este valor con una raíz pública. Puede exponer el código de la aplicación y los secretos incrustados.
:::

Cada entrada empieza por un punto y contiene al menos dos caracteres. No puede contener `/` ni espacios en blanco. Una entrada no válida detiene la inicialización del servidor.

Consulta [Configuración](/es/docs/configuration) para las demás claves del archivo de configuración.

## Validación en la inicialización

El servidor comprueba la raíz antes de aceptar peticiones. La raíz debe existir y ser un directorio. La cuenta del servidor debe tener permiso de búsqueda en ella. Una comprobación fallida impide la inicialización e indica la ruta.

Las dos partes de la configuración deben aparecer juntas. Una entrada de middleware `"static"` requiere la tabla `[http.static]`, y la tabla requiere la entrada. Rapira también rechaza nombres de middleware repetidos y desconocidos.

::: question ¿Por qué el servidor comprueba la raíz dos veces?
La primera comprobación lee los metadatos de la raíz. Confirma que la ruta existe y es un directorio. La segunda comprobación resuelve `.` dentro de la raíz. Comprueba el permiso de búsqueda que el acceso a los archivos necesita.

Los permisos de búsqueda y de lectura de un directorio usan bits distintos. Por tanto, la primera comprobación puede pasar y la segunda fallar. Consulta [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html) para los permisos necesarios.
:::

## Reglas de servicio

El middleware solo considera una petición cuando el método es `GET` o `HEAD`. Cualquier otro método va a PHP.

El middleware aplica estas reglas de ruta:

- Un segmento de ruta que empieza por `.` va a PHP. Por tanto, `/.env`, `/.git/config` y `/../outside.txt` no acceden a archivos.
- La comprobación de `forbid` se hace sobre la ruta con la codificación porcentual decodificada y no distingue mayúsculas. Con `.php` prohibido, `/index.php`, `/index%2Ephp` y `/Upper.PHP` van todas a PHP.
- Una ruta con una codificación porcentual que no decodifica a UTF-8 va a PHP. Por ejemplo, `/%FF.css` va a PHP.
- La URL de un directorio va a PHP. El middleware no sirve un archivo de índice.
- Un archivo que no existe, un error de permisos o un nombre de archivo no válido van a PHP. Un nombre de archivo no válido es demasiado largo o contiene un byte NUL.
- Cualquier otro fallo de lectura devuelve `500`. PHP no recibe la petición, y Rapira registra el fallo en el target `http`.

Una petición que va a PHP llega sin cambios. Consulta [Peticiones y respuestas HTTP](/es/docs/http) para ver qué lee PHP de ella.

::: question ¿Por qué la URL de un directorio no se responde con `index.html`?
PHP controla el espacio de URL, por lo que una URL de directorio es una ruta de la aplicación. Un archivo de índice automático crearía dos respuestas posibles. El sistema de archivos podría devolver una respuesta y el router de la aplicación otra. El script de entrada no recibiría las peticiones para `/`.
:::

## Campos de la respuesta

Los campos siguientes aparecen en una respuesta que sirve un archivo. La respuesta `500` del middleware no los contiene.

El middleware define `Content-Type` a partir de la extensión del archivo. Un nombre sin extensión conocida recibe `application/octet-stream`.

La respuesta contiene los campos `ETag` y `Last-Modified`. El middleware crea `Last-Modified` a partir de la fecha de modificación del archivo. Crea `ETag` a partir de la fecha de modificación y el tamaño del archivo. Un archivo sin fecha de modificación no recibe ninguno de los dos campos.

El middleware devuelve `304 Not Modified` cuando `If-None-Match` coincide con el `ETag`. Una petición sin `If-None-Match` recibe `304 Not Modified` cuando la fecha de modificación del archivo no es posterior a la fecha de `If-Modified-Since`. Esta respuesta contiene solo `ETag` y `Last-Modified`. No tiene cuerpo.

La respuesta también contiene `Accept-Ranges: bytes`. Una petición con `Range` puede devolver `206 Partial Content` y un campo `Content-Range`. Rapira devuelve `416 Range Not Satisfiable` para un rango no válido o para más de un rango. PHP no recibe esta petición.

Una condición `If-Match` o `If-Unmodified-Since` fallida devuelve `412 Precondition Failed`.

El middleware no define `Cache-Control`. Define este campo en un proxy inverso cuando los clientes lo necesiten.

## La caché de archivos

Cada proceso worker guarda en memoria los archivos que sirve. No puedes configurar la caché. Usa estos valores fijos:

- Una entrada de la caché es válida durante un segundo.
- La caché no guarda un archivo de más de 256 KiB. Ese archivo se transmite desde el disco en cada petición.
- Cada worker guarda como máximo 16 MiB. Por tanto, la caché puede usar 16 MiB de memoria por cada proceso de `http.pool.processes`.

Después de un segundo, la siguiente petición de un archivo ejecuta `stat` sobre él. El worker conserva la entrada cuando la fecha de modificación y el tamaño no cambian. En otro caso, vuelve a leer el archivo. Rapira deja de servir un archivo eliminado después de un segundo como máximo.

Una caché llena sigue sirviendo sus entradas. Elimina primero las entradas caducadas. Si la caché sigue llena, no guarda el archivo nuevo.

Un proceso worker nuevo empieza con la caché vacía. Por tanto, una recarga, una sustitución de worker o un reinicio vacían la caché.

La raíz debe usar almacenamiento local. El middleware ejecuta `stat` y `open` en el hilo que atiende peticiones. Un sistema de archivos lento retrasa las demás conexiones de ese worker.

::: question ¿Por qué la caché no detecta mi archivo modificado?
La caché compara solo la fecha de modificación y el tamaño del archivo. El `ETag` contiene los mismos valores. La caché no detecta una sustitución que conserva ambos valores. Un cambio de permisos también conserva la entrada. Para eliminar la entrada, elimina el archivo, cambia su fecha de modificación o [recarga](/es/docs/process-model#senales) el servidor.
:::
