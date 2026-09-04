---
title: Integración con frameworks
description: "La mecánica común a todos los frameworks que corren sobre Rapira: el bucle del worker, el estado por petición y el residente, el manejo de errores, los archivos estáticos y OPcache."
---

# Integración con frameworks

En modo Classic, una aplicación de framework funciona sin cambios. Configura Rapira para usar el script de entrada existente.
En modo Worker, el proceso de PHP permanece activo entre peticiones. El diseño del framework determina qué estado puede permanecer en memoria.
Esta página describe el comportamiento común. Las guías de frameworks describen solo el comportamiento específico.

::: info Verificado con

- **PHP 8.5.8**, NTS, SAPI embed
- **Rapira 0.8.0**
- **Symfony 7.4.15** y **8.1.2**, plantilla de aplicación de **Yii3** 1.4 (yii-runner-http 3.2.1)

Todo lo que cuenta esta página se observó ejecutando esas aplicaciones en Linux, con un único proceso worker. Las afirmaciones de más abajo sobre el comportamiento de los frameworks salen de esas mediciones. Las claves de configuración salen de la referencia de [configuración](/es/docs/configuration) de Rapira.
:::

## Modos Classic y Worker

**El modo Classic usa el script de entrada existente.** Inicia una petición PHP nueva para cada petición HTTP.
Un framework que funciona con php-fpm también funciona en este modo. Consulta [modo Classic](/es/docs/classic) para obtener más información.
Las secciones de archivos estáticos, TLS y OPcache también se aplican al modo Classic.

**El modo Worker mantiene activo el proceso.** El script inicia la aplicación y solicita trabajo en un bucle.
El estado de la aplicación permanece entre peticiones. Consulta [modos de ejecución](/es/docs/execution-modes) y [modo Worker](/es/docs/worker).

Un código base puede usar ambos modos. Conserva `public/index.php`. Añade `worker.php` junto a él.
Usa `--mode` para seleccionar el modo de ejecución. Selecciona el script con el argumento `SCRIPT` o con `pool.entrypoint`.
Usa el modo Classic si falla la migración al modo Worker.

## Bucle de Worker

Cada framework usa la misma estructura básica de script de worker:

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

El script contiene estas operaciones:

- **`require .../vendor/autoload.php`** registra el autoloader durante la vida del worker. Las clases cargadas permanecen disponibles.
- **`$app = new App();`** inicia la aplicación antes del bucle. Symfony conserva aquí un kernel persistente.
- Yii3 puede conservar un runner o crear uno dentro del handler. Cada guía muestra la inicialización y la limpieza necesarias.
- **`$handler = static function () use ($app): void`** define un handler sin argumentos. El handler lee la petición de las superglobales.
- Captura otras dependencias con `use`.
- **`header()`, `http_response_code()` y `echo`** crean una respuesta como en un script clásico. Consulta [HTTP](/es/docs/http).
- **`while (\Rapira\handle_request($handler))`** espera una petición. `handle_request()` rellena las superglobales, ejecuta el handler y completa la petición.
- Devuelve `true` después de una petición y `false` durante la parada. Llámala solo desde el bucle de nivel superior.
- Fuera del modo Worker, lanza `Rapira\Exception\NotInWorkerModeError`.
- **`gc_collect_cycles();`** se ejecuta entre peticiones y recoge ciclos de referencias. No corrige las fugas de memoria.
- Consulta [Memoria y reciclaje](#memoria-y-reciclaje).

Rapira establece `SCRIPT_NAME` en `/worker.php` porque es el script de entrada.
`DOCUMENT_ROOT` contiene el directorio del script. `REQUEST_URI` contiene la ruta del cliente.
Symfony y Yii3 generaron rutas y URL correctas con estos valores. Las URL no contenían `worker.php`.
Antes de integrar otro framework, comprueba si crea URL desde `SCRIPT_NAME` en lugar de `REQUEST_URI`.

## Estado por petición y estado residente

Rapira reconstruye en cada petición todo lo de la columna izquierda, así que el código PHP de toda la vida que lo lee sigue funcionando. Todo lo de la columna derecha persiste durante toda la vida del worker y lo tiene que gestionar el script del worker.

| Nuevo en cada petición | Sobrevive a cada petición |
| ---------------------- | ------------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` - rellenadas con los datos de esta petición | El autoloader de Composer, y todas las clases ya cargadas a través de él |
| `php://input` - el cuerpo crudo de esta petición, con `CONTENT_TYPE` y `CONTENT_LENGTH` al lado | Las propiedades y variables `static`, que siguen contando de una petición a otra |
| `$_FILES`, y los archivos temporales subidos que hay detrás | Los objetos creados antes del bucle - el contenedor, el kernel, tu aplicación |
| La fontanería de la sesión: `session_start()`, la cookie que entra, el `Set-Cookie` que sale | Los recursos abiertos: conexiones a la base de datos, clientes de caché, streams |
| El estado de la respuesta: código de estado, cabeceras, `setcookie()`, los búferes de salida | El proceso mismo - el mismo pid, un intérprete de PHP residente por worker |
| Las funciones de shutdown registradas **dentro** del handler | Los contadores del propio worker: `handled` y `errors` siguen incrementándose |
| El reloj de `max_execution_time`, rearmado en cada petición | |

En Linux (y FreeBSD), donde existe el temporizador por petición de Zend, el reloj de `max_execution_time` se rearma en cada petición y el rato que el worker pasa aparcado esperando la siguiente nunca le cuenta: en el reloj solo está la petición en sí. En el resto de sistemas, macOS incluido, no se arma ningún límite por petición.

Los tres comportamientos de abajo se aplican a un worker residente.

::: warning Un objeto residente mantiene su estado entre peticiones

PHP no llama al destructor de un objeto residente al final de una petición. Lo llama una sola vez, cuando termina el ciclo del worker o cuando el código elimina la última referencia.

No uses un destructor para la limpieza de cada petición. Reinicia dentro del handler el estado de cada petición.
:::

::: warning Una función de shutdown registrada en el arranque se ejecuta una vez, al salir el worker

PHP ejecuta una función de shutdown registrada fuera del handler una sola vez, al final del ciclo del worker. Una función registrada dentro del handler se ejecuta al final de esa petición.

Registra dentro del handler las funciones de shutdown de cada petición. Algunos ejemplos son el volcado de métricas, el tratamiento de un error fatal y la liberación de los recursos de la petición.
:::

::: warning PHP puede volver a importar `$_ENV` durante una petición

Con los ajustes ini predeterminados, PHP reinicia el indicador JIT de `$_ENV` para cada petición.
El primer archivo nuevo compilado que usa `$_ENV` hace que PHP vuelva a crear la superglobal.
Sin `E` en `variables_order`, PHP no importa valores. Por tanto, `$_ENV` queda **vacía** sin mostrar un diagnóstico.
Esto elimina los valores que Dotenv escribió en `$_ENV` durante la inicialización.

El efecto depende del momento de compilación. La configuración procesada durante la inicialización puede usar los valores antes de que PHP vacíe `$_ENV`.
La configuración procesada en la primera petición puede leer un `$_ENV` vacío. Esta diferencia puede causar fallos específicos de un entorno.

Hay dos alternativas. Escribe los valores en el entorno del proceso con `putenv()`.
La nueva importación conserva estos valores y el framework puede leerlos con `getenv()`.
En producción, define las variables de entorno en la unidad de servicio o el contenedor. No proceses `.env` durante las peticiones.
Con `variables_order = "GPCS"`, ninguna alternativa rellena `$_ENV`. Consulta un ejemplo en la [guía de Symfony](/es/docs/frameworks/symfony).

Le pasa a cualquier runtime de PHP que mantenga el proceso vivo entre peticiones.
:::

## Manejo de errores

Las pruebas confirmaron tres tipos de fallo con un worker:

- **`exit` o `die` dentro del handler** envía el estado y la salida actuales. El worker continúa aceptando peticiones.
- Un framework puede usar `exit` para una respuesta de mantenimiento sin terminar el proceso.
- **Una excepción sin capturar** devuelve `500`. El manejador del framework puede devolver su página de error.
- Sin este manejador, Rapira devuelve un cuerpo vacío. El worker continúa aceptando peticiones.
- **Un `Error` sin capturar** también devuelve `500`, y el worker continúa. PHP registra `Uncaught Error`.

El contador `errors` aumenta en los dos casos de error. Una petición con `exit` devuelve `200` y solo cambia `handled`.
En los tres casos, `recycles` y `restarts` permanecen en cero. Un throwable sin capturar no detiene el worker ni afecta a la siguiente petición.
Un error fatal de tipo bailout termina el script persistente. El worker vuelve a iniciar el script y la aplicación.
Esta acción aumenta `recycles`. Consulta estos contadores en [modelo de procesos](/es/docs/process-model).

## Archivos estáticos

Rapira sirve los archivos estáticos con el [middleware de archivos estáticos](/es/docs/static-files). Apunta la clave `root` de `[http.static]` al directorio `public/` del framework y nombra el middleware en `[http]`:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

El middleware solo responde a una petición cuando la ruta coincide con un archivo que hay bajo esa raíz. Su lista `forbid` de fábrica deja fuera los archivos `.php`, así que el script de entrada de `public/` no se sirve nunca como archivo. Cualquier otra URL ejecuta el script de entrada, igual en modo Classic que en modo Worker, y `$_SERVER['REQUEST_URI']` le dice a la aplicación adónde quería ir el cliente. La URL de un directorio también ejecuta el script de entrada, porque el middleware no sirve ningún archivo de índice.

Una CDN o un proxy inverso por delante también pueden servir esos archivos en su lugar. La [puesta en producción](/es/docs/deployment) monta un proxy de esos.

## TLS y proxies

El listener de Rapira habla HTTP en claro y en la configuración no hay ninguna sección de TLS. Termina el TLS en el proxy que ya tienes y deja que llegue a Rapira por loopback o por un socket Unix. El proxy debe escribir los campos reenviados con `-` y jamás con `_`, porque las dos grafías acaban en la misma clave de `$_SERVER`. Consulta [HTTP](/es/docs/http) para esa correspondencia y la [puesta en producción](/es/docs/deployment) para la configuración del proxy.

## Memoria y reciclaje

Un worker puede crear la aplicación dentro del handler. Este diseño conserva la aplicación durante una petición.
Conserva menos estado que un kernel persistente de Symfony, pero más que el modo Classic.
El bucle permanece en el script del worker. Mueve la inicialización fuera del handler solo después de comprobar el estado persistente.
Este diseño crea el contenedor después de recibir la petición.

Cada petición de este diseño crea un grafo de objetos. Los ciclos de referencias pueden conservar grafos antiguos hasta que se ejecuta el recolector.
El uso de memoria aumenta durante varias peticiones y disminuye cuando PHP libera varios grafos. Este uso cíclico no siempre es una fuga.
Sin embargo, el uso máximo puede ser mucho mayor que el de una petición.

Las pruebas mostraron que `gc_collect_cycles()` no evita este comportamiento en el bucle ni en el handler.
Una inicialización posterior puede conservar referencias a grafos antiguos. El recolector no puede liberar un grafo mientras otro objeto lo referencia.
Establece `memory_limit` por encima del máximo medido. También establece un límite de sustitución:

```toml
[pool]
max_requests = 100
```

El maestro sustituye un worker después del límite de peticiones. Rapira modifica ligeramente el límite para evitar sustituciones simultáneas.
Las pruebas enviaron cientos de peticiones durante varias sustituciones. La memoria volvió a su nivel inicial y cada petición devolvió `200`.
Este ajuste establece un límite predecible para el uso de memoria.

Las formas residentes -el kernel de Symfony, el contenedor de Yii3 detrás de `StateResetter`- son planas en comparación: en las mismas pruebas la memoria se mantuvo estable. Mantén el reciclaje activado también para ellas, como salvaguarda. Consulta [configuración](/es/docs/configuration) para la clave y [modelo de procesos](/es/docs/process-model) para lo que el reciclaje le hace al pool.

## OPcache y el código que cambia

Rapira inicia PHP una vez en el maestro antes de crear workers. OPcache crea un segmento de memoria compartida.
Cada worker hereda el mismo mapa. Los scripts compilados permanecen en caché entre peticiones y workers en ambos modos.

En producción, `opcache.validate_timestamps = 0` elimina el stat por archivo de cada petición. Con este ajuste, nada invalida la caché. El segmento pertenece al maestro y sobrevive a todas las generaciones de workers. Por tanto, una recarga progresiva sigue sirviendo los opcodes antiguos y un despliegue requiere un reinicio completo. Consulta la [puesta en producción](/es/docs/deployment) para ver la secuencia.

Durante el desarrollo, una aplicación persistente no vuelve a leer su código de inicialización. Este comportamiento no depende de OPcache.
Reinicia el servidor después de cambiar el script del worker o los servicios iniciados. Pulsa Ctrl-C y vuelve a ejecutar `rapira serve`.

## Guías de frameworks

- **[Symfony](/es/docs/frameworks/symfony)** - el kernel arranca una vez y se queda residente, y el propio `services_resetter` del framework deja entre peticiones los servicios con estado tal y como los encontró. Un único archivo de worker vale para 7.4 y 8.1, byte a byte.
- **[Laravel](/es/docs/frameworks/laravel)** - modo Classic: el `public/index.php` de serie funciona sin tocar nada. El modo Worker para Laravel está en desarrollo: una aplicación de Laravel residente necesita el desmontaje de estado que implementa Octane, y Rapira todavía no tiene driver de Octane.
- **[Yii3](/es/docs/frameworks/yii3)** - `StateResetter` reinicia un contenedor persistente después de cada petición. Como alternativa, el worker puede crear un runner para cada petición.

Otros frameworks pueden usar el mismo script básico. Usa el modo Worker solo si la aplicación procesa varias peticiones en un proceso.
Primero, crea la aplicación dentro del handler. Este diseño no requiere soporte del framework para procesos persistentes.
Después de comprobarlo, conserva la aplicación y reinicia su estado. Usa el [modo Classic](/es/docs/classic) si no funciona ningún diseño Worker.
