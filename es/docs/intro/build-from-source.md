---
title: Compilar desde el código
description: "Cuándo y cómo compilar Rapira tú mismo - las herramientas de Rust y C, un PHP NTS con el SAPI embed y los detalles del enlazado en Linux y macOS."
---

# Compilar desde el código

Rapira se compila desde el código en Linux y macOS. Compilarlo tú mismo resuelve los casos que no cubren los binarios ya compilados de la página [Instalación](/es/docs/intro/installation), y el único requisito más allá de las herramientas habituales de Rust y C es un PHP que Rapira pueda incrustar.

## Cuándo compilar desde el código

- **No hay binario para tu plataforma**: una arquitectura de CPU poco habitual, o una distro basada en musl como Alpine.
- **Tu distribución es más antigua de lo que admiten los paquetes.** Las releases se compilan contra glibc 2.34, así que Debian 12, Ubuntu 22.04 y RHEL 9 son las versiones más antiguas donde llegan a instalarse (lo tienes en [Instalación](/es/docs/intro/installation)).
- **Necesitas otro conjunto de extensiones de PHP.** Las compilaciones de release incluyen un PHP construido con la lista de flags de [`ci/php-configure-flags.txt`](https://github.com/rapira-rs/rapira/blob/main/ci/php-configure-flags.txt), que es corta a propósito: session, mbstring, OPcache, OpenSSL, curl, la familia XML y PDO con SQLite. Si tu aplicación necesita `pdo_mysql`, `intl` o `gd`, compila Rapira contra un PHP que las traiga.
- **Estás trabajando en el propio Rapira**, o quieres algo que todavía no se ha publicado.

## Las herramientas

La compilación requiere estas herramientas:

- **Rust, canal estable.** El archivo `rust-toolchain.toml` selecciona la versión mediante [rustup](https://rustup.rs/).
- **Un compilador de C y `pkg-config`.** La compilación crea pequeños adaptadores de C con las cabeceras de PHP.
- **libclang.** Bindgen lo usa para crear los enlaces de la API de Zend. El paquete se llama `libclang-dev` en Debian y Ubuntu, `clang-devel` en Fedora y `clang` en Arch.

## PHP con el SAPI embed

Rapira enlaza el intérprete en su proceso y no usa un socket. PHP debe ser una biblioteca compartida NTS, versión 8.4 u 8.5.
Configura PHP con `--enable-embed=shared`. Esta opción crea `libphp.so`, o `libphp.dylib` en macOS.

::: warning Las compilaciones ZTS se rechazan
Un PHP con seguridad de hilos causa un error de compilación. Rapira requiere NTS porque ejecuta un intérprete en cada proceso worker.
Si `PATH` selecciona una compilación ZTS, instala PHP NTS. Define `PHP_CONFIG` con la ruta de su `php-config`.
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

El archivo `ci/php-configure-flags.txt` contiene las opciones de las compilaciones publicadas. Pásalo a `configure` dentro del código fuente de PHP extraído.
Añade las opciones de las extensiones necesarias:

```bash
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/ci/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

En macOS, instala antes las dependencias (`brew install pkg-config openssl@3 curl oniguruma libxml2 sqlite`), mete sus directorios `lib/pkgconfig` en `PKG_CONFIG_PATH` y añade `--with-iconv="$(xcrun --show-sdk-path)/usr"` después del archivo de flags: un `--with-iconv` a secas no encuentra ahí libiconv, y en autoconf gana la última forma.

### El nombre `libphp.so` a secas

La compilación enlaza con `-lphp` y solo busca en `lib` y `lib64` dentro del prefijo de PHP, así que en uno de esos dos directorios tiene que haber un archivo llamado exactamente `libphp.so` (o `libphp.dylib`). Debian y Ubuntu traen únicamente el nombre con versión, `libphp8.4.so`; la copia de Alpine sí lleva el nombre a secas, pero vive en `lib/phpXX`, que no se busca. En ambos casos el enlazado falla hasta que pongas un symlink con el nombre a secas en el `lib` o `lib64` del prefijo:

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
sudo ln -sf /usr/lib/php84/libphp.so /usr/lib/libphp.so     # Alpine
```

Si no tienes root, crea el symlink en un directorio tuyo y apunta hacia él tanto el enlazador como el cargador:

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="-L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## Compilar Rapira

Con PHP ya en su sitio, compilar es un `cargo build` de lo más normal:

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
cargo build --release
```

El binario aparece en `target/release/rapira`.

PHP se descubre a través de `php-config`. Si el que hay en el `PATH` no es la compilación que quieres que Rapira incruste, indícala de forma explícita:

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
`make test` ejecuta las suites de tests y resuelve por ti las rutas de las bibliotecas: busca la biblioteca embed bajo el prefijo de `php-config` (`lib`, `lib64`, `lib/phpXX`, con el nombre a secas o con versión) y la normaliza al nombre a secas que quiere el enlazador. Ejecútalo para comprobar el montaje antes de fiarte de tu propia compilación.
:::

## Ejecutar el binario que has compilado

En tiempo de ejecución, Rapira carga `libphp.so` (`libphp.dylib` en macOS) de forma dinámica. Si está en una ruta estándar no hay nada que hacer; si no, apunta el cargador hacia ella:

```bash
LD_LIBRARY_PATH="$HOME/.local/php-nts/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ./target/release/rapira serve --mode worker worker.php         # Linux
DYLD_LIBRARY_PATH="$HOME/.local/php-nts/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ./target/release/rapira serve --mode worker worker.php   # macOS
```

El resultado es el mismo servidor que instalan los paquetes: [Inicio rápido](/es/docs/intro/quickstart) te guía por un primer script, [CLI](/es/docs/cli) enumera lo que acepta `serve` y [Configuración](/es/docs/configuration) cubre `rapira.toml`.

## Trabajar en el propio Rapira

`make test` ejecuta las dos suites -la que corre dentro del mismo proceso y la de extremo a extremo, que lanza el binario de verdad-, `make stubs` regenera la cabecera de arginfo a partir de `crates/php_sys/rapira.stub.php`, y CI ejecuta la compilación, `cargo fmt`, clippy y la cobertura en cada pull request.
