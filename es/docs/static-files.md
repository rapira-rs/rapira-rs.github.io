---
title: Archivos estáticos
description: "Servir archivos de un directorio antes de que la petición llegue a PHP: las claves de [http.static], las reglas que deciden qué responde el middleware y la caché de archivos de cada worker."
faqLevel: 2
---

# Archivos estáticos

Rapira ejecuta el middleware de archivos estáticos antes de PHP. Responde cuando la ruta corresponde a un archivo dentro de la raíz. Pasa las demás peticiones al siguiente handler sin cambios.

## Configuración del middleware

Dos partes de `rapira.toml` activan el middleware. Añade `static` a `http.middleware`, la lista `middleware` de `[http]`. Después añade una sección `[http.static]` con el directorio.

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # Required. Relative paths use this file's directory.
forbid = [".php"]   # Optional. This list replaces the default.
```

`middleware` guarda la cadena de middleware en el orden de la lista. Por ahora, `static` es el único nombre que admite.

`root` define el directorio de archivos. No tiene valor predeterminado. Una ruta relativa usa el directorio del archivo de configuración. `pool.entrypoint` usa la misma regla.

`forbid` contiene sufijos de nombres de archivo que el middleware no sirve. El valor predeterminado es `[".php"]`. Una lista explícita sustituye este valor. Por ejemplo, `forbid = [".php", ".env"]` bloquea ambos sufijos.

::: danger
`forbid = []` permite todos los archivos, incluido el código PHP. No uses este valor con una raíz pública. Puede exponer el código de la aplicación y los secretos incrustados.
:::

Cada entrada empieza por un punto, contiene al menos dos caracteres y no contiene `/` ni espacios en blanco. Una entrada no válida impide iniciar el servidor.

Las demás claves del archivo están en la página de [Configuración](/es/docs/configuration).

::: question ¿Por qué una entrada de `forbid` debe ser un sufijo?
El middleware compara cada entrada con el final del nombre de archivo. Rapira solo acepta sufijos con dos o más caracteres que empiezan por `.` y no contienen barras ni espacios en blanco.
:::

## Validación en el arranque

El servidor comprueba la raíz antes de aceptar peticiones. La ruta debe existir, ser un directorio y permitir la búsqueda al usuario. Un error impide iniciar el servidor e indica la ruta.

Las dos partes de la configuración deben aparecer juntas. Una entrada `"static"` requiere `[http.static]` y la sección requiere la entrada. Rapira también rechaza nombres de middleware repetidos.

::: question ¿Por qué el servidor comprueba la raíz dos veces?
La primera comprobación lee los metadatos y confirma que la ruta es un directorio. La segunda resuelve `.` y comprueba el permiso de búsqueda. Los permisos de búsqueda y lectura usan bits distintos. Por tanto, la primera comprobación puede pasar y la segunda fallar. Consulta [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html).
:::

## Reglas de servicio

El middleware solo se plantea una petición cuando el método es `GET` o `HEAD`. Cualquier otro método va a PHP.

El resto lo decide la ruta:

- Una ruta con algún segmento que empieza por `.` va a PHP, así que `/.env`, `/.git/config` y `/../outside.txt` no llegan nunca al sistema de archivos.
- La comprobación de `forbid` se hace sobre la ruta ya decodificada y compara el último segmento sin distinguir mayúsculas, así que `/index.php`, `/index%2Ephp` y `/Upper.PHP` van todas a PHP mientras `forbid` contenga `.php`.
- La URL de un directorio va a PHP. El middleware no sirve ningún archivo de índice para ella, lleve barra final o no.
- Una ruta que no tiene ningún archivo detrás va a PHP. Un error de permisos va a PHP también, igual que un nombre que el sistema de archivos no acepta.
- Cualquier otro fallo de lectura se responde con un `500`. Esa petición no llega a PHP, y el fallo queda registrado en el target `http`.

PHP recibe sin cambios una petición transferida. Consulta [Peticiones y respuestas HTTP](/es/docs/http).

::: question ¿Por qué la URL de un directorio no se responde con `index.html`?
PHP controla el espacio de URL, por lo que una URL de directorio es una ruta. Un índice automático crearía dos respuestas posibles. El sistema de archivos podría devolver una respuesta y el router de la aplicación otra. El script de entrada no recibiría las peticiones para `/`.
:::

::: question ¿Cómo distingue el middleware un archivo que no está de un fallo de lectura?
Seis resultados indican que no hay un archivo disponible. La ruta puede faltar, ser inaccesible o ser un directorio. Un componente puede tener un tipo incorrecto. El nombre puede ser demasiado largo o contener un byte NUL. En estos casos, la petición sigue a PHP.

Otros errores indican un archivo existente que Rapira no puede leer. Para estos errores, el middleware devuelve `500`.
:::

## Campos de la respuesta

Los campos de abajo pertenecen a una respuesta que sirve un archivo. La respuesta `500` del middleware no lleva ninguno de ellos.

El middleware pone el `Content-Type` a partir de la extensión del archivo. Un nombre sin extensión conocida recibe `application/octet-stream`.

La respuesta contiene `ETag` y `Last-Modified`. El middleware crea `Last-Modified` a partir de la fecha del archivo. Crea `ETag` a partir de la fecha y el tamaño. Un archivo sin fecha no recibe estos campos. Una fecha anterior a la época Unix impide solo el `ETag`.

El middleware responde `304 Not Modified` cuando el campo `If-None-Match` coincide con el `ETag`. Una petición sin `If-None-Match` recibe `304 Not Modified` cuando la fecha de modificación del archivo no es posterior a la fecha de `If-Modified-Since`. Esa respuesta lleva solo los campos `ETag` y `Last-Modified`, y no tiene cuerpo.

La respuesta lleva además `Accept-Ranges: bytes`. Una petición con `Range` se responde con `206 Partial Content` y un campo `Content-Range`. Un rango que el archivo no puede satisfacer se responde con `416 Range Not Satisfiable`, y esa petición tampoco llega a PHP.

## La caché de archivos

Cada worker guarda en memoria los archivos que sirve. No puedes configurar la caché.

Una entrada es válida durante un segundo. Después, la siguiente petición usa `stat` para comparar el archivo. El worker conserva la entrada si la fecha y el tamaño coinciden. Vuelve a leer un archivo modificado.

Un archivo de más de 256 KiB no se guarda nunca: ese archivo se transmite desde el disco en cada petición.

Un worker guarda hasta 16 MiB. Una caché llena sigue sirviendo sus entradas. La caché elimina primero las entradas caducadas. Si sigue llena, no guarda el archivo nuevo. Cada worker usa hasta 16 MiB para esta caché. Un reinicio vacía la caché.

Cada worker valida sus entradas. Un archivo eliminado afecta a las respuestas después de un segundo como máximo. Un archivo modificado o sustituido afecta a las respuestas después de un segundo como máximo cuando cambia su fecha de modificación o tamaño. Un cambio de permisos no elimina la entrada si la fecha y el tamaño no cambian. Elimina el archivo para retirar la entrada. Una sustitución retira la entrada solo con una fecha de modificación o un tamaño nuevos. También puedes reiniciar el servidor.

La raíz debe usar almacenamiento local. El middleware ejecuta `stat` y `open` en el hilo que atiende peticiones. Un sistema de archivos lento retrasa las demás conexiones del worker.

::: question ¿Cómo detecta la caché que un archivo ha cambiado?
La caché compara la fecha y el tamaño con los valores guardados. El ETag contiene los mismos valores. La caché no detecta una sustitución que conserva ambos valores. Cambia la fecha o el tamaño de cada archivo sustituido.
:::

Consulta [Configuración](/es/docs/configuration) para más información.
