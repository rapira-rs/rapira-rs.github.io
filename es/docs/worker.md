---
title: Modo Worker
description: "El bucle de un worker de Rapira, el contrato de handle_request(), el estado persistente y los errores habituales."
faqLevel: 2
---

# Modo Worker

El modo Worker mantiene activo el proceso de PHP entre peticiones. El script inicia la aplicación una vez y espera peticiones en un bucle. El estado de la aplicación también permanece en memoria. Por tanto, el script del worker debe gestionarlo.

En [modo Classic](/es/docs/classic), el script de entrada se ejecuta desde cero en cada petición. Todo lo que haya construido se descarta al responder. El autoloader, el contenedor, la configuración, las rutas y las conexiones a la base de datos se inician para cada petición.

Esta página contiene la guía de programación del modo Worker. El modo Worker no requiere un framework específico. Requiere una aplicación que pueda procesar muchas peticiones después de una inicialización. Consulta los requisitos en [Modos de ejecución](/es/docs/execution-modes). Consulta las guías específicas en [Frameworks](/es/docs/frameworks/).

## El bucle residente

Un script de worker tiene tres partes. La primera inicia la aplicación. La segunda define un handler para una petición. La tercera ejecuta el handler hasta que el worker se detiene. Usa `\Rapira\handle_request()` en el bucle de PHP.

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // The worker creates this object once and reuses it.

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

Dispatcher es el modo predeterminado. Selecciona el modo Worker con uno de estos ajustes:

- `--mode worker` en la línea de comandos, junto al script de entrada.
- `mode = "worker"` en la sección `[pool]` de un `rapira.toml`.

```bash
rapira serve --mode worker app/worker.php
```

El resto de las opciones están en [CLI](/es/docs/cli), y sus equivalentes de `rapira.toml`, en [Configuración](/es/docs/configuration).

## El contrato de `handle_request()`

`\Rapira\handle_request(callable $handler): bool` tiene este contrato:

- **Espera** hasta que este worker recibe una petición. Un worker en espera no usa CPU.
- Mantiene el intérprete y la aplicación iniciada en memoria.
- **Rellena los datos de la petición** en `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE`, `$_FILES` y `$_REQUEST` antes de ejecutar el handler.
- El código PHP puede leerlas como lo hace con php-fpm.
- **Llama al handler sin argumentos.** Los datos de la petición están en las superglobales. La firma es `function (): void`.
- Captura dependencias, como el contenedor o el logger, con `use`.
- **Usa la salida del handler como respuesta.** El handler puede usar `echo`, `print`, `header()`, `http_response_code()` y `setcookie()`.
- Consulta [HTTP](/es/docs/http) para obtener información sobre las peticiones y las respuestas.
- **Devuelve `true`** después de una petición para continuar el bucle. Devuelve **`false`** cuando el worker empieza a detenerse.
- Termina el bucle y el script cuando devuelve `false`.
- **Llámala solo desde el bucle de nivel superior.** No la llames desde una función de shutdown ni desde un destructor.

Una petición en modo Worker corresponde a una iteración del bucle `while`. Rapira completa el cierre de la petición alrededor del handler. Ejecuta las funciones de shutdown, vacía los búferes, cierra la sesión y vuelve a rellenar las superglobales. Los valores externos al handler permanecen en memoria. Rapira no ejecuta todos los destructores al final de una petición. PHP destruye un objeto cuando el código elimina su última referencia.

## Un solo handler por worker

`handle_request()` retorna después de cada petición. El script debe proporcionar el bucle que mantiene activo el worker.

Un script de worker ejecuta un handler cada vez. Un segundo bucle consecutivo no puede ejecutarse hasta que termine el primero. El primer bucle termina cuando `handle_request()` devuelve `false`. En ese momento, el worker se está deteniendo. Distribuye las peticiones dentro de un handler en lugar de usar varios bucles.

```php
while (\Rapira\handle_request($api)) {
}

// Code reaches this loop only during shutdown.
while (\Rapira\handle_request($web)) {
}
```

## Estado entre peticiones

Los objetos creados **fuera** del handler permanecen hasta que el script del worker se reinicia. Algunos ejemplos son el autoloader, el contenedor, las rutas, la configuración, las conexiones abiertas y los datos en caché.

Los valores creados **dentro** del handler pertenecen a una petición. PHP los libera después de que el handler retorna y desaparecen sus referencias.

El script del worker define la duración del estado. Coloca el estado de la aplicación antes del bucle. Coloca el estado de la petición en el handler o reinícialo antes de la siguiente petición.

::: warning
El estado global también permanece entre peticiones. Incluye propiedades estáticas, singletons, registros y cambios persistentes de `ini_set()`. php-fpm reinicia estos valores durante el cierre de la petición. Un worker de Rapira no los reinicia. Usa el [modo Classic](/es/docs/classic) si la aplicación no puede reiniciar el estado global. El modo Classic sustituye a php-fpm. Selecciona el modo Worker después de corregir el estado global.
:::

