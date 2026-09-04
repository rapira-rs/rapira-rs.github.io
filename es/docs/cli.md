---
title: Línea de comandos
description: "Opciones de rapira serve, prioridad de la configuración y resolución de la ruta del script de entrada."
---

# Línea de comandos

Rapira es un único binario con un solo subcomando:

```bash
rapira serve [OPTIONS] [SCRIPT]
```

El comando `serve` inicia PHP, registra las extensiones incorporadas y acepta peticiones. Ejecuta `rapira` sin argumentos para mostrar la ayuda. Ejecuta `rapira serve --help` para mostrar las opciones disponibles. Ejecuta `rapira --version` para mostrar la versión instalada.

El archivo de configuración es opcional. Un comando con la ruta del script inicia el servidor con los ajustes predeterminados.

## Prioridad de los ajustes

Rapira lee los ajustes en este orden:

**Opciones de línea de comandos > archivo de configuración > valores por defecto.**

Solo las cuatro opciones de la tabla y el argumento `SCRIPT` tienen formas de línea de comandos. Los demás ajustes usan el archivo o su valor predeterminado.

Una opción sustituye el valor correspondiente de `rapira.toml`. Un valor de `rapira.toml` sustituye el valor predeterminado. Este orden permite usar un valor temporal durante una ejecución. Por ejemplo, prueba otro puerto sin editar el archivo.

Las opciones sin definir usan los valores predeterminados de la tabla. El archivo controla el escalado del pool, los registros y los límites de petición. Consulta [Configuración](/es/docs/configuration) para ver todos los ajustes del archivo.

## Opciones

| Opción            | Por defecto      | Qué hace                                                                                         |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `--config <PATH>` | ninguno          | Carga los ajustes de un `rapira.toml`.                                                           |
| `--listen <ADDR>` | `127.0.0.1:8000` | Dirección de escucha: `host:port`, `:port` (todas las interfaces) o `unix:<path>`.                |
| `--processes <N>` | número de CPU    | Procesos worker que se crean con fork.                                                           |
| `--mode <MODE>`   | `dispatcher`     | Modo de ejecución: `classic`, `worker` o `dispatcher`. Tiene prioridad sobre el `pool.mode` del archivo de configuración. |
| `SCRIPT`          | obligatorio*     | El script PHP de entrada. Tiene prioridad sobre el `pool.entrypoint` del archivo de configuración. |

\* Obligatorio salvo que el archivo de configuración defina `pool.entrypoint`. Si no hay ninguno de los dos, `serve` informa del error y no arranca.

**`--listen`** acepta tres formatos. `127.0.0.1:8000` enlaza la interfaz de loopback. Los sistemas remotos no pueden conectarse a esta dirección. `:8080` equivale a `0.0.0.0:8080` y enlaza todas las interfaces IPv4. Usa `[::]:8080` para todas las interfaces IPv6. `unix:/run/rapira.sock` crea un socket Unix para un proxy inverso local. Escribe los literales IPv6 entre corchetes, como `[::1]:8000`. Rapira rechaza un puerto sin dirección. Usa `--listen :8080` o `--listen 127.0.0.1:8080`. Rapira no resuelve nombres de host en esta opción. Usa `127.0.0.1:8000` en lugar de `localhost:8000`.

**`--processes`** usa de forma predeterminada el número de CPU lógicas. El escalado estático lo usa como número exacto de workers. El escalado dinámico y `ondemand` lo usan como número máximo. Consulta [Modelo de procesos](/es/docs/process-model).

**`--mode`** selecciona el modo de ejecución. `dispatcher` es el valor predeterminado y obtiene cada petición del host. `worker` conserva el script de entrada y ejecuta un handler para cada petición. `classic` inicia una petición PHP nueva para cada petición HTTP. La opción sustituye el modo del archivo de configuración. Consulta [Modo Classic](/es/docs/classic), [Modo Worker](/es/docs/worker) y [Modos de ejecución](/es/docs/execution-modes).

::: info
`pool.scaling` y `pool.mode` son claves distintas. `pool.scaling` establece la política que dimensiona el pool. `pool.processes` establece el número de workers al que se aplica la política, y `--processes` lo sustituye. `pool.mode` establece qué hace un worker con una petición. `pool.scaling` no tiene una opción de línea de comandos. Establécelo en el archivo de configuración.
:::

## Resolución del script de entrada

Especifica el script con el argumento `SCRIPT` o con `pool.entrypoint`. El argumento sustituye a `pool.entrypoint`, pero se aplican los demás ajustes del archivo de configuración. Rapira convierte la ruta del script en una ruta absoluta antes de crear los workers. Esto evita que los cambios posteriores del directorio de trabajo afecten a la ruta.

Las dos formas relativas se resuelven contra bases distintas:

- Un `SCRIPT` relativo en la línea de comandos se resuelve respecto al **directorio actual**.
- Un `pool.entrypoint` relativo se resuelve respecto al **directorio del archivo de configuración**.

```toml
[pool]
entrypoint = "public/index.php"
```

Este ajuste en `/etc/rapira/rapira.toml` se resuelve como `/etc/rapira/public/index.php`. El directorio actual no afecta a la ruta.

## Ejemplos

Invocaciones habituales:

```bash
rapira serve app/dispatcher.php
rapira serve --mode worker app/worker.php
rapira serve --mode classic public/index.php
rapira serve --listen :8080 --processes 8 app/dispatcher.php
rapira serve --listen unix:/run/rapira.sock app/dispatcher.php
rapira serve --config /etc/rapira/rapira.toml
rapira serve --config /etc/rapira/rapira.toml --listen 127.0.0.1:9000
```

El primer comando no establece `--listen`. Por tanto, el servidor usa la dirección predeterminada. Envía una petición con este comando:

```bash
curl http://127.0.0.1:8000/
```

[Inicio rápido](/es/docs/intro/quickstart) contiene los scripts de entrada para `--mode classic` y `--mode worker`. Para Dispatcher, usa `dispatcher-sync.php` o `dispatcher-async.php` del directorio [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples).

## Parar el servidor

El primer `SIGINT` o `SIGTERM` permite terminar las peticiones actuales. Después, el servidor cierra las extensiones y termina. Una segunda señal detiene la espera y fuerza la salida. Envía las señales al proceso maestro. Consulta la tabla completa en [Modelo de procesos](/es/docs/process-model).
