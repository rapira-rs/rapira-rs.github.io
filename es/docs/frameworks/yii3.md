---
title: Yii3
description: "Una aplicación Yii3 en Rapira en modo Worker: el HttpApplicationRunner residente con StateResetter, el runner que se reconstruye en cada petición y qué se comprobó sobre enrutado, sesiones, subidas de archivos y errores."
---

# Yii3

Yii3 admite procesos persistentes. Su contenedor proporciona `StateResetter` y el runner permite el acceso público al contenedor.
Un worker puede iniciar la aplicación una vez y reiniciar el estado después de cada respuesta.
El runner oficial [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner) usa el mismo diseño.
Esta página describe un worker persistente, una alternativa por petición y los resultados de las pruebas.

::: info Verificado con
- **PHP 8.5.8** - NTS, SAPI embed
- **Rapira 0.8.0**
- Plantilla **yiisoft/app** 1.4, con **yii-runner-http 3.2.1** (router-fastroute 4.x)

Los dos scripts de worker de esta página se ejecutaron contra ese stack y pasaron la batería completa: enrutado, URL generadas, envíos de formulario y de JSON, sesiones, subidas de archivos, gestión de errores y 200 peticiones seguidas.
:::

## Yii3 y el modo Worker

Un worker residente necesita dos piezas de API pública.

`ApplicationRunner::getContainer()` devuelve el contenedor de la aplicación. El worker no necesita una subclase ni acceso al estado privado.
`Yiisoft\Di\StateResetter` es un servicio del contenedor. Los componentes registran callbacks que reinician el estado de petición.
Una llamada a `reset()` ejecuta estos callbacks.

Un servicio de la aplicación con estado de petición también debe registrar un callback. Añade `'reset' => function (): void { … }` a su definición.
`yiisoft/session` y `yiisoft/router` usan el mismo método. El closure puede reiniciar el estado privado sin crear otro objeto.
Consulta la duración del estado en la [guía general](/es/docs/frameworks/) y en [Modo Worker](/es/docs/worker).

El patrón residente son entonces tres pasos: construir el runner una vez, ejecutarlo en cada petición y reiniciar después el estado del contenedor.

## Requisitos previos

