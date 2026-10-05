---
title: Yii3
description: "Yii3 en modo Worker con un HttpApplicationRunner residente, StateResetter o un runner nuevo para cada petición."
---

# Yii3

Yii3 admite procesos persistentes. Un worker puede iniciar la aplicación una vez y reiniciar el estado de petición después de cada respuesta. El runner oficial [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner) usa el mismo diseño. Esta página describe un worker persistente, una alternativa por petición y los resultados de las pruebas de integración.

::: info Verificado con
- **PHP 8.5.8**: NTS, SAPI embed
- **Rapira 0.8.0**
- Plantilla **yiisoft/app** 1.4, con **yii-runner-http 3.2.1** (router-fastroute 4.x)

Las pruebas ejecutaron los dos scripts de worker con este software. Cubrieron el enrutado, las URL, los cuerpos de petición, las sesiones, las subidas de archivos, los errores y 200 peticiones seguidas. Los ejemplos de esta página usan el formato de configuración de v0.9.
:::

## Yii3 y el modo Worker

Un worker residente usa dos elementos de API pública:

- `ApplicationRunner::getContainer()` devuelve el contenedor de la aplicación. El worker no necesita una subclase ni acceso al estado privado.
- `Yiisoft\Di\StateResetter` es un servicio de ese contenedor. Los componentes registran callbacks de reinicio, y una llamada a `reset()` los ejecuta todos.

Un servicio de la aplicación con estado de petición también debe registrar un callback. Añade una clave `'reset' => function (): void { … }` a su definición de inyección de dependencias. `yiisoft/session` y `yiisoft/router` usan el mismo método. El closure puede reiniciar el estado privado y no crea un objeto nuevo. Consulta la duración del estado en la [guía general](/es/docs/frameworks/) y en [Modo Worker](/es/docs/worker).

El diseño persistente tiene tres pasos. Crea el runner una vez. Ejecútalo en cada petición. Reinicia el contenedor después de cada petición.

## Requisitos previos

