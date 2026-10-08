---
title: Integración con frameworks
description: "Bucles de worker de frameworks, estado de petición, estado persistente, manejo de errores, archivos estáticos y OPcache."
---

# Integración con frameworks

En modo Classic, una aplicación de framework funciona sin cambios. Configura Rapira para usar el script de entrada existente. En modo Worker, el proceso de PHP permanece activo entre peticiones. El diseño del framework determina qué estado de la aplicación puede permanecer en memoria. Esta página describe las reglas para todos los frameworks. Las guías de frameworks describen solo el comportamiento específico de cada framework.

::: info Verificado con

- **PHP 8.5.8**, NTS, SAPI embed
- **Rapira 0.8.0**
- **Symfony 7.4.15** y **8.1.2**, plantilla de aplicación de **Yii3** 1.4 (yii-runner-http 3.2.1)

Las pruebas ejecutaron estas aplicaciones en Linux con un proceso worker. Las afirmaciones sobre los frameworks de esta página proceden de estas pruebas. Los ejemplos de esta página usan el formato de configuración de v0.9. Consulta [configuración](/es/docs/configuration) para ver los ajustes de Rapira.
:::

## Modos Classic y Worker

**El modo Classic usa el script de entrada existente.** Inicia una petición PHP nueva para cada petición HTTP. Un framework que funciona con php-fpm también puede funcionar en este modo. Consulta [modo Classic](/es/docs/classic) para obtener más información. Solo las secciones de archivos estáticos, TLS y OPcache que aparecen a continuación se aplican al modo Classic.

**El modo Worker mantiene activo el proceso.** El script inicia la aplicación y solicita trabajo en un bucle. El estado de la aplicación permanece entre peticiones. Consulta [modos de ejecución](/es/docs/execution-modes) y [modo Worker](/es/docs/worker) para obtener más información.

Un código base puede usar ambos modos. Conserva `public/index.php`. Añade `worker.php` a la raíz del proyecto. `http.pool.mode` selecciona el modo de ejecución y `http.pool.entrypoint` selecciona el script. El modo Classic sigue disponible si falla la migración al modo Worker.

Cada worker usa el directorio de su script de entrada como directorio de trabajo. Por tanto, las rutas de archivo relativas en `worker.php` se resuelven respecto a la raíz del proyecto. Las rutas de archivo relativas en `public/index.php` se resuelven respecto a `public/`. Una llamada a `chdir()` en el código PHP permanece en vigor hasta que el proceso worker termina.

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

