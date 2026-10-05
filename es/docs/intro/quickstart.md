---
title: Inicio rápido
description: "Ejecuta una aplicación PHP en los modos Classic y Worker. Guarda los ajustes en rapira.toml."
---

# Inicio rápido

Inicia una aplicación en modo Classic. Después, conviértela al modo Worker. Guarda los ajustes en un archivo de configuración. Los pasos requieren un binario `rapira` con su PHP incluido. Consulta [Instalación](/es/docs/intro/installation) para más información.

## Modo Classic

El modo Classic está disponible para cualquier aplicación. Rapira incluye de nuevo el script de entrada en cada petición, como hace php-fpm. El código no necesita cambios.

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

El modo Worker mantiene activo el script. El script se inicializa una vez y después espera peticiones en un bucle. Para cada petición, Rapira rellena de nuevo las superglobales y llama al handler. PHP puede seguir leyendo `$_GET` y usar `echo` para una respuesta. Consulta [Modos de ejecución](/es/docs/execution-modes) para más información.

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

`\Rapira\handle_request()` espera la siguiente petición. La función llama al handler y devuelve `true`. Durante la parada del worker, `\Rapira\handle_request()` devuelve `false`. Este valor termina el bucle.

El handler lee las superglobales y crea la salida con `echo` y `header()`. Llama a `\Rapira\handle_request()` solo desde el bucle de nivel superior del script. En otros modos, lanza `Rapira\Exception\NotInWorkerModeError`.

El módulo PHP que Rapira registra proporciona `\Rapira\handle_request()`. Por tanto, el ejemplo no necesita un autoloader. Una aplicación con dependencias de Composer debe cargar `vendor/autoload.php` antes del bucle.

Detén el servidor Classic con `Ctrl-C`, porque ambos servidores escuchan en `127.0.0.1:8000`. Cambia `rapira.toml` al modo Worker:

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

Ejecuta el comando `curl` varias veces. El contador de un worker aumenta cuando ese proceso gestiona otra petición. Rapira crea un worker por CPU lógica de forma predeterminada. El sistema operativo selecciona un worker para cada conexión. Cada worker tiene su propio contador. El identificador del proceso en la salida muestra qué worker devolvió la respuesta.

Establece `processes = 1` en `[http.pool]` para crear un solo worker. Consulta [Modelo de procesos](/es/docs/process-model) para la supervisión del pool.

Los objetos creados antes del bucle `while` permanecen en memoria hasta que el script del worker se reinicia. Estos objetos incluyen el autoloader de Composer, el contenedor, las conexiones, las rutas y las plantillas. Rapira inicializa este estado una vez y no en cada petición. Solo el estado de la petición es nuevo en cada iteración.

::: warning
El script del worker debe reiniciar el estado de la petición que permanece en memoria. Este estado incluye propiedades estáticas, valores globales y transacciones abiertas. Consulta [Modo Worker](/es/docs/worker) para más información.
:::

El handler puede llamar a `rapira_finish_request()` para enviar la respuesta antes de que termine el handler. Consulta [HTTP](/es/docs/http) para más información.

## Archivo de configuración

El archivo de configuración contiene todos los ajustes. El comando `rapira serve` acepta solo la ruta de este archivo. Añade el número de workers al archivo:

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

El archivo también controla la sustitución de workers, los tiempos límite de petición, los registros y el pidfile del supervisor. El servidor no se inicia si el archivo contiene una clave desconocida. Consulta [Configuración](/es/docs/configuration) para todos los ajustes del archivo de configuración y [Línea de comandos](/es/docs/cli) para el comando.

## Parar el servidor

Pulsa `Ctrl-C` para detener el servidor. La terminal envía `SIGINT` al proceso maestro y a cada worker, por lo que las peticiones actuales se detienen inmediatamente. Para dejar terminar las peticiones actuales, envía `SIGTERM` solo al proceso maestro, por ejemplo `kill -TERM <master-pid>`. Consulta [Modelo de procesos](/es/docs/process-model) para ver la tabla completa de señales.

## Próximos pasos

- [Modo Worker](/es/docs/worker) describe el bucle persistente, el estado, las fugas de memoria, la sustitución de workers y la inicialización de la aplicación.
- [Configuración](/es/docs/configuration) enumera cada clave de `rapira.toml` y su valor predeterminado.
- [Frameworks](/es/docs/frameworks/) proporciona guías de integración para Symfony, Laravel y Yii3.
