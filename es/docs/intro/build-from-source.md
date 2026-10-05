---
title: Compilar desde el código
description: Requisitos e instrucciones para compilar Rapira en Linux y macOS.
---

# Compilar desde el código

Rapira se compila desde el código en Linux y macOS. Una compilación desde el código puede admitir plataformas y extensiones de PHP que los binarios precompilados no admiten. La compilación requiere Rust, herramientas de C y una biblioteca de PHP que se pueda incrustar. Consulta [Instalación](/es/docs/intro/installation) para los binarios precompilados.

## Cuándo compilar desde el código

- **Ningún binario precompilado admite la plataforma.** Por ejemplo, una arquitectura de CPU poco habitual y una distribución basada en musl como Alpine.
- **La distribución es más antigua que los requisitos de los paquetes.** Los binarios publicados requieren glibc 2.34 o posterior. Los sistemas compatibles más antiguos son Debian 12, Ubuntu 22.04 y RHEL 9.
- **La aplicación necesita otras extensiones de PHP.** Las compilaciones publicadas incluyen SQLite, PostgreSQL mediante `pdo_pgsql` y `pgsql`, `bcmath`, `intl`, `igbinary` y `redis`. Consulta [Instalación](/es/docs/intro/installation) para ver la lista completa. Compila con otro PHP cuando la aplicación necesite extensiones como `pdo_mysql` o `gd`.
- **Modificas Rapira** o necesitas un cambio que no está en una versión publicada.

## Las herramientas

La compilación requiere estas herramientas:

- **Rust 1.99 o posterior.** Instala Rust mediante [rustup](https://rustup.rs/). El archivo `rust-toolchain.toml` del repositorio selecciona el canal estable. Si la versión estable instalada es anterior a 1.99, ejecuta `rustup update stable`. Un paquete de Rust de la distribución puede ser demasiado antiguo.
- **Un compilador de C.** La compilación compila pequeños archivos de interfaz de C con las cabeceras de PHP.
- **libclang.** Bindgen lo usa para crear los enlaces de la API de Zend durante la compilación. El paquete se llama `libclang-dev` en Debian y Ubuntu, `clang-devel` en Fedora y `clang` en Arch.

## PHP con el SAPI embed

Rapira enlaza el intérprete de PHP en su proceso y no usa un socket. PHP debe ser una biblioteca compartida NTS, versión 8.4 u 8.5. Configura PHP con `--enable-embed=shared`. Esta opción crea `libphp.so`, o `libphp.dylib` en macOS.

::: warning La compilación rechaza ZTS
Un PHP con seguridad de hilos causa un error de compilación. Rapira requiere NTS porque ejecuta un intérprete en cada proceso worker. Si `PATH` selecciona una compilación ZTS, instala PHP NTS. Define `PHP_CONFIG` con la ruta de su `php-config`.
:::

Varias distribuciones ya empaquetan el SAPI embed:

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora/RHEL
sudo pacman -S php php-embed                  # Arch
sudo apk add php84-dev php84-embed            # Alpine
```

::: warning En macOS no hay ningún paquete con el SAPI embed
La fórmula `php` de Homebrew no incluye el SAPI embed. Compila PHP desde el código fuente en macOS.
:::

### Compilar PHP desde el código fuente

Compila PHP cuando no haya un paquete embed. Compílalo también cuando el paquete no incluya las extensiones necesarias.

El archivo `.github/php-configure-flags.txt` contiene las opciones de las extensiones distribuidas con PHP. Entre ellas están `bcmath`, `intl`, `pdo_pgsql` y `pgsql`.

Instala las bibliotecas de desarrollo de ICU y del cliente PostgreSQL para habilitar `intl` y PostgreSQL. Los paquetes se llaman `libicu-dev` y `libpq-dev` en Debian o Ubuntu, y `libicu-devel` y `libpq-devel` en Rocky Linux. La extensión `intl` también requiere un compilador de C++.

En Debian o Ubuntu, instala las dependencias de compilación:

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl git autoconf bison re2c libclang-dev llvm-dev libssl-dev libcurl4-openssl-dev libxml2-dev libonig-dev libsqlite3-dev zlib1g-dev libffi-dev libicu-dev libpq-dev
```

En macOS, instala las dependencias de compilación:

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq
export PATH="$(brew --prefix bison)/bin:$PATH"
```

Desde el directorio de código fuente de Rapira, ejecuta el objetivo `php`:

```bash
make php PHP_SRC=/path/to/php-src PHP_PREFIX="$HOME/.local/php-nts"
```

El objetivo ejecuta `buildconf`, configura PHP, lo compila y lo instala en `PHP_PREFIX`. Activa las extensiones distribuidas con PHP que figuran en `.github/php-configure-flags.txt`. Detecta macOS y configura las rutas de las bibliotecas de Homebrew y la ruta del SDK para iconv.

Para un conjunto personalizado de extensiones, configura PHP directamente en su directorio de código fuente. Añade las opciones de las extensiones necesarias a `./configure`:

```bash
./buildconf --force
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

Para configurar PHP manualmente en macOS, usa las rutas de bibliotecas y las opciones de configuración del objetivo `php`.

Los objetivos de `make` no añaden `igbinary` ni `redis`. El CI de publicación compila ambos dentro de `libphp` y activa la serialización igbinary para Redis. [El flujo de publicación](https://github.com/rapira-rs/rapira/blob/main/.github/workflows/build-binaries.yml) fija sus versiones de código fuente y sus sumas de verificación. Para añadirlos, extrae sus fuentes en los directorios `ext/igbinary` y `ext/redis` de PHP. Haz esto antes de ejecutar `./buildconf --force`. Después añade `--enable-igbinary --enable-redis --enable-redis-igbinary` a `./configure`.

### El nombre `libphp.so` a secas

La compilación enlaza con `-lphp`. Solo busca en `lib` y `lib64` dentro del prefijo de PHP. Uno de estos directorios debe contener `libphp.so`, o `libphp.dylib` en macOS. Debian y Ubuntu solo incluyen el nombre con versión `libphp8.4.so`. Alpine pone `libphp.so` en `lib/phpXX`, donde la compilación no busca. Crea un enlace con el nombre necesario en el directorio `lib` o `lib64` del prefijo:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
sudo ln -sf /usr/lib/php84/libphp.so /usr/lib/libphp.so     # Alpine
```

Sin acceso root, pon el enlace en un directorio del usuario. Configura el enlazador y el cargador para que lo usen:

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="-L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## Compilar Rapira

Después de instalar PHP, compila Rapira con Cargo:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
cargo build --release
```

La compilación escribe el binario en `target/release/rapira`.

La compilación encuentra PHP mediante `php-config`. Define `PHP_CONFIG` cuando `PATH` no selecciona el PHP necesario:

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
Ejecuta `make test` para validar la configuración de la compilación. Busca la biblioteca de PHP en `lib`, `lib64` o `lib/phpXX` dentro del prefijo de PHP. Acepta los nombres de biblioteca a secas y con versión, y crea el nombre a secas que necesita el enlazador.
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
LD_LIBRARY_PATH="$HOME/.local/php-nts/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml         # Linux
DYLD_LIBRARY_PATH="$HOME/.local/php-nts/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml   # macOS
```

::: tip OPcache en PHP 8.4
PHP 8.4 compila OPcache como un archivo `opcache.so` separado. Añade `zend_extension=opcache` a `php.ini` para cargarlo. PHP 8.5 incluye OPcache en `libphp`.
:::

El resultado tiene las mismas funciones que un servidor empaquetado. Consulta [Inicio rápido](/es/docs/intro/quickstart), [CLI](/es/docs/cli) y [Configuración](/es/docs/configuration).

## Trabajar en el propio Rapira

`make test` ejecuta los tests unitarios y los tests de extremo a extremo. `make stubs` regenera cada cabecera `*_arginfo.h` a partir del archivo `*.stub.php` que está junto a ella en `crates/`. Usa el `gen_stub.php` de PHP. Define `GEN_STUB` cuando `make` no encuentra ese archivo. En cada pull request, CI ejecuta la compilación, los tests, `cargo fmt`, Clippy y la cobertura.

- `make test_nts` ejecuta los tests unitarios del workspace.
- `make test_e2e` compila el servidor y ejecuta los tests de extremo a extremo sobre el binario. Ejecútalo por separado de `test_nts`. `make test` ejecuta ambos en secuencia.
- `make coverage` escribe la cobertura unitaria y de extremo a extremo en `lcov.info`. Requiere `cargo-llvm-cov` y el componente de Rust `llvm-tools-preview`.
- `make grpc_fixtures` regenera los descriptores de prueba de gRPC. Usa Go por defecto. Define `BUF=/path/to/buf` para usar un ejecutable Buf instalado.

Consulta la [guía de contribución del núcleo](https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md) para conocer la ubicación de los tests y los comandos de lint y fuzzing. El flujo de fuzzing ejecuta cada objetivo durante 60 segundos en los pull requests y durante 30 minutos dos veces por semana.