- **`require .../vendor/autoload.php`** registra el autoloader. El autoloader y las clases cargadas permanecen disponibles hasta que el script del worker se reinicia.
- **`$app = new App();`** inicia la aplicación antes del bucle. Symfony conserva aquí un kernel persistente. Yii3 puede conservar un runner persistente o crear un runner dentro del handler. Cada guía muestra la inicialización y la limpieza de la petición.
- **`$handler = static function () use ($app): void`** define un handler sin argumentos. El handler lee los datos de la petición de las superglobales. Obtiene otras dependencias mediante `use`.
- **`header()`, `http_response_code()` y `echo`** crean la respuesta como en un script clásico. Consulta [HTTP](/es/docs/http) para ver la transmisión de la respuesta.
- **`while (\Rapira\handle_request($handler))`** espera una petición. `handle_request()` rellena las superglobales, ejecuta el handler y completa la petición. Devuelve `true` después de una petición y `false` cuando el worker se detiene. Llámala solo desde el bucle de nivel superior del script. Fuera del modo Worker, lanza `Rapira\Exception\NotInWorkerModeError`.
- **`gc_collect_cycles();`** recoge los ciclos de referencias entre peticiones. No corrige las fugas de memoria. Consulta [Memoria y reciclaje](#memoria-y-reciclaje).

Dentro del handler, Rapira establece `SCRIPT_NAME` en `/worker.php` porque `worker.php` es el script de entrada. `DOCUMENT_ROOT` contiene el directorio del script. `REQUEST_URI` contiene la ruta del cliente. Symfony y Yii3 enrutaron las peticiones y generaron URL correctas con estos valores. Las URL generadas no contenían `worker.php`. Antes de integrar otro framework, comprueba si crea URL desde `SCRIPT_NAME` en lugar de `REQUEST_URI`.

Antes de la primera petición, `$_SERVER` contiene el entorno del proceso. En ese momento, `SCRIPT_NAME` contiene la ruta absoluta del script y `DOCUMENT_ROOT` está vacío. El `$_SERVER` de una petición no contiene el entorno del proceso. Lee las variables de entorno antes del bucle o usa `getenv()` en el handler. No calcules un prefijo de URL desde `$_SERVER` antes del bucle. Consulta [`$_SERVER` antes de la primera petición](/es/docs/execution-modes#server-antes-de-la-primera-peticion).

## Estado por petición y estado residente

Rapira reconstruye todo lo de la columna izquierda para cada petición. El código PHP normal puede seguir leyendo estos valores. Todo lo de la columna derecha permanece entre peticiones. El script del worker debe gestionar este estado.

| Nuevo para cada petición | Permanece entre peticiones |
| ------------------------ | ------------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE`: Rapira las rellena con los datos de la petición. `$_SERVER` no contiene el entorno del proceso | El autoloader de Composer y cada clase que ha cargado |
| `php://input`: el cuerpo sin procesar de la petición, `CONTENT_TYPE` y `CONTENT_LENGTH` | Las propiedades y variables `static`, que conservan sus valores entre peticiones |
| `$_FILES` y los archivos temporales subidos | Los objetos creados antes del bucle, como el contenedor, el kernel y la aplicación |
| Datos de sesión: `session_start()`, la cookie de la petición y el campo de respuesta `Set-Cookie` | Recursos abiertos: conexiones de base de datos, clientes de caché y streams |
| Estado de la respuesta: código de estado, cabeceras, `setcookie()` y búferes de salida | El proceso: el mismo pid y un intérprete PHP persistente para cada worker |
| Funciones de shutdown registradas **dentro** del handler | Los valores de `$_ENV` cargados antes del bucle |
| El reloj de `max_execution_time`, que se reinicia para cada petición | |

Rapira inicia un temporizador de `max_execution_time` nuevo para cada petición. El tiempo que un worker espera una petición no cuenta para este límite.

Los tres comportamientos siguientes se aplican a un worker persistente.

::: warning Un objeto residente mantiene su estado entre peticiones

PHP no llama al destructor de un objeto persistente al final de una petición. Lo llama una sola vez, cuando termina el ciclo del worker o cuando el código elimina la última referencia.

No uses un destructor para la limpieza de cada petición. Reinicia dentro del handler el estado de cada petición.
:::

::: warning Una función de shutdown registrada durante la inicialización se ejecuta una vez al final del ciclo del worker

PHP ejecuta una función de shutdown registrada fuera del handler una sola vez, al final del ciclo del worker. Una función registrada dentro del handler se ejecuta al final de esa petición.

Registra dentro del handler las funciones de shutdown de cada petición. Algunos ejemplos son la salida de métricas, el procesamiento de errores fatales y la limpieza de recursos de la petición.
:::

::: warning `$_ENV` permanece entre peticiones

Rapira no reconstruye `$_ENV` para cada petición. Los valores que el código escribe en `$_ENV` antes del bucle permanecen hasta que el script del worker se reinicia. Carga la configuración del entorno antes del bucle. No guardes datos de peticiones en `$_ENV`.

Un cambio en `$_ENV` no cambia el entorno del proceso. Usa `putenv()` cuando `getenv()` o los procesos secundarios deban ver un valor. En producción, define las variables de entorno en la unidad de servicio, el contenedor o el orquestador.
:::

## Manejo de errores

Las pruebas confirmaron tres tipos de fallo con un worker:

- **`exit` o `die` dentro del handler** envía el estado y la salida actuales. El proceso no se detiene y el worker continúa aceptando peticiones. Por ejemplo, un framework puede usar `exit` para una respuesta de mantenimiento.
- **Una excepción sin capturar** devuelve `500` si PHP no envió salida antes de la excepción. Después de la salida, se mantiene el estado que PHP envió. Un manejador de excepciones del framework puede devolver su propia página de error. Sin este manejador y con `display_errors` desactivado, el cuerpo está vacío. El worker continúa aceptando peticiones.
- **Un `Error` sin capturar** tiene el mismo resultado. Para ambos tipos, PHP escribe un registro `Uncaught`.

El contador `errors` del worker aumenta cuando ningún manejador de excepciones captura la excepción o el `Error`. Una petición con `exit` solo aumenta `handled`. En los tres casos, `recycles` permanece en cero.

Un error fatal de tipo bailout termina el script persistente. El worker vuelve a iniciar el script e inicia la aplicación. Este reinicio aumenta `recycles`. La salida de estado del [modelo de procesos](/es/docs/process-model) muestra estos contadores.

## Archivos estáticos

Rapira sirve los archivos estáticos con el [middleware de archivos estáticos](/es/docs/static-files). Establece `[http.static].root` en el directorio `public/` del framework. Añade el middleware a `[http]`:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

El middleware solo responde cuando una ruta coincide con un archivo bajo la raíz. Su lista `forbid` predeterminada bloquea los archivos `.php`, por lo que no sirve el script de entrada como archivo. Las demás URL ejecutan el script de entrada. Las URL de directorios también ejecutan el script de entrada, porque el middleware no sirve archivos de índice. `$_SERVER['REQUEST_URI']` contiene la ruta del cliente.

Como alternativa, una CDN o un proxy inverso pueden servir los archivos. Consulta [En producción](/es/docs/deployment) para ver la configuración del proxy inverso.

## TLS y proxies

Rapira solo acepta HTTP sin cifrar y no tiene ajustes de TLS. Termina TLS en un proxy. Conecta el proxy mediante loopback o un socket Unix. `$_SERVER['HTTPS']` siempre está vacío y `$_SERVER['REQUEST_SCHEME']` siempre es `http`. Configura los proxies de confianza del framework para que lea `X-Forwarded-Proto`. Sin esta configuración, el framework genera URL `http://`.

Usa guiones, no guiones bajos, en los nombres de campos reenviados, porque ambos caracteres se pueden asignar a la misma clave de `$_SERVER`. Consulta [HTTP](/es/docs/http) y [En producción](/es/docs/deployment).

## Memoria y reciclaje

Un worker puede crear la aplicación dentro del handler. La aplicación permanece entonces en memoria durante una petición. El worker conserva menos estado que con un kernel persistente de Symfony, pero más que en modo Classic. Mueve la inicialización fuera del handler solo después de identificar el estado persistente.

En este diseño, cada petición crea un grafo de objetos. Los ciclos de referencias pueden conservar grafos antiguos hasta que se ejecuta el recolector de ciclos. El uso de memoria aumenta durante varias peticiones y disminuye cuando PHP libera muchos grafos. Este patrón no siempre es una fuga de memoria. Sin embargo, el máximo de memoria puede ser mucho mayor que la memoria de una petición.

Las pruebas mostraron que `gc_collect_cycles()` en el bucle o en el handler no evita este patrón. Una inicialización posterior puede conservar referencias a grafos antiguos. El recolector no puede liberar un grafo mientras otro objeto lo referencia. Establece `memory_limit` por encima del máximo medido. También establece un límite de sustitución de workers:

```toml
[http.pool]
max_requests = 100
```

Cada worker se detiene después de servir más de `max_requests` peticiones, y el maestro inicia un sustituto. Cada worker usa su propio límite, desde `max_requests + 1` hasta `max_requests` más la mitad de ese valor. Por tanto, los workers no se detienen al mismo tiempo. Las pruebas enviaron cientos de peticiones durante varias sustituciones. La memoria volvió a su nivel inicial y cada petición devolvió `200`. Este ajuste limita el máximo de memoria de este patrón.

Las aplicaciones persistentes de Symfony y Yii3 tuvieron un uso de memoria estable durante las mismas pruebas. Mantén activada la sustitución de workers para limitar el crecimiento inesperado de la memoria. Consulta [configuración](/es/docs/configuration) y [modelo de procesos](/es/docs/process-model) para obtener más información.

## OPcache y el código que cambia

Rapira inicia PHP una vez en el maestro antes de crear workers. OPcache crea un segmento de memoria compartida y cada worker hereda el mismo mapa. Los scripts compilados permanecen en caché entre peticiones y workers en todos los modos.

En PHP 8.4, OPcache es un archivo `opcache.so` separado que necesita una línea `zend_extension` en `php.ini`. Consulta [php.ini](/es/docs/intro/installation#php-ini).

En producción, `opcache.validate_timestamps = 0` elimina la comprobación de archivos de cada petición. Este ajuste impide la invalidación automática de la caché. El segmento de OPcache pertenece al maestro y permanece durante la sustitución de workers. Por tanto, un despliegue requiere un reinicio completo. Consulta [En producción](/es/docs/deployment) para ver la secuencia.

Durante el desarrollo, una aplicación persistente no vuelve a leer su código de inicialización. Este comportamiento no depende de OPcache. Después de cambiar el script del worker o los servicios iniciados, pulsa Ctrl-C. Después, vuelve a ejecutar `rapira serve rapira.toml`.

## Guías de frameworks

- **[Symfony](/es/docs/frameworks/symfony):** El kernel se inicia una vez y permanece en memoria. `services_resetter` restablece los servicios con estado entre peticiones. Un archivo de worker admite Symfony 7.4 y 8.1.
- **[Laravel](/es/docs/frameworks/laravel):** El bridge `rapira/laravel` ejecuta un único script de entrada en los modos Classic, Worker y Dispatcher. El worker de Laravel Octane restablece el estado de la aplicación entre peticiones.
- **[Yii3](/es/docs/frameworks/yii3):** `StateResetter` restablece un contenedor persistente después de cada petición. Como alternativa, el worker puede crear un runner nuevo para cada petición.

Otros frameworks pueden usar el mismo script básico de worker. Usa el modo Worker solo si la aplicación puede procesar varias peticiones en un proceso. Primero, crea la aplicación dentro del handler. Este diseño no requiere que el framework admita procesos persistentes.

Valida la aplicación con este diseño. Después, conserva la aplicación en memoria. Restablece su estado de petición después de cada petición. Usa el [modo Classic](/es/docs/classic) si ninguno de los diseños Worker funciona correctamente.
