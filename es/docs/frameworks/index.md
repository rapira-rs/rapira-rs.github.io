---
title: Integración con frameworks
description: "La mecánica común a todos los frameworks que corren sobre Rapira: el bucle del worker, el estado por petición y el residente, el manejo de errores, los archivos estáticos y OPcache."
---

# Integración con frameworks

En modo Classic una aplicación de framework corre sobre Rapira sin tocar nada: apuntas el servidor al front controller que ya tienes. En modo Worker el proceso de PHP sigue vivo entre una petición y la siguiente, y lo que la aplicación puede mantener residente depende del diseño del propio framework. Esta página cubre la mecánica que es igual para todos los frameworks; las tres guías específicas de cada framework dan por hecho que ya la has leído y solo cuentan lo suyo.

::: info Verificado con

- **PHP 8.5.8**, NTS, SAPI embed
- **Rapira 0.8.0**
- **Symfony 7.4.15** y **8.1.2**, plantilla de aplicación de **Yii3** 1.4 (yii-runner-http 3.2.1)

Todo lo que cuenta esta página se observó ejecutando esas aplicaciones en Linux, con un único proceso worker. Las afirmaciones de más abajo sobre el comportamiento de los frameworks salen de esas mediciones. Las claves de configuración salen de la referencia de [configuración](/es/docs/configuration) de Rapira.
:::

## Modos Classic y Worker

**En modo Classic no cambia nada.** Tu front controller es el script de entrada, Rapira lo ejecuta desde cero en cada petición y aquí funciona cualquier framework que funcione con php-fpm, incluidos aquellos cuyo estado jamás sobreviviría a una segunda petición. Consulta [modo Classic](/es/docs/classic) para más información; de las secciones de abajo solo se aplican los archivos estáticos, TLS y OPcache.

**En modo Worker el proceso sigue vivo.** Tu script arranca la aplicación una vez y entra en un bucle pidiéndole a Rapira la siguiente petición. El framework ya no se desmonta entre petición y petición. En [modos de ejecución](/es/docs/execution-modes) tienes las descripciones de los modos, y en [modo Worker](/es/docs/worker), su referencia de API.

Un mismo código corre en los dos modos: deja `public/index.php` tal cual está y pon un `worker.php` al lado. Las aplicaciones verificadas de Symfony y Yii3 mantienen los dos archivos uno junto al otro, y cuál de ellos se ejecuta lo elige la opción `--mode`: `rapira serve --mode classic public/index.php` o `rapira serve --mode worker worker.php`. El modo Classic sigue disponible como marcha atrás mientras haces la migración.

## El bucle, línea a línea

Todos los scripts de worker tienen la misma forma, sea cual sea el framework que va dentro:

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

De arriba abajo:

- **`require .../vendor/autoload.php`** — el autoloader se registra una sola vez para toda la vida del worker, y cada clase que resuelve se queda cargada.
- **`$app = new App();`** — aquí arranca la aplicación, una sola vez, antes de que empiece el bucle. Esta línea es donde se separan las dos guías de worker: Symfony mantiene aquí un kernel residente, mientras que Yii3 o mantiene aquí un runner residente o lo construye dentro del handler — y cada guía añade su propio arranque encima del bucle y su propia limpieza por petición dentro del handler.
- **`$handler = static function () use ($app): void`** — el handler no recibe argumentos. La petición está en las superglobales; lo demás que necesite lo captura con `use`.
- **`header()`, `http_response_code()`, `echo`** — escribes la respuesta exactamente igual que en un script clásico. En [HTTP](/es/docs/http) tienes cómo se convierte eso en bytes por la red.
- **`while (\Rapira\handle_request($handler))`** - `handle_request()` bloquea hasta que llega una petición. Rellena las superglobales con ella, ejecuta tu handler, cierra la petición y devuelve `true`. Devuelve `false` cuando el worker empieza a drenarse, y así es como acaba el bucle. Llámala solo desde el nivel superior del script de arranque. Fuera del modo Worker lanza `Rapira\Exception\NotInWorkerModeError`.
- **`gc_collect_cycles();`** — el cuerpo del bucle se ejecuta *entre* peticiones, que es donde va el trabajo que debe ocurrir en un momento predecible y no durante una petición. Recoge los ciclos de referencias normales y no es un arreglo de memoria: mira [Memoria y reciclaje](#memoria-y-reciclaje).

Tu script de entrada es `worker.php`, así que `SCRIPT_NAME` vale `/worker.php` y `DOCUMENT_ROOT` es el directorio donde está, mientras que `REQUEST_URI` lleva la ruta que el cliente pidió de verdad. Tanto Symfony como Yii3 enrutaron y generaron URLs correctamente encima de eso, sin ningún `worker.php` en las URLs generadas y sin parchear `$_SERVER` de ninguna manera. Un framework que construya las URLs a partir de `SCRIPT_NAME` en lugar de `REQUEST_URI` es el primer caso que hay que revisar.

## Estado por petición y estado residente

Rapira reconstruye en cada petición todo lo de la columna izquierda, así que el código PHP de toda la vida que lo lee sigue funcionando. Todo lo de la columna derecha persiste durante toda la vida del worker y lo tiene que gestionar el script del worker.

| Nuevo en cada petición | Sobrevive a cada petición |
| ---------------------- | ------------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` — rellenadas con los datos de esta petición | El autoloader de Composer, y todas las clases ya cargadas a través de él |
| `php://input` — el cuerpo crudo de esta petición, con `CONTENT_TYPE` y `CONTENT_LENGTH` al lado | Las propiedades y variables `static`, que siguen contando de una petición a otra |
| `$_FILES`, y los archivos temporales subidos que hay detrás | Los objetos creados antes del bucle — el contenedor, el kernel, tu aplicación |
| La fontanería de la sesión: `session_start()`, la cookie que entra, el `Set-Cookie` que sale | Los recursos abiertos: conexiones a la base de datos, clientes de caché, streams |
| El estado de la respuesta: código de estado, cabeceras, `setcookie()`, los búferes de salida | El proceso mismo — el mismo pid, un intérprete de PHP residente por worker |
| Las funciones de shutdown registradas **dentro** del handler | Los contadores del propio worker: `handled` y `errors` siguen incrementándose |
| El reloj de `max_execution_time`, rearmado en cada petición | |

En Linux (y FreeBSD), donde existe el temporizador por petición de Zend, el reloj de `max_execution_time` se rearma en cada petición y el rato que el worker pasa aparcado esperando la siguiente nunca le cuenta: en el reloj solo está la petición en sí. En el resto de sistemas, macOS incluido, no se arma ningún límite por petición.

Los tres comportamientos de abajo son propiedades de un PHP residente, no de Rapira. Los tres están verificados y los tres aparecen en el arranque.

::: warning El destructor de un objeto residente se ejecuta al final de la primera petición

Dale un `__destruct` de userland a un objeto creado *fuera* del bucle y se ejecutará — una vez, al final de la **primera** petición, cuando PHP recorre el almacén de objetos al cerrar la petición. El objeto en sí queda perfectamente después: sigue siendo un objeto, sus métodos siguen siendo llamables y el destructor no vuelve a ejecutarse jamás, ni en las peticiones siguientes ni al apagarse el worker.

Por eso una clase que cierra un descriptor, vacía un búfer o escribe una línea de despedida en el registro desde su destructor lo hace una vez, al final de la primera petición, y nunca más en toda la vida del proceso. En cualquier cosa que mantengas residente, saca el desmontaje de los destructores.
:::

::: warning `register_shutdown_function()` en el arranque se ejecuta una vez y nunca más

Si lo llamas fuera del handler, el callback se ejecuta al final de la primera petición y después se libera; ninguna petición posterior lo ejecuta. Registrado *dentro* del handler se comporta exactamente igual que con php-fpm: se ejecuta al final de esa petición, en todas.

Si tu arranque instala un handler de shutdown —para volcar métricas, para cazar un error fatal, para cerrar algo—, regístralo dentro del handler, en cada vuelta del bucle.
:::

::: warning `$_ENV` se vuelve a importar a mitad de petición y sin avisar

Con los ajustes de ini de fábrica (`variables_order = "GPCS"`, `auto_globals_jit = On`), PHP rearma en cada petición el flag JIT de `$_ENV`. El primer archivo que se compile durante esa petición y mencione `$_ENV` hace que PHP reconstruya la superglobal — y como en `variables_order` no hay ninguna `E`, no hay nada que importar: `$_ENV` vuelve **vacía** y todo lo que un arranque tipo Dotenv escribió en ella al levantar el worker se pierde a mitad de petición, sin que PHP emita ningún diagnóstico.

El efecto depende de *cuándo* se compila cada archivo. La configuración que un framework resuelve de golpe durante el arranque ya está cacheada y funciona bien; lo que se resuelve de forma perezosa, en la primera petición, lee un `$_ENV` que se vació un instante antes. Por eso exactamente la misma aplicación puede funcionar en un entorno y devolver un 500 en cada petición en otro.

Hay dos soluciones. La primera está verificada: que el arranque escriba también los valores en el entorno de verdad — `putenv()` sobrevive a la reimportación, y un framework que tire de `getenv()` como plan B los encuentra ahí. En producción, es preferible la segunda: define variables de entorno reales en tu archivo de unidad o en tu contenedor y deja de parsear un `.env` en tiempo de ejecución. Ninguna de las dos devuelve nada a `$_ENV`: bajo `GPCS` se queda vacía por mucho que llenes el entorno, y quien ve los valores es `getenv()`. La [guía de Symfony](/es/docs/frameworks/symfony) recorre el fallo concreto y el arreglo de una línea.

Le pasa a cualquier runtime de PHP que mantenga el proceso vivo entre peticiones.
:::

## Manejo de errores

Tres formas de fallo, todas observadas contra un único worker y siguiéndole el pid:

- **`exit` o `die` dentro del handler** — la respuesta se vuelca al cliente, con el estado y el cuerpo que hubiera hasta ese momento, y el worker sigue atendiendo. Los frameworks lo hacen en su funcionamiento normal —una comprobación de modo mantenimiento que termina la petición con un `exit`, por ejemplo— y no es mortal para el proceso.
- **Una excepción sin capturar** — un `500`. Si el manejador de errores de tu framework la captura antes, pinta su propia página de error; si no la captura nadie, Rapira responde un `500` con el cuerpo vacío. En cualquier caso el worker sigue atendiendo.
- **Un `Error` sin capturar** — llamar a una función que no existe, por ejemplo. PHP lo registra como `Uncaught Error` y sigue el mismo camino que cualquier otro throwable sin capturar: un `500`, y el worker sigue atendiendo con el mismo pid.

El contador `errors` del worker sube con las dos formas de error; la petición del `exit` es un `200` normal y solo mueve `handled`. En los tres casos, `recycles` y `restarts` se quedan a cero: un throwable sin capturar no se lleva al worker por delante ni toca la petición siguiente. La única forma que hace algo más es un error fatal de los que provocan un bailout: desmonta el script residente, así que el worker vuelve a ejecutarlo desde arriba y arranca tu aplicación otra vez, que es justo lo que cuenta `recycles`. El volcado de estado de la página de [modelo de procesos](/es/docs/process-model) imprime esos contadores para cada worker.

## Archivos estáticos

Rapira sirve los archivos estáticos con el [middleware de archivos estáticos](/es/docs/static-files). Apunta la clave `root` de `[http.static]` al directorio `public/` del framework y nombra el middleware en `[http]`:

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

El middleware solo responde a una petición cuando la ruta coincide con un archivo que hay bajo esa raíz. Su lista `forbid` de fábrica deja fuera los archivos `.php`, así que el front controller de `public/` no se sirve nunca como archivo. Cualquier otra URL ejecuta el script de entrada, igual en modo Classic que en modo Worker, y `$_SERVER['REQUEST_URI']` le dice a la aplicación adónde quería ir el cliente. La URL de un directorio también ejecuta el script de entrada, porque el middleware no sirve ningún archivo de índice.

Una CDN o un proxy inverso por delante también pueden servir esos archivos en su lugar. La [puesta en producción](/es/docs/deployment) monta un proxy de esos.

## TLS y proxies

El listener de Rapira habla HTTP en claro y en la configuración no hay ninguna sección de TLS. Termina el TLS en el proxy que ya tienes y deja que llegue a Rapira por loopback o por un socket Unix. El proxy debe escribir los campos reenviados con `-` y jamás con `_`, porque las dos grafías acaban en la misma clave de `$_SERVER`. Consulta [HTTP](/es/docs/http) para esa correspondencia y la [puesta en producción](/es/docs/deployment) para la configuración del proxy.

## Memoria y reciclaje

Un worker que reconstruye la aplicación dentro del handler —la más sencilla de las dos formas de Yii3— mantiene residente menos que un kernel al estilo de Symfony, pero más que el modo Classic, y el bucle está en tu propio script, así que el trabajo puede ir saliendo del handler poco a poco a medida que compruebas qué sobrevive a una segunda petición. Lo que esa forma no te da es un contenedor ya construido cuando llega la petición.

En esa forma, cada petición deja atrás un grafo de objetos desechado. PHP no los libera de uno en uno: los mantienen unidos ciclos de referencias, así que el heap crece petición tras petición hasta que se ejecuta el recolector de ciclos y se lleva un lote grande de golpe. Es un diente de sierra, no una fuga, pero un diente de sierra cuyo pico está bastante por encima de lo que ocupa cualquier petición suelta.

Llamar tú mismo a `gc_collect_cycles()` no lo aplana — verificado, tanto en el bucle como dentro del handler. Los grafos viejos siguen fuertemente referenciados hasta que un arranque posterior los suelta, así que el recolector todavía no tiene nada que llevarse. De ahí salen dos cosas. Dale a `memory_limit` un margen de verdad, porque lo que tiene que caber es el pico y no la media. Y ponle un presupuesto de reciclaje:

```toml
[pool]
max_requests = 100
```

El worker termina al llegar a ese número de peticiones (más un poco de jitter, para que el pool no rote todo a la vez) y el maestro hace fork de un sustituto que empieza con el heap limpio. Verificado a lo largo de cientos de peticiones seguidas y varios reciclajes: los workers rotan, la memoria se reinicia en cada ciclo y no se cayó ni una sola petición ni hubo ninguna respuesta que no fuera un `200`. Es un límite determinista para un perfil de memoria que, si no, queda por completo en manos del recolector.

Las formas residentes —el kernel de Symfony, el contenedor de Yii3 detrás de `StateResetter`— son planas en comparación: en las mismas pruebas la memoria se mantuvo estable. Mantén el reciclaje activado también para ellas, como salvaguarda. Consulta [configuración](/es/docs/configuration) para la clave y [modelo de procesos](/es/docs/process-model) para lo que el reciclaje le hace al pool.

## OPcache y el código que cambia

Rapira arranca PHP exactamente una vez, en el maestro, antes de hacer fork del primer worker — así que OPcache crea su segmento de memoria compartida una única vez y todos los workers heredan ese mismo mapeo. Los scripts compilados siguen calientes de una petición a otra *y* en todo el pool, en los dos modos. Un worker que vuelve a incluir los archivos de tu framework no los está volviendo a parsear.

En producción, `opcache.validate_timestamps = 0` elimina el stat por archivo de cada petición. Con este ajuste, nada invalida la caché. El segmento pertenece al maestro y sobrevive a todas las generaciones de workers. Por tanto, una recarga progresiva sigue sirviendo los opcodes antiguos y un despliegue requiere un reinicio completo. Consulta la [puesta en producción](/es/docs/deployment) para ver la secuencia.

Mientras desarrollas, el mismo resultado tiene otra causa. Un arranque residente no vuelve a leer nunca el código que cargó al inicio, haga lo que haga OPcache: los cambios en un servicio que el contenedor ya construyó, o en el propio script del worker, no llegan al proceso en marcha. Reinicia después de cada edición: `rapira serve` corre en primer plano y no se demoniza nunca, así que es Ctrl-C y volver a lanzarlo.

## Guías de frameworks

- **[Symfony](/es/docs/frameworks/symfony)** — el kernel arranca una vez y se queda residente, y el propio `services_resetter` del framework deja entre peticiones los servicios con estado tal y como los encontró. Un único archivo de worker vale para 7.4 y 8.1, byte a byte.
- **[Laravel](/es/docs/frameworks/laravel)** — modo Classic: el `public/index.php` de serie funciona sin tocar nada. El modo Worker para Laravel está en desarrollo: una aplicación de Laravel residente necesita el desmontaje de estado que implementa Octane, y Rapira todavía no tiene driver de Octane.
- **[Yii3](/es/docs/frameworks/yii3)** — un contenedor residente que se reinicia en cada petición mediante `StateResetter`, que es el diseño del propio Yii3 para procesos de larga vida (su runner de RoadRunner tiene la misma forma), o un runner nuevo por petición, más sencillo, si prefieres empezar por ahí.

Un framework que no cubra ninguna de estas guías corre con el mismo script de worker, y lo que decide si puede correr en modo Worker es si la aplicación atiende una segunda petición en el mismo proceso. La forma por la que conviene empezar es reconstruir la aplicación dentro del handler, porque no le pide nada al framework; la forma a la que conviene pasar después es una aplicación residente con un reinicio de estado por petición. Si no funciona ninguna de las dos formas, el [modo Classic](/es/docs/classic) ejecuta la aplicación sin tocar nada.
