---
title: Laravel
description: Laravel sobre Rapira — una aplicación nueva en cada petición dentro de un worker residente, el comportamiento de memoria que eso trae consigo y la verdad sobre la compatibilidad con Octane.
---

# Laravel

Rapira ejecuta Laravel, y lo hace **construyendo una aplicación nueva en cada petición dentro de un proceso de PHP que se queda residente entre peticiones**. Es una afirmación deliberadamente modesta, y conviene decirla de entrada en lugar de esconderla: lo que se queda residente es el worker, no el framework.

::: info Verificado con
- **PHP 8.5.8** — NTS, SAPI embed
- **Rapira 0.6.0**
- Esqueleto de **laravel/laravel** con **laravel/framework v13.23.0**

Todo lo que cuenta esta página se ejecutó sobre un esqueleto `laravel/laravel` con unas cuantas rutas de prueba añadidas y un solo worker: enrutado, sesiones, subidas de archivos, cuerpos JSON y de formulario, configuración y rutas cacheadas, respuestas de error y varios cientos de peticiones seguidas repartidas en varios reciclajes del worker.
:::

## Por qué la aplicación se reconstruye en cada petición

El contenedor de Laravel no está pensado para sobrevivir a una segunda petición sin ayuda. Los bindings se resuelven, los singletons se quedan con la petición actual, las estáticas del propio framework se van llenando mientras la petición avanza, y alguien tiene que deshacer todo eso antes de que llegue la siguiente. Ese alguien tiene nombre: **Octane**. Hoy Rapira no tiene driver de Octane, así que esta guía no pretende hacer de uno. Lo que te da es el patrón que sí se ha verificado que funciona: arrancar el framework dentro del handler, responder a la petición y tirar la aplicación a la basura.

Aun así sales ganando frente a php-fpm, solo que no tanto como si el contenedor se quedara residente:

- **Sin salto FastCGI.** PHP va incrustado en el proceso de Rapira y el servidor llama directamente al intérprete: ni socket, ni protocolo, ni un segundo demonio al que pasarle la petición; el worker que responde es el proceso que lleva dentro el intérprete.
- **El proceso no muere.** Tu script de worker se ejecuta una vez. El autoloader de Composer y su classmap se registran una sola vez, al arrancar, y no se vuelven a registrar en cada petición como hace un front controller.
- **OPcache está caliente y se comparte.** PHP arranca una sola vez en el maestro, antes de hacer fork de ningún worker, así que todos los workers heredan la misma caché de scripts compilados: tu código y tu árbol de `vendor/`. Los archivos de `config:cache` y `route:cache` también se compilan una sola vez, de modo que volver a ejecutarlos en cada petición no cuesta ningún parseo. Los dos comandos de caché de artisan se han verificado con este patrón.

