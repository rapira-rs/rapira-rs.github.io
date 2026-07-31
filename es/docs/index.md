---
title: ¿Qué es Rapira?
description: "Rapira es un servidor de aplicaciones PHP escrito en Rust. Incrusta PHP directamente en el proceso del servidor: sin FastCGI, sin sockets y sin serialización de por medio."
---

# ¿Qué es Rapira?

Rapira es un servidor de aplicaciones PHP escrito en Rust. Ocupa el lugar que suele ocupar php-fpm: es el dueño del socket de escucha, habla HTTP con el exterior y ejecuta tu código PHP.

Lo que lo diferencia es lo que hay entre el servidor y el intérprete: nada. Rapira incrusta PHP en su propio proceso mediante el SAPI embed de PHP, la misma interfaz con la que un programa en C puede alojar el motor. El proceso anfitrión llama al intérprete directamente: no hay protocolo FastCGI, ni socket local ni pipe, ni serialización de cada petición a un formato de transporte y vuelta. Cuando llega una petición, se rellenan las superglobales y PHP se ejecuta; cuando termina, los bytes de la respuesta salen directamente hacia el cliente.

Del HTTP se encarga un frontal construido sobre [Pingora](https://github.com/cloudflare/pingora), el framework de proxies en Rust con el que Cloudflare mueve su edge. Viene dentro del binario, así que no hay un segundo proceso que instalar, configurar ni mantener vivo: el árbol de procesos de `rapira` es todo el servidor.

## Qué necesitas

Antes de seguir, conviene conocer unas cuantas restricciones, porque no son negociables:

- **Solo Linux y macOS.** No existe una compilación para Windows.
- **PHP 8.4 u 8.5.** Los archivos comprimidos de cada release y los paquetes `rapira-php8.4` / `rapira-php8.5` incluyen el runtime embed de PHP en NTS que les corresponde, así que la versión que ejecutas es la del artefacto que elijas: no hay nada más que instalar.
- **NTS, nunca ZTS.** Rapira enlaza con un PHP que no es thread-safe. Esto solo te afecta si compilas Rapira contra un PHP tuyo: ahí una compilación thread-safe se rechaza de entrada, en vez de fallar más adelante.

¿Y si prefieres compilar contra tu propio PHP —otro conjunto de extensiones, una arquitectura poco habitual, una distro basada en musl—? Mira [Compilar desde el código](/es/docs/build-from-source).

## Dos formas de ejecutar tu aplicación

Hoy Rapira trae dos formas de ejecutar una aplicación PHP. Por defecto obtienes un worker; Classic hay que pedirlo, con un flag en la línea de comandos o con una sola clave en el archivo de configuración.

**[Classic](/es/docs/classic)** es el de toda la vida. Tu front controller se ejecuta desde cero en cada petición, exactamente igual que bajo php-fpm: la aplicación arranca, atiende la petición y todo lo que ha construido se tira a la basura. No tienes que cambiar nada en tu código, y por eso es el punto de partida honesto para una aplicación que ya existe, y el plan B siempre que algo de tu stack no sobreviva a una segunda petición.

**[SAPI Worker](/es/docs/worker)** mantiene el proceso vivo. Un script residente arranca tu aplicación una sola vez —autoloader, contenedor, conexiones— y a partir de ahí entra en un bucle: atiende una petición tras otra, rellenando de nuevo las superglobales cada vez. El coste del arranque se paga al principio y no en cada petición, pero ahora el estado sobrevive a la petición, y eso cambia de verdad la forma en que tienes que pensar tu código.

Son los dos primeros peldaños de una escalera más larga —`Classic → SAPI Worker → PSR Worker → Async`— en la que cada escalón le da a PHP más control sobre el ciclo de vida de la petición. Por ahora solo están disponibles los dos primeros; [Modos de ejecución](/es/docs/execution-modes) explica la escalera entera y cómo saber hasta qué peldaño llega de verdad tu aplicación.

::: tip
Hasta dónde sube una aplicación depende de la propia aplicación, no de un límite que imponga Rapira. Si tienes estado global que no sobrevive a una segunda petición, te quedas en Classic: eso lo dice tu código, y tiene arreglo.
:::

## Por dónde seguir

- **[Instalación](/es/docs/installation)** — paquetes y archivos comprimidos para Linux y macOS; el runtime de PHP viene dentro.
- **[Inicio rápido](/es/docs/quickstart)** — atiende tu primera petición, en los dos modos, en unos minutos.
- **[Configuración](/es/docs/configuration)** — la referencia completa de `rapira.toml`, para cuando los flags se te queden cortos.

::: question ¿Tengo que reescribir mi aplicación para usar Rapira?
No. En modo Classic, un front controller normal y corriente funciona sin tocar nada: Rapira entra donde estaba php-fpm y tu código ni se entera. Pasar a un worker es un paso aparte y opcional, que das cuando tú quieras.
:::
