---
title: Integración con frameworks
description: "Bucles de worker de frameworks, estado de petición, estado persistente, manejo de errores, archivos estáticos y OPcache."
---

# Integración con frameworks

En modo Classic, una aplicación de framework funciona sin cambios. Configura Rapira para usar el script de entrada existente. En modo Worker, el proceso de PHP permanece activo entre peticiones. El diseño del framework determina qué estado puede permanecer en memoria. Esta página describe el comportamiento común. Las guías de frameworks describen solo el comportamiento específico.

::: info Verificado con

- **PHP 8.5.8**, NTS, SAPI embed
- **Rapira 0.8.0**
- **Symfony 7.4.15** y **8.1.2**, plantilla de aplicación de **Yii3** 1.4 (yii-runner-http 3.2.1)

Las pruebas ejecutaron estas aplicaciones en Linux con un proceso worker. Las afirmaciones sobre los frameworks de esta página proceden de estas pruebas. Consulta [configuración](/es/docs/configuration) para ver los ajustes de Rapira.
:::

## Modos Classic y Worker

**El modo Classic usa el script de entrada existente.** Inicia una petición PHP nueva para cada petición HTTP. Un framework que funciona con php-fpm también funciona en este modo. Consulta [modo Classic](/es/docs/classic) para obtener más información. Solo las secciones de archivos estáticos, TLS y OPcache que aparecen a continuación se aplican al modo Classic.

**El modo Worker mantiene activo el proceso.** El script inicia la aplicación y solicita trabajo en un bucle. El estado de la aplicación permanece entre peticiones. Consulta [modos de ejecución](/es/docs/execution-modes) y [modo Worker](/es/docs/worker).

Un código base puede usar ambos modos. Conserva `public/index.php`. Añade `worker.php` a la raíz del proyecto. Usa `--mode` para seleccionar el modo de ejecución. Selecciona el script con el argumento `SCRIPT` o con `pool.entrypoint`. Usa el modo Classic si falla la migración al modo Worker.

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

- **`require .../vendor/autoload.php`** registra el autoloader hasta que el script del worker se reinicia. Las clases cargadas permanecen disponibles.
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

Rapira establece `SCRIPT_NAME` en `/worker.php` porque es el script de entrada. `DOCUMENT_ROOT` contiene el directorio del script. `REQUEST_URI` contiene la ruta del cliente. Symfony y Yii3 generaron rutas y URL correctas con estos valores. Las URL no contenían `worker.php`. Antes de integrar otro framework, comprueba si crea URL desde `SCRIPT_NAME` en lugar de `REQUEST_URI`.

## Estado por petición y estado residente

Rapira reconstruye todo lo de la columna izquierda para cada petición. El código PHP normal puede seguir leyendo estos valores. Todo lo de la columna derecha permanece entre peticiones. El script del worker debe gestionar este estado.

| Nuevo para cada petición | Permanece entre peticiones |
| ------------------------ | ------------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE`: Rapira las rellena con los datos de la petición | El autoloader de Composer y cada clase que ha cargado |
| `php://input`: el cuerpo sin procesar de la petición, `CONTENT_TYPE` y `CONTENT_LENGTH` | Las propiedades y variables `static`, que conservan sus valores entre peticiones |
| `$_FILES` y los archivos temporales subidos | Los objetos creados antes del bucle, como el contenedor, el kernel y la aplicación |
| Datos de sesión: `session_start()`, la cookie de la petición y el campo de respuesta `Set-Cookie` | Recursos abiertos: conexiones de base de datos, clientes de caché y streams |
| Estado de la respuesta: código de estado, cabeceras, `setcookie()` y búferes de salida | El proceso: el mismo pid y un intérprete PHP persistente para cada worker |
| Funciones de shutdown registradas **dentro** del handler | Los contadores del worker: `handled` y `errors` continúan incrementándose |
| El reloj de `max_execution_time`, que se reinicia para cada petición | `$_ENV`, incluidos los valores cargados antes del bucle |

