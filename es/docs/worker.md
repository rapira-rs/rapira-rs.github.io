---
title: Modo Worker
description: "El bucle de un worker de Rapira, el contrato de handle_request(), el estado persistente y los errores habituales."
faqLevel: 2
---

# Modo Worker

El modo Worker mantiene activo el proceso de PHP entre peticiones. El script inicializa la aplicación una vez y después espera peticiones en un bucle. El estado de la aplicación permanece en memoria, por lo que el script del worker debe gestionarlo.

En [modo Classic](/es/docs/classic), el script de entrada se ejecuta cada vez en una nueva petición de PHP, y Rapira elimina el estado de la aplicación después de la respuesta. Este estado incluye el autoloader, el contenedor, la configuración, las rutas y las conexiones a la base de datos.

El modo Worker no requiere un framework específico. Requiere una aplicación que pueda procesar muchas peticiones después de una inicialización. Consulta [Modos de ejecución](/es/docs/execution-modes) para seleccionar un modo. Consulta [Frameworks](/es/docs/frameworks/) para las guías de frameworks.

## El bucle residente

Un script de worker tiene tres partes. La primera parte inicializa la aplicación. La segunda parte define un handler para una petición. La tercera parte llama a `\Rapira\handle_request()` en un bucle hasta que el worker se detiene.

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

Dispatcher es el modo predeterminado. Selecciona el modo Worker con `mode = "worker"` en la tabla `[http.pool]` de un `rapira.toml`:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/worker.php"
mode = "worker"
```

```bash
rapira serve rapira.toml
```

Consulta las demás claves en [Configuración](/es/docs/configuration).

## El contrato de `handle_request()`

`\Rapira\handle_request(callable $handler): bool` tiene este contrato:

- **Espera** hasta que llega una petición para este worker. El worker no usa CPU mientras espera.
- **Rellena los datos de la petición** en `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE`, `$_FILES` y `$_REQUEST` antes de ejecutar el handler. El código lee estas superglobales como lo hace con php-fpm.
- **Llama al handler sin argumentos.** Usa la firma `function (): void`. Captura dependencias, como el contenedor o el logger, con `use`. Rapira ignora el valor de retorno.
- **La salida del handler es la respuesta.** El handler puede usar `echo`, `print`, `header()`, `http_response_code()` y `setcookie()`. Consulta [HTTP](/es/docs/http) para el procesamiento de las peticiones y las respuestas.
- **Devuelve `true`** después de cada petición. Devuelve `false` cuando el worker empieza a detenerse. Termina el bucle y el script cuando devuelve `false`.
- **Llámala solo desde el bucle de nivel superior del script.** Una llamada desde dentro del handler lanza un `\Error`. No la llames desde una función de shutdown ni desde un destructor.

Una petición en modo Worker es una iteración del bucle `while`. Antes de cada llamada al handler, Rapira vuelve a rellenar las superglobales. Después de la llamada, Rapira ejecuta las funciones de shutdown de la petición, vacía los búferes de salida y cierra la sesión. Los valores que el script mantiene fuera del handler permanecen en memoria.

Antes de la primera llamada a `handle_request()`, `$_SERVER` contiene el entorno del proceso y la ruta del script de entrada, igual que con PHP CLI. Consulta la lista completa en [Modos de ejecución](/es/docs/execution-modes).

## Un bucle por worker

Un script de worker ejecuta un bucle con un handler. En el ejemplo siguiente, el segundo bucle se ejecuta solo después de que termine el primero, y el primer bucle termina solo durante la detención. Usa un handler que distribuya todas las peticiones.

```php
while (\Rapira\handle_request($api)) {
}

