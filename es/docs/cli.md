---
title: Línea de comandos
description: "El comando rapira serve, su argumento de archivo de configuración, las rutas relativas, las señales de parada y los códigos de salida."
---

# Línea de comandos

Rapira es un único binario con un solo subcomando:

```bash
rapira serve <CONFIG>
```

El comando `serve` inicia PHP, prepara los plugins y atiende peticiones en primer plano. `CONFIG` es la ruta del archivo de configuración y es obligatorio. Cualquier nombre de archivo es válido, y esta documentación usa `rapira.toml`.

Ejecuta `rapira` sin argumentos para mostrar la ayuda. Ejecuta `rapira serve --help` para mostrar la ayuda del comando. Ejecuta `rapira --version` para mostrar la versión instalada.

El archivo de configuración contiene todos los ajustes del servidor. Un valor del archivo sustituye el valor predeterminado. `RUST_LOG` y `NO_COLOR` solo cambian la salida de stderr. Consulta [Configuración](/es/docs/configuration) para ver todas las claves y los formatos de dirección de `listen`.

::: question ¿Puedo definir el modo o la dirección de escucha en la línea de comandos?
No. `rapira serve` solo acepta el archivo de configuración. Define `workers`, `mode` y `entrypoint` en `[http.pool]`. Define `listen` en `[http]`.
:::

## Rutas relativas

Una ruta relativa en el archivo de configuración usa como base el directorio del archivo de configuración. Esto se aplica a `http.pool.entrypoint`, `grpc.pool.entrypoint`, las rutas de escucha `unix:` relativas y todas las demás claves de ruta. Por ejemplo, `entrypoint = "public/index.php"` en `/etc/rapira/rapira.toml` se resuelve como `/etc/rapira/public/index.php`. El directorio actual no afecta a estas rutas. Consulta [Rutas relativas](/es/docs/configuration#relative-paths) para ver la lista de claves de ruta.

## Ejemplo

Este `rapira.toml` atiende HTTP en modo Dispatcher, el modo predeterminado:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/dispatcher.php"
```

Para seleccionar otro modo, define `mode = "worker"` o `mode = "classic"` en `[http.pool]`. Consulta [Modos de ejecución](/es/docs/execution-modes).

Inicia el servidor con la ruta del archivo:

```bash
rapira serve rapira.toml
rapira serve /etc/rapira/rapira.toml
```

El servidor escucha en `127.0.0.1:8000`. Envía una petición con este comando:

```bash
curl http://127.0.0.1:8000/
```

[Inicio rápido](/es/docs/intro/quickstart) contiene los scripts de entrada para los modos Classic y Worker. Para un script de entrada Dispatcher, usa `dispatcher-sync.php` del directorio [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples) del repositorio. Consulta [Modo Dispatcher](/es/docs/dispatcher) para ver la guía de programación.

## Parar el servidor

El primer `SIGTERM`, `SIGINT` o `SIGQUIT` inicia una parada ordenada. Rapira cierra las escuchas, drena las conexiones abiertas dentro de `[server].stop_timeout_secs`, apaga PHP y sale. Pulsar `Ctrl-C` en un terminal envía `SIGINT` y realiza la misma parada ordenada.

Un segundo `SIGTERM` o `SIGINT` durante el drenaje fuerza una salida inmediata con el código `130`. Consulta [Modelo de procesos](/es/docs/process-model) para ver la tabla completa de señales.

## Códigos de salida {#exit-codes}

| Código | Significado |
| --- | --- |
| `0` | El servidor se detuvo de forma ordenada. `--help`, `--version` y `rapira` sin argumentos también salen con `0`. |
| `1` | Fallo de arranque o de ejecución, como una configuración no válida, un archivo ilegible, un error de enlace, un error de configuración de PHP o `SIGRTMAX`, o un fallo de escucha. El error está en stderr. |
| `2` | La línea de comandos no es válida, por ejemplo una opción desconocida o la falta de `CONFIG`. |
| `70` | Un worker residente alcanzó `max_boot_failures` antes de que su pool atendiera una unidad. |
| `101` | Un hilo worker de PHP entró en pánico. |
| `124` | Todos los workers de un pool permanecieron bloqueados después del plazo de gracia de 5 segundos tras `request_terminate_timeout_secs`. |
| `130` | Un segundo `SIGTERM` o `SIGINT` llegó durante una parada y forzó la salida. |
