---
title: Symfony
description: "Cómo ejecutar una aplicación Symfony sobre Rapira en modo worker: el script del worker, el reinicio de servicios entre peticiones y cómo llegan al contenedor los valores de .env."
---

# Symfony

La estructura de Symfony encaja con un worker residente: un kernel que arrancas, una `Request` que le pasas y una `Response` que te devuelve. Con Rapira el kernel arranca una sola vez, al levantarse el worker, y a partir de ahí cada petición es una llamada a `handle()` sobre un contenedor que ya está caliente. De tu aplicación no cambia casi nada: lo que cambia son las veinte líneas que sustituyen a `public/index.php`. Esta página cubre ese archivo, el reinicio entre peticiones y cómo llegan al contenedor los valores de `.env`.

::: info Verificado con
- **PHP 8.5.8** — NTS, SAPI embed
- **Rapira 0.6.0**
- **Symfony 7.4** (`symfony/framework-bundle` v7.4.15) — batería completa en `dev` y en `prod`
- **Symfony 8.1** (`symfony/framework-bundle` v8.1.2) — batería completa en `dev`

Las dos aplicaciones son un `symfony/skeleton` pelado corriendo en un único proceso worker, y las dos ejecutaron el **mismo `worker.php`**, byte a byte, sin ninguna rama por versión. La batería cubre el enrutado, un 404, cadenas de consulta, URLs generadas, envíos de formulario, cuerpos JSON, sesiones que se mantienen entre peticiones, la subida de un archivo, una excepción sin capturar y 200 peticiones seguidas.
:::

## Comportamiento en modo worker

El kernel arranca en la parte de arriba del script, fuera del bucle, y se queda residente mientras viva el proceso del worker: el autoloader, el contenedor compilado, el router, el event dispatcher y todas las conexiones que hayan abierto tus bundles se construyen una vez en lugar de una vez por petición. Eso es lo que aporta el [modo SAPI Worker](/es/docs/worker); mira [Modos de ejecución](/es/docs/execution-modes) para más detalles.

En cada petición, el handler hace cuatro cosas y después limpia:

1. `Request::createFromGlobals()` — Rapira vuelve a rellenar `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` y `$_FILES` en cada petición antes de llamar a tu handler, así que el constructor de siempre de Symfony lee exactamente lo mismo que leería con php-fpm.
2. `$kernel->handle($request)` — enrutado, controlador y respuesta, sin cambios.
3. `$response->send()` — la salida se convierte en la respuesta HTTP (en [HTTP](/es/docs/http) tienes cómo se empaqueta al salir).
4. `$kernel->terminate($request, $response)` — se ejecutan los listeners posteriores a la respuesta, como siempre.

Después, el handler reinicia los servicios con estado a través del `services_resetter` del contenedor: es el mismo reinicio que Symfony ejecuta entre mensajes de Messenger, y es lo que usa un kernel de vida larga para soltar lo que se va acumulando petición a petición.

Las sesiones funcionan como sesiones nativas de PHP, exactamente igual que con php-fpm: `session_start()` en cada petición, la cookie sale con la respuesta y los datos se vuelven a leer en la siguiente. El aislamiento entre clientes está verificado: un segundo cliente con el tarro de cookies limpio recibe su propia sesión.

Un kernel vive en un proceso worker, y los workers son procesos independientes del sistema: entre ellos no se comparte nada en el espacio de usuario. En [Modelo de procesos](/es/docs/process-model) tienes cuántos hay y cómo se supervisan.

## Requisitos previos

Necesitas [Rapira instalado](/es/docs/installation) y una aplicación Symfony, ya sea un `composer create-project symfony/skeleton my-app` recién hecho o la que ya tengas. No hay que preparar nada especial: el script del worker se pone al lado de `composer.json` y todo lo demás se queda donde está. También necesitas un PHP CLI normal en la máquina para Composer y `bin/console`: Rapira incluye PHP como biblioteca (`libphp`), no como comando `php`, así que esos pasos se ejecutan con el PHP de tu sistema, que Rapira ni usa ni toca.

