---
title: Instalación
description: "Instala Rapira desde un deb, un rpm o un tarball, comprueba la suma de verificación y consulta qué compilación de libphp lleva cada artefacto."
faqLevel: 2
---

# Instalación

Rapira se distribuye como el binario `rapira` con `libphp` al lado: ese es el intérprete de PHP que el servidor carga en su propio proceso. En el artefacto no hay nada más — ni el comando `php`, ni php-fpm, ni un directorio de ini. No hace falta instalar PHP en la máquina para que Rapira funcione.

::: question ¿Qué es `libphp` y por qué no es «PHP a secas»?
De un mismo código fuente de PHP salen varias interfaces hacia el motor, llamadas SAPI. El motor es siempre el mismo —Zend con sus extensiones—; lo que cambia es la envoltura y quién lleva las riendas del programa:

| SAPI | Qué produce | Quién manda |
| --- | --- | --- |
| CLI | el comando `php` | PHP: arranca, ejecuta un script y termina. |
| FPM | `php-fpm` | PHP: escucha en el socket y mantiene un pool de workers. |
| embed | `libphp.so` | El programa anfitrión: llama al intérprete como a cualquier biblioteca. |

Rapira lleva la compilación embed porque quien conduce la petición es el servidor, no PHP. El comando `php` es otra SAPI para otra tarea, así que ningún artefacto lo incluye.
:::

::: question ¿Por qué `libphp` no se toma del sistema?
Hace falta un PHP compilado con `--enable-embed=shared`: solo esa compilación produce `libphp.so`. Las distribuciones casi nunca la empaquetan, y donde sí lo hacen —`php-embedded` en Fedora y RHEL, `php-embed` en Arch, `libphpX.Y-embed` de deb.sury.org en Debian y Ubuntu— la versión menor y el conjunto de extensiones vienen dados; el `php` de Homebrew ni siquiera trae la SAPI embed. Por eso cada versión de Rapira compila `libphp` a partir del código fuente oficial de PHP y la coloca junto al binario.
:::

