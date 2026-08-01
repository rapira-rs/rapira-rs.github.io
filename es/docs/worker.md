---
title: Modo worker
description: "Cómo escribir un script de worker de Rapira: el bucle residente, el contrato de handleRequest(), qué sobrevive entre peticiones y las trampas más habituales."
---

# Modo worker

El modo worker mantiene vivo el proceso de PHP de una petición a otra: tu script arranca la aplicación una vez y luego se queda en un bucle pidiéndole a Rapira la siguiente petición. El arranque ocurre una sola vez, al iniciar, y a partir de ahí cada petición empieza con la aplicación ya caliente en memoria. El estado también sobrevive a la petición, así que el script del worker tiene que gestionarlo.

En [modo clásico](/es/docs/classic), en cambio, el script de entrada se ejecuta desde cero en cada petición y todo lo que haya construido se descarta al responderla, de modo que arrancar un framework moderno —autoloader, contenedor, configuración, rutas, conexiones a la base de datos— cuesta lo mismo en todas y cada una de las peticiones.

El modo worker es el modo **SAPI Worker** y, junto con Classic, es lo que hay disponible hoy; esta página es su guía de programación. El modo worker no exige ningún framework concreto, solo una aplicación que aguante arrancar una vez y atender muchas peticiones después, algo que la mayoría de los frameworks modernos hacen. En [Modos de ejecución](/es/docs/execution-modes) tienes los cuatro modos y qué determina cuál puede usar una aplicación, y en [Frameworks](/es/docs/frameworks/), las guías de frameworks concretos.

## El bucle residente

Un script de worker tiene tres partes: todo lo que arranques al principio, un handler que responde a una petición y un bucle que ejecuta ese handler hasta que el servidor se apaga. El bucle lo escribes tú en PHP, alrededor del objeto handler que Rapira le devuelve al script.

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

use Rapira\Plugin\Http\HttpHandlerConfig;
use function Rapira\create_plugin_handler;

$http = create_plugin_handler(new HttpHandlerConfig());
$app = new App(); // booted once, reused for every request

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

El modo worker es lo que ejecuta `rapira serve` por defecto, así que basta con apuntar el servidor al script; el modo clásico hay que pedirlo:

```bash
rapira serve app/worker.php
```

El resto de las opciones están en [CLI](/es/docs/cli), y sus equivalentes de `rapira.toml`, en [Configuración](/es/docs/configuration).

## Qué hace `handleRequest()`

`handleRequest(callable $handler)` es todo el contrato:

- **Bloquea** hasta que le llega una petición a este worker. Un worker que espera en `handleRequest()` no gasta CPU, y sigue teniendo en memoria su intérprete y tu aplicación ya arrancada.
- **Rellena las superglobales** —`$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` y compañía— con los datos de esa petición, recién puestos, antes de ejecutar tu handler. El código PHP de toda la vida que las lee sigue funcionando igual que con php-fpm.
- **Llama a tu handler sin ningún argumento.** Todo lo de la petición está en las superglobales; la firma del callable es `function (): void`. Lo demás que necesite —el contenedor, la aplicación, un logger— lo capturas con `use`.
- **Tu salida es la respuesta.** `echo`, `print`, `header()`, `http_response_code()`, `setcookie()`: el handler genera la respuesta igual que lo haría un script clásico. En [HTTP](/es/docs/http) tienes cómo se conectan los datos de la petición y la salida de la respuesta.
- **Devuelve `true`** cuando la petición ha terminado —o sea, sigue dando vueltas— y **`false`** cuando el servidor se está apagando. Esa es la condición del bucle: en cuanto pasa a falso, sales del bucle y dejas que el script acabe.

Así que, en modo worker, una petición es una vuelta de tu bucle `while`. Rapira cierra la petición alrededor de tu handler —se ejecutan las funciones de shutdown y los destructores, se vacían y se reinician los búferes de salida, la sesión se escribe y se cierra, y las superglobales se rellenan de nuevo para la vuelta siguiente— mientras que todo lo que tu script guarda fuera del handler se queda exactamente donde estaba.