Hay dos extensiones que sí importan, porque el skeleton las exige de forma estricta en `composer.json` (`ext-ctype`, `ext-iconv`) *y además* hace `replace` de los polyfills correspondientes, así que tienen que ser extensiones de verdad y no sustitutos escritos en PHP. Las necesitan las dos compilaciones de PHP, también el CLI del sistema: si no, `composer create-project` y `composer install` fallan en la comprobación de plataforma mucho antes de que Rapira entre en juego. El PHP que va dentro de cada release de Rapira trae las dos: `ctype` e `iconv` están en la línea de configure de la compilación, y la lista completa de extensiones está en la página de [Instalación](/es/docs/installation). Si en vez de eso compilas Rapira contra un PHP tuyo, deja las dos activadas; en [Compilar desde el código](/es/docs/build-from-source) se ve dónde se fija esa lista.

El archivo del worker que viene abajo usa además `symfony/dotenv`, que el skeleton ya incluye. Si tu despliegue define variables de entorno de verdad y no tiene ningún `.env`, quita esa línea y, con ella, el componente. El worker no pasa por `symfony/runtime` —arranca el `.env` y construye el kernel él mismo—, pero deja el paquete instalado, porque `bin/console` y `public/index.php` lo siguen usando.

## El script del worker

Ponlo en la raíz del proyecto como `worker.php`. Es el archivo que se verificó, tal cual, en las dos versiones mayores:

```php
<?php

declare(strict_types=1);

use App\Kernel;
use Rapira\Plugin\Http\HttpHandlerConfig;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

use function Rapira\create_plugin_handler;

require __DIR__ . '/vendor/autoload.php';

// public/index.php delegates this to symfony/runtime; here we do it once, up front.
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');

$kernel = new Kernel($_SERVER['APP_ENV'], (bool) $_SERVER['APP_DEBUG']);
$kernel->boot();
$container = $kernel->getContainer();

$http = create_plugin_handler(new HttpHandlerConfig());

$handler = static function () use ($kernel, $container): void {
    $request = Request::createFromGlobals();

    try {
        $response = $kernel->handle($request);
        $response->send();
        $kernel->terminate($request, $response);
    } finally {
        // The same reset Symfony runs between Messenger messages: every service
        // tagged kernel.reset drops the state it accumulated during the request.
        // In finally: handle() turns application exceptions into a response, but a
        // failing send() or a throwing kernel.terminate listener escapes the handler,
        // and the worker keeps serving — the reset has to run on that path too.
        if ($container->has('services_resetter')) {
            $container->get('services_resetter')->reset();
        }
    }
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Casi todo es arranque normal y corriente de Symfony. Cuatro líneas son propias de este montaje:

**`(new Dotenv())->usePutenv()->bootEnv(...)`.** En una aplicación normal esto no lo escribes nunca, porque `public/index.php` se lo delega a `symfony/runtime`. Aquí el arranque es cosa del worker, así que carga el `.env` él mismo, una sola vez y antes de que exista el kernel. `usePutenv()` es obligatorio: sin él la aplicación responde 500 en `prod`, mientras que en `dev` sigue funcionando. Mira [`$_ENV` y `variables_order`](#env-y-variables-order) para más detalles.

**El kernel se construye y se arranca antes del bucle.** `new Kernel(...)`, `boot()` y `getContainer()` se ejecutan al levantarse el worker, así que `$_SERVER['APP_ENV']` se lee cuando los valores de Dotenv todavía están puestos, y el contenedor ya está caliente antes de que llegue la primera petición. A partir de ahí, todo lo que hay dentro del `while` trabaja contra ese único contenedor.

**`$container->has('services_resetter')` antes del `get()`.** El id de servicio `services_resetter` es público tanto en 7.4 como en 8.1, y por eso el mismo archivo vale para las dos: la *clase* que hay detrás cambió de namespace entre una mayor y otra (`Symfony\Component\DependencyInjection\ServicesResetter` en 7.4, `Symfony\Component\HttpKernel\DependencyInjection\ServicesResetter` en 8.1), y pedir el servicio por su id hace desaparecer esa diferencia. La comprobación con `has()` evita que el script se vaya a un error fatal con un contenedor que no lo defina.

**El bucle y `gc_collect_cycles()`.** `handleRequest()` se bloquea hasta que llega una petición, ejecuta tu handler y devuelve `true`; o `false` cuando el servidor se está apagando, que es lo que termina el bucle. Recoger los ciclos una vez por vuelta mantiene ese trabajo entre peticiones y no en mitad de una. El contrato completo está en [Modo worker](/es/docs/worker).

Si el resetter no basta, quedan dos herramientas más contundentes: `$container->reset()` borra todos los servicios que se hayan instanciado, y `$kernel->reboot(null)` tira el contenedor y construye uno nuevo, con lo que el `$container` que capturó el handler se queda obsoleto y tendrás que volver a pedirlo con `$kernel->getContainer()` si tiras por ese camino. Las dos descartan el estado caliente que te da el modo worker, así que úsalas mientras investigas una fuga, no como valor por defecto.

## `$_ENV` y `variables_order`

::: warning
Con un `bootEnv()` a secas —sin `usePutenv()`—, una aplicación Symfony con `APP_ENV=prod` responde **500 ya en la primera petición**, y en todas las siguientes, con `EnvNotFoundException: Environment variable not found: "DEFAULT_URI"`. La misma aplicación en `dev` no falla.
:::

La causa está en PHP. Con los valores de ini por defecto con los que se hizo la verificación (`variables_order = "GPCS"`, `auto_globals_jit = On`), PHP vuelve a armar el flag JIT de `$_ENV` en **cada** petición. El primer archivo que se compile durante esa petición y mencione `$_ENV` dispara `php_auto_globals_create_env`, que reimporta la superglobal desde el entorno real del proceso y borra todo lo que `Dotenv->bootEnv()` había dejado ahí al arrancar el worker. En la prueba, `$_ENV` pasó de ser un array lleno a estar vacío en mitad de una petición.

Por qué solo en `prod`: ahí es la primera petición la que compila de forma perezosa el contenedor y los archivos de servicios, así que el borrado cae *antes* de que `RequestContext` resuelva `%env(DEFAULT_URI)%`, y para entonces ya no queda nada que resolver. En `dev`, el contenedor de depuración resuelve las variables de entorno de golpe durante `$kernel->boot()`, en el arranque, y se guarda los valores; el borrado llega cuando la respuesta ya estaba anotada. El comportamiento es el mismo en `dev`, solo que allí no tiene ningún efecto.

El arreglo es esa única línea del script de arriba:

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` hace que Dotenv escriba los valores también en el entorno *real* del proceso, que es justo de donde lee la reimportación, así que ahí los valores sobreviven; y el `EnvVarProcessor` de Symfony recurre a `getenv()` de todas formas. Rapira ejecuta PHP en NTS con un modelo de procesos pre-fork, un intérprete por proceso, así que las advertencias habituales sobre `putenv()` y los hilos aquí no vienen al caso.

