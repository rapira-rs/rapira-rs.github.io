---
title: Modo worker
description: "La guía de programación del worker residente de Rapira: arranca tu aplicación una sola vez, recorre las peticiones en bucle con handleRequest() y ten claro qué sobrevive entre una y otra."
---

# Modo worker

En [modo clásico](/es/docs/classic) PHP hace lo de siempre: el script de entrada se ejecuta desde cero, se responde a la petición y todo lo que el script haya construido se tira a la basura. Arrancar un framework moderno —autoloader, contenedor, configuración, rutas, conexiones a la base de datos— cuesta lo mismo en la primera petición que en la millonésima.

El modo worker es la alternativa. El proceso sigue vivo: tu script arranca la aplicación una vez y se queda en un bucle pidiéndole a Rapira la siguiente petición. El arranque se paga al inicio y, a partir de ahí, cada petición empieza con la aplicación ya caliente en memoria. A cambio, te toca pensar en el estado, porque ahora sobrevive a la petición.

Este es el peldaño **SAPI Worker** de la escalera de ejecución de Rapira y, junto con Classic, es lo que hay disponible hoy. En [Modos de ejecución](/es/docs/execution-modes) tienes la escalera entera y cómo saber qué peldaño puede usar tu aplicación; esta página es la guía de programación del peldaño que ya puedes usar.

## El bucle residente

Un script de worker tiene tres partes: todo lo que arranques al principio, un handler que responde a una petición y un bucle que ejecuta ese handler hasta que el servidor se apaga. El bucle lo escribes tú en PHP: Rapira te da un objeto handler y tú lo manejas.

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

Apunta el servidor a ese archivo y listo: el modo worker es lo que hace `rapira serve` por defecto, y el clásico hay que pedirlo:

```bash
rapira serve app/worker.php
```

El resto de las opciones están en [CLI](/es/docs/cli), y sus equivalentes de `rapira.toml`, en [Configuración](/es/docs/configuration).

## Qué hace `handleRequest()`

`handleRequest(callable $handler)` es todo el contrato:

- **Bloquea** hasta que le llega una petición a este worker. Un worker aparcado en `handleRequest()` no gasta CPU mientras espera, pero sigue teniendo en memoria su intérprete y tu aplicación ya arrancada.
- **Rellena las superglobales** —`$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` y compañía— con los datos de esa petición, recién puestos, antes de ejecutar tu handler. El código PHP de toda la vida que las lee sigue funcionando igual que con php-fpm.
- **Llama a tu handler sin ningún argumento.** Todo lo de la petición está en las superglobales; la firma del callable es `function (): void`. Lo demás que necesite —el contenedor, la aplicación, un logger— lo capturas con `use`.
- **Tu salida es la respuesta.** `echo`, `print`, `header()`, `http_response_code()`, `setcookie()`: el handler genera la respuesta igual que lo haría un script clásico. En [HTTP](/es/docs/http) tienes cómo se conectan los datos de la petición y la salida de la respuesta.
- **Devuelve `true`** cuando la petición ha terminado —o sea, sigue dando vueltas— y **`false`** cuando el servidor se está apagando. Esa es la condición del bucle: en cuanto pasa a falso, sales del bucle y dejas que el script acabe.

Así que, en modo worker, una petición es una vuelta de tu bucle `while`. Rapira cierra la petición alrededor de tu handler —se ejecutan las funciones de shutdown y los destructores, se vacían y se reinician los búferes de salida, la sesión se escribe y se cierra, y las superglobales se rellenan de nuevo para la vuelta siguiente— mientras que todo lo que tu script guarda fuera del handler se queda exactamente donde estaba.

## Un handler, un worker

`handleRequest()` retorna después de cada petición, sin excepción. No es una llamada de tipo «sirve para siempre»: lo que mantiene vivo al worker es el bucle que la rodea, y ese bucle es tuyo.

La consecuencia pilla a más de uno: un script de worker maneja exactamente un handler a la vez. Si escribes dos bucles seguidos, al segundo no se llega hasta que termine el primero, y el primero solo termina cuando `handleRequest()` devuelve `false`, es decir, cuando el servidor ya se está apagando. Repartir el trabajo entre distintos caminos de código es algo que hace por dentro tu único handler, no algo que se exprese con varios bucles.

```php
while ($http->handleRequest($api)) {
}

// unreachable until shutdown
while ($http->handleRequest($web)) {
}
```

## Qué sobrevive entre peticiones

Todo lo que crees **fuera** del handler sigue vivo mientras viva el proceso del worker: el autoloader, el contenedor de DI, las rutas compiladas, la configuración, las conexiones abiertas a la base de datos y a la caché, las cachés calientes. En eso consiste el modo worker: es el coste que dejas de pagar en cada petición.

Todo lo que crees **dentro** del handler es trabajo normal de una petición y se libera cuando el handler retorna y la petición se desmonta.

Dónde pones la frontera entre esas dos cosas es la decisión de diseño que te pide el modo worker. El estado pensado para compartirse va arriba; el que pertenece a una sola petición se queda en el handler, o se reinicia antes de la siguiente.

