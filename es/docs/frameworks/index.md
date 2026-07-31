---
title: Integración con frameworks
description: Qué cambia cuando una aplicación de Symfony, Laravel o Yii3 corre sobre Rapira — el bucle del worker, qué se renueva entre peticiones, qué sobrevive y las trampas que trae consigo un proceso PHP residente.
---

# Integración con frameworks

Poner una aplicación de framework a correr sobre Rapira no es migrarla. En modo clásico ni siquiera es un cambio: apuntas el servidor al front controller que ya tienes y funciona. Lo interesante viene con el worker, donde el proceso de PHP sigue vivo entre una petición y la siguiente — y ahí es donde el framework empieza a tener opinión. Esta página es la mitad común de la historia: la mecánica que es igual para todos. Las tres guías de cada framework dan por hecho que ya la has leído y solo cuentan lo suyo.

::: info Verificado con

- **PHP 8.5.8**, NTS, SAPI embed
- **Rapira 0.6.0**
- **Symfony 7.4.15** y **8.1.2**, **Laravel 13.23.0**, plantilla de aplicación de **Yii3** 1.4 (yii-runner-http 3.2.1)

Todo lo que cuenta esta página se observó ejecutando esas aplicaciones en Linux, con un único proceso worker. Si alguna afirmación resulta incómoda, está aquí porque se midió, no porque sonara bien.
:::

## Qué significa ejecutar un framework sobre Rapira

**En modo clásico no cambia nada.** Tu front controller es el script de entrada, Rapira lo ejecuta desde cero en cada petición y aquí funciona cualquier framework que funcione con php-fpm, incluidos aquellos cuyo estado jamás sobreviviría a una segunda petición. Si es ahí donde empiezas, la página que necesitas es [modo clásico](/es/docs/classic); de aquí en adelante solo te conciernen las secciones sobre archivos estáticos, TLS y OPcache.

**En el peldaño SAPI Worker el proceso sigue vivo.** Tu script arranca la aplicación una vez y entra en un bucle pidiéndole a Rapira la siguiente petición. El framework ya no se desmonta entre petición y petición, y en esa frase caben enteras la ventaja y el riesgo — el resto de la página va de lo que eso implica. [Modos de ejecución](/es/docs/execution-modes) sitúa este peldaño en la escalera; [modo worker](/es/docs/worker) es su referencia de API.

## El bucle, línea a línea

Todos los scripts de worker tienen la misma forma, sea cual sea el framework que va dentro:

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

De arriba abajo:

- **`require .../vendor/autoload.php`** — el autoloader se registra una sola vez para toda la vida del worker, y cada clase que resuelve se queda cargada. Con esto solo ya te llevas casi todo lo que vienes a buscar.
- **`create_plugin_handler(new HttpHandlerConfig())`** — le pide un handler a Rapira; el plugin lo elige la *clase* del objeto de configuración. En modo clásico lanza una excepción, porque no hay ningún bucle residente al que entregarle un handler.
- **`$app = new App();`** — tu arranque, que se paga una sola vez al inicio. Esta línea es donde empiezan a separarse las tres guías de frameworks: aquí va un kernel residente; una aplicación que se construye en cada petición se construye dentro del handler — y cada guía añade su propio arranque encima del bucle y su propia limpieza dentro del handler.
- **`$handler = static function () use ($app): void`** — el handler no recibe argumentos. La petición está en las superglobales; lo demás que necesite lo captura con `use`.
- **`header()`, `http_response_code()`, `echo`** — escribes la respuesta exactamente igual que en un script clásico. En [HTTP](/es/docs/http) tienes cómo se convierte eso en bytes por la red.
- **`while ($http->handleRequest($handler))`** — `handleRequest()` bloquea hasta que llega una petición, rellena las superglobales con ella, ejecuta tu handler, cierra la petición y devuelve `true`. Devuelve `false` cuando el servidor se está apagando, y así es como acaba el bucle.
- **`gc_collect_cycles();`** — el cuerpo del bucle se ejecuta *entre* peticiones. Ese es el sitio para el trabajo que quieres que ocurra en un momento predecible y no en mitad de atender a alguien. Es higiene para los ciclos normales, no un arreglo de memoria: mira [Memoria y reciclaje](#memoria-y-reciclaje).

Una cosa que conviene saber antes de escribir el archivo: tu script de entrada es `worker.php`, así que `SCRIPT_NAME` vale `/worker.php` y `DOCUMENT_ROOT` es el directorio donde está, mientras que `REQUEST_URI` lleva la ruta que el cliente pidió de verdad. Los tres frameworks enrutaron y generaron URLs correctamente encima de eso, sin parchear `$_SERVER` de ninguna manera.

## Qué se renueva y qué sobrevive

Esta es la tabla que conviene tener en la cabeza. Columna izquierda: Rapira lo reconstruye en cada petición, así que el código PHP de toda la vida que lo lee sigue funcionando. Columna derecha: a partir de ahora lo gestionas tú.

| Nuevo en cada petición | Sobrevive a cada petición |
| ---------------------- | ------------------------- |
| `$_GET`, `$_POST`, `$_SERVER`, `$_COOKIE` — rellenadas con los datos de esta petición | El autoloader de Composer, y todas las clases ya cargadas a través de él |
| `php://input` — el cuerpo crudo de esta petición, con `CONTENT_TYPE` y `CONTENT_LENGTH` al lado | Las propiedades y variables `static`, que siguen contando de una petición a otra |
| `$_FILES`, y los archivos temporales subidos que hay detrás | Los objetos creados antes del bucle — el contenedor, el kernel, tu aplicación |
| La fontanería de la sesión: `session_start()`, la cookie que entra, el `Set-Cookie` que sale | Los recursos abiertos: conexiones a la base de datos, clientes de caché, streams |
| El estado de la respuesta: código de estado, cabeceras, `setcookie()`, los búferes de salida | El proceso mismo — el mismo pid, un intérprete de PHP residente por worker |
| Las funciones de shutdown registradas **dentro** del handler | Los contadores del propio worker: `handled` y `errors` no paran de subir |
| El reloj de `max_execution_time`, rearmado en cada petición | |

La fila de `max_execution_time` tiene un detalle que merece explicarse. En Linux (y FreeBSD), donde existe el temporizador por petición de Zend, el reloj se rearma en cada petición y el rato que el worker pasa aparcado esperando la siguiente nunca le cuenta: en el reloj solo está la petición en sí. En el resto de sistemas, macOS incluido, no se arma ningún límite por petición.

Hay tres comportamientos que pillan a mucha gente por sorpresa. Los tres están verificados, los tres muerden en el arranque y los tres son propiedades de un PHP residente, no de Rapira.

::: warning El destructor de un objeto residente se ejecuta al final de la primera petición

Dale un `__destruct` de userland a un objeto creado *fuera* del bucle y se ejecutará — una vez, al final de la **primera** petición, cuando PHP recorre el almacén de objetos al cerrar la petición. El objeto en sí queda perfectamente después: sigue siendo un objeto, sus métodos siguen siendo llamables y el destructor no vuelve a ejecutarse jamás, ni en las peticiones siguientes ni al apagarse el worker.

Así que una clase que cierra un descriptor, vacía un búfer o escribe una línea de despedida en el registro desde su destructor lo hace una vez, pronto y a tus espaldas — y ya no lo vuelve a hacer en toda la vida del proceso. En cualquier cosa que mantengas residente, saca el desmontaje de los destructores.
:::

::: warning `register_shutdown_function()` en el arranque se ejecuta una vez y nunca más

Si lo llamas fuera del handler, el callback se ejecuta al final de la primera petición y después se libera. La segunda petición no lo ejecuta, y la milésima tampoco. Registrado *dentro* del handler se comporta exactamente igual que con php-fpm: se ejecuta al final de esa petición, en todas.

Si tu arranque instala un handler de shutdown —para volcar métricas, para cazar un error fatal, para cerrar algo—, regístralo dentro del handler, en cada vuelta del bucle.
:::

::: warning `$_ENV` se vuelve a importar a mitad de petición y sin avisar

Con los ajustes de ini de fábrica (`variables_order = "GPCS"`, `auto_globals_jit = On`), PHP rearma en cada petición el flag JIT de `$_ENV`. El primer archivo que se compile durante esa petición y mencione `$_ENV` hace que PHP reconstruya la superglobal — y como en `variables_order` no hay ninguna `E`, no hay nada que importar: `$_ENV` vuelve **vacía** y todo lo que un arranque tipo Dotenv escribió en ella al levantar el worker desaparece a mitad de petición, sin ningún aviso y sin ningún error.

Lo malo es que depende de *cuándo* se compila cada archivo. La configuración que un framework resuelve de golpe durante el arranque ya está cacheada y tiene una pinta estupenda; lo que se resuelve de forma perezosa, en la primera petición, lee un `$_ENV` que se vació un instante antes. Por eso exactamente la misma aplicación puede ir como la seda en un entorno y devolver un 500 en cada petición en otro.

Hay dos salidas. La primera está verificada: que el arranque escriba también los valores en el entorno de verdad — `putenv()` sobrevive a la reimportación, y un framework que tire de `getenv()` como plan B los encuentra ahí. La segunda es, de todas formas, la mejor respuesta en producción: define variables de entorno reales en tu archivo de unidad o en tu contenedor y deja de parsear un `.env` en tiempo de ejecución. Ninguna de las dos devuelve nada a `$_ENV`: bajo `GPCS` se queda vacía por mucho que llenes el entorno, y quien ve los valores es `getenv()`. La [guía de Symfony](/es/docs/frameworks/symfony) recorre el fallo concreto y el arreglo de una línea.

Esto no es una rareza de Rapira: le pasa a cualquier runtime de PHP que mantenga el proceso vivo entre peticiones.
:::

## Cuando algo va mal

Tres formas de fallo, todas observadas contra un único worker y siguiéndole el pid:

- **`exit` o `die` dentro del handler** — la respuesta se vuelca al cliente, con el estado y el cuerpo que hubiera hasta ese momento, y el worker sigue atendiendo. Los frameworks hacen esto más de lo que te imaginas (la comprobación del modo mantenimiento de Laravel acaba en un `exit`), así que importa mucho que no sea mortal para el proceso.
- **Una excepción sin capturar** — un `500`. En la práctica la caza antes el manejador de errores de tu framework y pinta su propia página de error; si no la caza nadie, Rapira responde un `500` con el cuerpo vacío. En cualquier caso el worker sigue atendiendo.
- **Un `Error` sin capturar** — llamar a una función que no existe, por ejemplo. PHP lo registra como `Uncaught Error` y sigue el mismo camino que cualquier otro throwable sin capturar: un `500`, y el worker sigue atendiendo con el mismo pid.

El contador `errors` del worker sube con las dos formas de error; la petición del `exit` es un `200` normal y solo mueve `handled`. En los tres casos, `recycles` y `restarts` se quedan a cero: un throwable sin capturar no se lleva al worker por delante ni toca la petición siguiente. Conviene saberlo antes de ponerte a leer un registro de errores con el corazón en un puño. La única forma que hace algo más es un error fatal de los que provocan un bailout: desmonta el script residente, así que el worker vuelve a ejecutarlo desde arriba y arranca tu aplicación otra vez, que es justo lo que cuenta `recycles`. Para leer esos contadores desde PHP tienes `getInfo()`, en la página de [modo worker](/es/docs/worker).

## Rapira no sirve nada del disco

No hay búsqueda en un document root ni regla de «sirve el archivo si existe». Sea cual sea la URL, se ejecuta tu script de entrada y `$_SERVER['REQUEST_URI']` le dice a la aplicación adónde quería ir el cliente — el mismo montaje que una regla de nginx que reescribe todo hacia `index.php`, pero sin la regla, e idéntico en modo clásico y en modo worker.

Lo que significa que tus archivos estáticos necesitan algo por delante: una CDN, o el proxy inverso que monta la [puesta en producción](/es/docs/deployment). El JS y el CSS empaquetados, las imágenes, el favicon: si no, cada uno de ellos es una petición a PHP.

## TLS y proxies

El listener de Rapira habla HTTP en claro y en la configuración no hay ninguna sección de TLS. Termina el TLS en el proxy que ya tienes y deja que llegue a Rapira por loopback o por un socket Unix; a la entrada, la única obligación del proxy es escribir los campos reenviados con `-` y jamás con `_`, porque las dos grafías acaban en la misma clave de `$_SERVER`. En [HTTP](/es/docs/http) tienes esa correspondencia; en la [puesta en producción](/es/docs/deployment), la receta del proxy.

## Memoria y reciclaje

Si tu worker reconstruye la aplicación dentro del handler —lo que hoy necesita Laravel, y la más sencilla de las dos formas de Yii3—, cada petición deja atrás un grafo de objetos desechado. PHP no los libera de uno en uno: los mantienen unidos ciclos de referencias, así que el heap va subiendo petición tras petición hasta que se ejecuta el recolector de ciclos y se lleva un lote grande de golpe. Es un diente de sierra, no una fuga, pero un diente de sierra cuyo pico está bastante por encima de lo que ocupa cualquier petición suelta.

Llamar tú mismo a `gc_collect_cycles()` no lo aplana — verificado, tanto en el bucle como dentro del handler. Los grafos viejos siguen fuertemente referenciados hasta que un arranque posterior los suelta, así que el recolector de verdad no tiene todavía nada que llevarse. De ahí salen dos cosas. Dale a `memory_limit` un margen de verdad, porque lo que tiene que caber es el pico y no la media. Y ponle un presupuesto de reciclaje:

```toml
[pool]
max_requests = 100
```

El worker se jubila al llegar a ese número de peticiones (más un poco de jitter, para que el pool no rote todo a la vez) y el maestro hace fork de un sustituto que empieza con el heap limpio. Verificado a lo largo de cientos de peticiones seguidas y varios reciclajes: los workers rotan, la memoria se reinicia en cada ciclo y no se cayó ni una sola petición ni hubo ninguna respuesta que no fuera un `200`. Es la red determinista que hay debajo de un patrón cuyo perfil de memoria, si no, es cosa del recolector.

Las formas residentes —el kernel de Symfony, el contenedor de Yii3 detrás de `StateResetter`— son planas en comparación: en las mismas pruebas la memoria se mantuvo estable. Aun así, el reciclaje merece la pena como red. La clave está en [Configuración](/es/docs/configuration); lo que el reciclaje le hace al pool, en [Modelo de procesos](/es/docs/process-model).

## OPcache y el código que cambia

Rapira arranca PHP exactamente una vez, en el maestro, antes de hacer fork de un solo worker — así que OPcache crea su segmento de memoria compartida una única vez y todos los workers heredan ese mismo mapeo. Los scripts compilados siguen calientes de una petición a otra *y* en todo el pool, en los dos modos. Un worker que vuelve a incluir los archivos de tu framework no los está volviendo a parsear.

En producción, `opcache.validate_timestamps = 0` te quita el stat por archivo en cada petición. El precio es que ya nada invalida la caché: el segmento es del maestro y sobrevive a todas las generaciones de workers, así que una recarga progresiva seguirá sirviendo los opcodes viejos y un despliegue necesita un reinicio completo. La secuencia está en la [puesta en producción](/es/docs/deployment).

Mientras desarrollas, espera el mismo resultado por otro motivo. Un arranque residente no vuelve a leer nunca el código que cargó al inicio, haga lo que haga OPcache: toca un servicio que el contenedor ya construyó, o el propio script del worker, y el proceso en marcha ni se entera. Reinicia después de cada edición y no tendrás que pararte a pensar cuál de los dos motivos aplica: `rapira serve` corre en primer plano y no se demoniza nunca, así que es Ctrl-C y volver a lanzarlo.

## Elige tu framework

- **[Symfony](/es/docs/frameworks/symfony)** — el kernel arranca una vez y se queda residente, y el propio `services_resetter` del framework deja entre peticiones los servicios con estado tal y como los encontró. Un único archivo de worker vale para 7.4 y 8.1, byte a byte.
- **[Laravel](/es/docs/frameworks/laravel)** — una aplicación nueva en cada petición, porque hoy por hoy esa es la respuesta honesta: Octane es la propuesta de aplicación residente del propio Laravel y Rapira no tiene driver de Octane. Te quedas con el autoloader caliente y con OPcache caliente; con el contenedor, no.
- **[Yii3](/es/docs/frameworks/yii3)** — un contenedor residente que se reinicia en cada petición mediante `StateResetter`, que es el diseño del propio Yii3 para procesos de larga vida (su runner de RoadRunner tiene la misma forma), o un runner nuevo por petición, más sencillo, si prefieres empezar por ahí.

::: question Mi framework no es ninguno de esos tres. ¿Puedo ejecutarlo igualmente?
Seguramente. El script del worker son una docena de líneas y la única pregunta de verdad es si tu aplicación aguanta que le pidan atender una segunda petición. Empieza reconstruyéndola dentro del handler —esa es la forma de Laravel y no le pide nada al framework— y luego ve sacando cosas fuera del handler a medida que descubras qué se puede conservar sin riesgo. Y si no aguanta ninguna de las dos cosas, el [modo clásico](/es/docs/classic) la ejecuta sin tocar nada.
:::

::: question ¿Que el script de entrada sea `worker.php` rompe la generación de URLs?
A ninguno de los tres. `SCRIPT_NAME` vale `/worker.php` mientras que `REQUEST_URI` lleva la ruta real, y Symfony, Laravel y Yii3 enrutaron bien y generaron URLs limpias, sin ningún `worker.php` dentro, y sin sobrescribir `$_SERVER` en ninguna parte. Si tu framework construye las URLs a partir de `SCRIPT_NAME`, eso es lo primero que hay que mirar.
:::

::: question ¿De verdad arrancar en cada petición es mejor que el modo clásico?
Sí, aunque no de forma tan espectacular como una aplicación residente. El autoloader y todas las clases ya cargadas se quedan en memoria en lugar de reconstruirse desde la nada cada vez, y el bucle es tuyo: puedes ir sacando trabajo del handler poco a poco, según vayas descubriendo qué sobrevive. Lo que no te llevas es el premio gordo: un contenedor ya construido cuando llega la petición.
:::

::: question ¿Puede el mismo código correr en los dos modos?
Sí, y es la forma sensata de migrar: deja `public/index.php` tal cual está y pon un `worker.php` al lado. Las tres aplicaciones verificadas tienen los dos archivos. Cuál de ellos se ejecuta lo decide un flag —`rapira serve --classic public/index.php` o `rapira serve worker.php`—, así que el modo clásico sigue disponible como marcha atrás mientras te haces al worker.
:::
