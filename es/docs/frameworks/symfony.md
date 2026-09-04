---
title: Symfony
description: "Cómo ejecutar una aplicación Symfony sobre Rapira en modo Worker: el script del worker, el reinicio de servicios entre peticiones y cómo llegan al contenedor los valores de .env."
---

# Symfony

Symfony admite un worker persistente. La aplicación inicia un kernel, le pasa una `Request` y recibe una `Response`.
Rapira inicia el kernel una vez por worker. Después, cada petición llama a `handle()` en el contenedor iniciado.
El código de la aplicación no cambia. Un script de worker sustituye `public/index.php`.
Esta página describe ese archivo, el reinicio del estado y los valores de `.env`.

::: info Verificado con
- **PHP 8.5.8** - NTS, SAPI embed
- **Rapira 0.8.0**
- **Symfony 7.4** (`symfony/framework-bundle` v7.4.15) - batería completa en `dev` y en `prod`
- **Symfony 8.1** (`symfony/framework-bundle` v8.1.2) - batería completa en `dev`

Las dos aplicaciones se crearon con el paquete `symfony/skeleton` y usaron un único proceso worker. Ambas ejecutaron el **mismo `worker.php`**, byte a byte, sin ninguna rama por versión. Las pruebas cubren el enrutado, un 404, cadenas de consulta, URLs generadas, envíos de formulario, cuerpos JSON, sesiones que se mantienen entre peticiones, la subida de un archivo, una excepción sin capturar y 200 peticiones seguidas.
:::

## Comportamiento en modo Worker

El kernel se inicia fuera del bucle y permanece durante la vida del worker. El autoloader, el contenedor, el router y las conexiones se inician una vez.
Consulta [modo Worker](/es/docs/worker) y [Modos de ejecución](/es/docs/execution-modes) para obtener más información.

En cada petición, el handler hace cuatro cosas y después limpia:

1. `Request::createFromGlobals()` - Rapira vuelve a rellenar `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` y `$_FILES` en cada petición antes de llamar a tu handler, así que el constructor de siempre de Symfony lee exactamente lo mismo que leería con php-fpm.
2. `$kernel->handle($request)` - enrutado, controlador y respuesta, sin cambios.
3. `$response->send()` - la salida se convierte en la respuesta HTTP (en [HTTP](/es/docs/http) tienes cómo se empaqueta al salir).
4. `$kernel->terminate($request, $response)` - se ejecutan los listeners posteriores a la respuesta, como siempre.

Después, el handler reinicia los servicios con estado a través del `services_resetter` del contenedor: es el mismo reinicio que Symfony ejecuta entre mensajes de Messenger, y es lo que usa un kernel de vida larga para soltar lo que se va acumulando petición a petición.

Las sesiones funcionan como sesiones nativas de PHP, exactamente igual que con php-fpm: `session_start()` en cada petición, la cookie sale con la respuesta y los datos se vuelven a leer en la siguiente. El aislamiento entre clientes está verificado: un segundo cliente con el tarro de cookies limpio recibe su propia sesión.

Un kernel vive en un proceso worker, y los workers son procesos independientes del sistema: entre ellos no se comparte nada en el espacio de usuario. En [Modelo de procesos](/es/docs/process-model) tienes cuántos hay y cómo se supervisan.

## Requisitos previos

Instala [Rapira](/es/docs/intro/installation) y crea o selecciona una aplicación Symfony. Coloca el script del worker junto a `composer.json`.
Instala un PHP CLI para Composer y `bin/console`. Rapira proporciona PHP como biblioteca, no como comando `php`.
Composer y `bin/console` usan el PHP CLI del sistema. Rapira no usa ni cambia este CLI.

Hay dos extensiones que sí importan, porque el archivo `composer.json` de la aplicación base las exige de forma estricta (`ext-ctype`, `ext-iconv`) *y además* hace `replace` de los polyfills correspondientes, así que tienen que ser extensiones de verdad y no sustitutos escritos en PHP. Las necesitan las dos compilaciones de PHP, también el CLI del sistema: si no, `composer create-project` y `composer install` fallan en la comprobación de plataforma mucho antes de que Rapira entre en juego. El PHP que va dentro de cada release de Rapira trae las dos: `ctype` e `iconv` están en la línea de configure de la compilación, y la lista completa de extensiones está en la página de [Instalación](/es/docs/intro/installation). Si en vez de eso compilas Rapira contra un PHP tuyo, deja las dos activadas; en [Compilar desde el código](/es/docs/intro/build-from-source) se ve dónde se fija esa lista.

El archivo del worker que viene abajo usa además `symfony/dotenv`, que la aplicación base ya incluye. Si tu despliegue define variables de entorno de verdad y no tiene ningún `.env`, quita esa línea y, con ella, el componente. El worker no pasa por `symfony/runtime` -arranca el `.env` y construye el kernel él mismo-, pero deja el paquete instalado, porque `bin/console` y `public/index.php` lo siguen usando.

