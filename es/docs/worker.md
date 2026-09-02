---
title: Modo Worker
description: "Cómo escribir un script de worker de Rapira: el bucle residente, el contrato de handle_request(), qué sobrevive entre peticiones y las trampas más habituales."
faqLevel: 2
---

# Modo Worker

El modo Worker mantiene vivo el proceso de PHP de una petición a otra: tu script arranca la aplicación una vez y luego se queda en un bucle pidiéndole a Rapira la siguiente petición. El arranque ocurre una sola vez, al iniciar, y a partir de ahí cada petición empieza con la aplicación ya caliente en memoria. El estado también sobrevive a la petición, así que el script del worker tiene que gestionarlo.

En [modo Classic](/es/docs/classic), el script de entrada se ejecuta desde cero en cada petición. Todo lo que haya construido se descarta al responder. El autoloader, el contenedor, la configuración, las rutas y las conexiones a la base de datos se inician para cada petición.

Esta página es la guía de programación del modo Worker. El modo Worker no exige ningún framework concreto, solo una aplicación que aguante arrancar una vez y atender muchas peticiones después, algo que la mayoría de los frameworks modernos hacen. En [Modos de ejecución](/es/docs/execution-modes) tienes los tres modos y qué determina cuál puede usar una aplicación, y en [Frameworks](/es/docs/frameworks/), las guías de frameworks concretos.

## El bucle residente

Un script de worker tiene tres partes: todo lo que arranques al principio, un handler que responde a una petición y un bucle que ejecuta ese handler hasta que el worker se drena. El bucle lo escribes tú en PHP, alrededor de la función `\Rapira\handle_request()`.

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // booted once, reused for every request

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

El modo por defecto es Dispatcher. Hay dos maneras de seleccionar el modo Worker, y las dos hacen lo mismo:

- `--mode worker` en la línea de comandos, junto al script de entrada.
- `mode = "worker"` en la sección `[pool]` de un `rapira.toml`.

```bash
rapira serve --mode worker app/worker.php
```

El resto de las opciones están en [CLI](/es/docs/cli), y sus equivalentes de `rapira.toml`, en [Configuración](/es/docs/configuration).

## El contrato de `handle_request()`

`\Rapira\handle_request(callable $handler): bool` es todo el contrato:

- **Bloquea** hasta que le llega una petición a este worker. Un worker que espera en `handle_request()` no gasta CPU, y sigue teniendo en memoria su intérprete y tu aplicación ya arrancada.
- **Rellena las superglobales** —`$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` y compañía— con los datos de esa petición, recién puestos, antes de ejecutar tu handler. El código PHP de toda la vida que las lee sigue funcionando igual que con php-fpm.
- **Llama a tu handler sin ningún argumento.** Todo lo de la petición está en las superglobales; la firma del callable es `function (): void`. Lo demás que necesite —el contenedor, la aplicación, un logger— lo capturas con `use`.
- **Tu salida es la respuesta.** `echo`, `print`, `header()`, `http_response_code()`, `setcookie()`: el handler genera la respuesta igual que lo haría un script clásico. En [HTTP](/es/docs/http) tienes cómo se conectan los datos de la petición y la salida de la respuesta.
- **Devuelve `true`** cuando la petición ha terminado —o sea, sigue dando vueltas— y **`false`** cuando el worker se está drenando. Esa es la condición del bucle: en cuanto pasa a falso, sales del bucle y dejas que el script acabe.
- **Va en el nivel superior del script de arranque.** Llámala desde el bucle del propio script y desde ningún otro sitio: una llamada desde una función de shutdown o desde un destructor tiene un comportamiento indefinido.

Así que, en modo Worker, una petición es una vuelta de tu bucle `while`. Rapira cierra la petición alrededor de tu handler: se ejecutan las funciones de shutdown que registró esa petición, se vacían y se reinician los búferes de salida, la sesión se escribe y se cierra, y las superglobales se rellenan de nuevo para la vuelta siguiente. Todo lo que tu script guarda fuera del handler se queda exactamente donde estaba. Rapira no hace ninguna pasada de destructores al terminar una petición: un objeto se destruye cuando desaparece la última referencia que lo apuntaba.

## Un solo handler por worker

`handle_request()` retorna después de cada petición en lugar de servir para siempre, así que lo que mantiene vivo al worker es el bucle que la rodea, y ese bucle lo tiene que poner el propio script del worker.

Por eso un script de worker maneja exactamente un handler a la vez. Si escribes dos bucles seguidos, al segundo no se llega hasta que termine el primero, y el primero solo termina cuando `handle_request()` devuelve `false`, es decir, cuando el worker ya se está drenando. Repartir el trabajo entre distintos caminos de código es algo que hace por dentro tu único handler, no algo que se exprese con varios bucles.

```php
while (\Rapira\handle_request($api)) {
}

// unreachable until shutdown
while (\Rapira\handle_request($web)) {
}
```

## Qué sobrevive entre peticiones

Todo lo que crees **fuera** del handler sigue vivo mientras viva el proceso del worker: el autoloader, el contenedor de DI, las rutas compiladas, la configuración, las conexiones abiertas a la base de datos y a la caché, las cachés calientes. Nada de eso se reconstruye en cada petición.

Todo lo que crees **dentro** del handler es trabajo normal de una petición y se libera cuando el handler retorna y desaparece la última referencia que lo apuntaba.

Dónde cae la frontera entre esas dos cosas es una decisión de diseño del script del worker: el estado pensado para compartirse va por encima del bucle, y el que pertenece a una sola petición se queda en el handler o se reinicia antes de la siguiente.