- Rapira instalado: ver [Instalación](/es/docs/intro/installation).
- Una aplicación Yii3, ya sea un proyecto recién creado con [`yiisoft/app`](https://github.com/yiisoft/app) o una que ya tengas.

En el lado de PHP no hay que instalar nada: el script de worker de abajo es el único archivo nuevo del proyecto, y va en la raíz, junto a `composer.json`, porque el `rootPath` del runner es precisamente la raíz del proyecto. También necesitas un PHP CLI normal en la máquina para Composer: Rapira trae PHP como biblioteca (`libphp`), no como comando `php`, así que esos pasos se ejecutan con el PHP de tu sistema, que Rapira ni usa ni toca.

## El worker residente

Esta es la forma recomendada. Guárdalo como `worker.php` en la raíz del proyecto:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Di\StateResetter;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/vendor/autoload.php';
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

Vamos por partes:

**`src/bootstrap.php` es el arranque que trae la propia plantilla.** Carga el autoloader de Composer, lee el `.env` si está y llama a `Environment::prepare()`: exactamente lo que hace `public/index.php` antes de tocar el runner. La línea explícita de `vendor/autoload.php` que va justo encima es redundante -`require_once` convierte la segunda llamada en algo que no hace nada- y deja el worker legible como punto de entrada independiente.

**El worker crea el runner una vez con los argumentos de `public/index.php`.**
Pasa `rootPath`, `debug`, `checkEvents` y `environment` desde `App\Environment`. Por tanto, inicia la misma aplicación.
La plantilla también pasa `temporaryErrorHandler` con un logger `StreamTarget`. Carga `c3.php` cuando se activa `APP_C3`.
El worker probado omite ambas partes.
El manejador temporal registra errores durante la creación de la configuración y el contenedor.
Sin él, `HttpApplicationRunner::createTemporaryErrorHandler()` crea un `ErrorHandler` con `NullLogger`.
Pasa el manejador de la plantilla para registrar fallos de creación del contenedor.

**`getContainer()` es API pública**, así que el contenedor que capturas es el de la aplicación: el mismo que usará el runner en cada petición. El `StateResetter` se resuelve desde ahí dentro del handler.

**En cada petición: `run()` y después `reset()`.** `run()` es la misma llamada que hace el script de entrada; `reset()` recorre los callbacks de reinicio registrados en el contenedor y devuelve los servicios con estado a su punto de partida antes de que llegue la petición siguiente.

**`run()` repite su secuencia completa en cada llamada.** Registra el manejador, ejecuta `runBootstrap()` y `checkEvents()`, y procesa la petición.
Las pruebas confirmaron esta secuencia durante 200 llamadas.
La comprobación de eventos solo se ejecuta cuando su opción es verdadera. La plantilla obtiene la opción de `Environment::appDebug()`.

**Un runner residente lee cada petición desde cero.** `run()` no captura la petición al construirse. En cada llamada resuelve `RequestFactory` desde el contenedor y construye un `ServerRequest` PSR-7 nuevo a partir de `$_SERVER`, `$_GET`, `$_POST`, `$_COOKIE`, `$_FILES` y `php://input`, y Rapira vuelve a rellenar esas superglobales antes de cada iteración del bucle (ese contrato lo cubre [Modo Worker](/es/docs/worker)).

**El uso de memoria permaneció estable.** Las pruebas no observaron un aumento significativo durante 200 peticiones.
La aplicación se inicia una vez y cada petición ejecuta un reinicio.

## Un runner nuevo para cada petición

Para evitar por completo el estado residente, construye el runner *dentro* del handler. Así, todo lo que cree la aplicación pertenece a una sola petición:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

require_once __DIR__ . '/vendor/autoload.php';
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

El contenedor se reconstruye cada vez, así que hay menos piezas móviles, ningún reinicio que puedas hacer mal y ningún estado del contenedor que pase de una petición a la siguiente; las propiedades `static`, las variables globales y todo lo que dejara montado el arranque siguen residentes bajo cualquier worker y tiene que reiniciarlos tu propio código. Esta variante también pasó la batería completa.

El contenedor se inicia para cada petición. Esto añade tiempo de inicio y crea objetos que PHP debe liberar.
La memoria puede aumentar hasta que PHP libere varios contenedores antiguos. Este comportamiento cíclico no siempre es una fuga.
Define `pool.max_requests` para sustituir los workers periódicamente.
Consulta este comportamiento en la [guía general](/es/docs/frameworks/) y el ajuste en [Configuración](/es/docs/configuration).

El autoloader y el arranque de la plantilla siguen siendo residentes y el bucle de peticiones sigue viviendo en el script de worker, así que esto sigue siendo un worker, uno que descarta su aplicación entre peticiones, no [modo Classic](/es/docs/classic).

Usa el runner persistente de forma predeterminada. Sigue el diseño del framework, tuvo memoria estable y requiere una llamada de reinicio.
Usa un runner por petición si el orden de inicio impide un callback completo de `StateResetter`.
El cambio entre los diseños solo requiere modificar el script del worker.

## Iniciar Rapira

```bash
rapira serve --mode worker worker.php
```

`--mode worker` elige el modo Worker. Las demás opciones están en [CLI](/es/docs/cli).

Para producción, pásalo a un `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "/srv/app/worker.php"
mode = "worker"
processes = 8
max_requests = 500
request_terminate_timeout_secs = 30

[log]
level = "info"
format = "json"
```

Cada clave, con su valor por defecto y sus límites, está en la página de [Configuración](/es/docs/configuration); la unidad de systemd y el proxy inverso que va delante están en [En producción](/es/docs/deployment).

## Resultados de las pruebas

Los dos patrones pasaron la misma batería de pruebas contra la plantilla `yiisoft/app`. Los resultados:

**El enrutado funciona sin sobrescribir nada de `$_SERVER`.** Rapira pone en `SCRIPT_NAME` el nombre del script de entrada -`/worker.php`, no `/index.php`- y aun así FastRoute siguió emparejando rutas anidadas con query string. La raíz `/` renderizó la página de inicio de la plantilla y una ruta desconocida devolvió el 404 del propio framework. No hizo falta sobrescribir `SCRIPT_NAME`, `REQUEST_URI` ni `DOCUMENT_ROOT` en ningún sitio.

**Las URL generadas salen limpias.** `UrlGeneratorInterface::generate()` produjo rutas normales de la aplicación: el nombre del script de worker no se cuela en ellas.

**Las sesiones son de cada petición y están bien aisladas.** Un cliente que guardaba sus cookies vio su contador pasar de 1 a 2 entre peticiones; otro cliente que llegó justo después al mismo endpoint obtuvo una sesión nueva que volvía a empezar en 1. Eso se cumple también en el patrón residente, donde el contenedor sobrevive.

**Llegan los envíos de formulario, los cuerpos JSON y las subidas de archivos.** Campos en `$_POST`, un payload JSON leído de `php://input` y una subida multipart con su archivo temporal legible durante la petición: el `ServerRequest` PSR-7 que yii-runner-http construye a partir de las superglobales lo lleva todo.

**Una excepción lanzada es un 500, y el worker sigue sirviendo.** A una acción que lanza la recoge `ErrorCatcher`, que renderiza la respuesta de error igual que lo haría en cualquier otro sitio; la excepción queda registrada y la petición siguiente la atiende con normalidad ese mismo proceso worker. En Rapira una excepción sin capturar es un fallo de la petición, no del worker: en [Modo Worker](/es/docs/worker) tienes qué provoca la caída de un worker y qué no.

## CSRF

La plantilla de la aplicación mete `CsrfTokenMiddleware` en su cadena de middleware por defecto, y el token vive en la sesión, que es justo el estado que sí ejercitó la batería: por petición y aislado por cliente. Nada del bucle del worker toca el flujo del token, así que aquí un POST necesita el suyo igual que en cualquier otro sitio. Si los POST empiezan a ser rechazados después de pasarte a un worker, comprueba primero el token; el arreglo es el de siempre (renderizar el token en el formulario y devolverlo), no un cambio en el script de worker.

## El modo Classic como alternativa

Yii3 también funciona con un script de entrada normal:

```bash
rapira serve --mode classic public/index.php
```

El mismo código, sin script de worker y con estado limpio en cada petición. Consulta [Modo Classic](/es/docs/classic) para más información.

El script de worker es un punto de entrada más y no sustituye al script de entrada normal. Conserva `public/index.php`: el modo Classic lo ejecuta y sigue siendo útil para trabajar en local con el servidor que trae PHP.

El `public/index.php` de la plantilla tiene una rama `PHP_SAPI === 'cli-server'` que sirve archivos estáticos y reescribe `SCRIPT_NAME`. Está ahí por el servidor de desarrollo que trae PHP y bajo Rapira no se activa nunca, porque `PHP_SAPI` vale `rapira` (`fastcgi` en PHP 8.4 - ver [Instalación](/es/docs/intro/installation)), así que puede quedarse como está.
