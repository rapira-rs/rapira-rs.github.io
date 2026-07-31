---
title: Modo clásico
description: "El peldaño de Rapira con forma de php-fpm: un front controller de toda la vida, ejecutado desde cero en cada petición y con el estado limpio cada vez."
---

# Modo clásico

El modo clásico es por donde empieza casi todo el mundo y, para muchas aplicaciones, es el único peldaño que van a necesitar. El script de entrada es un front controller de PHP normal y corriente —el mismo `public/index.php` al que ya apuntas con php-fpm— y Rapira lo ejecuta desde cero en cada petición que llega. Tu código no tiene por qué enterarse de que corre dentro de un servidor escrito en Rust: las superglobales se rellenan, el script se ejecuta de arriba abajo y lo que imprima se convierte en la respuesta.

Esa es toda la promesa del primer peldaño. Rapira ocupa el lugar de php-fpm y la aplicación ni se entera.

## Estado limpio en cada petición

Cada petición pasa por un ciclo de PHP completo: arranque de la petición, tu script de entrada y cierre de la petición. Todo lo que el script haya construido por el camino —variables globales, propiedades estáticas, el contenedor de DI, el mapa de identidad del ORM— se destruye antes de que empiece la siguiente, exactamente igual que bajo php-fpm.

Por eso el modo clásico es el reemplazo seguro. Un descriptor que se escapa, un singleton que se corrompe a mitad de petición, una biblioteca que se guarda datos de la petición en una propiedad estática: nada de eso llega a la petición siguiente, porque nada de lo que crea tu script sobrevive a la petición en la que nació. Valen las mismas excepciones que con php-fpm: las conexiones persistentes y el estado que vive dentro de una extensión están en el proceso worker, no en la petición. Aquí funciona sin problemas el código que nunca se escribió pensando en un proceso de larga vida, y de ese hay muchísimo en producción ahora mismo.

El precio es que la aplicación vuelve a arrancar en cada petición: autoloader, configuración, contenedor, rutas. Si eso te importa o no es justo la pregunta de la que trata la página de [modos de ejecución](/es/docs/execution-modes).

## Cómo activarlo

Hay dos maneras de elegir el modo, y las dos hacen lo mismo:

- `--classic` en la línea de comandos, junto al script de entrada.
- `classic = true` en la sección `[pool]` de un `rapira.toml`.

La opción solo sirve para *activar* el modo: no existe `--no-classic`, así que un archivo de configuración con `classic = true` se queda en clásico diga lo que diga la línea de comandos. En todo lo demás manda la precedencia de siempre, en la que las opciones de línea de comandos ganan al archivo de configuración; la lista completa de claves está en la página de [configuración](/es/docs/configuration).

Un script de entrada clásico es PHP y nada más:

```php
<?php
// index.php
header('Content-Type: text/plain');
echo "Hello, " . ($_GET['name'] ?? 'anonymous') . "!\n";
echo "Method: {$_SERVER['REQUEST_METHOD']}\n";
```

Apunta Rapira hacia él de cualquiera de las dos formas:

::: code-group

```bash [CLI]
rapira serve --classic public/index.php
```

```toml [rapira.toml]
[pool]
entrypoint = "public/index.php"
classic = true
```

:::

Con el archivo de configuración, el comando para arrancar es `rapira serve --config rapira.toml`. Un `pool.entrypoint` relativo se resuelve respecto al directorio del propio archivo de configuración, así que puedes mover el archivo de sitio sin romper nada; una ruta de script relativa en la línea de comandos se resuelve respecto al directorio actual. El resto de opciones están en la [referencia de la línea de comandos](/es/docs/cli).

## Siempre un único script de entrada

Rapira no traduce URLs a archivos del disco ni sirve nada del disco por su cuenta. Cada petición ejecuta el script de entrada que le indicaste, venga la ruta que venga, y la URL llega en `$_SERVER['REQUEST_URI']` para que la enrute tu aplicación. Es el mismo montaje que una regla de nginx que lo reescribe todo hacia `index.php`, pero sin la regla.

De ahí salen las variables CGI: `SCRIPT_FILENAME` es siempre el script de entrada, `SCRIPT_NAME` su nombre de archivo con una barra delante (`/index.php`) y `DOCUMENT_ROOT` el directorio donde está. Los archivos estáticos necesitan algo por delante de Rapira: una CDN o el proxy inverso que monta la página de [puesta en producción](/es/docs/deployment).

## Lo que sí se queda caliente

Lo de «desde cero» va por el estado de tu aplicación, no por el trabajo del compilador. El proceso maestro arranca PHP una sola vez, al iniciar el módulo y *antes* de hacer fork de ningún worker, así que OPcache crea su segmento de memoria compartida una única vez y todos los workers heredan ese mismo mapeo. Con OPcache activado, los scripts compilados siguen en caché de una petición a otra y en todo el pool: volver a ejecutar tu front controller no significa volver a parsearlo.

Cómo funciona ese fork por debajo —un maestro, N workers y quién atiende qué— lo tienes en la página de [modelo de procesos](/es/docs/process-model).

::: info
`Rapira\create_plugin_handler()` lanza una `Rapira\RapiraException` en modo clásico: *plugin handlers require worker mode*. No hay ningún bucle residente al que entregarle un handler, porque el script termina cuando termina la petición. Los scripts de worker son cosa del peldaño [SAPI Worker](/es/docs/worker).
:::

## Quedarte aquí o subir

Quédate en clásico cuando el estado de tu aplicación no sobreviva a una segunda petición —código antiguo, un framework que se filtra en propiedades estáticas, una biblioteca de terceros que no controlas— o simplemente cuando estés migrando desde php-fpm y prefieras cambiar una cosa cada vez. Sube al peldaño [SAPI Worker](/es/docs/worker) cuando quitar de en medio el arranque compense y tu código aguante un proceso que no muere; la página de [modos de ejecución](/es/docs/execution-modes) recorre la escalera entera, de la que Classic y SAPI Worker son los peldaños disponibles hoy.

::: question Mi aplicación llama a `fastcgi_finish_request()`. ¿Funciona?
No: esa función la trae el binario de php-fpm y Rapira no es php-fpm. Lo que sí tienes es `rapira_finish_request()`, con el mismo contrato —enviar la respuesta al cliente cuanto antes y seguir trabajando después—, documentada en la página de [HTTP](/es/docs/http).
:::

::: question ¿El modo clásico sigue ejecutando más de un proceso?
Sí. El pool de procesos es el mismo en los dos modos: el maestro hace fork de los workers y cada worker atiende una petición cada vez, así que la concurrencia sale del número de procesos. Consulta el [modelo de procesos](/es/docs/process-model).
:::

::: question ¿Necesito un script de worker para probar Rapira?
No, y de eso va precisamente este peldaño. Apunta `rapira serve --classic` al front controller que ya tienes y funciona tal cual, sin tocar nada. El [inicio rápido](/es/docs/quickstart) hace exactamente eso.
:::