En Linux y FreeBSD, Zend inicia un temporizador de `max_execution_time` nuevo para cada petición. El tiempo de espera del worker no se incluye en este límite. En otros sistemas, incluido macOS, PHP no inicia un temporizador de petición.

Los tres comportamientos de abajo se aplican a un worker residente.

::: warning Un objeto residente mantiene su estado entre peticiones

PHP no llama al destructor de un objeto residente al final de una petición. Lo llama una sola vez, cuando termina el ciclo del worker o cuando el código elimina la última referencia.

No uses un destructor para la limpieza de cada petición. Reinicia dentro del handler el estado de cada petición.
:::

::: warning Una función de shutdown registrada durante la inicialización se ejecuta una vez al final del ciclo del worker

PHP ejecuta una función de shutdown registrada fuera del handler una sola vez, al final del ciclo del worker. Una función registrada dentro del handler se ejecuta al final de esa petición.

Registra dentro del handler las funciones de shutdown de cada petición. Algunos ejemplos son la salida de métricas, el procesamiento de errores fatales y la limpieza de recursos de la petición.
:::

::: warning `$_ENV` permanece entre peticiones

Rapira no reconstruye `$_ENV` para cada petición. Los valores que el código escribe antes del bucle permanecen hasta que el worker vuelve a ejecutar el script. Trata `$_ENV` como estado residente de la aplicación. Carga la configuración del entorno antes del bucle. No guardes datos de peticiones en `$_ENV`.

Rapira conserva los valores de `$_ENV` sin `putenv()`. Usa `putenv()` cuando el código necesite funciones del entorno del proceso, como `getenv()` o la herencia en procesos secundarios. En producción, define las variables de entorno en la unidad de servicio, el contenedor o el orquestador.
:::

## Manejo de errores

Las pruebas confirmaron tres tipos de fallo con un worker:

- **`exit` o `die` dentro del handler** envía el estado y la salida actuales. El worker continúa aceptando peticiones.
- Un framework puede usar `exit` para una respuesta de mantenimiento sin terminar el proceso.
- **Una excepción sin capturar** devuelve `500`. El manejador del framework puede devolver su página de error.
- Sin este manejador, Rapira devuelve un cuerpo vacío. El worker continúa aceptando peticiones.
- **Un `Error` sin capturar** también devuelve `500`, y el worker continúa. PHP registra `Uncaught Error`.

El contador `errors` aumenta en los dos casos de error. Una petición con `exit` devuelve `200` y solo cambia `handled`. En los tres casos, `recycles` y `restarts` permanecen en cero. Un throwable sin capturar no detiene el worker ni afecta a la siguiente petición. Un error fatal de tipo bailout termina el script persistente. El worker vuelve a iniciar el script y la aplicación. Esta acción aumenta `recycles`. Consulta estos contadores en [modelo de procesos](/es/docs/process-model).

## Archivos estáticos

Rapira sirve los archivos estáticos con el [middleware de archivos estáticos](/es/docs/static-files). Establece `[http.static].root` en el directorio `public/` del framework. Añade el middleware a `[http]`:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

El middleware solo responde cuando una ruta coincide con un archivo bajo la raíz. La lista `forbid` predeterminada impide el acceso a archivos `.php`. Por tanto, no sirve el script de entrada como archivo. Las demás URL ejecutan el script de entrada en los modos Classic y Worker. `$_SERVER['REQUEST_URI']` contiene la ruta del cliente. Las URL de directorios también ejecutan el script de entrada porque el middleware no sirve archivos de índice.

Como alternativa, una CDN o un proxy inverso pueden servir los archivos. Consulta [En producción](/es/docs/deployment) para ver la configuración del proxy inverso.

## TLS y proxies

Rapira acepta HTTP sin cifrar y no proporciona ajustes de TLS. Termina TLS en un proxy. Conecta el proxy mediante loopback o un socket Unix. Usa guiones en lugar de guiones bajos en los nombres de campos reenviados. Ambos caracteres se pueden asignar a la misma clave de `$_SERVER`. Consulta [HTTP](/es/docs/http) y [En producción](/es/docs/deployment).