## Un solo handler por worker

`handleRequest()` retorna después de cada petición en lugar de servir para siempre, así que lo que mantiene vivo al worker es el bucle que la rodea, y ese bucle lo tiene que poner el propio script del worker.

Por eso un script de worker maneja exactamente un handler a la vez. Si escribes dos bucles seguidos, al segundo no se llega hasta que termine el primero, y el primero solo termina cuando `handleRequest()` devuelve `false`, es decir, cuando el servidor ya se está apagando. Repartir el trabajo entre distintos caminos de código es algo que hace por dentro tu único handler, no algo que se exprese con varios bucles.

```php
while ($http->handleRequest($api)) {
}

// unreachable until shutdown
while ($http->handleRequest($web)) {
}
```

## Qué sobrevive entre peticiones

Todo lo que crees **fuera** del handler sigue vivo mientras viva el proceso del worker: el autoloader, el contenedor de DI, las rutas compiladas, la configuración, las conexiones abiertas a la base de datos y a la caché, las cachés calientes. Nada de eso se reconstruye en cada petición.

Todo lo que crees **dentro** del handler es trabajo normal de una petición y se libera cuando el handler retorna y la petición se desmonta.

Dónde cae la frontera entre esas dos cosas es una decisión de diseño del script del worker: el estado pensado para compartirse va por encima del bucle, y el que pertenece a una sola petición se queda en el handler o se reinicia antes de la siguiente.

::: warning
El estado global también se comparte, lo hayas querido o no: propiedades estáticas, singletons, registros que una biblioteca va llenando sobre la marcha, un `ini_set()` que nunca se deshace. Con php-fpm todo eso era de una sola petición porque el cierre de la petición en PHP lo reiniciaba: estáticas, globales e `ini_set()` por igual. Un worker de Rapira se salta ese reinicio entre peticiones a propósito, así que persisten. Una aplicación que no puede renunciar a su estado global se ejecuta en [modo clásico](/es/docs/classic): el modo clásico renuncia a la aplicación caliente que un worker mantiene en memoria, pero sigue siendo un reemplazo directo de php-fpm, y la aplicación podrá pasarse a un worker más adelante, cuando ese estado esté desenredado.
:::

## Elegir el plugin

`create_plugin_handler()` recibe un objeto de configuración, y es la *clase* de ese objeto la que elige el plugin. `HttpHandlerConfig` significa que este worker sirve HTTP, y a cambio recibes un `HttpHandler`.

Lanza una `Rapira\RapiraException` en dos casos: cuando ningún plugin coincide con la clase de configuración que le pasaste y cuando el script ni siquiera se está ejecutando en modo worker; el modo clásico no tiene bucle residente, así que allí un handler no podría hacer otra cosa que anunciar el apagado.

La configuración lleva además una descripción de a qué apunta, en `$http->config->info`: un `Rapira\PluginInfo` con un `name` y una `description` (`http` y `HTTP request handler` en el caso del plugin HTTP):

```php
$http = create_plugin_handler(new HttpHandlerConfig());

echo $http->config->info->name;        // http
echo $http->config->info->description; // HTTP request handler
```

## Vigilar un worker con `getInfo()`

`$http->getInfo()` devuelve un `Rapira\Plugin\Http\RuntimeInfo`: los contadores en vivo de este worker, leídos en el momento de la llamada:

| Campo      | Qué es                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------ |
| `state`    | `starting`, `idle`, `active`, `draining` o `free`: ver más abajo                            |
| `pid`      | El id de proceso de este worker                                                             |
| `queued`   | Cuántas peticiones esperan ahora mismo en la cola de entrada de este worker                 |
| `handled`  | Peticiones que este worker ha terminado                                                     |
| `errors`   | Cuántas de ellas acabaron en error                                                          |
| `recycles` | Cuántas veces este worker ha tenido que reconstruir su estado después de que PHP abortara   |
| `restarts` | Cuántas veces ha habido que reconstruir el propio hilo de PHP del worker                    |

