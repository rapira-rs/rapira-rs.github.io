---
title: Línea de comandos
description: "El comando rapira serve, su argumento de archivo de configuración, las rutas relativas, las señales de parada y los códigos de salida."
---

# Línea de comandos

Rapira es un único binario con un solo subcomando:

```bash
rapira serve <CONFIG>
```

El comando `serve` inicia PHP, prepara los plugins y atiende peticiones. `CONFIG` es la ruta del archivo de configuración y es obligatorio. Cualquier nombre de archivo es válido, y esta documentación usa `rapira.toml`.

Ejecuta `rapira` sin argumentos para mostrar la ayuda. Ejecuta `rapira serve --help` para mostrar la ayuda del comando. Ejecuta `rapira --version` para mostrar la versión instalada.

El archivo de configuración contiene todos los ajustes del servidor. Un valor del archivo sustituye el valor predeterminado. `RUST_LOG` y `NO_COLOR` solo cambian la salida de stderr. Consulta [Configuración](/es/docs/configuration) para ver todas las claves y los formatos de dirección de `listen`.

::: question ¿Puedo definir el modo o la dirección de escucha en la línea de comandos?
No. `rapira serve` solo acepta el archivo de configuración. Define `processes`, `mode` y `entrypoint` en `[http.pool]`. Define `listen` en `[http]`.
:::

## Rutas relativas

Una ruta relativa del archivo usa como base el directorio del archivo de configuración. Esto se aplica a `http.pool.entrypoint`, `grpc.pool.entrypoint` y las demás claves de ruta. Por ejemplo, `entrypoint = "public/index.php"` en `/etc/rapira/rapira.toml` se resuelve como `/etc/rapira/public/index.php`. El directorio actual no afecta a estas rutas. Una ruta `unix:` relativa de `listen` es diferente: usa el directorio actual del comando `rapira serve`. Consulta [Rutas relativas](/es/docs/configuration#rutas-relativas) para ver la lista de claves de ruta.

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

El primer `SIGTERM` o `SIGINT` inicia una parada ordenada. Los workers no aceptan trabajo nuevo y terminan las peticiones actuales. Después, el maestro cierra PHP y termina. Un segundo `SIGTERM` o `SIGINT` detiene la espera y fuerza la salida. Envía las señales al proceso maestro. Consulta la tabla completa de señales en [Modelo de procesos](/es/docs/process-model).

Ctrl-C en un terminal envía `SIGINT` al maestro y a cada worker. Después, el maestro envía `SIGQUIT` a cada worker. Así, cada worker recibe una segunda señal y sale al instante con el código `131`. Las peticiones actuales no terminan. Para una parada ordenada, envía `SIGTERM` solo al maestro, por ejemplo `kill -TERM <master-pid>`. systemd con `KillMode=mixed` y `docker stop` también envían la señal solo al maestro.

## Códigos de salida

| Código | Significado |
| --- | --- |
| `0` | El servidor se paró y todos los workers salieron. `--help`, `--version` y `rapira` sin argumentos también salen con `0`. |
| `1` | El servidor no se inició. Por ejemplo, la configuración no es válida, Rapira no puede leer un archivo, una escucha no puede enlazar la dirección o PHP no puede iniciarse. El error está en stderr. |
| `2` | La línea de comandos no es válida, por ejemplo una opción desconocida o la falta de `CONFIG`. |
| `70` | El maestro falló después de iniciarse. Por ejemplo, el total de workers de todos los pools es mayor que 2048, o el maestro no puede escribir el pidfile. Un worker unhealthy de la generación cero también causa esta salida si su pool no tiene ninguna petición correcta ni ningún worker idle o active. La generación cero identifica los workers creados antes de la primera recarga. El registro tiene una entrada `master failed`. |
| `130` | Un `SIGTERM` o `SIGINT` llegó durante una parada y forzó la salida. |