## Memoria y reciclaje

Un worker puede crear la aplicación dentro del handler. Este diseño conserva la aplicación durante una petición. Conserva menos estado que un kernel persistente de Symfony, pero más que el modo Classic. El bucle permanece en el script del worker. Mueve la inicialización fuera del handler solo después de comprobar el estado persistente. Este diseño crea el contenedor después de recibir la petición.

Cada petición de este diseño crea un grafo de objetos. Los ciclos de referencias pueden conservar grafos antiguos hasta que se ejecuta el recolector. El uso de memoria aumenta durante varias peticiones y disminuye cuando PHP libera varios grafos. Este uso cíclico no siempre es una fuga. Sin embargo, el uso máximo puede ser mucho mayor que el de una petición.

Las pruebas mostraron que `gc_collect_cycles()` no evita este comportamiento en el bucle ni en el handler. Una inicialización posterior puede conservar referencias a grafos antiguos. El recolector no puede liberar un grafo mientras otro objeto lo referencia. Establece `memory_limit` por encima del máximo medido. También establece un límite de sustitución:

```toml
[pool]
max_requests = 100
```

El maestro sustituye un worker después del límite de peticiones. Rapira modifica ligeramente el límite para evitar sustituciones simultáneas. Las pruebas enviaron cientos de peticiones durante varias sustituciones. La memoria volvió a su nivel inicial y cada petición devolvió `200`. Este ajuste establece un límite predecible para el uso de memoria.

Las aplicaciones persistentes de Symfony y Yii3 tuvieron un uso de memoria estable durante las mismas pruebas. Mantén activada la sustitución de workers para limitar el crecimiento inesperado de la memoria. Consulta [configuración](/es/docs/configuration) y [modelo de procesos](/es/docs/process-model).

## OPcache y el código que cambia

Rapira inicia PHP una vez en el maestro antes de crear workers. OPcache crea un segmento de memoria compartida. Cada worker hereda el mismo mapa. Los scripts compilados permanecen en caché entre peticiones y workers en ambos modos.

En producción, `opcache.validate_timestamps = 0` elimina la comprobación de archivos de cada petición. Este ajuste impide la invalidación automática de la caché. El segmento de OPcache pertenece al maestro y permanece durante la sustitución de workers. Por tanto, un despliegue requiere un reinicio completo. Consulta [En producción](/es/docs/deployment) para ver la secuencia.

Durante el desarrollo, una aplicación persistente no vuelve a leer su código de inicialización. Este comportamiento no depende de OPcache. Reinicia el servidor después de cambiar el script del worker o los servicios iniciados. Pulsa Ctrl-C y vuelve a ejecutar `rapira serve`.

## Guías de frameworks

- **[Symfony](/es/docs/frameworks/symfony):** El kernel se inicia una vez y permanece en memoria. `services_resetter` restablece los servicios con estado entre peticiones.
- Un archivo de worker admite Symfony 7.4 y 8.1.
- **[Laravel](/es/docs/frameworks/laravel):** El modo Classic ejecuta el archivo `public/index.php` estándar sin cambios.
- El modo Worker de Laravel está en desarrollo. Rapira todavía no proporciona el driver de Octane necesario.
- **[Yii3](/es/docs/frameworks/yii3):** `StateResetter` restablece un contenedor persistente después de cada petición.
- Como alternativa, el worker puede crear un runner nuevo para cada petición.

Otros frameworks pueden usar el mismo script básico. Usa el modo Worker solo si la aplicación puede procesar varias peticiones en un proceso. Primero, crea la aplicación dentro del handler. Este diseño no requiere que el framework admita procesos persistentes. Valida la aplicación con este diseño. Después, conserva la aplicación. Restablece su estado de petición después de cada petición. Usa el [modo Classic](/es/docs/classic) si ninguno de los diseños Worker funciona correctamente.