Los cinco estados dicen en qué punto de su vida está un worker: **starting**, el proceso maestro acaba de crearlo con fork y todavía no ha dado señales; **idle**, aparcado esperando una petición y contando como capacidad de reserva; **active**, atendiendo una petición; **draining**, está de salida (se le acabó la cuota de peticiones o se le marcó como no sano) y ya no cuenta como capacidad de reserva; **free**, la plaza no tiene ningún worker asignado.

Ojo con `queued`: es la profundidad actual de la cola de entrada, no un acumulado. Y todos los contadores son de este proceso y solo de este: empiezan en cero cuando arranca el worker, así que un worker de repuesto vuelve a contar desde cero.

Con esos contadores puedes montar un pequeño endpoint de estado:

```php
$handler = static function () use ($http): void {
    $info = $http->getInfo();
    header('Content-Type: application/json');
    echo json_encode([
        'pid' => $info->pid,
        'state' => $info->state,
        'queued' => $info->queued,
        'handled' => $info->handled,
        'errors' => $info->errors,
    ]);
};
```

## Trampas habituales

**Estado que se filtra entre peticiones.** Una aplicación que se porta mal en un worker pero no con php-fpm suele estar filtrando estado entre peticiones. Un array estático que no para de crecer, un objeto de petición cacheado en un singleton, un logger que se queda con el contexto del último usuario: cada uno es un fallo que solo aparece en la segunda petición. Limpia de forma explícita al principio o al final de tu handler y reinicia todo lo que alguna biblioteca deje por ahí. `pool.max_requests` hace que el worker salga tras N peticiones para que el proceso maestro lo sustituya por uno nuevo, lo que acota el daño de una fuga lenta sin llegar a arreglarla.

**Ciclos de referencias sin recoger.** El conteo de referencias de PHP libera casi todo al instante, pero los ciclos solo se recogen cuando se ejecuta el recolector de ciclos. Llamar a `gc_collect_cycles()` una vez por vuelta del bucle —como hace el script de arriba— no es obligatorio, pero los recoge en un punto predecible: entre peticiones y no en mitad de una.

**Peticiones que no terminan nunca.** Un worker atascado en una petición colgada se queda ahí indefinidamente y mientras tanto no atiende ninguna otra. `pool.request_terminate_timeout_secs` pone un límite de tiempo real a una sola petición y mata al worker que se lo salte. Esta clave y `pool.max_requests` están en [Configuración](/es/docs/configuration), y lo que hace el proceso maestro cuando muere un worker, en [Modelo de procesos](/es/docs/process-model).

**Una excepción sin capturar afecta a la petición, no al worker.** Una excepción que se escapa de tu handler suma en `errors` y se responde con un `500`, salvo que el handler ya hubiera fijado un estado antes de lanzarla. En cualquier caso el bucle sigue, así que la excepción no se lleva al worker por delante. Un error fatal es otra cosa: desmonta el script residente, con lo que el worker vuelve a ejecutarlo desde arriba y arranca tu aplicación otra vez. Eso es justo lo que cuenta el contador `recycles`.

**Trabajo después de la respuesta.** Si quieres enviar la respuesta y seguir trabajando —vaciar una cola, escribir un apunte de auditoría—, `rapira_finish_request()` hace exactamente eso. Está documentada en la página de [HTTP](/es/docs/http).

## El stub para el IDE

Todas las clases y funciones que Rapira expone a PHP están declaradas en [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php). Es la declaración de referencia de la API —firmas, tipos de las propiedades, para qué sirve cada clase— y encima vale como stub de IDE: mételo en tu proyecto y tu editor te autocompletará `create_plugin_handler()`, `handleRequest()` y todo lo demás en lugar de marcarlos como indefinidos.
