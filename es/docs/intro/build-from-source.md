---
title: Compilar desde el código
description: Requisitos e instrucciones para compilar Rapira en Linux y macOS.
---

# Compilar desde el código

Rapira se compila desde el código en Linux y macOS. Una compilación desde el código puede admitir plataformas y extensiones de PHP que los binarios precompilados no admiten. La compilación requiere Rust, herramientas de C y una biblioteca de PHP que se pueda incrustar. Consulta [Instalación](/es/docs/intro/installation) para los binarios precompilados.

## Cuándo compilar desde el código

- **Ningún binario precompilado admite la plataforma.** Por ejemplo, una arquitectura de CPU poco habitual.
- **La distribución es más antigua que los requisitos de los paquetes.** Los binarios de PHP 8.4 y PHP 8.5 requieren glibc 2.34 y OpenSSL 3.0 o posterior (Debian 12, Ubuntu 22.04, RHEL 9). Los binarios de PHP 8.6 requieren OpenSSL 3.3 y RHEL 9.7 o posterior.
- **La aplicación necesita otras extensiones de PHP.** Las compilaciones publicadas incluyen SQLite, PostgreSQL mediante `pdo_pgsql` y `pgsql`, `bcmath`, `intl`, `sodium` e `igbinary` en PHP 8.4 y PHP 8.5. Consulta [Instalación](/es/docs/intro/installation) para ver la lista completa. Compila con otro PHP cuando la aplicación necesite extensiones como `pdo_mysql` o `gd`.
- **Modificas Rapira** o necesitas un cambio que no está en una versión publicada.

## Las herramientas

La compilación requiere estas herramientas:

