---
title: Modo Classic
description: "El modo Classic ejecuta un script de entrada de PHP normal desde cero en cada petición, igual que php-fpm, con el estado limpio cada vez."
---

# Modo Classic

El modo Classic ejecuta un script de entrada PHP normal. Puede ser el mismo `public/index.php` que ejecuta php-fpm.
Rapira inicia una nueva petición PHP para cada petición HTTP. Rellena las superglobales y ejecuta el script.
La salida del script se convierte en la respuesta. Rapira puede sustituir a php-fpm sin cambiar la aplicación.

## Estado limpio en cada petición

Cada petición tiene un ciclo PHP completo. Incluye la inicialización, la ejecución del script y el cierre.
PHP elimina el estado antes de la siguiente petición. Este estado incluye variables globales, propiedades estáticas, el contenedor DI y el mapa ORM.

Los objetos y los datos de una petición no afectan a la siguiente. Las conexiones persistentes y el estado de extensiones son excepciones.
Las aplicaciones sin soporte para procesos persistentes pueden usar Classic.
Rapira no proporciona la función `fastcgi_finish_request()` de php-fpm. Usa `rapira_finish_request()` para enviar la respuesta antes de terminar el script.
Consulta [HTTP](/es/docs/http).

La aplicación inicializa el autoloader, la configuración, el contenedor y las rutas en cada petición. Consulta [modos de ejecución](/es/docs/execution-modes).

## Configuración del modo Classic

Selecciona el modo de una de estas formas:

- `--mode classic` en la línea de comandos, junto al script de entrada.
- `mode = "classic"` en la sección `[pool]` de un `rapira.toml`.

`--mode` sustituye a `pool.mode` del archivo. Los demás argumentos CLI también sustituyen los valores correspondientes.
Consulta [configuración](/es/docs/configuration) para ver todas las claves.

Un script de entrada clásico es PHP normal:

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Selecciona el modo con el CLI o el archivo:

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

Ejecuta `rapira serve --config rapira.toml` para usar el archivo de configuración.
Un `pool.entrypoint` relativo usa el directorio del archivo. Una ruta CLI relativa usa el directorio actual.
Consulta la [referencia de la línea de comandos](/es/docs/cli).

## Script de entrada

Rapira no asigna URL a scripts PHP. Cada petición ejecuta el script de entrada configurado.
`$_SERVER['REQUEST_URI']` contiene la URL para las rutas de la aplicación.
El [middleware de archivos estáticos](/es/docs/static-files) puede devolver archivos para peticiones `GET` y `HEAD`.
El script de entrada procesa las demás peticiones.

`SCRIPT_FILENAME` siempre contiene la ruta del script. `SCRIPT_NAME` contiene su nombre con una barra inicial, como `/index.php`.
`DOCUMENT_ROOT` contiene el directorio del script. Una CDN o un proxy inverso también pueden servir los archivos.
Consulta [puesta en producción](/es/docs/deployment).

## OPcache

Cada petición reinicia el estado de la aplicación, pero no el bytecode compilado. El proceso maestro inicia PHP antes de crear workers.
OPcache crea un segmento de memoria compartida. Cada worker usa el mismo mapa.
Con OPcache, el pool usa scripts almacenados entre peticiones. PHP no vuelve a analizar el script de entrada.

Classic y Worker usan el mismo tipo de pool. El maestro crea workers y cada uno procesa una petición a la vez.
El número de workers establece el máximo de peticiones simultáneas. Consulta [modelo de procesos](/es/docs/process-model).

::: info
`Rapira\handle_request()` lanza `Rapira\Exception\NotInWorkerModeError` en Classic. El script termina con la petición y no puede ejecutar un bucle.
Usa [Worker](/es/docs/worker) para scripts de worker.
:::

## Elegir entre Classic y Worker

Usa Classic si la aplicación no puede mantener el estado con seguridad entre peticiones. Esto incluye bibliotecas que guardan datos en propiedades estáticas.
Classic también reduce los cambios durante una migración desde php-fpm.
Usa [Worker](/es/docs/worker) si la aplicación admite un proceso persistente. Worker elimina la inicialización de cada petición.
Consulta [modos de ejecución](/es/docs/execution-modes).