Si el trato no te convence, la [salida de emergencia al modo clásico](#la-salida-de-emergencia-el-modo-clasico) del final de esta página no necesita ningún script de worker.

## Antes de empezar

Necesitas Rapira instalado —lo tienes en [Instalación](/es/docs/installation)— y una aplicación de Laravel que ya te funcione. También necesitas un PHP CLI normal en la máquina para Composer y `artisan`: Rapira trae PHP como biblioteca (`libphp`), no como comando `php`, así que esos pasos se ejecutan con el PHP de tu sistema, que Rapira ni usa ni toca.

Hay una cosa que conviene comprobar antes del primer arranque: un esqueleto recién creado de `laravel/laravel` viene con una base de datos SQLite y con los drivers de sesión, caché y colas apoyados en base de datos, lo que significa que necesita `pdo_sqlite`. El PHP que acompaña a las releases de Rapira lo trae: PDO, `pdo_sqlite` y `sqlite3` están en el conjunto de extensiones de la compilación de release, tal y como lista la página de [Instalación](/es/docs/installation). Si ejecutas Rapira contra un PHP compilado por ti, asegúrate de que esas extensiones aparecen en tu línea de configure ([Compilar desde el código](/es/docs/build-from-source) lo cuenta), o tira por el camino sin base de datos y apunta Laravel a los drivers de archivo y sync: `SESSION_DRIVER=file`, `CACHE_STORE=file`, `QUEUE_CONNECTION=sync`. Esa es la combinación con la que se verificó esta página.

## El script del worker

Deja este archivo en la raíz de la aplicación, junto a `composer.json`: todas sus rutas son relativas a `__DIR__`, así que tiene que estar donde están `vendor/`, `bootstrap/` y `storage/`.

```php
<?php

declare(strict_types=1);

use Illuminate\Http\Request;
use Rapira\Plugin\Http\HttpHandlerConfig;

use function Rapira\create_plugin_handler;

define('LARAVEL_START', microtime(true));

// Resident: the autoloader and opcache-compiled classes stay warm.
require __DIR__ . '/vendor/autoload.php';

$http = create_plugin_handler(new HttpHandlerConfig());

$handler = static function (): void {
    if (file_exists($maintenance = __DIR__ . '/storage/framework/maintenance.php')) {
        require $maintenance;
    }

    // A fresh application per request. `require`, not `require_once`:
    // bootstrap/app.php must run again for every request.
    $app = require __DIR__ . '/bootstrap/app.php';
    $app->handleRequest(Request::capture());
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Léelo de arriba abajo y verás `public/index.php` partido en dos: lo que se puede hacer una sola vez queda por encima del bucle, y lo que no, dentro del handler.

- **`LARAVEL_START`** se define justo donde lo define el front controller original, antes que nada. Una constante es de todo el proceso, así que su sitio está por encima del bucle, y eso también significa que ahora marca el arranque del *worker*, no el de la petición. Cualquier cosa que mida una petición como `microtime(true) - LARAVEL_START` te dará en realidad el tiempo que lleva vivo el worker, subiendo hasta que se recicle; toma tu propia marca de tiempo dentro del handler.
- **El autoloader se incluye una sola vez**, fuera del handler, y ese es todo el estado residente que este patrón conserva de verdad. Lo que va por debajo es trabajo de cada petición.
- **La comprobación del modo mantenimiento va dentro del handler**, porque `php artisan down` puede ejecutarse en cualquier momento de la vida del worker y hay que comprobarlo petición a petición. El `storage/framework/maintenance.php` que se genera termina la petición con `exit`, y aquí eso es seguro: un `exit` dentro del handler vacía la respuesta hacia el cliente y el worker sigue sirviendo. Está verificado, y es la regla general del [modo worker](/es/docs/worker).
- **`$app = require __DIR__ . '/bootstrap/app.php'`** es la aplicación nueva, reconstruida solo para esta petición.
- **`$app->handleRequest(Request::capture())`** es la línea que trae el propio Laravel: atiende la petición, envía la respuesta y ejecuta `terminate()`, middleware y callbacks terminables incluidos. No hace `exit`, así que el control vuelve al bucle.
- **`gc_collect_cycles()` en el bucle** es la forma canónica del bucle de Rapira: recoge los ciclos de referencias entre peticiones y no en mitad de una. Déjalo ahí, pero no esperes que arregle el comportamiento de la memoria del que habla la siguiente sección, porque no lo arregla.

::: warning `require`, no `require_once`
Esta es la línea que no puedes equivocar. A partir de la segunda petición, `require_once` devuelve `true` en lugar de la instancia de `Application`, y todas las peticiones menos la primera se rompen. El `public/index.php` de toda la vida usa `require_once`, y hace bien: allí solo se ejecuta una vez por proceso. En un worker, `bootstrap/app.php` tiene que volver a ejecutarse en cada petición.
:::

## La memoria y por qué dibuja dientes de sierra

Reconstruir la aplicación en cada petición significa tirar una a la basura en cada petición, y el perfil de memoria que sale de ahí —dientes de sierra, no una fuga, y unos dientes que `gc_collect_cycles()` no puede aplanar— está contado al detalle en la [guía general de frameworks](/es/docs/frameworks/). La llamada sigue en el bucle de esta página porque es buena higiene para el resto de tu basura, no porque arregle eso.

Con Laravel hay dos consecuencias que no son opcionales. Dale margen de verdad a `memory_limit`, porque lo que tiene que caber es el pico del diente de sierra y el valor por defecto de PHP se queda corto para este patrón. Y pon `pool.max_requests = 100`: el reciclaje es lo que le pone techo a la subida, se ha verificado que no se nota a lo largo de cientos de peticiones seguidas repartidas en varios reciclajes, y para Laravel sobre Rapira es el ajuste de producción recomendado, no una optimización que dejar para más adelante.

::: warning No llames a `HandleExceptions::flushState()`
Parece la llamada de limpieza evidente y, con Rapira, se lleva por delante a tu worker. `Illuminate\Foundation\Bootstrap\HandleExceptions::flushState()` trata como caso especial el manejador de errores de PHPUnit y, con `phpunit` instalado —o sea, en cualquier esqueleto, porque es una dependencia de desarrollo por defecto—, lanza una excepción (`PHPUnit\TextUI\Configuration\Registry::get(): … null returned`). Si la pones en el cuerpo del bucle, entre peticiones, que es donde la colocan las recetas de otros servidores, la excepción se escapa del bucle, el script del worker muere, Rapira marca al worker como no sano y a los clientes les llegan `503`. Comprobado por las malas. Déjala fuera.
:::

## Ponerlo en marcha

El modo worker es lo que hace `rapira serve` por defecto, así que apuntarlo al script es todo el comando:

::: code-group

```bash [CLI]
rapira serve worker.php
```

```toml [rapira.toml]
[pool]
entrypoint = "worker.php"
processes = 4
max_requests = 100

[http]
listen = "127.0.0.1:8000"
```

:::

Con un archivo de configuración el comando es `rapira serve --config rapira.toml`, y un `entrypoint` relativo se resuelve respecto al directorio del propio archivo. `max_requests` es la clave de la sección anterior; todas las claves y sus valores por defecto están en la página de [Configuración](/es/docs/configuration).

Para producción, genera antes las cachés del framework. Las dos se verificaron con este worker, sin cachear y cacheadas, y la misma batería de pruebas pasó en ambos casos:

```bash
php artisan config:cache
php artisan route:cache
```

Esos archivos se leen en cada petición, igual que el resto del arranque: lo que te ahorra OPcache es el parseo, no la ejecución. Aun así, después de cada despliegue vuelve a lanzar los comandos y recarga el pool, porque el autoloader y el segmento de OPcache son justo lo que un worker en marcha no va a releer. Recargar es mandarle una señal al maestro ([Modelo de procesos](/es/docs/process-model)), y la forma que toma el despliegue alrededor de eso —junto con los archivos estáticos, TLS y para qué sirve un proxy inverso delante de Rapira— está en la [guía general de frameworks](/es/docs/frameworks/).

## Rutas y URLs

Rapira ejecuta un único script de entrada para todas las URL, así que con este worker `$_SERVER['SCRIPT_NAME']` vale `/worker.php` y no `/index.php`. A Laravel le da igual: el enrutado resuelve bien las rutas, las que no encajan con ninguna acaban en la página 404 del propio Laravel y `url()` genera URLs absolutas limpias —esquema, host y ruta— sin rastro de `worker.php` por ninguna parte. **No hace falta sobrescribir nada de `$_SERVER` ni tocar la configuración de rutas o de URLs**; se comprobó a propósito, porque es lo primero que se rompe en los servidores que mapean URLs sobre archivos.

La ruta de salud `/up` que trae el esqueleto responde `200` como siempre, lo que la convierte en el destino natural para el health check de un balanceador de carga o de un contenedor.

## Sesiones, CSRF y formularios

Las sesiones funcionan petición a petición, verificado con el driver de archivos: la cookie de sesión sale, vuelve en la petición siguiente y cada cliente tiene la suya. El driver de base de datos necesita que antes resuelvas el asunto de la extensión PDO de los requisitos, pero nada de esa elección de driver es específico de Rapira.

**En CSRF no hay nada específico de Rapira.** El token vive en la sesión, y se ha verificado que las sesiones funcionan petición a petición, así que un formulario que funciona con php-fpm no tiene ningún motivo achacable a Rapira para dejar de hacerlo. No hay nada que excluir, desactivar ni reconfigurar por culpa del worker. (Las rutas de prueba de la propia verificación envían POST sin token y por eso quedaron excluidas de CSRF, de modo que el viaje completo del token se deduce del resultado de las sesiones en lugar de medirse.)

Los envíos de formularios, los cuerpos de petición en JSON y las subidas de archivos se verificaron todos con ese mismo worker. Y cuando una ruta lanza una excepción, el manejador de excepciones de Laravel pinta su `500` de siempre: el fallo se queda dentro de la petición y el worker sigue atendiendo la siguiente.

## La salida de emergencia: el modo clásico

Si prefieres no mantener ningún script de worker, no lo mantengas:

```bash
rapira serve --classic public/index.php
```

Ese es el camino sin tocar nada. Rapira ejecuta desde cero tu front controller de siempre en cada petición, al estilo de php-fpm, y tu aplicación no nota la diferencia. Renuncias al proceso residente —el autoloader se vuelve a registrar en cada petición, igual que hoy— y te quedas con el reemplazo directo de php-fpm y con OPcache compartida. En [Modo clásico](/es/docs/classic) está la historia entera, y en [Modos de ejecución](/es/docs/execution-modes) tienes dónde cae cada uno de los dos peldaños en la escalera.

::: question ¿Cuándo será Rapira compatible con Octane?
Hoy no hay driver de Octane, y esta guía prefiere decirlo claro antes que publicar uno a medio funcionar. El peldaño no tiene nada que ver: Symfony y Yii3 mantienen su aplicación residente en el mismo peldaño SAPI Worker en el que aquí corre Laravel (en [Modos de ejecución](/es/docs/execution-modes) tienes qué significa cada peldaño). Lo que a Laravel le hace falta es el desmontaje de estado entre peticiones que hace Octane, y eso es un driver que alguien tiene que escribir. Mientras tanto, lo que sí está verificado que funciona es una aplicación nueva en cada petición dentro de un worker residente, y es lo que documenta esta página.
:::

::: question ¿Por qué no mantener yo mismo `$app` residente?
Porque estarías reconstruyendo a mano el sandbox de Octane. El estado que hay que deshacer entre peticiones está repartido entre el contenedor, los singletons ya resueltos, la pila de petición/sesión/autenticación y las estáticas del propio framework; Octane existe precisamente porque recogerlo todo es un trabajo delicado, y los fallos que aparecen cuando se te escapa uno son sutiles: un objeto de petición caducado, la sesión de un usuario visible para el siguiente, una configuración que una petición cambió y nadie restauró. Una versión a medias de eso no la vamos a documentar. La única trampa que sí hemos perseguido hasta el final está en la sección de memoria de más arriba: `HandleExceptions::flushState()` parece parte de la solución y lo que hace es matar al worker.
:::

::: question ¿Tengo que ajustar `memory_limit`?
Sí: dale más margen que el valor que usabas con php-fpm, y acompáñalo de `pool.max_requests`. Los dos están en la [sección sobre memoria](#la-memoria-y-por-que-dibuja-dientes-de-sierra) de arriba, y el mecanismo que hay detrás, en la [guía general de frameworks](/es/docs/frameworks/).
:::