La otra opción en producción es definir variables de entorno de verdad —un `Environment=` de systemd, tu runtime de contenedores, tu orquestador— y dejar el `.env` como comodidad de desarrollo. En cualquiera de los dos casos, los valores viven en un sitio que la reimportación de mitad de petición no puede borrar.

Esto se aplica a cualquier runtime de PHP con workers residentes: cualquier framework que lea `$_ENV` de forma perezosa está expuesto. La página de [Frameworks](/es/docs/frameworks/) lo trata junto a los otros dos comportamientos de los procesos residentes: el destructor de un objeto de arranque y `register_shutdown_function()`, que se disparan una sola vez, al final de la primera petición.

## Ponerlo en marcha

```bash
rapira serve worker.php
curl -i http://127.0.0.1:8000/
```

El modo worker es el de por defecto y `127.0.0.1:8000`, la dirección de escucha por defecto. `rapira serve` se queda en primer plano y `Ctrl-C` lo apaga drenando lo que tenga en curso.

El script de entrada es `worker.php` y no `index.php`, así que `$_SERVER['SCRIPT_NAME']` vale `/worker.php`. La `Request` de Symfony busca ese nombre al principio de la URI, no lo encuentra y degrada la URL base a `""`. `getPathInfo()` devuelve la ruta real, el enrutado casa y `generateUrl()` genera rutas limpias, sin ningún prefijo `/worker.php` por ninguna parte. No hace falta sobrescribir `$_SERVER` ni recurrir a `Request::setTrustedProxies()` para esto.

## Pasar a producción

Pon `APP_ENV=prod`, instala sin dependencias de desarrollo y precalienta la caché antes de arrancar el servidor. Se verificó que `php bin/console cache:warmup` deja la aplicación arrancando limpia, y saca la compilación del contenedor de la primera petición:

```bash
composer install --no-dev --optimize-autoloader
APP_ENV=prod php bin/console cache:warmup
```