## El script del worker

Ponlo en la raíz del proyecto como `worker.php`. Es el script que se verificó en las dos versiones mayores, puesto al día con la API actual del worker:

```php
<?php

declare(strict_types=1);

use App\Kernel;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

require __DIR__ . '/vendor/autoload.php';

// public/index.php uses symfony/runtime for this operation.
// The worker performs it once before the request loop.
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');

$kernel = new Kernel($_SERVER['APP_ENV'], (bool) $_SERVER['APP_DEBUG']);
$kernel->boot();
$container = $kernel->getContainer();

$handler = static function () use ($kernel, $container): void {
    $request = Request::createFromGlobals();

    try {
        $response = $kernel->handle($request);
        $response->send();
        $kernel->terminate($request, $response);
    } finally {
        // Symfony uses the same reset between Messenger messages.
        // Each service with the kernel.reset tag removes request state.
        // The finally block also resets state when send() or terminate() throws.
        if ($container->has('services_resetter')) {
            $container->get('services_resetter')->reset();
        }
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Casi todo es arranque normal y corriente de Symfony. Cuatro líneas son propias de este montaje:

**`(new Dotenv())->usePutenv()->bootEnv(...)`.** El `public/index.php` estándar delega esta operación a `symfony/runtime`.
El worker lee `.env` una vez antes de crear el kernel. Usa `usePutenv()` porque la aplicación devuelve `500` en `prod` sin él.
Consulta [`$_ENV` y `variables_order`](#env-y-variables-order).

**El kernel se inicia antes del bucle.** `new Kernel(...)`, `boot()` y `getContainer()` se ejecutan al iniciar el worker.
Por tanto, lee `$_SERVER['APP_ENV']` antes de que una petición pueda borrar los valores de Dotenv. Cada petición usa el mismo contenedor.

**`$container->has('services_resetter')` antes de `get()`.** El identificador `services_resetter` es público en las dos versiones admitidas.
La clase de implementación usa espacios de nombres diferentes en 7.4 y 8.1. El identificador del servicio evita una condición de versión.
La comprobación `has()` evita un error cuando el contenedor no define el servicio.

**El bucle y `gc_collect_cycles()`.** `\Rapira\handle_request()` se bloquea hasta que llega una petición, ejecuta tu handler y devuelve `true`. Devuelve `false` cuando el worker empieza a drenarse, que es lo que termina el bucle. Recoger los ciclos una vez por vuelta mantiene ese trabajo entre peticiones y no en mitad de una. El contrato completo está en [Modo Worker](/es/docs/worker).

Si el resetter no es suficiente, usa `$container->reset()` o `$kernel->reboot(null)`. La primera opción elimina todos los servicios creados.
La segunda elimina el contenedor y crea uno nuevo.
Después de `$kernel->reboot(null)`, obtiene el contenedor nuevo con `$kernel->getContainer()`. El handler no debe usar el contenedor anterior.
Ambas opciones eliminan el estado en caché. Úsalas para encontrar una fuga, no como configuración predeterminada.

## `$_ENV` y `variables_order`

::: warning
Con `bootEnv()` sin `usePutenv()`, una aplicación Symfony en `prod` devuelve **500** para cada petición.
La excepción es `EnvNotFoundException: Environment variable not found: "DEFAULT_URI"`. La misma aplicación en `dev` no falla.
:::

PHP causa este resultado. Con `variables_order = "GPCS"` y `auto_globals_jit = On`, PHP reinicia el indicador JIT de `$_ENV` para cada petición.
El primer archivo compilado que usa `$_ENV` llama a `php_auto_globals_create_env`. Esta función vuelve a importar `$_ENV` desde el entorno.
La operación elimina los valores añadidos por `Dotenv->bootEnv()` durante la inicialización. Las pruebas observaron que `$_ENV` quedó vacío durante una petición.

En `prod`, la primera petición compila el contenedor y los archivos de servicios. PHP vacía `$_ENV` antes de resolver `%env(DEFAULT_URI)%`.
En `dev`, el contenedor resuelve y guarda las variables durante `$kernel->boot()`. PHP vacía `$_ENV` después de esta operación.
El reinicio ocurre en ambos entornos, pero solo `prod` usa el valor vacío.

Usa esta llamada:

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` escribe los valores de Dotenv en el entorno del proceso. La importación posterior lee estos valores.
`EnvVarProcessor` de Symfony también puede leerlos con `getenv()`.
Rapira ejecuta un intérprete PHP NTS en cada proceso. Por tanto, no hay hilos PHP simultáneos que llamen a `putenv()`.