::: warning
El estado global también se comparte, lo hayas querido o no: propiedades estáticas, singletons, registros que una biblioteca va llenando sobre la marcha, un `ini_set()` que nunca se deshace. Con php-fpm todo eso era de una sola petición porque el cierre de la petición en PHP lo reiniciaba: estáticas, globales e `ini_set()` por igual. Un worker de Rapira se salta ese reinicio entre peticiones a propósito, así que persisten. Una aplicación que no puede renunciar a su estado global se ejecuta en [modo Classic](/es/docs/classic): el modo Classic renuncia a la aplicación caliente que un worker mantiene en memoria, pero sigue siendo un reemplazo directo de php-fpm, y la aplicación podrá pasarse a un worker más adelante, cuando ese estado esté desenredado.
:::

## Funciones de shutdown

Una función de shutdown que el script registra durante el arranque, fuera del bucle, se ejecuta una sola vez: cuando termina el ciclo del worker (normalmente, cuando el worker sale). No se ejecuta al final de cada petición. Una función de shutdown que tu handler registra durante una petición se ejecuta al final de esa petición, una vez, y no vuelve a ejecutarse.

Registra en el arranque la limpieza de los recursos de todo el proceso, y dentro del handler la de los recursos de una sola petición.

```php
register_shutdown_function(static function (): void {
    // runs once, when the worker's cycle ends
});

$handler = static function (): void {
    register_shutdown_function(static function (): void {
        // runs at the end of this request
    });
};

while (\Rapira\handle_request($handler)) {
}
```

Al final del ciclo se ejecutan primero los registros del arranque, en el orden en que se hicieron. Una función que el script registre después del bucle se ejecuta detrás de ellas.

Con los objetos la regla es otra. Rapira no hace ninguna pasada de destructores al terminar una petición: un objeto se destruye cuando desaparece la última referencia que lo apuntaba, así que un objeto que solo guarda una variable local del handler se destruye cuando el handler retorna. Un objeto que guarda una variable global del arranque se queda en memoria de una petición a otra, y su `__destruct()` se ejecuta una vez, al terminar el ciclo.

::: question ¿Por qué una función de shutdown registrada en el arranque no se ejecuta al final de la primera petición?
En PHP, la lista de funciones de shutdown es estado de la petición: la pasada de cierre de la petición llama a las funciones de la lista y después libera la lista. En la primera llamada a `handle_request()`, Rapira saca de esa lista los registros del arranque y se los queda, así que cada petición cierra con una lista que solo contiene sus propios registros. Al final del ciclo, Rapira devuelve la lista del arranque a su sitio y le añade lo que el script haya registrado después del bucle, de modo que la pasada de cierre final ejecuta las entradas del arranque en el orden en que se registraron y las posteriores detrás.
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

## Trampas habituales

**Estado que se filtra entre peticiones.** Una aplicación que se porta mal en un worker pero no con php-fpm suele estar filtrando estado entre peticiones. Un array estático que no para de crecer, un objeto de petición cacheado en un singleton, un logger que se queda con el contexto del último usuario: cada uno es un fallo que solo aparece en la segunda petición. Limpia de forma explícita al principio o al final de tu handler y reinicia todo lo que alguna biblioteca deje por ahí. `pool.max_requests` hace que el worker salga tras N peticiones para que el proceso maestro lo sustituya por uno nuevo, lo que acota el daño de una fuga lenta sin llegar a arreglarla.

**Ciclos de referencias sin recoger.** El conteo de referencias de PHP libera casi todo al instante, pero los ciclos solo se recogen cuando se ejecuta el recolector de ciclos. Llamar a `gc_collect_cycles()` una vez por vuelta del bucle —como hace el script de arriba— no es obligatorio, pero los recoge en un punto predecible: entre peticiones y no en mitad de una.

**Peticiones que no terminan nunca.** Un worker atascado en una petición colgada se queda ahí indefinidamente y mientras tanto no atiende ninguna otra. `pool.request_terminate_timeout_secs` pone un límite de tiempo real a una sola petición y mata al worker que se lo salte. Esta clave y `pool.max_requests` están en [Configuración](/es/docs/configuration), y lo que hace el proceso maestro cuando muere un worker, en [Modelo de procesos](/es/docs/process-model).

**Una excepción sin capturar afecta a la petición, no al worker.** Una excepción que se escapa de tu handler se responde con un `500`, salvo que el handler ya hubiera mandado la cabecera de la respuesta antes de lanzarla. En cualquier caso el bucle sigue, así que la excepción no se lleva al worker por delante. Un error fatal es otra cosa: desmonta el script residente, con lo que el worker vuelve a ejecutarlo desde arriba y arranca tu aplicación otra vez.

**Trabajo después de la respuesta.** Si quieres enviar la respuesta y seguir trabajando —vaciar una cola, escribir un apunte de auditoría—, `rapira_finish_request()` hace exactamente eso. Está documentada en la página de [HTTP](/es/docs/http).

## Los stubs para el IDE

Rapira declara en archivos de stubs, dentro de `crates/php_sys`, las funciones y las clases que expone a PHP. La superficie del worker está en [`rapira.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira.stub.php), y las clases de excepción, en [`rapira_exception.stub.php`](https://github.com/rapira-rs/rapira/blob/main/crates/php_sys/rapira_exception.stub.php). Son la declaración de referencia de la API —firmas, tipos de las propiedades y para qué sirve cada clase— y encima valen como stubs de IDE: mételos en tu proyecto y tu editor te autocompletará `\Rapira\handle_request()`, `\Rapira\get_mode()` y todo lo demás en lugar de marcarlos como indefinidos.