Ya que estás, revisa `DEFAULT_URI`. El `config/packages/routing.yaml` del skeleton pone `router.default_uri` a `%env(DEFAULT_URI)%` en **todos** los entornos, y el `.env` lo trae como `http://localhost`, que es el valor con el que se construyen las URLs generadas fuera de una petición HTTP: comandos de consola, correos. Apúntalo a tu origen de verdad.

Un `rapira.toml` pequeño para ejecutarlo:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
processes = 4
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` recicla el worker pasadas esas peticiones, de modo que una fuga lenta en cualquier rincón de tu árbol de dependencias nunca pueda crecer sin límite; acota la fuga, no la arregla. `request_terminate_timeout_secs` pone un techo de tiempo real a una sola petición, porque si no un worker residente se queda bloqueado indefinidamente dentro de una petición colgada. Lánzalo con `rapira serve --config rapira.toml`. Todas estas claves, y las demás, están en la página de [Configuración](/es/docs/configuration); un `entrypoint` relativo se resuelve respecto al directorio del propio archivo de configuración.

## Qué se reinicia entre peticiones

`services_resetter` llama a `reset()` en todos los servicios etiquetados con `kernel.reset`. Cuáles son depende de los bundles que tengas instalados: los handlers de log con búfer, los recolectores de datos de depuración y demás acumuladores por petición se ponen la etiqueta ellos solos, así que una única llamada los alcanza a todos.

Lo que no cubre es el estado que te guardas tú: propiedades estáticas, globales memoizadas, un registro que alguna biblioteca va llenando sobre la marcha, un `ini_set()` que nunca deshiciste. Todo eso sobrevive a la petición en cualquier worker residente y tiene que reiniciarlo tu propio código. En la página de [Frameworks](/es/docs/frameworks/) está la tabla de qué sobrevive y qué no.

Con el resetter puesto, la verificación vio la memoria residente plana a lo largo de 200 peticiones seguidas, tanto en `dev` como en `prod`: el kernel mantiene un conjunto de trabajo constante en lugar de crecer petición a petición. Si la memoria de tu aplicación crece, algo de tu código o de algún bundle se está quedando con las peticiones.

## Trabajo después de la respuesta

Si quieres soltar al cliente antes de que se ejecuten los listeners posteriores a la respuesta, llama a [`rapira_finish_request()`](/es/docs/http) entre `$response->send()` y `$kernel->terminate($request, $response)`: la respuesta sale y `terminate()` sigue trabajando en un worker al que el cliente ya no espera. El worker en sí sigue ocupado hasta que tu handler retorne, así que esto es una herramienta de latencia, no una manera de conseguir concurrencia.

## El bucle de desarrollo

`rapira serve` se ejecuta en primer plano y tu aplicación arranca una sola vez, así que **el código PHP que cambies no se recoge hasta que se reemplacen los workers**. Mientras estás editando a fondo, lo más simple es parar y arrancar el servidor, o ejecutar el front controller en [modo clásico](/es/docs/classic), donde el script se ejecuta desde cero cada vez y cada guardado se ve al momento:

```bash
rapira serve --classic public/index.php
```

Es la misma aplicación en modo clásico: arranca en cada petición, así que los cambios surten efecto al momento, a costa de un arranque completo por petición. En un servidor de producción ya en marcha, la forma de que el código recién desplegado tome el relevo sin tirar conexiones es una recarga sin cortes (`SIGUSR2` al maestro), salvo que uses `opcache.validate_timestamps = 0`: ahí el segmento de OPcache del maestro sobrevive al pool y el despliegue necesita un reinicio completo. Mira [Modelo de procesos](/es/docs/process-model) y [cómo ejecutarlo en producción](/es/docs/deployment).

Una excepción sin capturar se gestiona dentro de Symfony: el framework responde con su propio `500` —la página completa de la excepción en `dev`, una página de error genérica en `prod`— y la petición siguiente la recoge ese mismo proceso worker, con el pid intacto pese al fallo. Lo que sobrevive a una excepción es el estado de servicio corrupto o de más, y eso lo suelta el reinicio del final del handler. Dónde acaba la traza depende de tu logger, y un skeleton recién creado no trae ninguno. Lo que sí llega al registro de Rapira por stderr es todo lo que se escapa del propio PHP, como la `EnvNotFoundException` de antes; en [Registros](/es/docs/logging) se ve cómo subir el nivel.