::: warning
Todo lo global también se comparte, lo hayas querido o no: propiedades estáticas, singletons, registros que una biblioteca va llenando sobre la marcha, un `ini_set()` que nunca deshaces. Con php-fpm todo eso era de una sola petición porque el cierre de la petición en PHP lo reiniciaba: estáticas, globales e `ini_set()` por igual. Un worker de Rapira se salta ese reinicio entre trabajos a propósito, así que ya no lo es.
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

Los cinco estados dicen en qué punto de su vida está un worker: **starting**, el proceso maestro acaba de crearlo con fork y todavía no ha dado señales; **idle**, aparcado esperando una petición y contando como capacidad de reserva; **active**, atendiendo una petición; **draining**, ha decidido salir (se le acabó la cuota de peticiones o se le marcó como no sano) y ya no cuenta como capacidad de reserva; **free**, la plaza no tiene ningún worker asignado.

Ojo con `queued`: es la profundidad actual de la cola de entrada, no un acumulado. Y todos los contadores son de este proceso y solo de este: empiezan en cero cuando arranca el worker, así que un worker de repuesto vuelve a contar desde cero.

El uso más natural es un pequeño endpoint de estado:

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

**Estado que se filtra entre peticiones.** Esta es la gorda, y casi siempre es la razón de que una aplicación se porte mal en un worker y no con php-fpm. Un array estático que no para de crecer, un objeto de petición cacheado en un singleton, un logger que se queda con el contexto del último usuario: cada uno es un fallo que solo aparece en la segunda petición. Limpia de forma explícita al principio o al final de tu handler y reinicia todo lo que alguna biblioteca deje por ahí. Como red de seguridad, `pool.max_requests` hace que el worker salga tras N peticiones para que el proceso maestro lo sustituya por uno nuevo; eso acota el daño de una fuga lenta, pero es una red, no un arreglo.

**Basura que no es de ninguna petición.** El conteo de referencias de PHP libera casi todo al instante, pero los ciclos solo se recogen cuando se ejecuta el recolector de ciclos. Llamar a `gc_collect_cycles()` una vez por vuelta del bucle —como hace el script canónico— los recoge en un punto predecible: entre peticiones y no en mitad de una.

**Peticiones que no acaban nunca.** Un worker residente se queda indefinidamente dentro de una petición colgada, y mientras tanto no atiende a nadie. `pool.request_terminate_timeout_secs` pone un límite de tiempo real a una sola petición y mata al worker que se lo salte. Las dos claves están en [Configuración](/es/docs/configuration), y lo que hace el proceso maestro cuando muere un worker, en [Modelo de procesos](/es/docs/process-model).

**Una excepción sin capturar afecta a la petición, no al worker.** Una excepción que se escapa de tu handler suma en `errors` y se responde con un `500`, salvo que el handler ya hubiera fijado un estado antes de lanzarla. En cualquier caso el bucle sigue: la excepción no se lleva al worker por delante, así que el fallo que estás leyendo en los registros no tiene por qué haber parado nada. Un error fatal es otra cosa: desmonta el script residente, con lo que el worker vuelve a ejecutarlo desde arriba y arranca tu aplicación otra vez. Eso es justo lo que cuenta el contador `recycles`.

**Trabajo después de la respuesta.** Si quieres enviar la respuesta y seguir trabajando —vaciar una cola, escribir un apunte de auditoría—, `rapira_finish_request()` hace exactamente eso. Está documentada en la página de [HTTP](/es/docs/http).

## El stub para el IDE

Todas las clases y funciones que Rapira expone a PHP están declaradas en [`crates/php_sys/rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php). Es la declaración de referencia de la API —firmas, tipos de las propiedades, para qué sirve cada clase— y encima vale como stub de IDE: mételo en tu proyecto y tu editor te autocompletará `create_plugin_handler()`, `handleRequest()` y todo lo demás en lugar de marcarlos como indefinidos.

::: question ¿Necesito un framework especial para trabajar en modo worker?
No. Lo que necesitas es una aplicación que aguante arrancar una vez y atender muchas peticiones después. Casi todos los frameworks modernos pueden hacerlo, y en las [guías de frameworks](/es/docs/frameworks/) tienes los detalles de los que ya hemos documentado.
:::

::: question ¿Es obligatorio el `gc_collect_cycles()` del bucle?
Obligatorio no, pero es un buen valor por defecto. Sin él, los ciclos de referencias se van acumulando hasta que al recolector de PHP le da por ejecutarse solo, quizá en mitad de una petición. Llamarlo entre peticiones mantiene ese trabajo en un punto predecible.
:::

::: question Mi aplicación tiene estado global del que no puede prescindir. ¿Puedo usar Rapira igualmente?
Sí: ejecútala en [modo clásico](/es/docs/classic). Pierdes el arranque caliente que da un worker, pero conservas el reemplazo directo de php-fpm y siempre puedes pasarte a un worker más adelante, cuando hayas desenredado ese estado.
:::