En producción, define variables de entorno mediante systemd, el contenedor o el orquestador.
Usa `.env` solo durante el desarrollo. Ambos métodos evitan que una petición elimine los valores.

Este comportamiento se aplica a cualquier runtime persistente de PHP que lea `$_ENV` durante una petición.
Consulta este y otros comportamientos en [Frameworks](/es/docs/frameworks/).

## Iniciar Rapira

```bash
rapira serve --mode worker worker.php
curl -i http://127.0.0.1:8000/
```

`--mode worker` selecciona el modo Worker. `127.0.0.1:8000` es la dirección predeterminada.
`rapira serve` permanece en primer plano. Pulsa `Ctrl-C` para detenerlo.

El script de entrada es `worker.php`, por lo que `$_SERVER['SCRIPT_NAME']` contiene `/worker.php`. Symfony no encuentra este valor al principio de la URI.
Después, establece la URL base en `""`. `getPathInfo()` devuelve la ruta y el enrutado funciona correctamente.
`generateUrl()` crea rutas sin el prefijo `/worker.php`. No necesitas modificar `$_SERVER` ni usar `Request::setTrustedProxies()`.

## Pasar a producción

Establece `APP_ENV=prod`. Instala sin dependencias de desarrollo.
Crea la caché antes de iniciar el servidor. Las pruebas confirmaron la inicialización correcta con `php bin/console cache:warmup`.
Este comando también compila el contenedor antes de la primera petición:

```bash
composer install --no-dev --optimize-autoloader
APP_ENV=prod php bin/console cache:warmup
```

Ya que estás, revisa `DEFAULT_URI`. El archivo `config/packages/routing.yaml` de la aplicación base pone `router.default_uri` a `%env(DEFAULT_URI)%` en **todos** los entornos, y el `.env` lo trae como `http://localhost`, que es el valor con el que se construyen las URLs generadas fuera de una petición HTTP: comandos de consola, correos. Apúntalo a tu origen de verdad.

Un `rapira.toml` pequeño para ejecutarlo:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` sustituye un worker después del número especificado de peticiones. Limita una fuga de memoria, pero no la corrige.
`request_terminate_timeout_secs` limita el tiempo de una petición.
Inicia el servidor con `rapira serve --config rapira.toml`.
Un `entrypoint` relativo usa el directorio del archivo. Consulta todos los ajustes en [Configuración](/es/docs/configuration).

## Reinicio del estado entre peticiones

`services_resetter` llama a `reset()` en cada servicio con la etiqueta `kernel.reset`. Los bundles instalados determinan estos servicios.
Algunos ejemplos son los handlers de registro con búfer y los recolectores de depuración. Los servicios registran la etiqueta.

No reinicia las propiedades estáticas, los valores globales, los registros de bibliotecas ni los cambios persistentes de `ini_set()`.
Este estado permanece en cada worker persistente. Reinícialo en el código de la aplicación.
Consulta la duración del estado en [Frameworks](/es/docs/frameworks/).

Las pruebas con el resetter mostraron memoria estable durante 200 peticiones en `dev` y `prod`.
Si aumenta la memoria, el código de la aplicación o un bundle puede estar conservando el estado de petición.

## Trabajo después de la respuesta

Llama a [`rapira_finish_request()`](/es/docs/http) entre `$response->send()` y `$kernel->terminate()` para enviar la respuesta antes de los listeners posteriores.
El worker continúa ejecutando `terminate()` hasta que retorna el handler. Esto puede reducir la espera del cliente, pero no añade concurrencia.

## El bucle de desarrollo

`rapira serve` se ejecuta en primer plano e inicia la aplicación una vez. Por tanto, **sustituye el worker para cargar el código PHP modificado**.
Reinicia el servidor después de cada cambio durante el desarrollo. Como alternativa, usa el [modo Classic](/es/docs/classic):

```bash
rapira serve --mode classic public/index.php
```

Es la misma aplicación en modo Classic: arranca en cada petición, así que los cambios surten efecto al momento, a costa de un arranque completo por petición. En un servidor de producción ya en marcha, la forma de que el código recién desplegado tome el relevo sin tirar conexiones es una recarga sin cortes (`SIGUSR2` al maestro), salvo que uses `opcache.validate_timestamps = 0`: ahí el segmento de OPcache del maestro sobrevive al pool y el despliegue necesita un reinicio completo. Mira [Modelo de procesos](/es/docs/process-model) y [cómo ejecutarlo en producción](/es/docs/deployment).

Symfony gestiona una excepción de la aplicación y devuelve su respuesta `500`. `dev` muestra la página de excepción.
`prod` muestra una página de error general. El mismo worker procesa la siguiente petición.
El reinicio final elimina el estado modificado de los servicios. El logger configurado controla la salida de la excepción.
Rapira registra los errores PHP que salen del framework. Consulta los niveles en [Registros](/es/docs/logging).
