---
title: Symfony
description: "Cómo ejecutar Symfony en modo Worker con un script de worker, el reinicio de servicios entre peticiones y los valores de .env en el contenedor."
---

# Symfony

Symfony admite un worker persistente. La aplicación inicia un kernel, le pasa una `Request` y recibe una `Response`. Rapira inicia el kernel una vez por worker. Después, cada petición llama a `handle()` en el mismo kernel.

El código de la aplicación no cambia. Un script de worker sustituye `public/index.php`. Esta página describe ese archivo, el reinicio del estado y los valores de `.env`.

::: info Verificado con
- **PHP 8.5.8**: NTS, SAPI embed
- **Rapira 0.8.0**
- **Symfony 7.4** (`symfony/framework-bundle` v7.4.15), probado en `dev` y en `prod`
- **Symfony 8.1** (`symfony/framework-bundle` v8.1.2), probado en `dev`

Las dos aplicaciones base usaron el paquete `symfony/skeleton` y un worker. Las dos usaron el **mismo `worker.php`** sin condiciones de versión. Las pruebas cubrieron el enrutado, los errores, las peticiones, las sesiones, las subidas de archivos y 200 peticiones seguidas. Los ejemplos de esta página usan el formato de configuración de v0.9.
:::

## Comportamiento en modo Worker

El kernel se inicia fuera del bucle y permanece hasta que el script del worker se reinicia. El autoloader, el contenedor, el router, el dispatcher de eventos y las conexiones se inician una vez. Consulta [modo Worker](/es/docs/worker) y [Modos de ejecución](/es/docs/execution-modes) para obtener más información.

En cada petición, el handler crea una `Request` a partir de las superglobales que rellena Rapira. Después llama a `handle()`, `send()` y `terminate()`. Por último, llama a `services_resetter` para reiniciar los servicios con estado. Consulta [HTTP](/es/docs/http) para ver la transmisión de la respuesta.

Las sesiones usan las funciones de sesión nativas de PHP. Una petición que usa la sesión llama a `session_start()`, y la respuesta contiene la cookie de sesión. La siguiente petición lee la sesión guardada. Las pruebas confirmaron que clientes diferentes reciben sesiones diferentes.

Cada proceso worker tiene un kernel. Los workers no comparten objetos de la aplicación. Consulta [Modelo de procesos](/es/docs/process-model) para ver el número de workers y su supervisión.

## Requisitos previos

Instala [Rapira](/es/docs/intro/installation). Crea o selecciona una aplicación Symfony. Coloca el script del worker junto a `composer.json`.

Instala un PHP CLI para Composer y `bin/console`. Rapira proporciona PHP como biblioteca, no como comando `php`. Composer y `bin/console` usan el PHP CLI del sistema. Rapira no usa ni cambia este CLI.

La aplicación base necesita las extensiones `ctype` e `iconv`. También sustituye sus polyfills de PHP, por lo que las dos deben ser extensiones nativas. El PHP CLI del sistema también las necesita para las comprobaciones de plataforma de Composer. Cada release de Rapira incluye las dos extensiones.

Consulta la lista completa de extensiones en [Instalación](/es/docs/intro/installation). Activa las dos extensiones cuando compiles PHP. Consulta [Compilar desde el código](/es/docs/intro/build-from-source).

El worker también usa el componente `symfony/dotenv` de la aplicación base. Quita la llamada a Dotenv si el entorno de despliegue proporciona todas las variables de entorno. Después, quita el componente si ningún otro punto de entrada lo usa. El worker lee `.env` y crea el kernel sin `symfony/runtime`. Conserva `symfony/runtime`, porque `bin/console` y `public/index.php` lo usan.

## El script del worker

Guarda este archivo como `worker.php` en la raíz del proyecto. Las pruebas lo usaron con las dos versiones de Symfony:

