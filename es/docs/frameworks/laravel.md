---
title: Laravel
description: "Ejecutar Laravel sobre Rapira en modo Classic y el estado actual de la compatibilidad con el modo Worker."
---

# Laravel

Rapira ejecuta Laravel en modo Classic con el script de entrada `public/index.php` de siempre. Lo ejecuta desde cero en cada petición, igual que php-fpm. La aplicación no necesita ningún cambio. El modo Worker para Laravel está en desarrollo; su estado actual está más abajo, en [Modo Worker](#modo-worker).

::: info Verificado con
- **PHP 8.5.8** - NTS, SAPI embed
- **Rapira 0.8.0**
- Aplicación base **laravel/laravel** con **laravel/framework v13.23.0**

Las pruebas utilizaron una aplicación base `laravel/laravel` con varias rutas adicionales, en modo Classic y con un solo proceso worker: enrutado, sesiones, subidas de archivos, cuerpos JSON y de formulario, configuración y rutas cacheadas, respuestas de error y 50 peticiones seguidas.
:::

## Requisitos previos

Necesitas Rapira instalado -lo tienes en [Instalación](/es/docs/intro/installation)- y una aplicación de Laravel que ya te funcione. También necesitas un PHP CLI normal en la máquina para Composer y `artisan`: Rapira trae PHP como biblioteca (`libphp`), no como comando `php`, así que esos pasos se ejecutan con el PHP de tu sistema, que Rapira ni usa ni toca.

Comprueba las extensiones de base de datos antes del primer arranque: una aplicación base nueva de `laravel/laravel` viene con una base de datos SQLite y con los drivers de sesión, caché y colas apoyados en base de datos, lo que significa que necesita `pdo_sqlite`. El PHP que acompaña a las releases de Rapira lo trae: PDO, `pdo_sqlite` y `sqlite3` están en el conjunto de extensiones de la compilación de release, tal y como lista la página de [Instalación](/es/docs/intro/installation). Si ejecutas Rapira contra un PHP compilado por ti, asegúrate de que esas extensiones aparecen en tu línea de configure ([Compilar desde el código](/es/docs/intro/build-from-source) lo cuenta), o apunta Laravel a los drivers de archivo y sync: `SESSION_DRIVER=file`, `CACHE_STORE=file`, `QUEUE_CONNECTION=sync`. Esa es la combinación con la que se verificó esta página.

## Ponerlo en marcha

El modo Classic se activa expresamente, así que el comando lo nombra:

::: code-group

```bash [CLI]
rapira serve --mode classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
mode = "classic"
processes = 4

[http]
listen = "127.0.0.1:8000"
```

:::

Con un archivo de configuración el comando es `rapira serve --config rapira.toml`, y un `entrypoint` relativo se resuelve respecto al directorio del propio archivo. Todas las claves y sus valores por defecto están en la página de [Configuración](/es/docs/configuration).

Rapira ejecuta el script de entrada desde cero en cada petición, así que el ciclo de vida del framework es exactamente el que tiene bajo php-fpm: no hay estado residente ni nada que reiniciar entre peticiones. Lo que sí se queda caliente es OPcache: PHP arranca una sola vez en el maestro, antes de hacer fork de ningún worker, así que todos los workers comparten la misma caché de scripts compilados para tu código y para tu árbol `vendor/`. En [Modo Classic](/es/docs/classic) tienes cómo funciona.

Para producción, genera antes las cachés del framework; las dos se verificaron en modo Classic, y las mismas comprobaciones pasaron sin cachear y cacheadas:

```bash
php artisan config:cache
php artisan route:cache
```

## Rutas y URLs

Rapira no mapea las URL sobre scripts PHP: cada petición ejecuta el script de entrada y la ruta que Laravel enruta llega en `$_SERVER['REQUEST_URI']`. Cuando el [middleware de archivos estáticos](/es/docs/static-files) está activado, responde a las peticiones que puede servir con un archivo, y las demás ejecutan el script de entrada. El enrutado, la página 404 del propio Laravel para las rutas que no encajan y la generación con `url()` se verificaron todos: las URL que salen son absolutas y limpias, sin `index.php` por ninguna parte, y sin sobrescribir nada de `$_SERVER` ni tocar la configuración de rutas o de URLs.

La ruta de salud `/up` que trae la aplicación base responde `200`, así que sirve como destino del health check de un balanceador de carga o de un contenedor. Rapira sirve los archivos estáticos de la aplicación con el [middleware de archivos estáticos](/es/docs/static-files). Actívalo por sus dos mitades: nombra `"static"` en `http.middleware` y pon en la clave `root` de `[http.static]` el directorio `public/` de la aplicación. Si aparece una mitad sin la otra, Rapira se niega a arrancar. Una CDN o un proxy inverso por delante también pueden servir esos archivos en su lugar. El listener de Rapira habla HTTP en claro y deja `$_SERVER['HTTPS']` vacío sea cual sea el valor de `X-Forwarded-Proto`. Cuando ese [proxy termina TLS](/es/docs/deployment), configura los [proxies de confianza](https://laravel.com/docs/requests#configuring-trusted-proxies) de Laravel; sin esa configuración, `url()` genera enlaces `http://`.

## Sesiones, CSRF y formularios

Las sesiones se verificaron con el driver de archivos: la cookie de sesión sale, vuelve en la petición siguiente y cada cliente tiene la suya. CSRF no necesita configuración: el token vive en la sesión y cada petición tiene la misma semántica de proceso nuevo que le da php-fpm. Los envíos de formularios, los cuerpos de petición en JSON y las subidas de archivos se verificaron todos con el mismo montaje. Cuando una ruta lanza una excepción, el manejador de excepciones de Laravel pinta su `500` de siempre y la petición siguiente no se ve afectada.

## Modo Worker

El modo Worker para Laravel está en desarrollo y todavía no se admite: ejecuta Laravel en modo Classic. Aún no hay fecha para la compatibilidad con el modo Worker.

El motivo es el ciclo de vida del framework. El contenedor de Laravel no está pensado para sobrevivir a una segunda petición sin ayuda: los bindings se resuelven, los singletons se quedan con la petición actual y las estáticas del framework se van llenando mientras la petición avanza, así que todo eso hay que deshacerlo antes de que llegue la siguiente. Ese desmontaje es justo lo que implementa [Octane](https://laravel.com/docs/octane) (`laravel/octane`), el paquete del propio Laravel para servidores de larga vida. Octane solo funciona en los servidores para los que tiene driver, y Rapira todavía no tiene driver de Octane.

El modo en sí no es el impedimento: [Symfony](/es/docs/frameworks/symfony) y [Yii3](/es/docs/frameworks/yii3) mantienen sus aplicaciones residentes en ese mismo modo [Worker](/es/docs/worker). Lo que falta es el manejo del estado entre peticiones específico de Laravel.

Puedes escribir tu propio script de worker para Laravel, pero mantener la aplicación residente significa rehacer a mano el manejo de estado de Octane: el estado que hay que deshacer está repartido entre el contenedor, los singletons ya resueltos, la pila de petición/sesión/autenticación y las estáticas del propio framework, y uno que se te escape aparece como un objeto de petición caducado o como la sesión de un usuario visible para el siguiente.
