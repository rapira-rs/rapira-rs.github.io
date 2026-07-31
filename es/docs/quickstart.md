---
title: Inicio rápido
description: "Servir una aplicación PHP con Rapira en modo clásico y en modo worker, y llevar los ajustes a un archivo rapira.toml."
---

# Inicio rápido

Esta página explica cómo servir una página en modo clásico, convertir esa misma aplicación en un worker residente y llevar los ajustes a un archivo de configuración. Da por hecho que tienes un binario `rapira` que funciona, con el PHP que trae incluido; consulta [Instalación](/es/docs/installation) para más información.

## Modo clásico

El modo clásico está disponible para cualquier aplicación: Rapira vuelve a incluir tu script de entrada en cada petición, exactamente igual que php-fpm ejecutaría un front controller. No hay que cambiar nada del código.

Crea `public/index.php`:

```php
<?php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Arranca el servidor: `--classic` es lo que selecciona el modo y el argumento posicional es el script de entrada:

```bash
rapira serve --classic public/index.php
```

Rapira escucha en `127.0.0.1:8000` mientras no le digas otra cosa. Desde otra terminal:

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

El proceso no se tira entre peticiones: Rapira hace fork de sus workers una sola vez y mantiene un intérprete de PHP arrancado dentro de cada uno. Lo que se descarta es el estado de tu script: las variables, el autoloader, todo lo que haya construido el framework.

## Modo worker

El modo SAPI Worker mantiene el script vivo. Arranca una vez y se queda en un bucle pidiéndole a Rapira la siguiente petición; Rapira vuelve a rellenar las superglobales y llama a tu handler. El código PHP conserva la forma de siempre —sigues leyendo `$_GET` y devolviendo la respuesta con `echo`—, pero el arranque ocurre una vez por proceso en lugar de una vez por petición. Consulta [Modos de ejecución](/es/docs/execution-modes) para más información.

Crea `worker.php` en la raíz del proyecto:

```php
<?php
use Rapira\Plugin\Http\HttpHandlerConfig;
use function Rapira\create_plugin_handler;

$http = create_plugin_handler(new HttpHandlerConfig());

// Outside the loop, so it survives every request this worker serves.
$handled = 0;

$handler = static function () use (&$handled): void {
    $handled++;
    header('Content-Type: text/plain');
    echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
    echo "worker " . getmypid() . " handled {$handled} request(s)\n";
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

`create_plugin_handler()` devuelve el handler que atiende HTTP, elegido por el `HttpHandlerConfig` que le pasas. A partir de ahí, `handleRequest()` se bloquea hasta que llega una petición, ejecuta tu callback y devuelve `true`; devuelve `false` cuando el servidor se está apagando, y eso es lo que termina el bucle.

`create_plugin_handler()`, `HttpHandlerConfig` y las clases del handler vienen del módulo PHP que Rapira registra al arrancar el intérprete, así que el script de arriba funciona sin autoloader. Una aplicación con dependencias de Composer carga su propio `vendor/autoload.php` antes del bucle.

Antes de nada, para el servidor clásico con `Ctrl-C` en su terminal, porque los dos escuchan en `127.0.0.1:8000`. El modo worker es el predeterminado, así que esta vez no hace falta ninguna opción:

```bash
rapira serve worker.php
```

```bash
curl '127.0.0.1:8000/?name=world'
```

Lanza ese `curl` unas cuantas veces y el contador sube: es el mismo proceso el que sigue atendiendo las peticiones. Por defecto Rapira arranca un worker por CPU, así que una petición puede caer en cualquiera de ellos —es el kernel quien decide qué worker la acepta— y cada worker lleva su propia cuenta; el pid de la salida te dice cuál respondió. Si quieres que la cuenta avance como una única secuencia, arranca con `rapira serve --processes 1 worker.php`. El [modelo de procesos](/es/docs/process-model) explica cómo se supervisa el pool.

Todo lo que construyas antes del bucle `while` se queda en memoria durante toda la vida del worker: el autoloader de Composer, un contenedor de dependencias, las conexiones a la base de datos y a la caché, las rutas y las plantillas compiladas; todo eso se construye una sola vez, al arrancar, y no en cada petición. Lo único que se rehace en cada vuelta es el estado propio de la petición.

::: warning
El estado que sobrevive entre peticiones lo tiene que reiniciar el propio script del worker. Una propiedad estática, una variable global o una transacción abierta que dejó una petición siguen ahí para la siguiente. [Modo worker](/es/docs/worker) explica a qué prestar atención y cómo mantener limpio un worker.
:::

Dentro del handler funcionan las funciones de siempre: `header()`, `http_response_code()`, `echo` y `rapira_finish_request()` para enviar la respuesta antes de tiempo y seguir trabajando después. Consulta [HTTP](/es/docs/http) para más información.

## Archivo de configuración

Los ajustes pueden vivir en un archivo `rapira.toml` en lugar de ir en la línea de comandos. Para empezar basta con un archivo junto a tu código:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
processes = 4
```

```bash
rapira serve --config rapira.toml
```

::: info
Un `pool.entrypoint` relativo se resuelve respecto al directorio del propio archivo de configuración, así que el mismo archivo funciona estés donde estés. Las opciones de línea de comandos siguen ganando al archivo: `rapira serve --config rapira.toml --processes 1` conserva todo lo demás y arranca un único worker.
:::

El archivo admite además modos de escalado del pool, reciclaje de workers, tiempos límite de las peticiones, registros y el pidfile del supervisor. Las claves desconocidas se rechazan en vez de ignorarse, así que una errata tumba el arranque en lugar de quedarse en nada sin avisar. La referencia completa está en [Configuración](/es/docs/configuration), y las opciones en [CLI](/es/docs/cli).

## Parar el servidor

Pulsa `Ctrl-C` y Rapira se apaga de forma ordenada: deja de aceptar trabajo nuevo, espera a que terminen las peticiones que ya estaban en curso, apaga las extensiones y sale. Un segundo `Ctrl-C` se salta la espera y fuerza la salida, de modo que una petición atascada no mantiene el servidor abierto. `SIGTERM` se comporta igual, y por eso el reinicio desde un gestor de servicios resulta igual de limpio. En [Modelo de procesos](/es/docs/process-model) tienes la tabla completa de señales, incluida la recarga sin perder conexiones.

## Próximos pasos

- [Modo worker](/es/docs/worker) — el bucle residente a fondo: estado, fugas, reciclaje y cómo arrancar una aplicación real antes del bucle.
- [Configuración](/es/docs/configuration) — todas las claves que admite `rapira.toml`, con sus valores por defecto.
- [Frameworks](/es/docs/frameworks/) — guías de integración para Symfony, Laravel y Yii3.