```php
<?php

declare(strict_types=1);

use App\Kernel;
use Symfony\Component\Dotenv\Dotenv;
use Symfony\Component\HttpFoundation\Request;

require __DIR__ . '/vendor/autoload.php';

// public/index.php uses symfony/runtime for this operation.
// The worker performs it once before the request loop.
(new Dotenv())->bootEnv(__DIR__ . '/.env');

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

Casi todas las operaciones usan la inicialización estándar de Symfony. Cuatro partes son específicas de este worker:

**`(new Dotenv())->bootEnv(...)`.** El `public/index.php` estándar delega esta operación a `symfony/runtime`. El worker lee `.env` una vez antes de crear el kernel. Rapira conserva estos valores de `$_ENV` entre peticiones.

**El kernel se inicia antes del bucle.** `new Kernel(...)`, `boot()` y `getContainer()` se ejecutan al iniciar el worker. El kernel lee `$_SERVER['APP_ENV']` durante el inicio del worker. Cada petición usa el mismo contenedor.

**`$container->has('services_resetter')` antes de `get()`.** El identificador `services_resetter` es público en las dos versiones admitidas. La clase de implementación usa espacios de nombres diferentes en 7.4 y 8.1. El identificador del servicio evita una condición de versión. La comprobación `has()` evita un error cuando el contenedor no define el servicio.

**El bucle y `gc_collect_cycles()`.** `\Rapira\handle_request()` espera una petición, ejecuta el handler y devuelve `true`. Devuelve `false` durante el apagado del worker y termina el bucle. El script recoge los ciclos entre peticiones. Consulta el contrato completo en [modo Worker](/es/docs/worker).

Si el resetter no es suficiente, usa `$container->reset()` o `$kernel->reboot(null)`. La primera opción elimina todos los servicios creados. La segunda elimina el contenedor y crea uno nuevo.

Después de `$kernel->reboot(null)`, obtén el contenedor nuevo con `$kernel->getContainer()`. El handler no debe usar el contenedor anterior. Ambas opciones eliminan el estado de la aplicación en caché. Úsalas para encontrar una fuga de memoria, no como configuración predeterminada.

## `$_ENV` y el entorno del proceso

Rapira conserva `$_ENV` hasta que el worker vuelve a ejecutar el script. No reconstruye esta superglobal para cada petición. Los valores que `bootEnv()` carga antes del bucle permanecen disponibles durante las peticiones posteriores. Este comportamiento también se aplica con `variables_order = "GPCS"` y `auto_globals_jit = On`.

Antes de la primera petición, `$_SERVER` contiene el entorno del proceso. Dotenv no sustituye una variable que ya existe en `$_SERVER` o en `$_ENV`. Por tanto, una variable de entorno tiene prioridad sobre la misma variable de `.env`, también con `variables_order = "GPCS"`.

Por ejemplo, añade `usePutenv()` si el código de la aplicación debe leer valores de Dotenv con `getenv()`:

```php
(new Dotenv())->usePutenv()->bootEnv(__DIR__ . '/.env');
```

`usePutenv()` escribe los valores de Dotenv en el entorno del proceso. Symfony `%env(...)%` puede leer los valores conservados en `$_ENV` sin esta llamada. Rapira ejecuta un intérprete PHP NTS en cada proceso. PHP no llama a `putenv()` desde hilos simultáneos.

En producción, define variables de entorno mediante systemd, el entorno de ejecución de contenedores o el orquestador. Usa `.env` solo durante el desarrollo.

## Iniciar Rapira

Crea `rapira.toml` junto a `worker.php`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

Inicia Rapira:

```bash
rapira serve rapira.toml
```

`mode = "worker"` selecciona el modo Worker. `rapira serve` permanece en primer plano.

Abre otro terminal. Envía una petición:

```bash
curl -i http://127.0.0.1:8000/
```

Pulsa `Ctrl-C` en el primer terminal para detener Rapira.

El script de entrada es `worker.php`, por lo que `$_SERVER['SCRIPT_NAME']` contiene `/worker.php`. Symfony no encuentra este valor al principio de la URI. Después, establece la URL base en `""`. `getPathInfo()` devuelve la ruta y el enrutado funciona correctamente. `generateUrl()` crea rutas sin el prefijo `/worker.php`. No necesitas modificar `$_SERVER` ni usar `Request::setTrustedProxies()` para este comportamiento.

## Producción

Establece `APP_ENV=prod`. Instala sin dependencias de desarrollo. Crea la caché antes de iniciar el servidor. Las pruebas confirmaron la inicialización correcta con `php bin/console cache:warmup`. Este comando también compila el contenedor antes de la primera petición:

```bash
composer install --no-dev --optimize-autoloader
APP_ENV=prod php bin/console cache:warmup
```

Comprueba `DEFAULT_URI` durante la configuración. La aplicación base establece `router.default_uri` en `%env(DEFAULT_URI)%` en cada entorno. El valor predeterminado es `http://localhost`. Los comandos de consola y el código de correo usan este valor para crear URLs fuera de una petición HTTP. Establécelo en el origen de la aplicación.

