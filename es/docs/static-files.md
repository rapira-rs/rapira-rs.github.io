---
title: Archivos estáticos
description: "Servir archivos de un directorio antes de que la petición llegue a PHP: las claves de [http.static], las reglas que deciden qué responde el middleware y la caché de archivos de cada worker."
faqLevel: 2
---

# Archivos estáticos

Rapira sirve archivos de un directorio con el middleware de archivos estáticos, antes de que la petición llegue a PHP. El middleware vive en el frontal HTTP, por delante del handler de PHP: responde a las peticiones que se resuelven en un archivo dentro de su raíz y deja pasar todas las demás por la cadena, sin tocarlas.

## Activar el middleware

El middleware se activa con dos partes de `rapira.toml`: el nombre `static` en la lista `middleware` de `[http]` y una sección `[http.static]` que dice dónde están los archivos.

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # required; a relative path resolves against this file's directory
forbid = [".php"]   # optional; an explicit list replaces this default
```

`middleware` guarda la cadena de middleware en el orden de la lista. Por ahora, `static` es el único nombre que admite.

`root` nombra el directorio desde el que sirve el middleware. No tiene valor por defecto, así que la sección tiene que ponerlo. Una ruta relativa se resuelve respecto al directorio donde está el archivo de configuración, igual que hace `pool.entrypoint`.

`forbid` guarda las extensiones que el middleware no sirve nunca. Por defecto vale `[".php"]`, y una lista explícita sustituye a ese valor: con `forbid = [".php", ".env"]` ninguna de las dos extensiones aparece en una respuesta, y con `forbid = []` se sirve cualquier archivo bajo la raíz, fuentes PHP incluidas. Cada entrada es una extensión que empieza por un punto, tiene dos caracteres como mínimo y no lleva ni `/` ni espacios en blanco. Una entrada que se salga de esa forma corta el arranque.

Las demás claves del archivo están en la página de [Configuración](/es/docs/configuration).

::: question ¿Por qué una entrada de `forbid` tiene que parecerse a una extensión?
El middleware compara cada entrada como sufijo del nombre del archivo. Ni un separador ni un espacio pueden terminar nunca un nombre de archivo, así que una entrada que lleve uno de los dos no coincide con nada y el archivo que iba a proteger sigue estando al alcance. La comprobación rechaza una entrada así en lugar de aceptar una protección que no protege nada.
:::

## Validación en el arranque

El servidor comprueba la raíz antes de servir nada. La raíz tiene que existir, tiene que ser un directorio y el usuario con el que corre el servidor tiene que poder recorrerla. Una raíz que falle una de esas comprobaciones corta el arranque con un mensaje que dice de qué ruta se trata.

Las dos partes de la configuración tienen que concordar. Un `middleware = ["static"]` sin sección `[http.static]` corta el arranque, y una sección `[http.static]` que `middleware` no menciona lo corta igual. Un nombre repetido en `middleware` también se rechaza.

::: question ¿Por qué el servidor comprueba la raíz dos veces?
La primera comprobación lee los metadatos de la raíz, y con eso queda claro que la ruta existe y que es un directorio. La segunda resuelve `.` dentro de la raíz, y con eso queda claro que hay permiso de búsqueda, que es el que necesita cualquier lectura bajo la raíz. El permiso de búsqueda de un directorio es un bit distinto del de lectura, así que una raíz que pasa la primera comprobación todavía puede fallar la segunda. En [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html) tienes los permisos que necesita cada llamada.
:::

## Reglas de servicio

El middleware solo se plantea una petición cuando el método es `GET` o `HEAD`. Cualquier otro método va a PHP.

El resto lo decide la ruta:

- Una ruta con algún segmento que empieza por `.` va a PHP, así que `/.env`, `/.git/config` y `/../outside.txt` no llegan nunca al sistema de archivos.
- La comprobación de `forbid` se hace sobre la ruta ya decodificada y compara el último segmento sin distinguir mayúsculas, así que `/index.php`, `/index%2Ephp` y `/Upper.PHP` van todas a PHP mientras `forbid` contenga `.php`.
- La URL de un directorio va a PHP. El middleware no sirve ningún archivo de índice para ella, lleve barra final o no.
- Una ruta que no tiene ningún archivo detrás va a PHP. Un error de permisos va a PHP también, igual que un nombre que el sistema de archivos no acepta.
- Cualquier otro fallo de lectura se responde con un `500`. Esa petición no llega a PHP, y el fallo queda registrado en el target `http`.

Una petición que va a PHP llega con su cuerpo, sus campos y sus extensiones intactos. En [Peticiones y respuestas HTTP](/es/docs/http) tienes qué lee PHP de ella.

::: question ¿Por qué la URL de un directorio no se responde con `index.html`?
El espacio de URLs es de PHP: la URL de un directorio es una ruta de la aplicación. Un archivo de índice implícito daría dos respuestas para una misma URL, una del sistema de archivos y otra del router, e impediría que el script de entrada gestionara `/`.
:::

::: question ¿Cómo distingue el middleware un archivo que no está de un fallo de lectura?
Hay seis resultados que significan que no hay ningún archivo que servir: la ruta no existe, el proceso no puede leerla, la ruta es un directorio, algún componente de la ruta no es un directorio, el nombre es demasiado largo para el sistema de archivos y el nombre contiene un byte NUL. En esos seis casos no hay archivo, y la petición sigue su camino hacia PHP. Cualquier otro error habla de un archivo que existe y no se puede leer, algo que PHP tampoco sabría responder, así que el middleware lo informa como `500`.
:::

## Campos de la respuesta

Los campos de abajo pertenecen a una respuesta que sirve un archivo. La respuesta `500` del middleware no lleva ninguno de ellos.

El middleware pone el `Content-Type` a partir de la extensión del archivo. Un nombre sin extensión conocida recibe `application/octet-stream`.

La respuesta lleva un campo `ETag` y otro `Last-Modified`. El middleware construye los dos a partir de la fecha de modificación del archivo. Un archivo sin fecha de modificación no recibe ninguno de los dos, y uno con una fecha de modificación anterior a la época Unix se queda sin `ETag`.

El middleware responde `304 Not Modified` cuando el campo `If-None-Match` o el `If-Modified-Since` de la petición coincide con el archivo. Esa respuesta lleva solo los campos `ETag` y `Last-Modified`, y no tiene cuerpo.

La respuesta lleva además `Accept-Ranges: bytes`. Una petición con `Range` se responde con `206 Partial Content` y un campo `Content-Range`. Un rango que el archivo no puede satisfacer se responde con `416 Range Not Satisfiable`, y esa petición tampoco llega a PHP.

## La caché de archivos

Cada proceso worker guarda en memoria los archivos que sirve. La caché no tiene claves de configuración: los valores de abajo son fijos.

Una entrada se mantiene fresca durante un segundo. La primera petición que llega pasada esa ventana hace un `stat` y renueva la entrada si la fecha de modificación y el tamaño siguen coincidiendo con el archivo. Un archivo que ha cambiado se vuelve a leer.

Un archivo de más de 256 KiB no se guarda nunca: ese archivo se transmite desde el disco en cada petición.

Un worker guarda 16 MiB como mucho. Una caché que llega a ese límite sigue sirviendo las entradas que tiene, y descarta las caducadas antes de rechazar un archivo nuevo. El coste de memoria es, por tanto, de hasta 16 MiB por cada proceso de `pool.processes`. Un reinicio vacía la caché.

Cada worker revalida sus propias entradas, así que un cambio bajo la raíz llega al cliente en un segundo como mucho. Un archivo borrado y otro sustituido salen los dos de la caché dentro de esa ventana. Un cambio de permisos por sí solo no retira ninguna entrada, porque `stat` informa de la misma fecha de modificación y del mismo tamaño que antes: para sacar un archivo de la caché, bórralo, sustitúyelo o reinicia el servidor.

La raíz tiene que estar en almacenamiento local. El middleware ejecuta `stat` y `open` en el hilo del runtime que atiende las peticiones, así que un sistema de archivos que responda despacio a esas llamadas frena las demás conexiones de ese worker.

::: question ¿Cómo detecta la caché que un archivo ha cambiado?
Compara la fecha de modificación y el tamaño del archivo con los dos valores que guardó, y el ETag codifica ese mismo par. Una sustitución que conserva los dos valores no se detecta, así que un despliegue que copia archivos tiene que dejar en cada archivo sustituido una fecha de modificación nueva o un tamaño distinto.
:::

Consulta [Configuración](/es/docs/configuration) para más información.
