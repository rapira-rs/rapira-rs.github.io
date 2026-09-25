---
title: Línea de comandos
description: "El comando rapira serve, su argumento de archivo de configuración y la resolución de la ruta del script de entrada."
---

# Línea de comandos

Rapira es un único binario con un solo subcomando:

```bash
rapira serve <CONFIG>
```

El comando `serve` inicia PHP, registra las extensiones incorporadas y acepta peticiones. `CONFIG` es la ruta del archivo de configuración. Es obligatorio. Cualquier nombre de archivo es válido, y esta documentación usa `rapira.toml`. Ejecuta `rapira` sin argumentos para mostrar la ayuda. Ejecuta `rapira serve --help` para mostrar la ayuda del comando. Ejecuta `rapira --version` para mostrar la versión instalada.

El archivo de configuración contiene todos los ajustes del servidor. Un valor del archivo sustituye el valor predeterminado. `RUST_LOG` y `NO_COLOR` solo cambian la salida de stderr. Consulta [Configuración](/es/docs/configuration) para ver todas las claves y los formatos de dirección de `listen`.

## Resolución del script de entrada

`http.pool.entrypoint` indica el script PHP de entrada. Una ruta relativa se resuelve respecto al directorio del archivo de configuración. Rapira convierte la ruta en una ruta absoluta antes de crear los workers. Esto evita que los cambios posteriores del directorio de trabajo afecten a la ruta.

```toml
[http.pool]
entrypoint = "public/index.php"
```

Este ajuste en `/etc/rapira/rapira.toml` se resuelve como `/etc/rapira/public/index.php`. El directorio actual no afecta a la ruta.

## Ejemplos

Cada ejemplo es un `rapira.toml` completo. El modo Dispatcher es el predeterminado:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "app/dispatcher.php"
mode = "dispatcher"
```

Modo Worker:

```toml
[http]
listen = ":8080"

[http.pool]
entrypoint = "app/worker.php"
mode = "worker"
```

Modo Classic:

```toml
[http]
listen = "unix:/run/rapira.sock"

[http.pool]
entrypoint = "public/index.php"
mode = "classic"
```

Inicia el servidor con la ruta del archivo:

```bash
rapira serve rapira.toml
rapira serve /etc/rapira/rapira.toml
```

El primer ejemplo escucha en `127.0.0.1:8000`. Envía una petición con este comando:

```bash
curl http://127.0.0.1:8000/
```

[Inicio rápido](/es/docs/intro/quickstart) contiene los scripts de entrada para los modos Classic y Worker. Para Dispatcher, usa `dispatcher-sync.php` o `dispatcher-async.php` del directorio [`examples/`](https://github.com/rapira-rs/rapira/tree/main/examples).

## Parar el servidor

El primer `SIGINT` o `SIGTERM` permite terminar las peticiones actuales. Después, el servidor cierra las extensiones y termina. Una segunda señal detiene la espera y fuerza la salida. Envía las señales al proceso maestro. Consulta la tabla completa en [Modelo de procesos](/es/docs/process-model).