Usa este `rapira.toml` mínimo:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
max_requests = 500
request_terminate_timeout_secs = 30
```

`max_requests` sustituye un worker después de un número aleatorio de peticiones entre este valor y 1,5 veces este valor. Limita el efecto de una fuga de memoria, pero no la corrige. `request_terminate_timeout_secs` detiene un worker cuando una petición dura más que este límite. El nuevo worker inicia el kernel otra vez. Un `entrypoint` relativo usa como base el directorio del archivo de configuración. Consulta todos los ajustes en [Configuración](/es/docs/configuration).

Inicia el servidor con `APP_ENV=prod`:

```bash
APP_ENV=prod rapira serve rapira.toml
```

Después de un despliegue, envía `SIGUSR2` al maestro para sustituir los workers. Con `opcache.validate_timestamps = 0`, reinicia Rapira. Consulta [En producción](/es/docs/deployment).

## Reinicio del estado entre peticiones

`services_resetter` llama a `reset()` en cada servicio con la etiqueta `kernel.reset`. Los bundles instalados determinan estos servicios. Algunos ejemplos son los handlers de registro con búfer y los recolectores de depuración. Esos servicios registran la etiqueta ellos mismos.

No reinicia las propiedades estáticas de la aplicación, los valores globales, los registros de bibliotecas ni los cambios persistentes de `ini_set()`. Este estado permanece en cada worker persistente. Reinícialo en el código de la aplicación. Consulta la tabla de duración del estado en [Frameworks](/es/docs/frameworks/).

Las pruebas con el resetter mostraron memoria estable durante 200 peticiones seguidas en `dev` y `prod`. Si aumenta la memoria, el código de la aplicación o un bundle puede estar conservando el estado de petición.

## Trabajo después de la respuesta

Llama a [`rapira_finish_request()`](/es/docs/http) entre `$response->send()` y `$kernel->terminate()` para enviar la respuesta antes de que se ejecuten los listeners posteriores a la respuesta. El worker continúa ejecutando `terminate()` hasta que retorna el handler. Esto puede reducir la espera del cliente, pero no añade concurrencia.

## Desarrollo

En modo Worker, cada worker inicia la aplicación una vez. Reinicia Rapira después de cada cambio de código para cargar el nuevo código PHP. Como alternativa, usa el [modo Classic](/es/docs/classic) durante el desarrollo. El modo Classic ejecuta el script de entrada en cada petición. Cambia `rapira.toml` al modo Classic:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

```bash
rapira serve rapira.toml
```

La misma aplicación se inicia en cada petición en modo Classic. Por tanto, los cambios guardados tienen efecto inmediatamente.

## Errores y registros

Symfony gestiona una excepción no capturada de la aplicación y devuelve su propia respuesta `500`. `dev` muestra la página de excepción, mientras que `prod` muestra una página de error general. El mismo worker procesa la siguiente petición. El reinicio final elimina el estado modificado de los servicios después de la excepción.

El logger de Symfony configurado controla la salida de la excepción. La aplicación base no incluye un logger. Rapira registra los errores PHP que Symfony no gestiona. Consulta [Registros](/es/docs/logging) para configurar los niveles.