::: question ¿Qué significa que «PHP se ejecuta dentro del proceso de Rapira»?
Al arrancar, `libphp` se carga en el espacio de direcciones del proceso `rapira`, así que llamar a PHP es una llamada a función en la misma memoria: sin socket, sin FastCGI y sin serializar la petición ni la respuesta. Eso describe cómo se ejecuta el código: como archivo, la biblioteca sigue siendo independiente y vive junto al binario, y por eso el binario no puede salir de su directorio sin ella (consulta [Tarballs, en Linux y macOS](#tarballs-en-linux-y-macos)).
:::

## Elegir la versión de PHP

Cada descarga lleva `php8.4` o `php8.5` en el nombre: esa es la versión de PHP con cuyo código se compiló la `libphp` que va dentro. Elige la versión menor sobre la que corre tu aplicación y quédate con 8.5 salvo que algo de tu stack exija 8.4.

El PHP que ya tengas en la máquina —el `php` del sistema, un pool de php-fpm, una compilación de Homebrew— Rapira ni lo usa ni lo toca. Ningún artefacto trae el comando `php`, así que Composer, `bin/console` y `artisan` siguen funcionando con tu propio PHP CLI.

::: question ¿Por qué cada versión de PHP tiene su propia compilación de Rapira?
La `libphp` del artefacto no es una dependencia intercambiable, sino parte de la compilación: el binario `rapira` está enlazado con una biblioteca concreta, y su ABI cambia de una versión menor de PHP a la siguiente. Por eso una compilación de Rapira funciona con exactamente una rama de PHP, y la versión va en el nombre del archivo. A cambio no hay paso previo de «instala PHP», ni un `php-config` al que apuntar, ni una versión que mantener sincronizada.
:::

::: question ¿Cómo paso de 8.4 a 8.5?
Instala el paquete de la otra versión y el gestor de paquetes hace el cambio por ti. `rapira-php8.4` y `rapira-php8.5` ocupan exactamente las mismas rutas, así que ambos declaran `provides`, `conflicts` y `replaces` (`obsoletes` en rpm) sobre un paquete virtual `rapira`: nunca conviven, el segundo sustituye al primero. Los tarballs sí pueden convivir: cada uno se descomprime en su propio directorio, de modo que un árbol 8.4 y otro 8.5 pueden estar uno al lado del otro y ejecutarse desde rutas distintas.
:::

## Artefactos de la versión

Todo está en la [página de releases de GitHub](https://github.com/rapira-rs/rapira/releases). La [página de descargas](/es/download) elige el artefacto para tu plataforma —sistema, arquitectura, versión de PHP, formato de paquete— y muestra su SHA-256; cada artefacto `php8.5` tiene su gemelo `php8.4`.

En Linux, coge un paquete si quieres que los archivos queden donde tu distribución los espera y que `apt` o `dnf` instalen las bibliotecas compartidas que PHP necesita; coge un tarball si el servidor tiene que caber en un único directorio autocontenido: una imagen de contenedor, un artefacto de despliegue, una máquina donde no tienes root.

En ambos casos, comprueba el archivo contra `rapira-v0.8.0-SHA256SUMS.txt` antes de instalar; los comandos están en [Comprobar las sumas de verificación](#comprobar-las-sumas-de-verificacion).

::: question ¿Por qué comprobar la suma antes de instalar?
`.deb` y `.rpm` ejecutan sus scripts de instalación como root, así que un archivo manipulado consigue root antes incluso de que arranques el servidor. La comprobación es un solo comando y elimina ese riesgo.
:::

## Debian y Ubuntu

Descarga el `.deb` e instálalo con `apt`, indicando la ruta:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-php8.5_0.8.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.8.0-1_amd64.deb
rapira --version
```

El paquete instala el servidor y nada más: ni unidad de servicio, ni archivo de configuración, ni directorio de ini. Ejecutar Rapira bajo systemd es un paso aparte, descrito en [En producción](/es/docs/deployment).

Los paquetes se compilan contra glibc 2.34, así que los sistemas más antiguos donde se instalan son **Debian 12 y Ubuntu 22.04**. Cualquier cosa más reciente funciona.

::: question ¿Para qué sirve el `./` delante del nombre del archivo?
Ese `./` inicial es lo que le dice a apt que se trata de un archivo local y no de un nombre de paquete que deba buscar en los repositorios.
:::

::: question ¿Qué archivos acaban en el sistema?
Cuatro: el binario `/usr/bin/rapira`, el intérprete `/usr/lib/rapira/libphp.so` y, además, la licencia y el README en `/usr/share/doc/rapira/`. El paquete no cambia nada más.
:::

## RHEL, Rocky y Fedora

Lo mismo, con `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-php8.5-0.8.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.8.0-1.x86_64.rpm
rapira --version
```

El mismo suelo de glibc 2.34 marca el mínimo: **RHEL 9** y sus recompilaciones —Rocky 9, AlmaLinux 9— más cualquier Fedora actual.

## Tarballs, en Linux y macOS

El tarball se descomprime en un único directorio con el servidor entero:

```text
rapira-v0.8.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

Mueve el directorio a donde vaya a quedarse y añade el binario al `PATH` mediante un enlace simbólico:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.8.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.8.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-php8.5-macos-aarch64.tar.gz
tar xzf rapira-v0.8.0-php8.5-macos-aarch64.tar.gz
sudo mv rapira-v0.8.0-php8.5-macos-aarch64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

:::

::: warning
El binario busca su intérprete junto a sí mismo, así que el directorio solo se puede mover entero: `cp bin/rapira /usr/local/bin/` rompe el arranque. Para el `PATH`, usa un enlace simbólico como en los comandos de arriba.
:::

::: question ¿Por qué funciona el enlace simbólico y no una copia del binario?
La ruta al intérprete va grabada en el binario como **rpath relativo** —`$ORIGIN/../lib/rapira` en Linux y `@loader_path/../lib/rapira` en macOS—, y se resuelve desde donde el binario está realmente. Junto a `/usr/local/bin` no hay ningún `lib/rapira`, así que una copia no encuentra el intérprete. El enlace simbólico lo resuelve el cargador antes de expandir el rpath, de modo que el enlace puede estar en cualquier parte mientras el árbol real permanece intacto.
:::

::: question ¿Qué bibliotecas del sistema necesita el tarball?
En macOS, `lib/rapira` contiene `libphp.dylib` junto con todas las bibliotecas no propias del sistema de las que depende, así que el árbol es autocontenido. En Linux solo se incluye `libphp.so`, y las bibliotecas habituales del sistema —OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib— tienen que estar presentes. En una distribución normal ya lo están; son exactamente las que el deb y el rpm declaran como dependencias, junto con glibc y libgcc.
:::

## Comprobar las sumas de verificación

Cada release trae un único archivo de sumas para todos sus artefactos, así que al comprobar hay que seleccionar solo los que has descargado. En Linux lo hace la opción `--ignore-missing`; en macOS, `grep` le pasa a `shasum` la única línea que necesita:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-SHA256SUMS.txt
sha256sum -c --ignore-missing rapira-v0.8.0-SHA256SUMS.txt
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-v0.8.0-SHA256SUMS.txt
grep rapira-v0.8.0-php8.5-macos-aarch64.tar.gz rapira-v0.8.0-SHA256SUMS.txt | shasum -a 256 -c
```

:::

## Docker

`ghcr.io/rapira-rs/rapira` es una imagen de contenedor con el binario `rapira` y la `libphp.so` contra la que se compiló. La imagen se construye `FROM scratch`: no lleva sistema base, ni shell, ni entrypoint, así que por sí sola no se ejecuta. Copia su contenido dentro de tu propia imagen:

```dockerfile
FROM php:8.5-cli-trixie
COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /
COPY . /app
CMD ["rapira", "serve", "--listen", ":8000", "--mode", "classic", "/app/public/index.php"]
```

La imagen lleva `/usr/local/bin/rapira`, `/usr/local/lib/libphp.so` y OPcache. En PHP 8.4, OPcache es un `opcache.so` aparte con su archivo ini; en PHP 8.5 va enlazado dentro de `libphp.so`. En `/usr/local/share/rapira` hay dos archivos más: `PHP_VERSION.txt`, con la versión de parche de la `libphp` incluida, y `debian-packages.txt`, con los paquetes de Debian que `libphp` necesita en una imagen base sin PHP.

La `libphp.so` de la imagen sale de la imagen base oficial de PHP con la que se hizo la compilación: `php:8.4-cli-trixie` o `php:8.5-cli-trixie`. Lleva el conjunto de extensiones de esa imagen, no el de `--disable-all` que describe [La compilación de libphp](#la-compilacion-de-libphp). Las que falten las añades tú en tu imagen base: sobre una imagen base de PHP, `docker-php-ext-install` las compila contra esa misma `libphp.so`.

::: question ¿Por qué la imagen se construye `FROM scratch`?
Una imagen scratch no contiene más que lo que la compilación copia dentro, así que `COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /` se lleva la carga útil y nada más. La imagen base la sigues eligiendo tú, y la copia no le pone encima una segunda distribución.
:::

Cada etiqueta dice su versión menor de PHP, y las de abajo son multiarquitectura: cada una cubre amd64 y arm64.

| Etiqueta | A qué apunta |
| --- | --- |
| `X.Y.Z-php8.4`, `X.Y.Z-php8.5` | Una compilación concreta de un release. La etiqueta no se mueve nunca. |
| `X.Y-php8.4`, `X.Y-php8.5` | El release estable más reciente con esa versión `X.Y`. |
| `php8.4`, `php8.5` | El release estable más reciente. |
| `nightly-php8.4`, `nightly-php8.5` | La compilación nightly más reciente. |

En el registro están además las etiquetas de una sola arquitectura que la compilación genera primero, como `X.Y.Z-php8.5-amd64` y `X.Y.Z-php8.5-arm64`.

No hay etiqueta `latest`. Rapira enlaza las estructuras de Zend al compilarse y se niega a arrancar con una `libphp.so` de otra versión menor de PHP, así que toda etiqueta tiene que decir qué versión menor lleva.

::: question ¿A qué apunta una etiqueta `nightly`?
Cada ejecución de CI que pasa en `main` vuelve a construir las imágenes a partir de ese commit. Esa compilación recibe una etiqueta inmutable `X.Y.Z-nightly.<short-sha>-php8.5`, donde `X.Y.Z` es la versión que lleva el repositorio en ese momento y `<short-sha>` son los siete primeros caracteres del commit. La etiqueta móvil `nightly-php8.5` pasa entonces a apuntar a esa compilación. El registro conserva las diez compilaciones nightly más recientes y borra las anteriores.
:::

## La compilación de libphp

`libphp` se compila con `--disable-all` y luego se vuelve a activar un conjunto fijo de extensiones:

- **Base del runtime**: session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar, posix.
- **OPcache** y PCRE con JIT activado.
- **Red y compresión**: openssl, curl, zlib, sockets, ftp.
- **XML**: libxml, dom, xml, simplexml, xmlreader, xmlwriter.
- **Bases de datos**: PDO con `pdo_sqlite`, y el propio `sqlite3`.
- **Memoria compartida e IPC de System V**: shmop, sysvmsg, sysvsem, sysvshm.
- **Fechas, metadatos de imagen y traducciones**: calendar, exif, gettext.
- **Interfaz de funciones externas**: ffi.
- Todo lo que PHP compila siempre: Core, standard, SPL, date, json, hash, random, Reflection.

Lo que *no* lleva: `pdo_mysql`, `pgsql`, redis, apcu, imagick y demás. Si tu aplicación necesita una de esas extensiones, compila `libphp` con ella y compila Rapira contra esa biblioteca; [Compilar desde el código](/es/docs/intro/build-from-source) explica cómo.

Cada release toma la última versión de parche de la rama que compila. En el tarball la versión exacta está en `share/php/PHP_VERSION.txt`, y en un servidor en marcha la informan `PHP_VERSION` y `phpinfo()`.

::: question ¿Por qué `PHP_SAPI` devuelve `fastcgi` en PHP 8.4?
En PHP 8.4, OPcache solo arranca para una lista fija de nombres de SAPI, y un nombre fuera de esa lista significa quedarse sin caché de opcodes compartida; por eso ahí la SAPI se registra como `fastcgi`. PHP 8.5 eliminó la lista, así que `PHP_SAPI` y `php_sapi_name()` devuelven `rapira`. La línea *Server API* de `phpinfo()` muestra `Rapira` en ambos casos. El código que se ramifica según `PHP_SAPI` tiene que contemplar los dos valores.
:::

## php.ini

Ni los paquetes ni los tarballs incluyen un `php.ini`, y Rapira tampoco lo crea, así que una instalación intacta funciona con los valores por defecto de PHP. Apunta `PHPRC` a un archivo real o al directorio donde buscarlo:

```bash
PHPRC=/etc/rapira/php.ini rapira serve --config /etc/rapira/rapira.toml
```

::: question ¿Dónde busca PHP el `php.ini` por su cuenta?
Como siempre: primero mira `PHPRC`, luego el directorio de trabajo actual y por último la ruta grabada en la compilación, que apunta dentro del directorio donde se compiló PHP y, por tanto, no lleva a ninguna parte en tu máquina.
:::

::: question ¿Por qué el archivo se llama `php.ini` y no `php-rapira.ini`?
PHP busca primero `php-<nombre-de-sapi>.ini` y solo después el `php.ini` normal, y el nombre de la SAPI depende de la versión: `fastcgi` en 8.4 y `rapira` en 8.5. Un `php.ini` normal sirve para las dos.
:::

## Distribución

Las compilaciones se publican en dos sitios: en GitHub Releases, como tarballs, paquetes y un archivo de sumas de verificación, y en `ghcr.io/rapira-rs/rapira`, como imágenes de contenedor. Todavía no hay repositorio para apt ni para yum, así que actualizar consiste en descargar el nuevo artefacto e instalarlo sobre el anterior, no en ejecutar `apt upgrade`. El paquete sustituye al instalado en su sitio; con el tarball, descomprime el nuevo directorio junto al viejo y cambia el enlace simbólico: el árbol anterior sigue donde estaba y volver atrás es un solo comando.

Junto a los releases corre un canal nightly. Cada ejecución de CI que pasa en `main` publica las etiquetas nightly de las imágenes. Esa misma ejecución sube además tarballs a la prepublicación `nightly` de GitHub Releases, que se va renovando. En un commit de release esa subida se salta, porque la compilación del release ya publica esos tarballs en el propio release. La prepublicación lleva solo los tarballs y su archivo de sumas de verificación: no tiene ni `.deb` ni `.rpm`. Una compilación nightly es una compilación de `main`, no un release.

La compilación de macOS es **solo para Apple Silicon**, apunta a **macOS 14 o superior** y va firmada ad hoc: sin Developer ID y sin notarización, así que puede que macOS te pida confirmar la primera ejecución. No hay compilación para Intel. Las compilaciones para Windows se publican aparte, en [rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows), y están pensadas solo para desarrollo local: en producción, Rapira funciona en Linux o macOS.

[Inicio rápido](/es/docs/intro/quickstart) explica cómo atender la primera petición cuando ya tienes el binario en su sitio.
