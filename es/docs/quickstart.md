---
title: Inicio rápido
description: Sirve tu primera aplicación PHP con Rapira — un front controller clásico, esa misma aplicación como worker residente y un rapira.toml de cinco líneas.
---

# Inicio rápido

Esta página retoma donde lo dejó [Instalación](/es/docs/installation): ya tienes un binario `rapira` que funciona, con el PHP que trae incluido. En los próximos minutos vas a servir una página en modo clásico, convertir esa misma aplicación en un worker residente y llevar los ajustes a un archivo de configuración.

## Hola mundo en modo clásico

El modo clásico es el peldaño disponible para cualquier aplicación: Rapira vuelve a incluir tu script de entrada en cada petición, exactamente igual que php-fpm ejecutaría un front controller. No hay que cambiar nada del código, y por eso es el mejor punto de partida.

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

El proceso no se tira entre peticiones: Rapira hace fork de sus workers una sola vez y mantiene un intérprete de PHP arrancado dentro de cada uno. Lo que se descarta es el estado de tu script: las variables, el autoloader, todo lo que haya construido el framework. Ese es el compromiso del modo clásico, y por eso existe el siguiente peldaño.

## La misma aplicación como worker residente

El peldaño SAPI Worker mantiene el script vivo. Arranca una vez y se queda en un bucle pidiéndole a Rapira la siguiente petición; Rapira vuelve a rellenar las superglobales y llama a tu handler. El código PHP conserva la forma de siempre —sigues leyendo `$_GET` y devolviendo la respuesta con `echo`—, pero el arranque se paga una vez por proceso en lugar de una vez por petición. En [Modos de ejecución](/es/docs/execution-modes) tienes la escalera completa.

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

`create_plugin_handler()` le pide al servidor el handler que atiende HTTP, y `HttpHandlerConfig` es lo que lo identifica. A partir de ahí, `handleRequest()` se bloquea hasta que llega una petición, ejecuta tu callback y devuelve `true`; devuelve `false` cuando el servidor se está apagando, y eso es lo que termina el bucle.

Antes de nada, para el servidor clásico con `Ctrl-C` en su terminal, porque los dos escuchan en `127.0.0.1:8000`. El modo worker es el predeterminado, así que esta vez no hace falta ninguna opción:

```bash
rapira serve worker.php
```

```bash
curl '127.0.0.1:8000/?name=world'
```

Lanza ese `curl` unas cuantas veces y el contador sube: es el mismo proceso el que sigue atendiendo las peticiones. Por defecto Rapira arranca un worker por CPU, así que una petición puede caer en cualquiera de ellos —es el kernel quien decide qué worker la acepta— y cada worker lleva su propia cuenta; el pid de la salida te dice cuál respondió. Si prefieres una secuencia limpia y ordenada, arranca con `rapira serve --processes 1 worker.php`. El [modelo de procesos](/es/docs/process-model) explica cómo se supervisa el pool.

Todo lo que construyas antes del bucle `while` se queda en memoria durante toda la vida del worker: el autoloader de Composer, un contenedor de dependencias, las conexiones a la base de datos y a la caché, las rutas y las plantillas compiladas; todo eso se paga una sola vez, al arrancar, y no en cada petición. Lo único que se rehace en cada vuelta es el estado propio de la petición.

::: warning
El estado que sobrevive entre peticiones pasa a ser responsabilidad tuya. Una propiedad estática, una variable global o una transacción abierta que dejó una petición siguen ahí para la siguiente. [Modo worker](/es/docs/worker) explica a qué prestar atención y cómo mantener limpio un worker.
:::

Dentro del handler tienes las herramientas de siempre: `header()`, `http_response_code()`, `echo` y `rapira_finish_request()` para enviar la respuesta antes de tiempo y seguir trabajando después. [HTTP](/es/docs/http) lo documenta todo.

## Llevar los ajustes a un archivo de configuración

Las opciones de línea de comandos van bien mientras experimentas, pero una aplicación desplegada suele guardar sus ajustes en un archivo. Para empezar basta con un `rapira.toml` junto a tu código:

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

Esas cinco líneas son una mínima parte de lo que admite el archivo: modos de escalado del pool, reciclaje de workers, tiempos límite de las peticiones, registros, el pidfile del supervisor. Las claves desconocidas se rechazan en vez de ignorarse, así que una errata tumba el arranque en lugar de quedarse en nada sin avisar. La referencia completa está en [Configuración](/es/docs/configuration), y las opciones en [CLI](/es/docs/cli).

## Parar el servidor

Pulsa `Ctrl-C` y Rapira se apaga de forma ordenada: deja de aceptar trabajo nuevo, espera a que terminen las peticiones que ya estaban en curso, apaga las extensiones y sale. Un segundo `Ctrl-C` se salta la espera y fuerza la salida, algo muy útil cuando una petición se ha quedado atascada y prefieres no esperar a que termine. `SIGTERM` se comporta igual, y por eso el reinicio desde un gestor de servicios resulta igual de limpio. En [Modelo de procesos](/es/docs/process-model) tienes la tabla completa de señales, incluida la recarga sin perder conexiones.

## Próximos pasos

- [Modo worker](/es/docs/worker) — el bucle residente a fondo: estado, fugas, reciclaje y cómo arrancar una aplicación real antes del bucle.
- [Configuración](/es/docs/configuration) — todas las claves que admite `rapira.toml`, con sus valores por defecto.
- [Frameworks](/es/docs/frameworks/) — scripts de entrada ya listos para Symfony, Laravel y Yii3.

::: question ¿Necesito Composer para ejecutar el script del worker?
No. `create_plugin_handler()`, `HttpHandlerConfig` y las clases del handler vienen del módulo PHP que Rapira registra al arrancar el intérprete, así que el script de arriba funciona sin ningún autoloader. Otra cosa es una aplicación real: ahí harás `require` de tu `vendor/autoload.php`, antes del bucle, para pagarlo una sola vez.
:::

::: question ¿Puede un mismo script servir en modo clásico y en modo worker?
No, y el error es explícito: `create_plugin_handler()` lanza una `Rapira\RapiraException` fuera del modo worker, porque el modo clásico no tiene ningún bucle residente que entregarte. Deja el front controller de siempre para el modo clásico y un `worker.php` aparte para el peldaño worker; las [guías de frameworks](/es/docs/frameworks/) explican cómo conectar cada uno.
:::
