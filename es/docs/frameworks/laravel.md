---
title: Laravel
description: "Ejecutar Laravel en los modos Classic, Worker y Dispatcher con el bridge rapira/laravel sobre Laravel Octane."
---

# Laravel

El paquete [`rapira/laravel`](https://github.com/rapira-rs/laravel) conecta Laravel con Rapira. Un único script de entrada sirve los tres [modos de ejecución](/es/docs/execution-modes). La clave `mode` de `rapira.toml` selecciona el modo. El código de la aplicación no cambia.

En los modos Worker y Dispatcher, la aplicación se inicia una vez y permanece en memoria. El bridge usa el worker de [Laravel Octane](https://laravel.com/docs/octane) para restablecer el estado de la aplicación entre peticiones. Octane es una dependencia del paquete. No ejecutas `octane:start`, porque Rapira sustituye al servidor de Octane.

::: info Verificado con
- **rapira/laravel 0.1.1**
- **laravel/framework v13.34.0** y **laravel/octane v2.20.0**
- **PHP 8.5**: SAPI embed

Las pruebas del bridge envían peticiones HTTP reales a una aplicación Laravel en cada uno de los tres modos. Las pruebas cubren el enrutado, la página 404, las excepciones en rutas, el aislamiento de la configuración entre peticiones, las sesiones, las cookies, los datos de formulario, las respuestas en streaming y las descargas de archivos.
:::

## Requisitos previos

- PHP 8.4 o posterior.
- Laravel 11, 12 o 13.
- Rapira 0.9 o posterior. Consulta [Instalación](/es/docs/intro/installation).

Rapira proporciona PHP como biblioteca, no como comando `php`. Instala un PHP CLI para Composer y `artisan`. Rapira no usa ni modifica este CLI.

Un proyecto `laravel/laravel` nuevo usa SQLite y drivers de sesión, caché y colas basados en la base de datos, por lo que requiere `pdo_sqlite`. Las compilaciones de las releases de Rapira incluyen `pdo_sqlite`. Consulta [Instalación](/es/docs/intro/installation) para ver la lista completa de extensiones. Si compilas PHP, activa las extensiones que necesitan tus drivers. Consulta [Compilar desde el código](/es/docs/intro/build-from-source).

## Instalación

Instala el paquete:

```bash
composer require rapira/laravel
```

Laravel descubre automáticamente el service provider del paquete. Publica el script de entrada y una configuración inicial del servidor en la raíz del proyecto:

```bash
php artisan vendor:publish --tag=rapira
```

El comando crea dos archivos. `worker.php` es el script de entrada para todos los modos:

```php
<?php

declare(strict_types=1);

use Rapira\Laravel\Runner;

require __DIR__ . '/vendor/autoload.php';

(new Runner(__DIR__))->run();
```

El argumento de `Runner` es la raíz de la aplicación, el directorio que contiene `bootstrap/app.php`. `rapira.toml` configura el servidor:

```toml
[http]
listen = "127.0.0.1:8000"
middleware = ["static"]

[http.static]
root = "public"

[http.pool]
entrypoint = "worker.php"
# "dispatcher", "worker" o "classic": el mismo worker.php sirve los tres.
mode = "dispatcher"
```

Inicia el servidor:

```bash
rapira serve rapira.toml
```

El servidor se queda en primer plano y la aplicación está disponible en `http://127.0.0.1:8000/`. Pulsa `Ctrl-C` para detener el servidor.

Un `entrypoint` relativo usa como base el directorio del archivo de configuración. Consulta [Configuración](/es/docs/configuration) para ver todas las claves y sus valores por defecto.

## Modos de ejecución

`Runner` lee el modo cuando el worker se inicia y ejecuta el bucle correspondiente. Cambia `http.pool.mode` para cambiar el modo. Conserva el mismo `worker.php`.

| Modo | Duración de la aplicación | Origen de la petición |
| --- | --- | --- |
| `classic` | Una petición | Superglobales que rellena Rapira |
| `worker` | El proceso worker | Superglobales que rellena Rapira |
| `dispatcher` | El proceso worker | Objetos `Rapira\Http\Exchange` |

**El modo Classic** ejecuta el mismo ciclo de vida que el `public/index.php` de Laravel. El bridge carga `bootstrap/app.php`, gestiona la petición, envía la respuesta y llama a `terminate()`. El archivo del modo de mantenimiento `storage/framework/maintenance.php` funciona como en `public/index.php`. No queda ningún estado después de la petición. Consulta [Modo Classic](/es/docs/classic).

**El modo Worker** mantiene una aplicación en cada proceso worker. Rapira rellena las superglobales para cada petición, y el bridge crea la petición con `Request::capture()`. La respuesta sale mediante `header()` y la salida, como en el modo Classic. Consulta [Modo Worker](/es/docs/worker).

**El modo Dispatcher** mantiene una aplicación en cada proceso worker. El bridge recibe cada petición como un exchange del [dispatcher](/es/docs/dispatcher) HTTP. Crea una `Illuminate\Http\Request` a partir del exchange y escribe la respuesta de vuelta en el exchange. Este es el modo predeterminado.

Cada worker gestiona una petición a la vez en todos los modos. Octane restablece la aplicación para cada petición, por lo que dos peticiones no pueden compartir una aplicación al mismo tiempo.

### Superglobales en modo Dispatcher

En modo Dispatcher, Rapira no rellena `$_GET`, `$_POST`, `$_COOKIE`, `$_FILES` ni los valores de petición de `$_SERVER`. El bridge tampoco los rellena. El código de Laravel que lee el objeto `Request` no necesita estas variables. Las sesiones y las cookies de Laravel también funcionan mediante los objetos `Request` y `Response`.

Usa el modo Worker si la aplicación o un paquete realiza una de estas operaciones:

- Lee las superglobales directamente.
- Envía cabeceras con `header()` o `setcookie()`.
- Usa las sesiones nativas de PHP (`session_start()`).

El bridge rellena los valores de servidor del objeto `Request` como si `public/index.php` gestionara la petición. `SCRIPT_NAME` es `/index.php`, y `DOCUMENT_ROOT` es el directorio `public/`. Los nombres de las cabeceras se asignan a claves `HTTP_*` con las mismas reglas que en el modo Worker.

## Estado entre peticiones

En los modos Worker y Dispatcher, el worker de Octane inicia la aplicación una vez. Para cada petición, Octane clona la aplicación en un sandbox. Después ejecuta sus listeners, que restablecen el estado de petición conocido. Por ejemplo, un cambio de configuración en una petición no aparece en la siguiente petición. Las pruebas del bridge confirman este comportamiento en ambos modos.

La configuración de Octane controla estos listeners. La clave `warm` enumera los servicios que se inician antes de la primera petición. La clave `flush` enumera los servicios que se eliminan después de cada petición. Octane usa su configuración por defecto si la aplicación no tiene `config/octane.php`. Para cambiar la configuración, publica el archivo:

```bash
php artisan vendor:publish --tag=octane-config
```

La clave `server` y los ajustes específicos de servidor de este archivo no se aplican a Rapira. Configura el servidor en `rapira.toml`.

Octane no restablece las propiedades estáticas, las variables globales ni los singletons que conservan una referencia a la petición o al contenedor. El código de la aplicación y los paquetes deben ser seguros para un worker persistente. Consulta [Dependency injection and Octane](https://laravel.com/docs/octane#dependency-injection-and-octane) en la documentación de Laravel. Consulta [Integración con frameworks](/es/docs/frameworks/) para ver el estado que permanece en un worker.

`Octane::concurrently()` ejecuta sus tareas una tras otra. El almacén de caché de Octane y `Octane::table()` requieren Swoole. No están disponibles en Rapira.

## Rutas y URLs

Rapira no asigna las URL a scripts PHP. Cada petición ejecuta el script de entrada, y Laravel enruta la ruta de la petición. Las URL generadas son absolutas y no contienen ni `worker.php` ni `index.php`. No necesitan cambios en `$_SERVER` ni en la configuración de rutas o URL.

El `rapira.toml` inicial activa el [middleware de archivos estáticos](/es/docs/static-files) para `public/`. El middleware responde a las peticiones que coinciden con archivos de `public/`. Las demás peticiones van a Laravel. Una CDN o un proxy inverso también pueden servir los recursos.

La ruta integrada `/up` devuelve `200`. Un balanceador de carga o un contenedor puede usarla para las comprobaciones de estado. Rapira también puede servir `/livez` y `/readyz` en una dirección separada. Consulta [Métricas y comprobaciones de estado](/es/docs/observability).

Rapira acepta solo HTTP sin cifrar, por lo que Laravel ve cada petición como `http`, también cuando una petición tiene `X-Forwarded-Proto`. Cuando un [proxy termina TLS](/es/docs/deployment), configura los [proxies de confianza](https://laravel.com/docs/requests#configuring-trusted-proxies) de Laravel. Sin esta configuración, `url()` genera enlaces `http://`.

## Sesiones, CSRF y formularios

Las sesiones de Laravel usan la cookie de sesión y el driver de sesiones configurado. Cada cliente recibe una sesión independiente. CSRF no requiere ajustes de Rapira porque el token está en la sesión.

Las pruebas del bridge cubren datos de formulario con campos anidados y subidas de archivos. En modo Dispatcher, el bridge analiza los cuerpos de formulario para `POST`, `PUT`, `PATCH` y `DELETE`, como hace `Request::createFromGlobals()`.

`http.max_body_size_mb` limita el cuerpo de la petición antes de que PHP se ejecute, y el valor por defecto es 8 MiB. Rapira devuelve `413` para un cuerpo más grande, y Laravel no recibe la petición. Para aceptar subidas más grandes, aumenta este valor. Aumenta también `post_max_size` y `upload_max_filesize` en php.ini. Consulta [Cuerpos de petición](/es/docs/http#cuerpos-de-peticion).

## Respuestas

El bridge envía todos los tipos de respuesta de Laravel:

- **Las respuestas con búfer** salen con sus cabeceras y cookies.
- **Las respuestas en streaming** (`response()->stream()`) salen por fragmentos. Un callback puede llamar a `ob_flush()` o `flush()` para enviar el fragmento actual.
- **Las respuestas de archivo** (`response()->download()` y `response()->file()`) salen con sus cabeceras. En modo Dispatcher, el bridge pasa la ruta del archivo a Rapira, y Rapira lee el archivo. Si Rapira no puede enviar el archivo, PHP lo transmite.

La salida que un controlador imprime con `echo` sale antes del cuerpo de la respuesta.

En los modos Classic y Worker, el bridge llama a [`rapira_finish_request()`](/es/docs/http) después de la respuesta. El cliente recibe la respuesta antes de que se ejecuten el middleware terminable y la limpieza de Octane.

## Errores

Laravel gestiona una excepción en una ruta y devuelve su respuesta `500` normal. El mismo worker gestiona la siguiente petición.

Una excepción puede escapar del kernel HTTP de Laravel, por ejemplo desde el callback de una respuesta en streaming. Entonces Octane informa de la excepción mediante el manejador de excepciones de Laravel. El cliente recibe una respuesta `500` en texto plano si las cabeceras de la respuesta todavía no se enviaron. La respuesta contiene los detalles de la excepción solo cuando `app.debug` es `true`.

Después de una excepción así, el estado de la aplicación puede ser incorrecto. Octane detiene el worker, y el bridge termina su bucle. Después, Rapira vuelve a iniciar el script de entrada, y el nuevo worker inicia la aplicación otra vez.

## Producción

Crea las cachés del framework antes de iniciar el servidor:

```bash
php artisan config:cache
php artisan route:cache
```

Un worker puede aumentar su uso de memoria con el tiempo. Establece un límite de sustitución de workers:

```toml
[http.pool]
entrypoint = "worker.php"
mode = "dispatcher"
processes = 4
max_requests = 500
```

`max_requests` sustituye un worker después de un número aleatorio de peticiones entre este valor y 1,5 veces este valor. Limita el efecto de una fuga de memoria, pero no la corrige. Consulta [Modelo de procesos](/es/docs/process-model).

En los modos Worker y Dispatcher, el código de la aplicación permanece en memoria. Después de un despliegue, envía `SIGUSR2` al maestro para sustituir los workers. Con `opcache.validate_timestamps = 0`, reinicia Rapira. Consulta [En producción](/es/docs/deployment).

## Desarrollo

En los modos Worker y Dispatcher, cada worker inicia la aplicación una vez. Reinicia Rapira después de cada cambio de código para cargar el nuevo código PHP.

Como alternativa, usa el modo Classic durante el desarrollo. Establece `mode = "classic"` en `rapira.toml` y conserva `entrypoint = "worker.php"`. El modo Classic inicia la aplicación en cada petición, por lo que los cambios guardados tienen efecto inmediatamente.

::: question ¿Puedo ejecutar Laravel en modo Classic sin el bridge?
Sí. Establece `entrypoint = "public/index.php"` y `mode = "classic"`. Cada petición ejecuta entonces el `public/index.php` estándar, como con php-fpm. Los modos Worker y Dispatcher requieren el bridge.
:::
