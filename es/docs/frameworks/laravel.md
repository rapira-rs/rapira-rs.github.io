---
title: Laravel
description: "Ejecutar Laravel sobre Rapira en modo Classic y el estado actual de la compatibilidad con el modo Worker."
---

# Laravel

Rapira ejecuta Laravel en modo Classic con el script de entrada estándar `public/index.php`. Cada petición HTTP se ejecuta en una nueva petición PHP, como con php-fpm. La aplicación no requiere cambios. Rapira todavía no admite Laravel en [modo Worker](#modo-worker).

::: info Verificado con
- **PHP 8.5.8**: NTS, SAPI embed
- **Rapira 0.8.0**
- Aplicación base **laravel/laravel** con **laravel/framework v13.23.0**

Las pruebas usaron una aplicación base `laravel/laravel` en modo Classic con un worker y rutas adicionales. Cubrieron el enrutado, las sesiones, las subidas de archivos, los cuerpos de petición, la configuración cacheada, las rutas cacheadas, los errores y 50 peticiones seguidas. Los ejemplos de esta página usan el formato de configuración de v0.9.
:::

## Requisitos previos

Instala Rapira como se describe en [Instalación](/es/docs/intro/installation). Rapira proporciona PHP como biblioteca, no como comando `php`. Instala un PHP CLI para Composer y `artisan`. Rapira no usa ni modifica este CLI.

Un proyecto `laravel/laravel` nuevo usa SQLite y drivers de sesión, caché y colas basados en la base de datos, por lo que requiere `pdo_sqlite`. Las compilaciones de las releases de Rapira incluyen `pdo_sqlite`. Consulta [Instalación](/es/docs/intro/installation) para ver la lista completa de extensiones. Si compilas PHP, activa las extensiones que necesitan tus drivers. Consulta [Compilar desde el código](/es/docs/intro/build-from-source).

También puedes establecer `SESSION_DRIVER=file`, `CACHE_STORE=file` y `QUEUE_CONNECTION=sync`. Las pruebas de esta página usaron estos ajustes.

## Iniciar Rapira

El modo por defecto es `dispatcher`, pero el `public/index.php` de Laravel no tiene un bucle dispatcher. Establece `mode = "classic"` en `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
processes = 4
```

Ejecuta `rapira serve rapira.toml` para iniciar el servidor. Un `entrypoint` relativo usa como base el directorio del archivo de configuración. Consulta [Configuración](/es/docs/configuration) para ver todas las claves y sus valores por defecto.

La aplicación no tiene estado persistente que restablecer entre peticiones. PHP se inicia una vez en el proceso maestro, antes de que el maestro cree los workers. Por tanto, todos los workers comparten un OPcache para el código de la aplicación y de `vendor/`. En PHP 8.4, OPcache es un `opcache.so` separado que necesita una línea `zend_extension` en [php.ini](/es/docs/intro/installation#php-ini). Consulta [Modo Classic](/es/docs/classic) para más información.

Crea las cachés del framework antes de iniciar producción. Las pruebas confirmaron ambas cachés en modo Classic:

```bash
php artisan config:cache
php artisan route:cache
```

## Rutas y URLs

Rapira no asigna las URL a scripts PHP. Cada petición ejecuta `public/index.php`, y Laravel enruta la ruta de `$_SERVER['REQUEST_URI']`. Las pruebas cubrieron el enrutado, la página 404 de Laravel y la generación con `url()`. Las URL generadas son absolutas y no contienen `index.php`. No necesitan cambios en `$_SERVER` ni en la configuración de rutas o URL.

Para servir los recursos de `public/`, activa el [middleware de archivos estáticos](/es/docs/static-files). Añade `middleware` a la tabla `[http]` existente y añade la tabla `[http.static]`. Rapira necesita ambos ajustes:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

El middleware responde a las peticiones que coinciden con archivos de `public/`. Las demás peticiones van a Laravel. También puedes usar una CDN o un proxy inverso para servir los recursos.

La ruta integrada `/up` devuelve `200`. Un balanceador de carga o un contenedor puede usarla para las comprobaciones de estado. Rapira también puede servir `/livez` y `/readyz` en una dirección separada. Consulta [Métricas y comprobaciones de estado](/es/docs/observability).

Rapira acepta solo HTTP sin cifrar y deja `$_SERVER['HTTPS']` vacío, también cuando una petición tiene `X-Forwarded-Proto`. Cuando un [proxy termina TLS](/es/docs/deployment), configura los [proxies de confianza](https://laravel.com/docs/requests#configuring-trusted-proxies) de Laravel. Sin esta configuración, `url()` genera enlaces `http://`.

## Sesiones, CSRF y formularios

Las pruebas usaron el driver de sesiones de archivos. Cada cliente recibió una sesión independiente y envió la cookie de sesión con la siguiente petición. CSRF no requiere ajustes de Rapira porque el token está en la sesión.

Las pruebas también cubrieron datos de formulario, cuerpos JSON y subidas de archivos. `http.max_body_size_mb` limita el cuerpo de la petición antes de que PHP se ejecute. El valor por defecto es 8 MiB. Rapira devuelve `413` para un cuerpo más grande, y Laravel no recibe la petición. Para aceptar subidas más grandes, aumenta este valor. Aumenta también `post_max_size` y `upload_max_filesize` en php.ini. Consulta [Cuerpos de petición](/es/docs/http#cuerpos-de-peticion).

Laravel devolvió su respuesta `500` normal para una excepción en una ruta. La siguiente petición se ejecutó con normalidad y no repitió la excepción.

## Modo Worker

Rapira todavía no admite Laravel en modo Worker. Ejecuta Laravel en modo Classic.

Laravel guarda el estado de la petición en el contenedor, en los singletons resueltos y en propiedades estáticas. Un worker debe restablecer este estado antes de la siguiente petición. [Octane](https://laravel.com/docs/octane) hace este restablecimiento para los servidores que admite, pero Rapira no tiene un driver de Octane. Las aplicaciones [Symfony](/es/docs/frameworks/symfony) y [Yii3](/es/docs/frameworks/yii3) pueden ejecutarse en modo Worker.

::: warning
Un worker propio de Laravel sin un restablecimiento completo del estado puede enviar datos de petición, sesión o autenticación de una petición a una petición posterior. No uses un worker propio sin pruebas completas de aislamiento del estado.
:::