// Code reaches this loop only during shutdown.
while (\Rapira\handle_request($web)) {
}
```

## Estado que permanece entre peticiones

Los objetos creados **fuera** del handler permanecen hasta que termina el ciclo del worker. Algunos ejemplos son el autoloader, el contenedor, las rutas, la configuración, las conexiones abiertas y los datos en caché. Rapira no crea este estado para cada petición.

Los valores creados **dentro** del handler pertenecen a una petición. PHP los libera después de que el handler retorna y el código elimina sus últimas referencias.

El script del worker define la duración del estado. Coloca el estado de la aplicación antes del bucle. Coloca el estado de la petición en el handler o reinícialo antes de la siguiente petición.

::: warning
El estado global también permanece entre peticiones. Algunos ejemplos son las propiedades estáticas, los singletons, los registros y los cambios de `ini_set()`. php-fpm descarta estos valores al final de cada petición. Un worker de Rapira los mantiene.

Usa el [modo Classic](/es/docs/classic) si la aplicación no puede reiniciar el estado global. El modo Classic es un sustituto compatible de php-fpm. Selecciona el modo Worker después de corregir el estado global.
:::

## Funciones de shutdown

Un ciclo del worker es una ejecución del script del worker, desde la inicialización hasta el final del script. PHP ejecuta cada función de shutdown que registra el código de inicialización una vez, al final del ciclo. PHP ejecuta cada función de shutdown que registra el handler una vez, al final de esa petición.

Registra la limpieza de los recursos del proceso durante la inicialización. Registra la limpieza de los recursos de la petición dentro del handler.

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

Al final del ciclo, los registros de la inicialización se ejecutan primero, en el orden de registro. Una función registrada después del bucle se ejecuta después de ellos.

Los objetos usan otra regla. Rapira no ejecuta todos los destructores al final de una petición. PHP destruye un objeto cuando el código elimina su última referencia. Por tanto, PHP destruye un objeto del handler cuando el handler retorna. Un objeto global creado durante la inicialización permanece entre peticiones. Su método `__destruct()` se ejecuta una vez cuando termina el ciclo.

::: question ¿Por qué una función de shutdown de la inicialización no se ejecuta después de la primera petición?
PHP guarda las funciones de shutdown en el estado de la petición. El cierre de la petición llama a las funciones y libera la lista. En la primera llamada a `handle_request()`, Rapira elimina y guarda los registros de la inicialización, por lo que cada petición tiene solo sus propios registros. Al final del ciclo, Rapira restaura la lista guardada y añade los registros posteriores al bucle.
:::

## Solo en modo Worker

`handle_request()` necesita el bucle residente que solo tiene el modo Worker. En modo Classic y en modo Dispatcher lanza una `Rapira\Exception\NotInWorkerModeError`. Todas las clases de excepción de Rapira implementan la interfaz marcadora `Rapira\Exception\RapiraThrowable`. Algunos errores de uso son `\Error` o `\ValueError` simples, y un `catch` de `RapiraThrowable` no los captura. Un ejemplo es una llamada a `handle_request()` dentro de su handler.

`Rapira\get_mode()` devuelve el [modo](/es/docs/execution-modes) del proceso actual como un caso de `Rapira\Mode`. Un script que se ejecuta en más de un modo lo consulta antes de entrar en el bucle:

```php
if (\Rapira\get_mode() === \Rapira\Mode::Worker) {
    while (\Rapira\handle_request($handler)) {
    }
}
```

## Problemas habituales

**El estado de la petición permanece entre peticiones.** Si una aplicación falla solo en modo Worker, busca el estado de la petición que permanece. Algunos ejemplos son un array estático que crece, un objeto de petición en un singleton o datos antiguos de un usuario en un logger.

Reinicia este estado al principio o al final del handler. Reinicia también el estado de la petición en las bibliotecas. `http.pool.max_requests` sustituye un worker después de que procesa más peticiones que este número. Esto limita el efecto de una fuga de memoria, pero no la corrige.

**Ciclos de referencias sin recoger.** El conteo de referencias de PHP libera la mayoría de los valores inmediatamente. Solo libera los ciclos cuando se ejecuta el recolector. El ejemplo llama a `gc_collect_cycles()` entre peticiones. Esta llamada es opcional, pero hace predecible el momento de recogida.

**Peticiones que no terminan.** Un worker no puede procesar otra petición mientras se ejecuta la petición actual. `http.pool.request_terminate_timeout_secs` limita el tiempo transcurrido de una petición. Cuando una petición supera el límite, Rapira detiene el worker e inicia uno nuevo. Consulta esta clave y `http.pool.max_requests` en [Configuración](/es/docs/configuration). Consulta la secuencia de detención en [Modelo de procesos](/es/docs/process-model).

**La inicialización falla.** El script del worker debe llamar a `handle_request()` y recibir una petición. Una excepción sin capturar durante la inicialización puede terminar el script antes. Rapira cuenta esto como un arranque fallido. Después, el worker espera hasta 5 segundos una petición, la responde con `503` y vuelve a ejecutar el script.

Después de cinco arranques fallidos seguidos, Rapira registra `worker keeps failing to boot; flagged unhealthy` y el worker termina. El master inicia un nuevo worker después de un retardo. Al iniciar el servidor, si ningún worker del pool ha arrancado ni ha procesado una petición, el servidor se detiene con el [código de salida](/es/docs/cli#codigos-de-salida) 70 en su lugar. Consulta la supervisión de los workers en [Modelo de procesos](/es/docs/process-model).

**Una excepción sin capturar afecta a una petición, no al worker.** Si el handler lanza una excepción, Rapira llama primero al callback que registró `set_exception_handler()`. Si ningún callback procesa la excepción, Rapira devuelve `500`, salvo que el handler ya haya enviado la cabecera de respuesta. En los dos casos, el bucle continúa. Una llamada a `exit()` o `die()` en el handler termina solo la petición actual, y Rapira envía la salida como respuesta. Un error fatal termina el script del worker, y Rapira vuelve a ejecutar el script con una nueva inicialización.

**Trabajo después de la respuesta.** `rapira_finish_request()` envía la respuesta antes de que termine el handler. Después, el handler puede hacer más trabajo, por ejemplo escribir un registro de auditoría. Consulta [HTTP](/es/docs/http) para obtener más información.

## Los stubs para el IDE

Rapira declara sus funciones y clases de PHP en archivos stub de `crates/sapi` y `crates/plugins`. La API del worker está en [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira.stub.php). Las clases de excepción compartidas están en [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/sapi/rapira_exception.stub.php). Estos archivos declaran las firmas, los tipos de propiedades y los propósitos de las clases. Añádelos al proyecto para habilitar el autocompletado del IDE para `\Rapira\handle_request()`, `\Rapira\get_mode()` y las demás API.
