---
title: Línea de comandos
description: "Todas las opciones que acepta rapira serve, cómo se superponen a lo que dice el archivo de configuración y cómo se resuelven las rutas del script de entrada."
---

# Línea de comandos

Rapira es un único binario con un solo subcomando:

```bash
rapira serve [OPTIONS] [SCRIPT]
```

`serve` es lo que arranca el servidor: pone en marcha PHP, registra las extensiones incorporadas y empieza a atender peticiones. Si ejecutas `rapira` a secas, sin argumentos, verás la ayuda y nada más; `rapira serve --help` te lista desde el propio binario las opciones que vienen a continuación, y `rapira --version` te dice qué versión tienes instalada.

El archivo de configuración es opcional: un solo comando con la ruta de un script ya es un servidor completo y en marcha, y el archivo está ahí para cuando las opciones de línea de comandos no bastan.

## Cómo se superponen los ajustes

Cada ajuste se resuelve consultando hasta tres capas, siempre en este orden:

**Opciones de línea de comandos > archivo de configuración > valores por defecto.**

Solo las cuatro opciones de la tabla de abajo y el argumento `SCRIPT` tienen forma de línea de comandos; todo lo demás sale del archivo o del valor por defecto.

Así que una opción siempre gana al mismo valor puesto en `rapira.toml`, y `rapira.toml` siempre gana al valor por defecto. Ese orden te permite dejar la configuración estable en el archivo y cambiar un único valor desde la línea de comandos para una ejecución suelta —otro puerto mientras pruebas, más workers en una máquina más grande— sin editar nada.

Todo lo que no toques por ninguna de las dos vías cae en los valores por defecto de la tabla de abajo. Los ajustes que las opciones no exponen —escalado del pool, registros, límites de las peticiones— salen del archivo, y la lista completa de lo que cabe en un archivo de configuración está en [Configuración](/es/docs/configuration).

## Opciones

| Opción            | Por defecto      | Qué hace                                                                                         |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `--config <PATH>` | ninguno          | Carga los ajustes de un `rapira.toml`.                                                           |
| `--listen <ADDR>` | `127.0.0.1:8000` | Dirección de escucha: `host:port`, `:port` (todas las interfaces) o `unix:<path>`.                |
| `--processes <N>` | número de CPU    | Procesos worker que se crean con fork.                                                           |
| `--classic`       | desactivado      | Vuelve a ejecutar el script desde cero en cada petición en lugar de mantenerlo residente.        |
| `SCRIPT`          | obligatorio*     | El script PHP de entrada. Tiene prioridad sobre el `pool.entrypoint` del archivo de configuración. |

\* Obligatorio salvo que el archivo de configuración defina `pool.entrypoint`. Si no hay ninguno de los dos, `serve` informa del error y no arranca.

**`--listen`** admite tres formas. `127.0.0.1:8000`, la de por defecto, escucha en una sola interfaz —solo loopback—, así que nada de fuera de la máquina puede alcanzarla. `:8080` es la forma corta de `0.0.0.0:8080`: todas las interfaces IPv4, que es lo habitual dentro de un contenedor; para IPv6 escribe `[::]:8080`. `unix:/run/rapira.sock` abre un socket Unix en lugar de un puerto, pensado para un proxy inverso en la misma máquina. Los literales IPv6 van entre corchetes: `[::1]:8000`. Un puerto a secas *no* es una dirección y se rechaza, porque no dice si hay que escuchar solo en loopback o en todas las interfaces: `--listen 8080` da error, escribe `--listen :8080` o `--listen 127.0.0.1:8080`. Y el host tiene que ser un literal IP, porque los nombres no se resuelven nunca: `--listen localhost:8000` también da error; escribe `--listen 127.0.0.1:8000`.

**`--processes`** vale por defecto el número de CPU lógicas. Con el pool estático de fábrica, ese es exactamente el número de procesos worker que se crean con fork; si el archivo de configuración pasa el pool a `dynamic` o a `ondemand`, ese mismo número se convierte en el techo hasta el que escalan esos modos. Qué hacen en realidad los workers y el proceso maestro lo tienes en [Modelo de procesos](/es/docs/process-model).

**`--classic`** elige el modo en el que corre la aplicación. Sin ella, el script de entrada se carga una vez y se queda residente: ese es el modo [SAPI Worker](/es/docs/worker). Con ella, el script se vuelve a incluir en cada petición, exactamente igual que haría php-fpm: ese es el modo [Classic](/es/docs/classic). Si no tienes claro cuál puede usar tu aplicación, [Modos de ejecución](/es/docs/execution-modes) describe los cuatro modos.

::: info
`--classic` es un interruptor que solo enciende. No existe ningún `--no-classic`, así que un `classic = true` en el archivo de configuración no se puede desactivar desde la línea de comandos: quita la clave del archivo.
:::

## Resolución del script de entrada

El script se puede indicar por dos vías —el argumento posicional `SCRIPT` o la clave `pool.entrypoint` del archivo de configuración— y, si están las dos, gana la línea de comandos mientras el resto de ajustes del archivo se siguen aplicando. En cualquiera de los dos casos, Rapira lo convierte en una ruta absoluta antes de que el servidor haga ningún fork, porque el directorio de trabajo de un demonio no es el directorio donde desplegaste.

Las dos formas relativas se resuelven contra bases distintas:

- Un `SCRIPT` relativo en la línea de comandos se resuelve respecto al **directorio actual**.
- Un `pool.entrypoint` relativo se resuelve respecto al **directorio del propio archivo de configuración**: así el archivo y la aplicación que tiene al lado se pueden mover, copiar o montar donde sea como un bloque y la ruta se sigue resolviendo bien.

```toml
[pool]
entrypoint = "public/index.php"
```

Con eso en `/etc/rapira/rapira.toml`, el script de entrada es `/etc/rapira/public/index.php`, sin importar desde qué directorio lanzaras el comando.

## Ejemplos

Invocaciones habituales:

```bash
rapira serve app/worker.php
rapira serve --classic public/index.php
rapira serve --listen :8080 --processes 8 app/worker.php
rapira serve --listen unix:/run/rapira.sock app/worker.php
rapira serve --config /etc/rapira/rapira.toml
rapira serve --config /etc/rapira/rapira.toml --listen 127.0.0.1:9000
```

El primer comando no lleva `--listen`, así que el servidor levanta en la dirección por defecto y mandarle una petición es una línea más. En [Inicio rápido](/es/docs/intro/quickstart) encontrarás un script worker con el que probar ese comando.

```bash
curl http://127.0.0.1:8000/
```

## Parar el servidor

El primer `SIGINT` o `SIGTERM` —un `Ctrl-C` en la terminal, o lo que mande tu sistema de init— deja terminar las peticiones en curso y apaga las extensiones de forma limpia; el segundo renuncia a esperar y fuerza la salida. Las señales van al proceso maestro, y la tabla completa, recargas incluidas, está en [Modelo de procesos](/es/docs/process-model).
