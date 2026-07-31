---
title: Yii3
description: "Una aplicación Yii3 en el peldaño SAPI Worker de Rapira: el HttpApplicationRunner residente con StateResetter, la variante más sencilla que reconstruye el runner en cada petición y qué se comprobó sobre enrutado, sesiones, subidas de archivos y errores."
---

# Yii3

De los tres frameworks documentados aquí, Yii3 es el que viene diseñado para esto. Su contenedor de DI trae un `StateResetter` de primera clase, el runner expone el contenedor como API pública, y lo de «construye la aplicación una vez y reinicia el estado de la petición después de cada respuesta» no es un truco que alguien se inventara para un servidor de larga vida: es la forma que el framework ya tiene. El runner oficial para RoadRunner, [`yiisoft/yii-runner-roadrunner`](https://github.com/yiisoft/yii-runner-roadrunner), está construido exactamente así, buena señal de que el patrón de abajo es el diseño previsto para procesos que no mueren y no un apaño ingenioso que fuerza el framework.

::: info Verificado con
- **PHP 8.5.8** — NTS, SAPI embed
- **Rapira 0.6.0**
- Plantilla **yiisoft/app** 1.4, con **yii-runner-http 3.2.1** (router-fastroute 4.x)

Los dos scripts de worker de esta página se ejecutaron contra ese stack y pasaron la batería completa: enrutado, URL generadas, envíos de formulario y de JSON, sesiones, subidas de archivos, gestión de errores y 200 peticiones seguidas.
:::

## Por qué Yii3 encaja en el peldaño worker

A un worker residente le bastan dos piezas de API pública.

`ApplicationRunner::getContainer()` es público: el runner te entrega el mismísimo contenedor sobre el que corre tu aplicación, así que no tienes que heredar de nada ni hurgar en estado privado para llegar hasta él. Y `Yiisoft\Di\StateResetter` es un servicio más de ese contenedor: los componentes registran en él sus propios callbacks de reinicio y una sola llamada a `reset()` los deja como estaban al principio. Esa es la respuesta del propio framework a «este objeto guarda estado de la petición», y existe porque Yii3 da por hecho que se va a ejecutar en un proceso que no muere.

Así que el patrón residente son tres líneas de pegamento: construye el runner una vez, ejecútalo en cada petición y reinicia después el estado del contenedor.

## Requisitos previos

- Rapira instalado: ver [Instalación](/es/docs/installation).
- Una aplicación Yii3, ya sea un proyecto recién creado con [`yiisoft/app`](https://github.com/yiisoft/app) o una que ya tengas.

En el lado de PHP no hay que instalar nada. No hay paquete de runtime, ni puente, ni adaptador: el script de worker de abajo es el único archivo nuevo del proyecto, y va en la raíz, junto a `composer.json`, porque el `rootPath` del runner es precisamente la raíz del proyecto.

## El worker residente

Esta es la forma recomendada. Guárdalo como `worker.php` en la raíz del proyecto:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Rapira\Plugin\Http\HttpHandlerConfig;
use Yiisoft\Di\StateResetter;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

use function Rapira\create_plugin_handler;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$runner = new HttpApplicationRunner(
    rootPath: __DIR__,
    debug: Environment::appDebug(),
    checkEvents: Environment::appDebug(),
    environment: Environment::appEnv(),
);
$container = $runner->getContainer();

$http = create_plugin_handler(new HttpHandlerConfig());

$handler = static function () use ($runner, $container): void {
    try {
        $runner->run();
    } finally {
        // The worker keeps serving after an escaped error; the reset has to
        // run on that path too, or state leaks into the next request.
        $container->get(StateResetter::class)->reset();
    }
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Vamos por partes:

**`src/bootstrap.php` es el arranque que trae la propia plantilla.** Carga el autoloader de Composer, lee el `.env` si está y llama a `Environment::prepare()`: exactamente lo que hace `public/index.php` antes de tocar el runner. La línea explícita de `vendor/autoload.php` que va justo encima es puro por si acaso (es `require_once`, así que no cuesta nada) y hace que el worker se lea bien como punto de entrada independiente.

**El runner se construye una sola vez, con los argumentos de `public/index.php`.** `rootPath`, `debug`, `checkEvents` y `environment` salen de `App\Environment` tal cual los pasa el front controller, así que el worker arranca la misma aplicación que el punto de entrada web. El `public/index.php` de la plantilla pasa un argumento más —un `temporaryErrorHandler` conectado a un logger con `StreamTarget`— y hace `require` de `c3.php` cuando `APP_C3` está activo. El worker verificado se salta las dos cosas. Ese manejador temporal solo cubre los errores que se producen mientras se construyen la configuración y el contenedor; si no le pasas ninguno, el runner recurre a un `ErrorHandler` con un `NullLogger` (`HttpApplicationRunner::createTemporaryErrorHandler()`), así que pásaselo aquí también si quieres que queden registrados los fallos al construir el contenedor.

**`getContainer()` es API pública**, así que el contenedor que capturas es el de la aplicación: el mismo que usará el runner en cada petición. El `StateResetter` se resuelve desde ahí dentro del handler.

**En cada petición: `run()` y después `reset()`.** `run()` es la misma llamada que hace el front controller; `reset()` recorre los callbacks de reinicio registrados en el contenedor y devuelve los servicios con estado a su punto de partida antes de que llegue la petición siguiente.

**Un runner residente sigue viendo cada petición nueva.** Esto despista a mucha gente, así que mejor decirlo claro: `run()` no captura la petición al construirse. En cada llamada le pide al contenedor un `RequestFactory` y construye un `ServerRequest` PSR-7 nuevo a partir de `$_SERVER`, `$_GET`, `$_POST`, `$_COOKIE`, `$_FILES` y `php://input`, y Rapira vuelve a rellenar esas superglobales antes de cada iteración del bucle (ese contrato lo cubre [Modo worker](/es/docs/worker)). Objetos residentes, petición nueva, siempre.

**La memoria se mantiene plana.** A lo largo de 200 peticiones seguidas, el conjunto residente del worker no creció de forma apreciable: la aplicación se construye una vez y el reinicio es barato, así que no hay ningún arranque por petición que después haya que recoger. Esa es la ventaja práctica de este patrón frente al siguiente.

## La alternativa sencilla: un runner nuevo en cada petición

Si prefieres no pensar en el estado residente en absoluto, construye el runner *dentro* del handler. Así, todo lo que cree la aplicación pertenece a una sola petición:

```php
<?php

declare(strict_types=1);

use App\Environment;
use Rapira\Plugin\Http\HttpHandlerConfig;
use Yiisoft\Yii\Runner\Http\HttpApplicationRunner;

use function Rapira\create_plugin_handler;

require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/bootstrap.php';

$http = create_plugin_handler(new HttpHandlerConfig());

$handler = static function (): void {
    // A fresh runner per request; constructor arguments mirror public/index.php.
    $runner = new HttpApplicationRunner(
        rootPath: __DIR__,
        debug: Environment::appDebug(),
        checkEvents: Environment::appDebug(),
        environment: Environment::appEnv(),
    );
    $runner->run();
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

Menos piezas móviles, ningún reinicio que puedas hacer mal y ninguna posibilidad de que el estado se filtre de una petición a la siguiente: el contenedor se reconstruye cada vez. Esta variante también pasó la batería completa.

Este patrón tiene un coste, y por eso va el *segundo* en la página: arrancas el contenedor en cada petición, así que pagas ese arranque cada vez y generas la basura de un contenedor entero cada vez. La memoria del worker va creciendo según se acumulan esos contenedores hasta que PHP los libera de golpe, que es el perfil normal de un arranque por petición y no una fuga, pero es un perfil al que conviene ponerle un tope. Combina este patrón con `pool.max_requests` para que cada worker termine y sea reemplazado cada cierto tiempo; los perfiles de memoria están en la [guía general de frameworks](/es/docs/frameworks/) y la clave, documentada en [Configuración](/es/docs/configuration).

El autoloader y el arranque de la plantilla siguen siendo residentes, y el bucle sigue siendo tuyo: esto sigue siendo un worker, solo que descarta su aplicación entre peticiones, no [modo clásico](/es/docs/classic).

## Cómo ejecutarlo

```bash
rapira serve worker.php
```

Ese es el comando entero: el modo worker es el de por defecto. Las demás opciones están en [CLI](/es/docs/cli).

Para producción, pásalo a un `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[pool]
entrypoint = "/srv/app/worker.php"
processes = 8
max_requests = 500
request_terminate_timeout_secs = 30

[log]
level = "info"
format = "json"
```

Cada clave, con su valor por defecto y sus límites, está en la página de [Configuración](/es/docs/configuration); la unidad de systemd y el proxy inverso que va delante están en [En producción](/es/docs/deployment).

## Qué se verificó

Los dos patrones pasaron la misma batería de pruebas contra la plantilla `yiisoft/app`. Esto es lo que salió:

**El enrutado funciona sin tocar nada de `$_SERVER`.** Rapira pone en `SCRIPT_NAME` el nombre del script de entrada —`/worker.php`, no `/index.php`— y aun así FastRoute siguió emparejando rutas anidadas con query string. La raíz `/` renderizó la página de inicio de la plantilla y una ruta desconocida devolvió el 404 del propio framework. No hizo falta sobrescribir `SCRIPT_NAME`, `REQUEST_URI` ni `DOCUMENT_ROOT` en ningún sitio.

**Las URL generadas salen limpias.** `UrlGeneratorInterface::generate()` produjo rutas normales de la aplicación: el nombre del script de worker no se cuela en ellas.

**Las sesiones son de cada petición y están bien aisladas.** Un cliente que guardaba sus cookies vio su contador pasar de 1 a 2 entre peticiones; otro cliente que llegó justo después al mismo endpoint obtuvo una sesión nueva que volvía a empezar en 1. Eso se cumple también en el patrón residente, donde el contenedor sobrevive.

**Llegan los envíos de formulario, los cuerpos JSON y las subidas de archivos.** Campos en `$_POST`, un payload JSON leído de `php://input` y una subida multipart con su archivo temporal legible durante la petición: el `ServerRequest` PSR-7 que yii-runner-http construye a partir de las superglobales lo lleva todo.

**Una excepción lanzada es un 500, y el worker sigue sirviendo.** A una acción que lanza la recoge `ErrorCatcher`, que renderiza la respuesta de error igual que lo haría en cualquier otro sitio; la excepción queda registrada y la petición siguiente la atiende con normalidad ese mismo proceso worker. En Rapira una excepción sin capturar es un fallo de la petición, no del worker: en [Modo worker](/es/docs/worker) tienes qué provoca la caída de un worker y qué no.

## El CSRF sigue activo

La plantilla de la aplicación mete `CsrfTokenMiddleware` en su cadena de middleware por defecto, y el token vive en la sesión, que es justo el estado que sí ejercitó la batería: por petición y aislado por cliente. Nada del bucle del worker toca el flujo del token, así que aquí un POST necesita el suyo igual que en cualquier otro sitio. Si tus POST empiezan a ser rechazados después de pasarte a un worker, lo primero que hay que mirar es el token, y el arreglo es el de siempre —renderizar el token en el formulario y devolverlo—, no un cambio en el script de worker.

## El modo clásico como alternativa

Si ahora mismo un worker no es lo que quieres, Yii3 funciona perfectamente como front controller de toda la vida:

```bash
rapira serve --classic public/index.php
```

El mismo código, sin script de worker y con estado limpio en cada petición: en [Modo clásico](/es/docs/classic) tienes lo que te da ese peldaño y lo que te cuesta.

Una curiosidad por si abres ese archivo: el `public/index.php` de la plantilla tiene una rama `PHP_SAPI === 'cli-server'` que sirve archivos estáticos y reescribe `SCRIPT_NAME`. Está ahí por el servidor de desarrollo que trae PHP y bajo Rapira sencillamente no se activa nunca, porque `PHP_SAPI` vale `rapira` (`fastcgi` en PHP 8.4 — ver [Instalación](/es/docs/installation)). Déjala como está: aquí no hace nada.

::: question ¿Qué patrón elijo?
El residente, salvo que tengas un motivo para no hacerlo. Es el diseño de larga vida que propone el propio framework, mantiene la memoria plana y el reinicio es una sola llamada. Usa el runner por petición cuando tu arranque tenga restricciones de orden sobre las que prefieras no pensar: código que debe ejecutarse antes de que se construya el contenedor, o trabajo de arranque por petición que un callback de `StateResetter` no puede deshacer. Puedes empezar por ahí y cambiar más adelante; lo único que cambia es el script de worker.
:::

::: question En el patrón residente, ¿`checkEvents` y el resto del arranque se vuelven a ejecutar en cada petición?
Sí: `run()` repite su secuencia interna en cada llamada — registrar el manejador de errores, `runBootstrap()`, `checkEvents()` y, por último, atender la petición. Se comprobó que es inofensivo durante 200 llamadas seguidas; el runner es reentrante por diseño. La comprobación de eventos, en concreto, solo hace algo cuando su flag está activo, y en la plantilla ese flag es `Environment::appDebug()`: con el modo debug apagado, no hace nada en ninguna llamada.
:::

::: question ¿Sigo necesitando `public/index.php`?
Consérvalo. No cuesta nada, es a lo que recurres en [modo clásico](/es/docs/classic) y sigue siendo útil para trabajar en local con el servidor que trae PHP. El script de worker es un punto de entrada más, no un sustituto del front controller.
:::

::: question ¿Qué reinicia exactamente `StateResetter::reset()`?
Lo que hayan registrado en él los servicios de tu contenedor: para eso es un servicio del contenedor y no un hook del framework. Los componentes con estado de Yii3 registran sus callbacks de reinicio; si escribes un servicio que guarda estado de la petición, registra el tuyo también — una clave `'reset' => function (): void { … }` en la definición de DI de ese servicio, igual que declaran las suyas `yiisoft/session` y `yiisoft/router`; el closure se enlaza a la instancia, así que puede restaurar estado privado sin reconstruir el objeto. Qué reinicia Rapira entre peticiones y qué deja a propósito sin tocar está en la [guía general de frameworks](/es/docs/frameworks/) y en [Modo worker](/es/docs/worker).
:::
