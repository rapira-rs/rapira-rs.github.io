---
title: Instalación
description: Instala Rapira desde un deb, un rpm o un tarball. Cada artefacto lleva dentro su propio PHP, así que no hay ninguna instalación previa de PHP con la que acertar.
---

# Instalación

Rapira se distribuye como un binario más el PHP que lleva incrustado. Esa segunda mitad es la que conviene entender antes de descargar nada, porque funciona de forma distinta a cualquier otra herramienta de PHP que tengas instalada.

Rapira ejecuta PHP a través del SAPI embed, la interfaz que permite a un programa alojar el intérprete como si fuera una biblioteca. Para usarla hace falta un PHP compilado con `--enable-embed=shared`, que genera un `libphp.so`. Hay distribuciones que lo empaquetan —`php-embedded` en Fedora y RHEL, `php-embed` en Arch, `libphpX.Y-embed` de deb.sury.org en Debian y Ubuntu—, pero entonces aceptas tal cual la versión menor y el conjunto de extensiones que hayan elegido (y el `php` de Homebrew ni siquiera trae el SAPI embed). En lugar de dejar eso en manos de tu gestor de paquetes, cada versión compila PHP desde el tarball oficial de código fuente y coloca el resultado justo al lado del binario `rapira`.

## Eliges una versión de PHP, no una instalación de PHP

Cada descarga viene etiquetada como `php8.4` o `php8.5`, y esa etiqueta describe el PHP que va *dentro* del paquete. No hay ningún paso previo de «instala PHP primero», ningún `php-config` al que apuntar, ninguna versión que mantener sincronizada. Si ya tienes PHP en la máquina —el `php` del sistema, un pool de php-fpm, una compilación de Homebrew—, Rapira ni lo usa ni lo toca: son programas independientes que da la casualidad de que ejecutan el mismo lenguaje.

Así que la única decisión que tomas es sobre qué versión menor quieres que corra tu aplicación: **8.4** u **8.5**. Elige 8.5 salvo que algo de tu stack todavía te ate a 8.4.

Los paquetes deb y rpm se lo toman al pie de la letra. `rapira-php8.4` y `rapira-php8.5` instalan exactamente las mismas rutas, así que ambos declaran `provides`, `conflicts` y `replaces` sobre un paquete virtual `rapira`: se excluyen mutuamente, y al instalar uno ocupa el lugar del otro en vez de acabar a su lado. Así es también como cambias de versión de PHP: instala el otro paquete y el gestor de paquetes hace el relevo.

## Qué archivo descargar

