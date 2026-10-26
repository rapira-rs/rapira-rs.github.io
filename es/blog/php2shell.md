---
title: "PHP2Shell y RoadRunner"
date: 2026-10-27
description: "Por qué las vulnerabilidades PHP2Shell (CVE-2026-109618 y CVE-2026-109619) no afectan a RoadRunner, cómo ejecutan PHP otros servidores y qué hacer si tienes WordPress."
author: Aleksei Gagarin
image: /blog/php2shell/preview.jpg
---

El 21 de octubre, PHP publicó las actualizaciones extraordinarias 8.5.12, 8.4.27, 8.3.36 y 8.2.35. Corrigen dos vulnerabilidades críticas que sus autores bautizaron como [PHP2Shell](https://calif.io/php2shell/): [CVE-2026-109618](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w) y [CVE-2026-109619](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp). Ambas permiten la ejecución remota de código sin autenticación, con una puntuación CVSS v4 de 9.2. Los investigadores demostraron el ataque contra WordPress, Drupal, Joomla, Magento, Nextcloud, Laravel, Symfony y otras aplicaciones.

Lo más interesante de estas vulnerabilidades es dónde se encuentran. No están en el código de los frameworks ni en funcionalidades recientes del lenguaje. Están en la parte de servidor del propio PHP: el parseo del cuerpo de las peticiones POST y la subida de archivos. El fichero `main/rfc1867.c`, que parsea `multipart/form-data`, llegó al repositorio en 1999, y `main/php_variables.c`, en 2000.

::: warning
Actualiza PHP, uses el servidor que uses. A continuación explicamos por qué unas formas de ejecutar PHP se vieron más afectadas que otras. Eso no es motivo para aplazar la actualización.
:::

## Cómo funciona el ataque

Todas las variantes del ataque comparten la misma idea. El atacante hace que PHP caiga con un fatal error justo cuando las estructuras en memoria solo están rellenas a medias. Lo más habitual es conseguirlo con una petición que consume más de `memory_limit`. Sirven para ello campos de formulario profundamente anidados en un `multipart` o un cuerpo sin longitud declarada: chunked en HTTP/1.1, o HTTP/2 sin `Content-Length`. La comprobación de `post_max_size` se fija en la longitud declarada, así que deja pasar estos datos.

Calif describe tres vías de ataque:

1. **Parseo de POST.** La memoria se agota mientras PHP parsea un cuerpo `application/x-www-form-urlencoded` o `multipart/form-data` al arrancar la petición. En la tabla hash queda un elemento que ya está contabilizado, pero cuya clave todavía no se ha creado.
2. **`session.upload_progress`.** Una parte `multipart` con un archivo inicia la sesión en pleno parseo del cuerpo. El fatal error interrumpe el arranque de la petición y la sesión no llega a cerrarse. Sus datos apuntan a memoria ya liberada.
3. **Decodificación tras el arranque.** El fatal error se produce en `unserialize()`, `session_decode()` o `session_start()`, cuando la petición ya ha arrancado y se está ejecutando el código de la aplicación. El estado del decodificador se queda apuntando a memoria liberada. Esta vía depende de la aplicación: tiene que decodificar datos que controla el atacante.

En los tres casos, el estado corrupto es inofensivo por sí solo. Lo que lo convierte en ejecución de código es la siguiente petición que recibe ese mismo proceso. El ataque solo funciona si el proceso de PHP sobrevive al fatal error. Por eso, la forma en que el servidor ejecuta PHP y le entrega la petición lo decide casi todo.

## Cómo se comunican los servidores con PHP

| Servidor                 | Cómo ejecuta PHP                    | Quién parsea el cuerpo de la petición | ¿Sobrevive el proceso al fatal error?                                                  | Resultado frente a PHP2Shell   |
|--------------------------|-------------------------------------|---------------------------------------|----------------------------------------------------------------------------------------|--------------------------------|
| Apache + mod_php         | Módulo dentro de Apache             | PHP                                   | Sí                                                                                     | Vulnerable, las tres vías      |
| PHP-FPM                  | Procesos independientes, FastCGI    | PHP                                   | Si falla al arrancar la petición, no; si falla en el código de la aplicación, sí       | Vulnerable, vía 3              |
| FrankenPHP               | Integrado en un servidor en Go      | PHP                                   | Sí, como mod_php                                                                       | En la lista de afectados       |
| Swoole                   | Extensión de PHP                    | Swoole                                | No                                                                                     | No afectado                    |
| RoadRunner               | Procesos PHP independientes         | Go                                    | No, RoadRunner lanza un proceso nuevo                                                  | No afectado                    |
| Rapira [Classic, Worker] | Integrado en un servidor en Rust    | PHP                                   | Sí, solo se reinicia la aplicación                                                     | Mismas condiciones que mod_php |
| Rapira [Dispatcher]      | Integrado en un servidor en Rust    | Rust                                  | Sí, solo se reinicia la aplicación                                                     | Las vías 1 y 2 no funcionan    |

**mod_php** es el que sale peor parado: Calif demuestra un RCE en un script PHP cualquiera con la configuración por defecto.

**PHP-FPM** termina el worker si falla el arranque de la petición. Por eso las vías 1 y 2, que rompen el arranque de la petición, no funcionan en FPM. La vía 3 sí funciona: el fatal error en el decodificador ocurre después del arranque y el worker sigue vivo. De hecho, la demostración de Calif usa precisamente nginx y PHP-FPM.

**FrankenPHP** integra PHP como un SAPI propio y llama a la función estándar `php_request_startup()`, así que el cuerpo de la petición lo parsea el propio PHP. PHP incluyó FrankenPHP en la lista de servidores afectados. El advisory señala que FrankenPHP ejecuta el cierre de la petición incluso tras un arranque fallido, igual que mod_php. FrankenPHP publicó [v1.13.2](https://github.com/php/frankenphp/releases) con el PHP corregido ese mismo día.

**Swoole** parsea HTTP y `multipart` con su propio código y no admite `session.upload_progress`. Los mantenedores de Swoole [han declarado](https://github.com/swoole/swoole-src/issues/6343) que estos CVE no afectan a Swoole.

**RoadRunner** también parsea HTTP fuera de PHP, y el worker termina tras un fatal error. Ninguna de las tres vías de ataque funciona aquí. Veamos por qué con más detalle.

## Cómo se comunica RoadRunner con PHP

RoadRunner no integra PHP ni usa FastCGI. El worker es un proceso normal `php worker.php` que se ejecuta en el SAPI CLI. RoadRunner y el worker intercambian frames del protocolo [Goridge](https://github.com/roadrunner-server/goridge) a través de STDIN/STDOUT o de un socket. Cada frame consta de una cabecera con la longitud y una suma de verificación, seguida de los datos.

El plugin http de RoadRunner se encarga de toda la petición HTTP. Acepta la conexión, comprueba `max_request_size`, parsea `application/x-www-form-urlencoded` y `multipart/form-data` y guarda los archivos subidos en un directorio temporal. PHP recibe un DTO ya preparado: el contexto de la petición (método, URI, cabeceras, cookies, campos parseados, lista de archivos subidos) y el cuerpo. El paquete PHP `roadrunner/http` construye a partir de él una petición PSR-7.

Qué significa esto para PHP2Shell:

- Vía 1: `rfc1867_post_handler()` y `php_std_post_handler()` nunca ven las peticiones HTTP. El worker CLI arranca una sola vez y sin cuerpo de petición.
- Vía 2: `session.upload_progress` no se ejecuta.
- Vía 3: el fatal error termina el script CLI y, con él, el proceso. RoadRunner detecta que el worker ha salido y lanza uno nuevo. El estado corrupto no llega a la siguiente petición.

En este esquema, el código de PHP para parsear peticiones, con veinte años a sus espaldas, ni siquiera llega a ejecutarse. Las tuberías (pipes) aparecieron en Unix allá por 1973, y desde entonces nadie ha conseguido romperlas. Entre RoadRunner y PHP no hay memoria compartida, ni hilos compartidos, ni hooks rebuscados en el motor: solo bytes por una tubería. Si el proceso PHP cae, RoadRunner simplemente lanza otro, y la siguiente petición llega ya a un proceso limpio.

Ya habíamos dicho que, en fiabilidad, RoadRunner no tiene nada que envidiar a PHP-FPM. El caso PHP2Shell demuestra que en seguridad incluso sale ganando: allí donde FPM tuvo que actualizarse de urgencia, RoadRunner simplemente no ejecuta el código vulnerable. Y está claro que la historia no acaba aquí.

::: info
Aun así, conviene actualizar PHP: la corrección cambia el comportamiento de PHP cuando se queda sin memoria.
:::

## Una aplicación que no muere

Esta arquitectura tiene un precio: la aplicación tiene que saber funcionar en un proceso de larga duración. El worker carga el framework una sola vez y después procesa las peticiones en un bucle. Las propiedades estáticas, los singletons y el estado global sobreviven a cada petición, así que el código no debe guardar en ellos datos de la petición.

WordPress no sabe funcionar así. En cambio, las aplicaciones en Symfony, Laravel y Yii3, si no recurren a lo estático a la ligera, lo más probable es que pasen a RoadRunner sin dolores de cabeza gracias a los puentes ya disponibles:

- Symfony: [Symfony Runtime](https://github.com/php-runtime/runtime) o [baldinof/roadrunner-bundle](https://github.com/baldinof/roadrunner-bundle);
- Laravel: [Laravel Octane](https://laravel.com/docs/octane) o [spiral/roadrunner-laravel](https://github.com/spiral/roadrunner-laravel);
- Yii3: [yiisoft/yii-runner-roadrunner](https://github.com/yiisoft/yii-runner-roadrunner).

::: info
Y si vas a empezar un proyecto nuevo, echa un vistazo a nuestro framework [Spiral](https://spiral.dev/). Se diseñó desde el principio para RoadRunner y funciona en un proceso de larga duración sin puentes ni concesiones. Spiral aprovecha al máximo y de serie las capacidades de RoadRunner: HTTP, gRPC, colas, almacenes key-value, WebSocket a través de Centrifugo, Temporal y métricas.
:::

## ¡Pero yo tengo WordPress!

Nuestro nuevo proyecto, [Rapira](/es/docs/intro/), es el siguiente paso después de RoadRunner. Lo escribimos en Rust a conciencia, sin dejarlo todo en manos de la IA. La arquitectura de Rapira y de sus contratos PHP, a través de los cuales la aplicación se comunica con el servidor, pasa por varios ciclos de revisión y benchmarks antes de llegar a una versión publicada. Rapira ejecuta PHP en uno de sus [tres modos](/es/docs/execution-modes): Classic, Worker y Dispatcher.

**Classic** sirve para WordPress y para bases de código antiguas. El script se ejecuta desde cero en cada petición, como con php-fpm, y no hace falta reescribir la aplicación. Rapira es compatible con PHP 8.4 y 8.5, así que, eso sí, tendrás que migrar a PHP 8.4+.

**Worker** mantiene la aplicación en memoria y rellena las variables superglobales en cada petición. Es el modelo del modo worker de FrankenPHP, pero sin CGO y sin hilos ZTS: cada worker es un proceso independiente con un único intérprete NTS.

**Dispatcher** es el modo de mayor rendimiento. Funciona como RoadRunner: la aplicación recibe un objeto de petición en lugar de variables superglobales, y es el propio Rust quien parsea `multipart`. Pero, a diferencia de RoadRunner, aquí no hay una capa intermedia como Goridge ni serialización, y todos los workers comparten el OPcache del proceso maestro.

Los benchmarks de Yii3 en distintos servidores, incluidos los tres modos de Rapira, están disponibles en [yii3-benchmarks.github.io](https://yii3-benchmarks.github.io/app-api/).

::: warning PHP2Shell y Rapira
Rapira descarta parte de las peticiones peligrosas antes incluso de ejecutar PHP. Guarda el cuerpo completo en un búfer y responde con `413` si supera `http.max_body_size_mb`. Por eso no funciona el truco de esquivar `post_max_size` con cuerpos chunked en HTTP/1.1 ni con HTTP/2 sin `Content-Length`.

Sin embargo, en los modos Classic y Worker el cuerpo de la petición lo parsea el propio PHP. Eso deja abierto el vector de ataque de los campos `multipart` anidados: un cuerpo así cabe dentro del límite de tamaño, pero al parsearlo ocupa más de `memory_limit`.
:::

Procura escribir tu aplicación de forma que funcione en el modo Dispatcher. Así no solo ganarás rendimiento, sino también fiabilidad y seguridad. Puedes probar este enfoque ya mismo con el superestable RoadRunner.

Y, como último recurso, existe un remedio drástico: `pm.max_requests = 1` en PHP-FPM o `max_jobs: 1` en el pool de RoadRunner. Cada petición recibirá un proceso nuevo, igual que con CGI en 1997. Lo decimos en broma, pero con la seguridad no se juega.

## Conclusión

PHP2Shell no será la última vulnerabilidad de este tipo. El código que arranca la petición, parsea el POST y gestiona la subida de archivos se escribió en C hace más de veinte años, y en la parte de servidor de PHP todavía se encontrarán más errores. Cuanto menos código de este tipo haya entre la red y tu aplicación, menor será la superficie de ataque. RoadRunner y el modo Dispatcher de Rapira parsean HTTP fuera de PHP. Y para las aplicaciones que necesitan el PHP clásico, la principal defensa es actualizar PHP a tiempo.
