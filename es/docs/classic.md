---
title: Modo Classic
description: El modo Classic ejecuta un script de entrada PHP normal con un estado nuevo en cada petición.
---

# Modo Classic

El modo Classic ejecuta un script de entrada PHP normal. Puede ser el mismo archivo `public/index.php` que ejecuta php-fpm. Rapira inicia una nueva petición PHP para cada petición HTTP. Rellena las superglobales y ejecuta el script. La salida del script se convierte en la respuesta. La mayoría de las aplicaciones pueden pasar de php-fpm al modo Classic sin cambios en el código.

## Estado nuevo en cada petición

Cada petición tiene un ciclo de petición PHP completo. El ciclo incluye la inicialización de la petición, la ejecución del script de entrada y el cierre de la petición. PHP elimina el estado de la petición antes de la siguiente petición. Este estado incluye las variables globales, las propiedades estáticas, el contenedor de inyección de dependencias y el mapa de identidad del ORM.

Los objetos y los datos de una petición no pueden afectar a una petición posterior. Parte del estado permanece en el proceso worker: las conexiones persistentes, el estado de las extensiones y el directorio de trabajo. Las aplicaciones que no admiten procesos persistentes pueden ejecutarse en modo Classic.

La aplicación inicializa el autoloader, la configuración, el contenedor y las rutas en cada petición. Consulta [modos de ejecución](/es/docs/execution-modes) para más información.

Cada worker usa el directorio del script de entrada como directorio de trabajo. Una llamada a `chdir()` en una petición sigue en efecto para las peticiones posteriores del mismo worker, hasta que el worker termina. Si una petición cambia el directorio de trabajo, restáuralo antes de que termine la petición.

Rapira no proporciona la función `fastcgi_finish_request()` de php-fpm. Usa `rapira_finish_request()` para enviar la respuesta antes de que termine el script. Consulta [HTTP](/es/docs/http) para más información.

## Selección del modo

Selecciona el modo Classic con `mode = "classic"` en la tabla `[http.pool]` de `rapira.toml`. Solo el pool HTTP admite el modo Classic. Consulta [configuración](/es/docs/configuration) para ver la lista completa de claves.

Un script de entrada clásico es PHP normal:

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

El `rapira.toml` para este script es:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

Inicia Rapira con `rapira serve rapira.toml`. Un `http.pool.entrypoint` relativo usa el directorio del archivo de configuración como base. Consulta la [referencia de la línea de comandos](/es/docs/cli) para ver el comando.

## Script de entrada

Rapira no asigna URL a scripts PHP. Cada petición ejecuta el script de entrada configurado. `$_SERVER['REQUEST_URI']` contiene la URL para las rutas de la aplicación.

El [middleware de archivos estáticos](/es/docs/static-files) puede devolver archivos para peticiones `GET` y `HEAD`. El script de entrada procesa las peticiones que el middleware no responde. Una CDN o un proxy inverso también pueden servir los archivos estáticos. Consulta [puesta en producción](/es/docs/deployment) para ver un ejemplo de proxy inverso.

`SCRIPT_FILENAME` contiene la ruta absoluta del script de entrada. `SCRIPT_NAME` contiene su nombre de archivo con una barra inicial, como `/index.php`. `DOCUMENT_ROOT` contiene el directorio del script de entrada.

## Subidas de archivos

PHP analiza los cuerpos `multipart/form-data` y rellena `$_FILES`, igual que con php-fpm. Se aplican los ajustes `upload_max_filesize` y `post_max_size` de `php.ini`.

Rapira aplica `http.max_body_size_mb` al cuerpo completo de la petición antes de que PHP se ejecute. El valor por defecto es 8 MiB. Rapira devuelve `413` para un cuerpo más grande. Si `php.ini` permite subidas más grandes, aumenta `http.max_body_size_mb` hasta el valor de `post_max_size`. Consulta [cuerpos de petición](/es/docs/http#cuerpos-de-peticion) para más información.

La tabla `[http.uploads]` solo se aplica al modo Dispatcher. Rapira no arranca si una configuración Classic contiene esta tabla. Consulta [configuración](/es/docs/configuration#la-tabla-http-uploads) para más información.

## OPcache

Cada petición PHP elimina el estado de la aplicación. OPcache conserva el bytecode compilado entre peticiones. El proceso maestro inicia PHP antes de crear los workers, así que todos los workers usan el mismo segmento de memoria compartida de OPcache. Con OPcache activado, las peticiones posteriores usan el bytecode almacenado, y PHP no vuelve a compilar los scripts que no cambian. Consulta [puesta en producción](/es/docs/deployment) para configurar OPcache.

Cada worker procesa una petición a la vez. `http.pool.processes` establece el número de workers, que también es el máximo de peticiones simultáneas. Consulta el [modelo de procesos](/es/docs/process-model) para más información.

## Elegir entre Classic y Worker

Usa el modo Classic si la aplicación no puede mantener el estado con seguridad entre peticiones. Por ejemplo, algunas aplicaciones y bibliotecas de terceros guardan datos de la petición en propiedades estáticas. El modo Classic también reduce los cambios en la aplicación al migrar desde php-fpm. Usa el modo [Worker](/es/docs/worker) si la aplicación admite un proceso persistente. El modo Worker elimina la inicialización de la aplicación de cada petición. Consulta [modos de ejecución](/es/docs/execution-modes) para ver los tres modos.

::: info
`Rapira\handle_request()` lanza `Rapira\Exception\NotInWorkerModeError` en modo Classic. Un script Classic termina con su petición y no puede ejecutar un bucle de peticiones.
:::