Todo está en la [página de releases de GitHub](https://github.com/rapira-rs/rapira/releases). La versión `v0.6.0` publica estos archivos, y cada nombre con `php8.5` de la lista tiene su gemelo con `php8.4`:

| Plataforma                           | Artefacto                                    |
| ------------------------------------ | -------------------------------------------- |
| Debian / Ubuntu, x86_64              | `rapira-php8.5_0.6.0-1_amd64.deb`            |
| Debian / Ubuntu, ARM                 | `rapira-php8.5_0.6.0-1_arm64.deb`            |
| RHEL / Fedora, x86_64                | `rapira-php8.5-0.6.0-1.x86_64.rpm`           |
| RHEL / Fedora, ARM                   | `rapira-php8.5-0.6.0-1.aarch64.rpm`          |
| Tarball de Linux, x86_64             | `rapira-v0.6.0-php8.5-linux-x86_64.tar.gz`   |
| Tarball de Linux, ARM                | `rapira-v0.6.0-php8.5-linux-aarch64.tar.gz`  |
| macOS, Apple Silicon                 | `rapira-v0.6.0-php8.5-macos-aarch64.tar.gz`  |
| Sumas de verificación de lo anterior | `rapira-v0.6.0-SHA256SUMS.txt`               |

En Linux, la opción por defecto debería ser el paquete: coloca cada cosa donde tu distribución espera encontrarla y permite que `apt` o `dnf` traigan las bibliotecas compartidas que PHP necesita. Recurre al tarball cuando quieras que el servidor viva en un único directorio autocontenido: una imagen de contenedor, un artefacto de despliegue, una máquina donde no eres root.

## Debian y Ubuntu

Descarga el `.deb` y pásaselo a `apt` con una ruta: ese `./` inicial es lo que le indica a apt que se trata de un archivo local y no del nombre de un paquete que deba buscar.

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5_0.6.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.6.0-1_amd64.deb
rapira --version
```

Se instalan cuatro archivos: el binario en `/usr/bin/rapira`, el intérprete incorporado en `/usr/lib/rapira/libphp.so`, y la licencia y el README en `/usr/share/doc/rapira/`. No se toca nada más: ni unidad de servicio, ni archivo de configuración, ni directorio de ini. Integrar Rapira en systemd es un paso aparte y deliberado que se explica en [En producción](/es/docs/deployment).

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

```
rapira-v0.6.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

En macOS, `lib/rapira` guarda `libphp.dylib` junto con el resto de bibliotecas ajenas al sistema de las que depende, así que el árbol es realmente autónomo. En Linux solo se incluye `libphp.so`, y las bibliotecas de sistema habituales —OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib— tienen que estar presentes. En una distribución normal ya lo están; esa es justamente la lista que el deb y el rpm declaran como dependencias, junto a glibc y libgcc.

Coloca el directorio donde guardes este tipo de cosas y enlaza el binario en tu `PATH`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.6.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

::: warning
El binario localiza su intérprete mediante un **rpath relativo** —`$ORIGIN/../lib/rapira` en Linux, `@loader_path/../lib/rapira` en macOS—, cuya base es la ubicación real del propio binario. Mueve el directorio completo a donde quieras, pero nunca saques el binario de él: `cp bin/rapira /usr/local/bin/` rompe la búsqueda, porque al lado de `/usr/local/bin` no hay nada que se llame `lib/rapira`. Haz un enlace simbólico, como arriba. El cargador resuelve el enlace antes de expandir el rpath, así que el enlace puede vivir donde sea mientras el árbol real siga junto.
:::

## Comprueba lo que has descargado

Cada versión publica un único archivo de sumas de verificación que cubre todos sus artefactos. `--ignore-missing` es lo que te permite comprobar solo el archivo (o los dos) que realmente has descargado:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-SHA256SUMS.txt
sha256sum -c --ignore-missing rapira-v0.6.0-SHA256SUMS.txt
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-SHA256SUMS.txt
shasum -a 256 rapira-v0.6.0-php8.5-macos-aarch64.tar.gz
grep macos-aarch64 rapira-v0.6.0-SHA256SUMS.txt
```

:::

## Qué hay dentro

El PHP incorporado se compila con `--disable-all` y después se reactiva un conjunto de extensiones elegido a conciencia — una base habitual para la web en vez de absolutamente todo lo que existe:

- **Lo esencial del runtime** — session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar
- **OPcache**, y PCRE con el JIT activado
- **Red y compresión** — openssl, curl, zlib
- **XML** — libxml, dom, xml, simplexml, xmlreader, xmlwriter
- **Bases de datos** — PDO con `pdo_sqlite`, más `sqlite3`
- Todo lo que PHP compila siempre — Core, standard, SPL, date, json, hash, random, Reflection

Cada versión toma el último parche de la rama que compila. El tarball deja constancia de cuál exactamente en `share/php/PHP_VERSION.txt`; con el servidor en marcha, `PHP_VERSION` y `phpinfo()` responden a la misma pregunta.

::: info El nombre del SAPI
En PHP 8.4 el SAPI se registra como `fastcgi`, porque en esa versión OPcache solo arranca para una lista fija de nombres de SAPI, y quedarse fuera de ella significa quedarse sin caché compartida de opcodes. PHP 8.5 eliminó esa lista, así que ahí `PHP_SAPI` y `php_sapi_name()` devuelven `rapira`. La fila *Server API* de `phpinfo()` muestra `Rapira` en ambos casos. Si tu código se bifurca según `PHP_SAPI`, haz que reconozca los dos valores.
:::

Lo que *no* viene en la caja: `pdo_mysql`, `pgsql`, redis, apcu, imagick y toda esa familia. Si tu aplicación necesita alguna, los artefactos publicados no te sirven: tendrás que compilar PHP con las extensiones que quieras y compilar Rapira contra ese PHP, un camino que [Compilar desde el código](/es/docs/build-from-source) recorre de principio a fin.

## No se incluye ningún php.ini

Ni los paquetes ni los tarballs traen un `php.ini`, y Rapira tampoco genera ninguno. PHP recurre a su búsqueda de siempre: primero mira `PHPRC`, después el directorio de trabajo actual y por último la ruta que quedó compilada en el binario, que apunta al directorio donde se compiló PHP y por eso nunca existe en tu máquina. En la práctica, una instalación recién hecha funciona con los valores por defecto que PHP trae de fábrica.

Apúntalo a un archivo concreto, o a un directorio donde buscar, con `PHPRC`:

```bash
PHPRC=/etc/rapira/php.ini rapira serve --config /etc/rapira/rapira.toml
```

Hay un detalle que conviene tener presente al escribir ese archivo: PHP busca `php-<sapi-name>.ini` antes que el `php.ini` a secas, y el nombre del SAPI cambia según la versión (lo hemos visto arriba), así que `php.ini` es el nombre que funciona tanto en 8.4 como en 8.5.

## De dónde salen las compilaciones

De GitHub Releases, y solo de ahí: todavía no hay repositorio de apt ni de yum, así que actualizar consiste en descargar el artefacto nuevo e instalarlo encima del anterior, en lugar de ejecutar `apt upgrade`.

La compilación de macOS es **solo para Apple Silicon**, apunta a **macOS 14 o superior** y va firmada ad hoc: sin Developer ID y sin notarización, así que puede que macOS te pida confirmar la primera ejecución. No hay compilación para Intel. Tampoco la hay para Windows: Rapira es Linux y macOS.

Con el binario ya en su sitio, [Inicio rápido](/es/docs/quickstart) sirve tu primera petición en apenas un minuto.

::: question ¿Necesito tener PHP instalado antes de instalar Rapira?
No. Cada artefacto lleva su propio `libphp`, compilado con el SAPI embed que Rapira necesita. El PHP del sistema ni se usa ni se modifica: si tienes php-fpm en marcha, seguirá funcionando igual que siempre.
:::

::: question ¿Puedo tener PHP 8.4 y 8.5 a la vez?
Con paquetes no: `rapira-php8.4` y `rapira-php8.5` entran en conflicto por el paquete virtual `rapira`, así que solo puede haber uno instalado a la vez. Con tarballs sí, porque son directorios autocontenidos: descomprime los dos y ejecútalos desde rutas distintas.
:::

::: question ¿Cómo actualizo a una versión nueva?
Descarga el artefacto nuevo e instálalo igual que la primera vez. Un paquete sustituye al anterior en su sitio; con un tarball, descomprime el directorio nuevo al lado del viejo y reapunta el enlace simbólico, lo que además te deja una vuelta atrás de un solo comando.
:::
