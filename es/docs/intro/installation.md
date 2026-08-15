---
title: Instalación
description: "Instala Rapira desde un deb, un rpm o un tarball, comprueba la descarga y consulta qué compilación de PHP lleva dentro cada artefacto."
---

# Instalación

Rapira se distribuye como un binario más el PHP que lleva incrustado.

Rapira ejecuta PHP a través del SAPI embed, la interfaz que permite a un programa alojar el intérprete como si fuera una biblioteca. Para usarla hace falta un PHP compilado con `--enable-embed=shared`, que genera un `libphp.so`. Hay distribuciones que lo empaquetan —`php-embedded` en Fedora y RHEL, `php-embed` en Arch, `libphpX.Y-embed` de deb.sury.org en Debian y Ubuntu—, pero entonces aceptas tal cual la versión menor y el conjunto de extensiones que hayan elegido (y el `php` de Homebrew ni siquiera trae el SAPI embed). Cada versión de Rapira compila PHP desde el tarball oficial de código fuente y coloca el resultado junto al binario `rapira`.

## Elegir la versión de PHP

Cada descarga viene etiquetada como `php8.4` o `php8.5`, y esa etiqueta describe el PHP que va *dentro* del paquete. No hay ningún paso previo de «instala PHP primero», ningún `php-config` al que apuntar, ninguna versión que mantener sincronizada. Si ya tienes PHP en la máquina —el `php` del sistema, un pool de php-fpm, una compilación de Homebrew—, Rapira ni lo usa ni lo toca. Ningún artefacto trae un comando `php`, así que las herramientas que rodean a tu aplicación —Composer, `bin/console`, `artisan`— siguen necesitando su propio PHP de línea de comandos.

La única decisión es sobre qué versión menor corre tu aplicación: **8.4** u **8.5**. Usa 8.5 salvo que algo de tu stack exija 8.4.

Los paquetes deb y rpm imponen esa restricción. `rapira-php8.4` y `rapira-php8.5` instalan exactamente las mismas rutas, así que ambos declaran `provides`, `conflicts` y `replaces` (`obsoletes` en rpm) sobre un paquete virtual `rapira`: se excluyen mutuamente, y al instalar uno ocupa el lugar del otro en vez de acabar a su lado. Así es también como cambias de versión de PHP: instala el otro paquete y el gestor de paquetes hace el cambio. Los tarballs no se excluyen entre sí: cada uno se descomprime en su propio directorio, de modo que un árbol de 8.4 y otro de 8.5 pueden convivir y ejecutarse desde rutas distintas.

## Artefactos de la versión

