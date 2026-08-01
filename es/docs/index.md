---
title: ¿Qué es Rapira?
description: "Rapira es un servidor de aplicaciones PHP escrito en Rust; esta página cubre sus requisitos y las dos formas en que ejecuta una aplicación PHP."
---

# ¿Qué es Rapira?

Rapira es un servidor de aplicaciones PHP escrito en Rust.

Incrusta PHP en su propio proceso mediante el SAPI embed de PHP, la misma interfaz con la que un programa en C puede alojar el motor. El proceso anfitrión llama al intérprete directamente: no hay protocolo FastCGI, ni socket local ni pipe, ni serialización de cada petición a un formato de transporte y vuelta. Cuando llega una petición, se rellenan las superglobales y PHP se ejecuta; cuando termina, los bytes de la respuesta salen directamente hacia el cliente.

Del HTTP se encarga un frontal construido sobre [Pingora](https://github.com/cloudflare/pingora), el framework de proxies en Rust de Cloudflare. Viene dentro del binario, así que no hay un segundo proceso que instalar, configurar ni mantener vivo.

## Qué necesitas

Rapira tiene tres requisitos.

- **Solo Linux y macOS.** No existe una compilación para Windows.
- **PHP 8.4 u 8.5.** Los archivos comprimidos de cada release y los paquetes `rapira-php8.4` / `rapira-php8.5` incluyen el runtime embed de PHP en NTS que les corresponde, así que la versión que ejecutas es la del artefacto que elijas: no hay nada más que instalar.
- **NTS, nunca ZTS.** Rapira enlaza con un PHP que no es thread-safe. Esto solo importa si compilas Rapira contra un PHP tuyo: ahí una compilación thread-safe se rechaza de entrada, en vez de fallar más adelante.

Para compilar contra tu propio PHP —otro conjunto de extensiones, una arquitectura poco habitual, una distro basada en musl— consulta [Compilar desde el código](/es/docs/build-from-source).

## Dos formas de ejecutar tu aplicación

Hoy Rapira trae dos formas de ejecutar una aplicación PHP. El modo worker es el predeterminado; Classic hay que pedirlo, con un flag en la línea de comandos o con una sola clave en el archivo de configuración.

**[Classic](/es/docs/classic)** ejecuta tu front controller desde cero en cada petición, exactamente igual que bajo php-fpm: la aplicación arranca, atiende la petición y todo lo que ha construido se descarta. No tienes que cambiar nada en tu código.

**[SAPI Worker](/es/docs/worker)** mantiene el proceso vivo. Un script residente arranca tu aplicación una sola vez —autoloader, contenedor, conexiones— y a partir de ahí entra en un bucle: atiende una petición tras otra, rellenando de nuevo las superglobales cada vez. El arranque ocurre una vez al inicio y no en cada petición, y el estado sobrevive a la petición.

[Modos de ejecución](/es/docs/execution-modes) añade algo más de información sobre las diferencias entre ambos y sobre cómo elegir cuál usar.

## Por dónde seguir

- **[Instalación](/es/docs/installation)** — paquetes y archivos comprimidos para Linux y macOS; el runtime de PHP viene dentro.
- **[Inicio rápido](/es/docs/quickstart)** — atiende tu primera petición en los dos modos.
- **[Configuración](/es/docs/configuration)** — la referencia completa de `rapira.toml`.
