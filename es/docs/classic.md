---
title: Modo Classic
description: "El modo Classic ejecuta un script de entrada de PHP normal desde cero en cada petición, igual que php-fpm, con el estado limpio cada vez."
---

# Modo Classic

El modo Classic ejecuta un script de entrada de PHP normal. Es el mismo `public/index.php` que ejecuta php-fpm. Rapira lo ejecuta desde cero en cada petición. Rapira ocupa el lugar de php-fpm y la aplicación no necesita ningún cambio. Las superglobales se rellenan, el script se ejecuta de arriba abajo y su salida se convierte en la respuesta.

## Estado limpio en cada petición

Cada petición pasa por un ciclo de PHP completo: arranque de la petición, tu script de entrada y cierre de la petición. Todo lo que el script haya construido por el camino —variables globales, propiedades estáticas, el contenedor de DI, el mapa de identidad del ORM— se destruye antes de que empiece la siguiente, exactamente igual que bajo php-fpm.

Un descriptor que se escapa, un singleton que se queda inicializado a medias, una biblioteca que se guarda datos de la petición en una propiedad estática: nada de eso afecta a la petición siguiente, porque nada de lo que crea tu script sobrevive a la petición en la que se creó. Valen las mismas excepciones que con php-fpm: las conexiones persistentes y el estado que vive dentro de una extensión están en el proceso worker, no en la petición. El código que nunca se escribió pensando en un proceso de larga vida funciona aquí sin cambios. `fastcgi_finish_request()` viene del binario de php-fpm y no está disponible bajo Rapira, que ofrece `rapira_finish_request()` con el mismo contrato —enviar la respuesta al cliente cuanto antes y seguir trabajando después—, documentada en la página de [HTTP](/es/docs/http).

La aplicación vuelve a arrancar en cada petición: autoloader, configuración, contenedor, rutas. Consulta la página de [modos de ejecución](/es/docs/execution-modes) para más información.

## Cómo activarlo

Hay dos maneras de elegir el modo, y las dos hacen lo mismo:

- `--mode classic` en la línea de comandos, junto al script de entrada.
- `mode = "classic"` en la sección `[pool]` de un `rapira.toml`.

`--mode` tiene prioridad sobre `pool.mode`, así que la línea de comandos elige el modo aunque el archivo de configuración indique otro. En todo lo demás manda la precedencia de siempre, en la que las opciones de línea de comandos ganan al archivo de configuración; la lista completa de claves está en la página de [configuración](/es/docs/configuration).

Un script de entrada clásico es PHP normal:

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Apunta Rapira hacia él de cualquiera de las dos formas:

::: code-group

```bash [CLI]
rapira serve --mode classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
mode = "classic"
```

:::

Con el archivo de configuración, el comando para arrancar es `rapira serve --config rapira.toml`. Un `pool.entrypoint` relativo se resuelve respecto al directorio del propio archivo de configuración, así que puedes mover el archivo de sitio sin romper nada; una ruta de script relativa en la línea de comandos se resuelve respecto al directorio actual. El resto de opciones están en la [referencia de la línea de comandos](/es/docs/cli).

## Script de entrada

Rapira no traduce URLs a scripts PHP. Cada petición ejecuta el script de entrada que le indicaste, venga la ruta que venga, y la URL llega en `$_SERVER['REQUEST_URI']` para que la enrute tu aplicación. La única excepción es el [middleware de archivos estáticos](/es/docs/static-files): cuando está activado, puede responder a un `GET` o a un `HEAD` con un archivo que haya bajo su raíz. Toda petición que él no responda ejecuta el script de entrada.

De ahí salen las variables CGI: `SCRIPT_FILENAME` es siempre el script de entrada, `SCRIPT_NAME` su nombre de archivo con una barra delante (`/index.php`) y `DOCUMENT_ROOT` el directorio donde está. Una CDN o un proxy inverso por delante de Rapira también pueden servir los archivos estáticos en su lugar. La página de [puesta en producción](/es/docs/deployment) monta un proxy de esos.

## OPcache

Ejecutar desde cero reinicia el estado de la aplicación, no el bytecode compilado. El proceso maestro arranca PHP una sola vez, antes de hacer fork de ningún worker. Por tanto, OPcache crea un único segmento de memoria compartida y todos los workers heredan ese mismo mapeo. Con OPcache activado, los scripts compilados siguen en caché de una petición a otra y en todo el pool. Volver a ejecutar el script de entrada no significa volver a parsearlo.

El pool de procesos en sí es el mismo en los dos modos: el maestro hace fork de los workers y cada worker atiende una petición cada vez, así que la concurrencia sale del número de procesos. Consulta la página de [modelo de procesos](/es/docs/process-model) para más información sobre el proceso maestro y sus workers.

::: info
`Rapira\handle_request()` lanza `Rapira\Exception\NotInWorkerModeError` en modo Classic. El script termina cuando termina la petición, así que no hay ningún bucle al que entregarle un handler. Los scripts de worker son cosa del modo [Worker](/es/docs/worker).
:::

## Elegir entre Classic y Worker

Usa el modo Classic cuando el estado de tu aplicación no sobreviva a una segunda petición: código antiguo, un framework que se filtra en propiedades estáticas o una biblioteca de terceros que no controlas. Úsalo también cuando estés migrando desde php-fpm y prefieras cambiar una cosa cada vez. Usa el modo [Worker](/es/docs/worker) cuando tu código aguante un proceso que no muere. El modo Worker quita de en medio el arranque de cada petición. La página de [modos de ejecución](/es/docs/execution-modes) describe los tres modos.
