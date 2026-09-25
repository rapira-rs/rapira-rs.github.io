---
title: Inicio rápido
description: "Inicia una aplicación PHP en los modos Classic y Worker y guarda los ajustes en rapira.toml."
---

# Inicio rápido

Esta guía inicia una aplicación en modo Classic y la convierte al modo Worker. Después, guarda los ajustes en un archivo de configuración. Los pasos requieren un binario `rapira` funcional con el PHP incluido. Consulta [Instalación](/es/docs/intro/installation).

## Modo Classic

El modo Classic está disponible para cualquier aplicación. Rapira incluye el script de entrada en cada petición, como php-fpm. El código no necesita cambios.

Crea `public/index.php`:

```php
<?php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Crea `rapira.toml` junto al directorio `public`. La clave `mode` selecciona el modo Classic y `entrypoint` indica el script de entrada:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

Inicia el servidor con la ruta del archivo:

```bash
rapira serve rapira.toml
```

Rapira escucha en `127.0.0.1:8000`. Envía una petición desde otra terminal:

```bash
curl '127.0.0.1:8000/?name=world'
```

```
Hello, world!
Method: GET
```

Los procesos worker permanecen activos entre peticiones. Rapira crea los workers una vez y mantiene un intérprete de PHP inicializado en cada uno. El modo Classic elimina el estado del script después de cada petición. Este estado incluye variables, el autoloader y los objetos del framework.

## Modo Worker

El modo Worker mantiene activo el script. Lo inicializa una vez y espera peticiones en un bucle. Rapira rellena las superglobales y llama al handler. PHP puede leer `$_GET` y crear una respuesta con `echo`. La aplicación se inicializa una vez por proceso. Consulta [Modos de ejecución](/es/docs/execution-modes).

Crea `worker.php` en la raíz del proyecto:

```php
<?php

// This value remains available for each request in this worker.
$handled = 0;

$handler = static function () use (&$handled): void {
    $handled++;
    header('Content-Type: text/plain');
    echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
    echo "worker " . getmypid() . " handled {$handled} request(s)\n";
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

`\Rapira\handle_request()` espera la siguiente petición. La función llama al handler y devuelve `true`. Durante la parada del worker, devuelve `false` y termina el bucle. El handler lee las superglobales y responde con `echo` y `header()`. Llama a `\Rapira\handle_request()` solo desde el bucle principal. En otros modos, lanza `Rapira\Exception\NotInWorkerModeError`.

El módulo PHP de Rapira proporciona `\Rapira\handle_request()`. Por tanto, el ejemplo no necesita un autoloader. Una aplicación con dependencias de Composer debe cargar `vendor/autoload.php` antes del bucle.

Detén el servidor Classic con `Ctrl-C`. Ambos servidores usan `127.0.0.1:8000`. Cambia `rapira.toml` al modo Worker:

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

```bash
curl '127.0.0.1:8000/?name=world'
```

Ejecuta el comando `curl` varias veces. El contador de un worker aumenta cuando ese proceso gestiona otra petición. Rapira crea un worker por CPU lógica de forma predeterminada. El sistema operativo selecciona un worker para cada conexión. Cada worker tiene su propio contador. El identificador del proceso en la respuesta muestra qué worker respondió. Establece `processes = 1` en `[http.pool]` para crear un solo worker. Consulta [Modelo de procesos](/es/docs/process-model).

Los objetos creados antes del bucle `while` permanecen en memoria hasta que el script del worker se reinicia. Estos objetos incluyen el autoloader de Composer, el contenedor, las conexiones, las rutas y las plantillas. Rapira inicializa este estado una vez. Solo el estado de la petición es nuevo en cada iteración.

::: warning
El script del worker debe reiniciar el estado de la petición que permanece en memoria. Este estado incluye propiedades estáticas, valores globales y transacciones abiertas. Consulta [Modo Worker](/es/docs/worker).
:::

El handler puede usar `header()`, `http_response_code()` y `echo`. `rapira_finish_request()` envía la respuesta antes de que termine el handler. Consulta [HTTP](/es/docs/http).

## Archivo de configuración

El archivo de configuración contiene todos los ajustes. Añade el número de workers al mismo archivo:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
```

```bash
rapira serve rapira.toml
```

::: info
Un `http.pool.entrypoint` relativo usa como base el directorio del archivo de configuración. El directorio actual no lo afecta.
:::

El archivo también controla el escalado del pool, la sustitución de workers, los tiempos límite, los registros y el pidfile. Una clave desconocida impide el inicio. Consulta [Configuración](/es/docs/configuration) y el comando en [Línea de comandos](/es/docs/cli).

## Parar el servidor

Pulsa `Ctrl-C` para iniciar una parada controlada. Rapira deja de aceptar trabajo, termina las peticiones actuales, detiene las extensiones y sale. Pulsa `Ctrl-C` otra vez para forzar la salida. `SIGTERM` tiene el mismo comportamiento. Consulta [Modelo de procesos](/es/docs/process-model) para ver la tabla completa de señales.

## Próximos pasos

- [Modo Worker](/es/docs/worker) - el bucle residente a fondo: estado, fugas, reciclaje y cómo arrancar una aplicación real antes del bucle.
- [Configuración](/es/docs/configuration) - todas las claves que admite `rapira.toml`, con sus valores por defecto.
- [Frameworks](/es/docs/frameworks/) - guías de integración para Symfony, Laravel y Yii3.