- **Rust estable.** Instala Rust mediante [rustup](https://rustup.rs/). `rust-toolchain.toml` selecciona el canal estable automáticamente. Un paquete de Rust de la distribución puede tener una versión más antigua.
- **Un compilador de C.** La compilación compila pequeños archivos de interfaz de C con las cabeceras de PHP.
- **libclang.** Bindgen lo usa para crear los enlaces de la API de Zend durante la compilación. El paquete se llama `libclang-dev` en Debian y Ubuntu, `clang-devel` en Fedora y `clang` en Arch.

## PHP con el SAPI embed

Rapira enlaza el intérprete de PHP en su proceso y no usa un socket. Compila PHP thread-safe (ZTS) 8.4, 8.5 u 8.6 con `--enable-zts --enable-embed=shared --disable-zend-signals`. Esta opción crea `libphp.so`, o `libphp.dylib` en macOS.

Múltiples workers con OPcache activado requieren la [corrección de bloqueo de hilos de PHP](https://github.com/php/php-src/commit/36c6d1f500f7ec477f6eae0b0f5c46b041d82347). Rapira comprueba la versión de PHP 8.4.29, 8.5.14 o 8.6.1 o posterior en cada versión menor.

::: info Alternativa con PHP NTS
Los paquetes embed de las distribuciones suelen ser non-thread-safe (NTS). Una compilación enlazada con PHP NTS ejecuta un pool con un solo worker. Rapira emite una advertencia cuando `workers` es mayor que `1` y rechaza un segundo pool PHP.
:::

Varias distribuciones empaquetan una SAPI embed NTS:

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora
sudo pacman -S php php-embed                  # Arch
```

::: warning En macOS no hay ningún paquete con el SAPI embed
La fórmula `php` de Homebrew no incluye el SAPI embed. Compila PHP desde el código fuente en macOS.
:::

### Compilar PHP desde el código fuente

Compila PHP ZTS desde el código fuente para usar múltiples workers o extensiones personalizadas.

El archivo `.github/php-configure-flags.txt` contiene las opciones de configuración de las extensiones incluidas en los releases de PHP. Entre ellas están `bcmath`, `intl`, `pdo_pgsql`, `pgsql` y `sodium`.

Instala las dependencias de compilación en Debian o Ubuntu:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl git autoconf bison re2c libclang-dev llvm-dev libssl-dev libcurl4-openssl-dev libxml2-dev libonig-dev libsqlite3-dev zlib1g-dev libffi-dev libicu-dev libpq-dev libargon2-dev libreadline-dev libsodium-dev
```

Instala las dependencias de compilación en macOS:

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq argon2 readline libsodium
export PATH="$(brew --prefix bison)/bin:$PATH"
```

Desde el directorio de código fuente de Rapira, ejecuta el objetivo `php` con una copia dedicada de `php-src`:

```bash
make php PHP_SRC=/path/to/php-src
```

El objetivo compila PHP ZTS con la biblioteca embed compartida y lo instala en `$HOME/.local/share/php-zts`. Activa `sodium` en el directorio `etc/php/conf.d` del prefijo. Define `PHP_PREFIX` para instalarlo en otra ubicación.

Para el conjunto de extensiones de los releases, configura PHP directamente en su directorio de código fuente:

```bash
./buildconf --force
./configure --prefix="$HOME/.local/share/php-zts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

Las compilaciones publicadas en PHP 8.4 y PHP 8.5 también compilan `igbinary` dentro de `libphp`. [El script de compilación](https://github.com/rapira-rs/rapira/blob/main/.github/build-php.sh) fija su versión de código fuente y su suma de verificación. Rapira no incluye `redis`.

### El nombre `libphp.so` a secas

La compilación enlaza con `-lphp`. Busca en `lib` y `lib64` dentro del prefijo de PHP. Uno de estos directorios debe contener `libphp.so`, o `libphp.dylib` en macOS. Debian y Ubuntu solo incluyen el nombre con versión `libphp8.4.so`. Crea un enlace con el nombre necesario en el directorio `lib` o `lib64` del prefijo:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
```

Sin acceso root, pon el enlace en un directorio del usuario. Configura el enlazador y el cargador para que lo usen:

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="--cfg tokio_unstable -L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## Compilar Rapira

Después de instalar PHP, compila Rapira con Cargo:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
export PHP_CONFIG="$HOME/.local/share/php-zts/bin/php-config"
export LD_LIBRARY_PATH="$("$PHP_CONFIG" --prefix)/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" # Linux
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--cfg tokio_unstable"
cargo build --release
```

El lector de archivos de Tokio usa io_uring en Linux cuando el kernel lo permite. Conserva `--cfg tokio_unstable` cuando definas `RUSTFLAGS`. La compilación escribe el binario en `target/release/rapira`.

::: tip
Ejecuta `make test` para validar la configuración de la compilación. Encuentra `libphp.so` o `libphp.dylib` mediante `PHP_CONFIG` y pasa `--cfg tokio_unstable` automáticamente.
:::

## Ejecutar el binario que has compilado

Rapira carga `libphp.so`, o `libphp.dylib`, cuando el proceso se inicia. Una biblioteca en un directorio estándar del sistema no necesita configuración adicional. Para otro directorio, configura el cargador. La biblioteca cargada debe tener la misma versión menor de PHP que el PHP que `php-config` seleccionó para la compilación. Si no, Rapira se detiene en el arranque con un error.

Usa el `worker.php` de [Inicio rápido](/es/docs/intro/quickstart). Crea `rapira.toml` junto a él:

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

```bash
LD_LIBRARY_PATH="$HOME/.local/share/php-zts/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml         # Linux
DYLD_LIBRARY_PATH="$HOME/.local/share/php-zts/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml   # macOS
```

::: tip OPcache en PHP 8.4
PHP 8.4 compila OPcache como un archivo `opcache.so` separado. Define `zend_extension` con su ruta absoluta en `php.ini` para cargarlo. PHP 8.5 y PHP 8.6 incluyen OPcache en `libphp`.
:::

El resultado tiene las mismas funciones que un servidor empaquetado. Consulta [Inicio rápido](/es/docs/intro/quickstart), [CLI](/es/docs/cli) y [Configuración](/es/docs/configuration).

## Trabajar en el propio Rapira

`make test` ejecuta los tests unitarios y los tests de extremo a extremo. `make stubs` regenera cada cabecera `*_arginfo.h` a partir del archivo `*.stub.php` que está junto a ella en `crates/`. Usa el `gen_stub.php` de PHP. Define `GEN_STUB` cuando `make` no encuentra ese archivo. En cada pull request, CI ejecuta la compilación, los tests, `cargo fmt`, Clippy y la cobertura.

- `make test_unit` ejecuta los tests unitarios del workspace.
- `make test_e2e` compila el servidor y ejecuta los tests de extremo a extremo basados en el binario en serie. `make test` ejecuta ambas suites en orden.
- `make coverage` escribe la cobertura unitaria y de extremo a extremo en `lcov.info`. Requiere `cargo-llvm-cov` y el componente de Rust `llvm-tools-preview`.
- `make grpc_fixtures` regenera los descriptores de prueba de gRPC. Usa Go por defecto. Define `BUF=/path/to/buf` para usar un ejecutable Buf instalado.

Consulta la [guía de contribución del núcleo](https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md) para conocer la ubicación de los tests y los comandos de lint y fuzzing. El flujo de fuzzing ejecuta cada objetivo durante 60 segundos en los pull requests y durante 30 minutos dos veces por semana.
