---
title: Laravel
description: "Ejecutar Laravel sobre Rapira en modo Classic y el estado actual de la compatibilidad con el modo Worker."
---

# Laravel

Rapira ejecuta Laravel en modo Classic con el script estándar `public/index.php`. Inicia una nueva petición PHP cada vez, como php-fpm. La aplicación no requiere cambios. El modo Worker para Laravel está en desarrollo. Consulta [Modo Worker](#modo-worker).

::: info Verificado con
- **PHP 8.5.8** - NTS, SAPI embed
- **Rapira 0.8.0**
- Aplicación base **laravel/laravel** con **laravel/framework v13.23.0**

Las pruebas utilizaron una aplicación base `laravel/laravel` con varias rutas adicionales, en modo Classic y con un solo proceso worker: enrutado, sesiones, subidas de archivos, cuerpos JSON y de formulario, configuración y rutas cacheadas, respuestas de error y 50 peticiones seguidas.
:::

## Requisitos previos

Instala Rapira como se describe en [Instalación](/es/docs/intro/installation). También necesitas una aplicación Laravel funcional. Instala PHP CLI para Composer y `artisan`. Rapira proporciona PHP como biblioteca, no como comando `php`. Composer y `artisan` usan el PHP CLI del sistema. Rapira no usa ni modifica este CLI.

Comprueba las extensiones de base de datos antes del primer inicio. Un proyecto `laravel/laravel` nuevo usa SQLite para la base, sesiones, caché y colas. Por tanto, requiere `pdo_sqlite`. Las compilaciones de Rapira incluyen PDO, `pdo_sqlite` y `sqlite3`. Consulta [Instalación](/es/docs/intro/installation) para ver la lista completa. Incluye estas extensiones al compilar PHP. Consulta [Compilar desde el código](/es/docs/intro/build-from-source). También puedes establecer `SESSION_DRIVER=file`, `CACHE_STORE=file` y `QUEUE_CONNECTION=sync`. Las pruebas de esta página usaron estos ajustes.

## Iniciar Rapira

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

Ejecuta `rapira serve --config rapira.toml` para usar el archivo de configuración. Un `entrypoint` relativo usa el directorio del archivo. Consulta [Configuración](/es/docs/configuration) para ver todas las claves.

Rapira inicia una petición PHP nueva para cada petición HTTP. Por tanto, el ciclo de vida coincide con php-fpm. No hay estado persistente de la aplicación. PHP se inicia en el proceso maestro antes de crear workers. OPcache proporciona una caché compartida para el código de la aplicación y `vendor/`. Consulta [Modo Classic](/es/docs/classic).

Crea las cachés del framework antes de iniciar producción. Ambos comandos se verificaron en modo Classic:

```bash
php artisan config:cache
php artisan route:cache
```

## Rutas y URLs

Rapira no asigna las URL a scripts PHP. Cada petición ejecuta el script de entrada. `$_SERVER['REQUEST_URI']` contiene la ruta que usa Laravel. El [middleware de archivos estáticos](/es/docs/static-files) responde a las peticiones de archivos. Las demás peticiones ejecutan el script de entrada. Las pruebas incluyeron rutas, la página 404 y la generación con `url()`. Las URL son absolutas y no contienen `index.php`. No necesitas cambiar `$_SERVER` ni la configuración de URL.

La ruta `/up` devuelve `200`. Un balanceador o contenedor puede usarla para comprobar el estado. Para los archivos estáticos, añade `"static"` a `http.middleware`. Establece `[http.static].root` en el directorio `public/`. Rapira requiere ambos ajustes. También puedes usar una CDN o un proxy inverso. Rapira acepta HTTP sin cifrar y deja `$_SERVER['HTTPS']` vacío, sin depender de `X-Forwarded-Proto`. Cuando un [proxy termina TLS](/es/docs/deployment), configura los [proxies de confianza](https://laravel.com/docs/requests#configuring-trusted-proxies). Sin esta configuración, `url()` genera enlaces `http://`.

## Sesiones, CSRF y formularios

Las pruebas usaron el driver de sesiones de archivos. Cada cliente recibió una sesión independiente y envió la cookie de sesión con la siguiente petición. CSRF no requiere ajustes de Rapira porque el token está en la sesión. Classic usa el ciclo de vida de php-fpm. Las pruebas también incluyeron formularios, cuerpos JSON y archivos. Laravel devolvió su respuesta `500` normal para una excepción. Laravel procesó la siguiente petición con normalidad.

## Modo Worker

El modo Worker para Laravel está en desarrollo y todavía no se admite. Ejecuta Laravel en modo Classic. No hay una fecha de publicación para el soporte de Worker.

El ciclo de vida del framework requiere una integración específica. Laravel resuelve bindings, almacena peticiones en singletons y cambia el estado estático durante el procesamiento de peticiones. Este estado debe restablecerse antes de la siguiente petición. [Octane](https://laravel.com/docs/octane) realiza el restablecimiento para servidores compatibles. Rapira todavía no tiene un driver de Octane.

[Symfony](/es/docs/frameworks/symfony) y [Yii3](/es/docs/frameworks/yii3) admiten aplicaciones persistentes. Laravel requiere su propio proceso para restablecer el estado.

Un worker propio de Laravel debe implementar todo el restablecimiento de estado de Octane. El estado de la petición existe en el contenedor, los singletons resueltos, los servicios de petición, los servicios de sesión, los servicios de autenticación y las propiedades estáticas. Un restablecimiento incompleto puede exponer datos antiguos de una petición o sesión a cualquier petición posterior, incluso a otra petición del mismo usuario. No uses ese worker sin pruebas completas de aislamiento del estado.