Todo está en la [página de releases de GitHub](https://github.com/rapira-rs/rapira/releases). La [página de descarga](/es/download) elige el artefacto adecuado para tu plataforma —sistema operativo, arquitectura, versión de PHP, formato de paquete— y muestra su SHA-256; cada artefacto con `php8.5` tiene su equivalente con `php8.4`.

En Linux usa un paquete si quieres que los archivos queden donde tu distribución los espera y que `apt` o `dnf` traigan las bibliotecas compartidas que PHP necesita; usa un tarball si quieres el servidor en un único directorio autocontenido: una imagen de contenedor, un artefacto de despliegue, una máquina donde no eres root. Compara cualquiera de los dos con `rapira-v0.6.0-SHA256SUMS.txt` antes de instalarlo, porque un `.deb` o un `.rpm` ejecuta sus scripts de instalación como root. Tienes los comandos en [Comprobar las sumas de verificación](#comprobar-las-sumas-de-verificacion).

## Debian y Ubuntu

Descarga el `.deb` e instálalo con `apt` indicando la ruta: ese `./` inicial es lo que le indica a apt que se trata de un archivo local y no del nombre de un paquete que deba buscar.

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5_0.6.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.6.0-1_amd64.deb
rapira --version
```

El paquete instala cuatro archivos: el binario en `/usr/bin/rapira`, el intérprete incorporado en `/usr/lib/rapira/libphp.so`, y la licencia y el README en `/usr/share/doc/rapira/`. No se toca nada más: ni unidad de servicio, ni archivo de configuración, ni directorio de ini. Ejecutar Rapira bajo systemd es un paso aparte. Consulta [En producción](/es/docs/deployment) para más información.

Los paquetes están compilados contra glibc 2.34, así que las versiones más antiguas en las que se instalan son **Debian 12 y Ubuntu 22.04**. De ahí en adelante, todo funciona.

## RHEL, Rocky y Fedora

El mismo patrón, con `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5-0.6.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.6.0-1.x86_64.rpm
rapira --version
```

Ese mismo suelo de glibc 2.34 sitúa la base en **RHEL 9** y sus recompilaciones —Rocky 9, AlmaLinux 9—, más cualquier Fedora actual.

## Tarballs, en Linux y macOS

El archivo se descomprime en un único directorio que contiene el servidor entero:

```text
rapira-v0.6.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

En macOS, `lib/rapira` guarda `libphp.dylib` junto con el resto de bibliotecas ajenas al sistema de las que depende, así que el árbol es autónomo. En Linux solo se incluye `libphp.so`, y las bibliotecas de sistema habituales —OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib— tienen que estar presentes. En una distribución normal ya lo están; esa es justamente la lista que el deb y el rpm declaran como dependencias, junto a glibc y libgcc.

Mueve el directorio a su ubicación definitiva y enlaza el binario en tu `PATH`:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.6.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-php8.5-macos-aarch64.tar.gz
tar xzf rapira-v0.6.0-php8.5-macos-aarch64.tar.gz
sudo mv rapira-v0.6.0-php8.5-macos-aarch64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

:::

::: warning
El binario localiza su intérprete mediante un **rpath relativo** —`$ORIGIN/../lib/rapira` en Linux, `@loader_path/../lib/rapira` en macOS—, cuya base es la ubicación real del propio binario. El directorio entero se puede mover a donde sea, pero el binario tiene que quedarse dentro: `cp bin/rapira /usr/local/bin/` rompe la búsqueda, porque al lado de `/usr/local/bin` no hay nada que se llame `lib/rapira`. Haz un enlace simbólico, como arriba. El cargador resuelve el enlace antes de expandir el rpath, así que el enlace puede vivir donde sea mientras el árbol real siga junto.
:::

## Comprobar las sumas de verificación

Cada versión publica un único archivo de sumas de verificación que cubre todos sus artefactos, así que la comprobación tiene que seleccionar solo los archivos que has descargado. En Linux de eso se encarga `--ignore-missing`; en macOS es el `grep` el que le pasa a `shasum` la única línea que necesita:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-SHA256SUMS.txt
sha256sum -c --ignore-missing rapira-v0.6.0-SHA256SUMS.txt
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-SHA256SUMS.txt
grep rapira-v0.6.0-php8.5-macos-aarch64.tar.gz rapira-v0.6.0-SHA256SUMS.txt | shasum -a 256 -c
```

:::

## Compilación de PHP incluida

El PHP incorporado se compila con `--disable-all` y con un conjunto fijo de extensiones reactivadas:

- **Lo esencial del runtime** — session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar
- **OPcache**, y PCRE con el JIT activado
- **Red y compresión** — openssl, curl, zlib
- **XML** — libxml, dom, xml, simplexml, xmlreader, xmlwriter
- **Bases de datos** — PDO con `pdo_sqlite`, más `sqlite3`
- Todo lo que PHP compila siempre — Core, standard, SPL, date, json, hash, random, Reflection

Cada versión toma el último parche de la rama que compila. El tarball deja constancia de cuál exactamente en `share/php/PHP_VERSION.txt`; con el servidor en marcha, `PHP_VERSION` y `phpinfo()` la indican.

::: info El nombre del SAPI
En PHP 8.4 el SAPI se registra como `fastcgi`, porque en esa versión OPcache solo arranca para una lista fija de nombres de SAPI, y quedarse fuera de ella significa quedarse sin caché compartida de opcodes. PHP 8.5 eliminó esa lista, así que ahí `PHP_SAPI` y `php_sapi_name()` devuelven `rapira`. La fila *Server API* de `phpinfo()` muestra `Rapira` en ambos casos. Si tu código se bifurca según `PHP_SAPI`, haz que reconozca los dos valores.
:::

Lo que *no* se incluye: `pdo_mysql`, `pgsql`, redis, apcu, imagick y toda esa familia. Si tu aplicación necesita alguna, compila PHP con las extensiones que quieras y compila Rapira contra ese PHP. Consulta [Compilar desde el código](/es/docs/intro/build-from-source) para más información.

## php.ini

Ni los paquetes ni los tarballs traen un `php.ini`, y Rapira tampoco genera ninguno. PHP recurre a su búsqueda de siempre: primero mira `PHPRC`, después el directorio de trabajo actual y por último la ruta que quedó compilada en el binario, que apunta al directorio donde se compiló PHP y por eso nunca existe en tu máquina. Una instalación sin tocar funciona, por tanto, con los valores por defecto que PHP trae de fábrica.

Apúntalo a un archivo concreto, o a un directorio donde buscar, con `PHPRC`:

```bash
PHPRC=/etc/rapira/php.ini rapira serve --config /etc/rapira/rapira.toml
```

PHP busca `php-<sapi-name>.ini` antes que el `php.ini` a secas, y el nombre del SAPI cambia según la versión (ver arriba), así que `php.ini` es el nombre que funciona tanto en 8.4 como en 8.5.

## Distribución

Las compilaciones se publican en GitHub Releases y en ningún otro sitio. Todavía no hay repositorio de apt ni de yum, así que actualizar consiste en descargar el artefacto nuevo e instalarlo encima del anterior, en lugar de ejecutar `apt upgrade`. Un paquete sustituye en su sitio al que ya está instalado; con un tarball, descomprime el directorio nuevo al lado del viejo y reapunta el enlace simbólico, lo que deja el árbol anterior donde estaba y permite volver atrás con un solo comando.

La compilación de macOS es **solo para Apple Silicon**, apunta a **macOS 14 o superior** y va firmada ad hoc: sin Developer ID y sin notarización, así que puede que macOS te pida confirmar la primera ejecución. No hay compilación para Intel. Las compilaciones para Windows se publican aparte, en [rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows), y están pensadas solo para desarrollo local: en producción, Rapira funciona en Linux o macOS.

[Inicio rápido](/es/docs/intro/quickstart) explica cómo servir la primera petición una vez que el binario está en su sitio.