- Instala Rapira. Consulta [Instalación](/es/docs/intro/installation).
- Crea o elige una aplicación Yii3. Puedes usar un proyecto nuevo de [`yiisoft/app`](https://github.com/yiisoft/app).

El script de worker es el único archivo PHP nuevo. Ponlo en la raíz del proyecto, junto a `composer.json`. El runner usa la raíz del proyecto como su `rootPath`.

Instala un PHP CLI para Composer. Rapira trae PHP como biblioteca, no como comando `php`. Rapira no usa ni cambia el PHP CLI del sistema.

## El worker residente

Este es el diseño recomendado. Guárdalo como `worker.php` en la raíz del proyecto:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Di\StateResetter;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/src/bootstrap.php';

$runner = new HttpApplicationRunner(
    rootPath: __DIR__,
    debug: Environment::appDebug(),
    checkEvents: Environment::appDebug(),
    environment: Environment::appEnv(),
);
$container = $runner->getContainer();

$handler = static function () use ($runner, $container): void {
    try {
        $runner->run();
    } finally {
        // The worker continues after an error leaves run().
        // Reset state before the next request.
        $container->get(StateResetter::class)->reset();
    }
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

El script contiene estas operaciones:

**`src/bootstrap.php` inicia la plantilla.** Carga el autoloader de Composer, lee `.env` si existe y llama a `Environment::prepare()`. El `public/index.php` estándar hace las mismas operaciones antes de usar el runner.

**El worker crea el runner una vez.** Usa los argumentos `rootPath`, `debug`, `checkEvents` y `environment` de `public/index.php`. Por tanto, inicia la misma aplicación.

**El handler llama a `run()` y después a `reset()` en cada petición.** `run()` procesa la petición igual que el script de entrada. `reset()` ejecuta los callbacks de reinicio registrados antes de la petición siguiente.

**El uso de memoria permaneció estable.** Las pruebas no observaron un aumento significativo de la memoria del proceso durante 200 peticiones seguidas.

::: question ¿Qué partes de la plantilla omite el worker?
La plantilla pasa `temporaryErrorHandler` con un logger `StreamTarget`. También carga `c3.php` cuando activas `APP_C3`. El worker probado omite ambas partes. Sin el manejador, `HttpApplicationRunner::createTemporaryErrorHandler()` crea un `ErrorHandler` con un `NullLogger`. Por tanto, el runner no registra los errores durante la creación de la configuración y del contenedor. Pasa el manejador de la plantilla para registrar estos errores.
:::

::: question ¿Lee un runner persistente la petición actual?
Sí. `run()` no conserva una petición desde la creación del runner. Cada llamada obtiene `RequestFactory` y crea un `ServerRequest` PSR-7 a partir de las superglobales y de `php://input`. Rapira rellena estos valores antes de cada llamada al handler. Cada llamada también registra el manejador de errores, llama a `runBootstrap()` y llama a `checkEvents()` cuando su opción es verdadera. Las pruebas confirmaron esta secuencia durante 200 llamadas. Consulta el contrato de los datos de petición en [Modo Worker](/es/docs/worker).
:::

## Un runner nuevo para cada petición

Crea el runner *dentro* del handler para evitar el estado persistente del contenedor. Así, los objetos de la aplicación pertenecen a una sola petición:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/src/bootstrap.php';

$handler = static function (): void {
    // Create one runner for each request.
    // Use the same arguments as public/index.php.
    $runner = new HttpApplicationRunner(
        rootPath: __DIR__,
        debug: Environment::appDebug(),
        checkEvents: Environment::appDebug(),
        environment: Environment::appEnv(),
    );
    $runner->run();
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Cada petición crea un contenedor nuevo, así que el worker no reinicia el estado del contenedor. Las propiedades estáticas, las variables globales y el estado de inicio permanecen en el worker. El código de la aplicación debe reiniciar este estado. Las pruebas también confirmaron este diseño.

El contenedor se inicia para cada petición. Esto añade tiempo de inicio y crea objetos que PHP debe liberar después. La memoria puede aumentar hasta que PHP libere varios contenedores antiguos a la vez. Este comportamiento cíclico no siempre es una fuga de memoria. Consulta [Memoria y reciclaje](/es/docs/frameworks/#memoria-y-reciclaje).

Define `http.pool.max_requests` para sustituir los workers periódicamente. Consulta esta clave en [Configuración](/es/docs/configuration).

Este diseño no es el [modo Classic](/es/docs/classic). El autoloader, el arranque de la plantilla y el bucle de peticiones permanecen residentes en el worker. Solo la aplicación es nueva en cada petición.

Usa el runner persistente de forma predeterminada. Sigue el diseño del framework, requiere una llamada de reinicio y mantuvo estable el uso de memoria en las pruebas. Usa un runner por petición si el orden de inicio o la preparación de la petición impiden un callback completo de `StateResetter`. Para cambiar entre estos diseños, cambia solo el script de worker.

## Iniciar Rapira

Crea `rapira.toml` junto a `worker.php`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

```bash
rapira serve rapira.toml
```

`mode = "worker"` elige el modo Worker. Consulta el comando en [CLI](/es/docs/cli).

Para producción, usa un `rapira.toml` completo:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "/srv/app/worker.php"
mode = "worker"
processes = 8
max_requests = 500
request_terminate_timeout_secs = 30

[log]
level = "info"
format = "json"
```

Consulta cada clave, su valor por defecto y su límite en [Configuración](/es/docs/configuration). Consulta la configuración de systemd y del proxy inverso en [En producción](/es/docs/deployment).

## Archivos estáticos

La plantilla guarda `favicon.ico`, `robots.txt` y los paquetes de assets publicados en `public/`. Rapira envía cada petición al script de entrada, salvo si el [middleware de archivos estáticos](/es/docs/static-files) la responde. Añade el middleware a la tabla `[http]` de `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"
middleware = ["static"]

[http.static]
root = "public"
```

La lista `forbid` por defecto bloquea los archivos `.php`, así que el middleware no sirve `public/index.php`. Un CDN o un proxy inverso también pueden servir los assets. Consulta las reglas en [Integración con frameworks](/es/docs/frameworks/#archivos-estaticos).

## Resultados de las pruebas

Las pruebas aplicaron las mismas comprobaciones a los dos diseños con la plantilla `yiisoft/app`. Estos son los resultados.

**El enrutado funciona sin sobrescribir `$_SERVER`.** Rapira pone en `SCRIPT_NAME` el valor `/worker.php`, que es el nombre del script de entrada. FastRoute encontró rutas anidadas con query string. La ruta raíz devolvió la página de inicio de la plantilla. Una ruta desconocida devolvió la respuesta `404` del framework. Las pruebas no cambiaron `SCRIPT_NAME`, `REQUEST_URI` ni `DOCUMENT_ROOT`.

**Las URL generadas no incluyen el nombre del archivo de worker.** `UrlGeneratorInterface::generate()` devolvió rutas normales de la aplicación.

**Yii3 aísla la sesión de cada cliente.** Un cliente conservó su contador entre peticiones. Un segundo cliente recibió una sesión nueva. El diseño con contenedor persistente dio el mismo resultado.

**Los tokens CSRF funcionan sin cambios.** El `CsrfTokenMiddleware` de la plantilla guarda el token en la sesión, y las pruebas confirmaron un token para cada cliente. Cada POST sigue necesitando su token. Si el modo Worker rechaza un POST, asegúrate de que el formulario envía el token. No cambies el script de worker por este error.

**La aplicación recibe datos de formulario, cuerpos JSON y subidas de archivos.** `$_POST` contenía los campos del formulario, y `php://input` contenía el cuerpo JSON. El archivo temporal de la subida se podía leer durante la petición. El `ServerRequest` PSR-7 contenía todos estos valores.

**Una excepción en una acción devuelve `500`, y el worker continúa.** `ErrorCatcher` crea la respuesta de error y registra la excepción. El mismo worker procesa la petición siguiente con normalidad. Consulta en [Modo Worker](/es/docs/worker) los errores que detienen un worker.

## El modo Classic como alternativa

Yii3 también funciona con un script de entrada normal. Cambia `rapira.toml` al modo Classic:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

Esta configuración usa el código estándar de la aplicación sin script de worker. Cada petición tiene un estado de aplicación nuevo. Consulta [Modo Classic](/es/docs/classic) para más información.

Conserva `public/index.php` como segundo script de entrada. El modo Classic y el servidor integrado de PHP lo usan.

::: question ¿Debo cambiar la condición `cli-server` de `public/index.php`?
No. Esta condición sirve archivos estáticos y cambia `SCRIPT_NAME` para el servidor integrado de PHP. Rapira no la ejecuta, porque `PHP_SAPI` vale `fastcgi` en PHP 8.4 y `rapira` en PHP 8.5. Consulta el nombre de la SAPI en [Instalación](/es/docs/intro/installation).
:::