## Funciones de shutdown

Una función de shutdown registrada durante la inicialización se ejecuta una vez cuando termina el ciclo del worker. No se ejecuta después de cada petición. Una función de shutdown registrada por el handler se ejecuta una vez al final de esa petición.

Registra en el arranque la limpieza de los recursos de todo el proceso, y dentro del handler la de los recursos de una sola petición.

```php
register_shutdown_function(static function (): void {
    // Runs once when the worker cycle ends.
});

$handler = static function (): void {
    register_shutdown_function(static function (): void {
        // Runs at the end of this request.
    });
};

while (\Rapira\handle_request($handler)) {
}
```

Al final del ciclo se ejecutan primero los registros del arranque, en el orden en que se hicieron. Una función que el script registre después del bucle se ejecuta detrás de ellas.

Los objetos usan otra regla. Rapira no ejecuta todos los destructores al final de una petición. PHP destruye un objeto cuando el código elimina su última referencia. Por tanto, destruye un objeto local cuando retorna el handler. Un objeto global creado durante la inicialización permanece entre peticiones. Su método `__destruct()` se ejecuta una vez cuando termina el ciclo.

::: question ¿Por qué una función de shutdown registrada en el arranque no se ejecuta al final de la primera petición?
PHP guarda las funciones de shutdown en el estado de la petición. El cierre de la petición llama a las funciones y libera la lista. En la primera llamada a `handle_request()`, Rapira elimina y guarda los registros de la inicialización. Cada petición contiene entonces solo sus registros. Al final del ciclo, Rapira restaura la lista guardada. Después añade los registros posteriores al bucle. El cierre final ejecuta primero los registros de la inicialización. Después ejecuta los registros posteriores.
:::

## Solo en modo Worker

`handle_request()` necesita el bucle residente que solo tiene el modo Worker. En modo Classic y en modo Dispatcher lanza una `Rapira\Exception\NotInWorkerModeError`. Todas las clases que Rapira lanza implementan la interfaz marcadora `Rapira\Exception\RapiraThrowable`, así que un único `catch` las cubre todas.

`Rapira\get_mode()` devuelve el [modo](/es/docs/execution-modes) del proceso actual como un caso de `Rapira\Mode`. Un script que se ejecuta en más de un modo lo consulta antes de entrar en el bucle:

```php
if (\Rapira\get_mode() === \Rapira\Mode::Worker) {
    while (\Rapira\handle_request($handler)) {
    }
}
```

## Problemas habituales

**Estado retenido entre peticiones.** Comprueba el estado de la petición si la aplicación falla solo en modo Worker. Algunos ejemplos son un array estático creciente, un objeto de petición en un singleton o datos antiguos en un logger. Reinicia este estado al principio o al final del handler. Reinicia también el estado de petición de las bibliotecas. `pool.max_requests` sustituye un worker después de un número especificado de peticiones. Limita una fuga de memoria, pero no la corrige.

**Ciclos de referencias sin recoger.** El conteo de referencias de PHP libera la mayoría de los valores inmediatamente. Solo libera los ciclos cuando se ejecuta el recolector. El ejemplo llama a `gc_collect_cycles()` entre peticiones. Esta llamada es opcional, pero hace predecible el momento de recogida.

**Peticiones que no terminan.** Un worker no puede procesar otra petición mientras se ejecuta la petición actual. `pool.request_terminate_timeout_secs` limita el tiempo de una petición. Rapira termina un worker que supera este valor. Consulta esta clave y `pool.max_requests` en [Configuración](/es/docs/configuration). Consulta el proceso de terminación en [Modelo de procesos](/es/docs/process-model).

**Una excepción sin capturar afecta a una petición, no al worker.** Rapira devuelve `500` para una excepción del handler sin capturar si el handler todavía no ha enviado la cabecera de respuesta. Rapira no puede cambiar el estado después de que el handler envíe la cabecera de respuesta. El bucle continúa, por lo que la excepción no detiene el worker. Un error fatal termina el script residente. El worker vuelve a iniciar el script y la aplicación.

**Trabajo después de la respuesta.** `rapira_finish_request()` envía la respuesta antes de que termine el handler. Después, el handler puede escribir un registro de auditoría. Consulta [HTTP](/es/docs/http) para obtener más información.

## Los stubs para el IDE

Rapira declara sus funciones y clases de PHP en archivos stub de `crates/php_sys`. La API del worker está en [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php). Las clases de excepción están en [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_exception.stub.php). Estos archivos definen las firmas, los tipos de propiedades y los propósitos de las clases. También son stubs para el IDE. Añádelos al proyecto para habilitar el autocompletado del IDE para las API de Rapira.
