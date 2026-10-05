---
title: Instalación
description: "Instala Rapira desde un deb, un RPM o un tarball. Comprueba su suma de verificación. Identifica la compilación de libphp incluida."
faqLevel: 2
---

# Instalación

Cada paquete o tarball para Linux o macOS contiene el binario `rapira` y su biblioteca de intérprete `libphp`. El servidor carga esta biblioteca en su proceso. Estos paquetes y tarballs no contienen el comando `php`, php-fpm ni un directorio de ini. Rapira no requiere una instalación de PHP en el sistema. Para los archivos ZIP de Windows, consulta [Windows](#windows).

::: question ¿Qué es `libphp` y en qué se diferencia del comando PHP?
PHP compila varias interfaces hacia su motor. Estas interfaces son las Server Application Programming Interfaces, o SAPI. Cada una usa el motor Zend y las extensiones, pero tiene una interfaz de programa diferente:

| SAPI | Qué produce | Quién controla |
| --- | --- | --- |
| CLI | el comando `php` | PHP: arranca, ejecuta un script y termina. |
| FPM | `php-fpm` | PHP: escucha en el socket y mantiene un pool de workers. |
| embed | `libphp.so` | El programa anfitrión: llama al intérprete como a cualquier otra biblioteca. |

Rapira incluye la SAPI embed porque el servidor controla las peticiones. El comando `php` usa otra SAPI, así que los artefactos no lo contienen.
:::

::: question ¿Por qué Rapira incluye su propia `libphp`?
PHP debe usar `--enable-embed=shared` para crear `libphp.so`. Pocas distribuciones proporcionan esta compilación. Fedora y RHEL proporcionan `php-embedded`, y Arch proporciona `php-embed`. Deb.sury.org proporciona `libphpX.Y-embed` para Debian y Ubuntu.

Estos paquetes tienen versiones de PHP y conjuntos de extensiones fijos. El PHP de Homebrew no incluye la SAPI embed. Por eso, cada versión de Rapira compila `libphp` a partir de un archivo oficial del código fuente de PHP y la incluye con el binario.
:::

::: question ¿Qué significa «PHP se ejecuta dentro del proceso de Rapira»?
Durante la inicialización, el proceso `rapira` carga `libphp` en su espacio de direcciones. Rapira llama a las funciones de PHP en el mismo proceso. No usa un socket, FastCGI ni serialización de peticiones. La biblioteca sigue siendo un archivo separado junto al binario. Por eso, no muevas el binario sin la biblioteca. Consulta [Tarballs en Linux y macOS](#tarballs-en-linux-y-macos).
:::

## Elegir la versión de PHP

El nombre de cada descarga contiene `php8.4` o `php8.5`. Este texto identifica la versión menor de PHP de su `libphp`. Elige 8.5 salvo que una dependencia de la aplicación requiera 8.4.

Rapira no usa ni cambia un PHP del sistema, un pool de php-fpm ni un PHP de Homebrew que ya existan. Composer, `bin/console` y `artisan` siguen usando el PHP CLI del sistema.

::: question ¿Por qué cada versión de PHP tiene su propia compilación de Rapira?
La `libphp` del artefacto forma parte de la compilación y no es intercambiable. El binario `rapira` se enlaza con una biblioteca concreta. La ABI de PHP cambia entre versiones menores. Por eso, una compilación de Rapira admite una sola versión menor de PHP. El nombre del archivo identifica esta versión. No necesitas instalar PHP ni configurar `php-config`.
:::

::: question ¿Cómo paso de 8.4 a 8.5?
Instala el paquete de la otra versión de PHP. El gestor de paquetes sustituye el paquete de Rapira instalado. Los dos paquetes usan las mismas rutas. Declaran `provides`, `conflicts` y `replaces`, u `obsoletes` en RPM. Las instalaciones desde tarball usan directorios separados y pueden existir a la vez. Arranca cada versión desde su propia ruta.
:::

## Artefactos de la versión

La [página de releases de Rapira](https://github.com/rapira-rs/rapira/releases) contiene los archivos para Linux y macOS. La [página de releases de Rapira para Windows](https://github.com/rapira-rs/rapira-windows/releases) contiene los archivos para Windows. Usa la [página de descargas](/es/download) para elegir el sistema operativo, la arquitectura, la versión de PHP y el formato de paquete. También muestra el valor SHA-256. Cada artefacto `php8.5` tiene un artefacto `php8.4` correspondiente.

En Linux, usa un paquete para tener las ubicaciones de archivos estándar y las dependencias de bibliotecas automáticas. Usa un tarball para un único directorio, una imagen de contenedor, un artefacto de despliegue o una instalación sin acceso root. El tarball de Linux también requiere bibliotecas del sistema. Consulta [Tarballs en Linux y macOS](#tarballs-en-linux-y-macos) para ver la lista.

Comprueba el archivo con `rapira-v0.9.0-SHA256SUMS.txt` antes de instalar. Consulta [Comprobar las sumas de verificación](#comprobar-las-sumas-de-verificacion).

::: question ¿Por qué debo comprobar la suma de verificación antes de instalar?
Los paquetes `.deb` y `.rpm` ejecutan scripts de instalación como root. Un paquete modificado puede ejecutar código no deseado con permisos de root. La comprobación de la suma detecta un paquete modificado antes de la instalación.
:::

## Debian y Ubuntu

Descarga el archivo `.deb`. Instálalo con `apt` indicando su ruta:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-php8.5_0.9.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.9.0-1_amd64.deb
rapira --version
```

El paquete instala el servidor sin unidad de servicio, archivo de configuración ni directorio de ini. Consulta [En producción](/es/docs/deployment) para configurar systemd.

Los paquetes requieren glibc 2.34 o posterior. Las versiones mínimas admitidas son **Debian 12 y Ubuntu 22.04**.

::: question ¿Por qué la ruta del archivo empieza con `./`?
El `./` inicial le indica a apt que use un archivo local en lugar de un nombre de paquete del repositorio.
:::

::: question ¿Qué archivos instala el paquete?
El paquete instala `/usr/bin/rapira`, `/usr/lib/rapira/libphp.so` y las bibliotecas ICU en `/usr/lib/rapira/`. En PHP 8.4, también instala `/usr/lib/rapira/opcache.so`. Instala la licencia y el README en `/usr/share/doc/rapira/`.
:::

## RHEL, Rocky y Fedora

Instala el RPM con `dnf`:

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-php8.5-0.9.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.9.0-1.x86_64.rpm
rapira --version
```

El RPM requiere glibc 2.34 o posterior. **RHEL 9**, Rocky 9, AlmaLinux 9 y las versiones actuales de Fedora cumplen este requisito.

## Tarballs en Linux y macOS

Un tarball se descomprime en un único directorio que contiene el servidor completo:

```text
rapira-v0.9.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

En Linux, `lib/rapira` contiene `libphp.so` y las bibliotecas ICU necesarias. En PHP 8.4, `lib/rapira` también contiene `opcache.so` en Linux y macOS.

Mueve el directorio a su ubicación permanente. Añade un enlace simbólico al binario en el `PATH`:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.9.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.9.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-php8.5-macos-aarch64.tar.gz
tar xzf rapira-v0.9.0-php8.5-macos-aarch64.tar.gz
sudo mv rapira-v0.9.0-php8.5-macos-aarch64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

:::

### Instalación sin acceso root

Para instalar sin acceso root, conserva el directorio completo dentro de tu directorio personal. Crea un enlace simbólico en `~/.local/bin`:

```bash
mkdir -p "$HOME/.local/opt" "$HOME/.local/bin"
mv rapira-v0.9.0-php8.5-linux-x86_64 "$HOME/.local/opt/rapira"
ln -s "$HOME/.local/opt/rapira/bin/rapira" "$HOME/.local/bin/rapira"
"$HOME/.local/bin/rapira" --version
```

En macOS, sustituye el nombre del directorio de origen por el nombre del directorio extraído para macOS. Añade `$HOME/.local/bin` a `PATH` si el shell no lo incluye.

::: warning
El binario usa una ruta relativa para encontrar su intérprete. Mueve el directorio completo. No copies solo `bin/rapira` a `/usr/local/bin/`. Usa un enlace simbólico como en los comandos de arriba.
:::

::: question ¿Por qué funciona un enlace simbólico y no una copia del binario?
El binario contiene un **rpath relativo** al intérprete. Linux usa `$ORIGIN/../lib/rapira`, y macOS usa `@loader_path/../lib/rapira`. El cargador resuelve el enlace simbólico antes de resolver el rpath. Por eso, el rpath parte de la ubicación real del binario. Una copia en `/usr/local/bin` no tiene un directorio `lib/rapira` junto a ella y no encuentra el intérprete.
:::

::: question ¿Qué bibliotecas del sistema necesita el tarball?
En macOS, `lib/rapira` contiene `libphp.dylib` y todas las bibliotecas necesarias que no forman parte del sistema. El directorio es autocontenido.

En Linux, `lib/rapira` contiene `libphp.so` y las bibliotecas ICU de su compilación. El sistema debe proporcionar OpenSSL 3, libcurl, libxml2, SQLite, Oniguruma, zlib, libpq y libstdc++. Los paquetes deb y RPM declaran estas bibliotecas, glibc y libgcc como dependencias.
:::

## Comprobar las sumas de verificación

Cada release para Linux y macOS tiene un único archivo de sumas de verificación para todos sus archivos. Comprueba solo el archivo descargado. En Linux, usa `--ignore-missing`. En macOS, usa `grep` para pasar la línea seleccionada a `shasum`:

::: code-group

```bash [Linux]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-SHA256SUMS.txt
sha256sum -c --ignore-missing rapira-v0.9.0-SHA256SUMS.txt
```

```bash [macOS]
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-v0.9.0-SHA256SUMS.txt
grep rapira-v0.9.0-php8.5-macos-aarch64.tar.gz rapira-v0.9.0-SHA256SUMS.txt | shasum -a 256 -c
```

:::

## Docker

La imagen de contenedor `ghcr.io/rapira-rs/rapira` contiene el binario `rapira` y su `libphp.so`. La imagen usa `FROM scratch` y no tiene sistema base, shell ni entrypoint. No se puede ejecutar por sí sola. Copia sus archivos en una imagen de la aplicación:

```dockerfile
FROM php:8.5-cli-trixie
COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /
RUN apt-get update \
    && xargs -r apt-get install -y --no-install-recommends < /usr/local/share/rapira/debian-packages.txt \
    && rm -rf /var/lib/apt/lists/*
COPY . /app
CMD ["rapira", "serve", "/app/rapira.toml"]
```

El directorio de la aplicación contiene un `rapira.toml`:

```toml
[http]
listen = ":8000"

[http.pool]
entrypoint = "/app/public/index.php"
mode = "classic"
```

La imagen contiene `/usr/local/bin/rapira`, `/usr/local/lib/libphp.so` y OPcache. En PHP 8.4, OPcache es un `opcache.so` separado con un archivo ini. En PHP 8.5, forma parte de `libphp.so`.

La imagen también incluye `bcmath`, `intl`, `pdo_pgsql`, `pgsql`, `igbinary` y `redis` como módulos compartidos con archivos INI que los activan. Redis admite la serialización igbinary.

El directorio `/usr/local/share/rapira` contiene dos archivos más. `PHP_VERSION.txt` contiene la versión de parche de PHP incluida. `debian-packages.txt` enumera los paquetes necesarios para ejecutar `libphp` y sus extensiones compartidas. Instala estos paquetes en la imagen de la aplicación, incluso cuando la imagen base contiene PHP.

La compilación de la imagen usa `libphp.so` de `php:8.4-cli-trixie` o `php:8.5-cli-trixie`. Añade las seis extensiones compartidas indicadas arriba. Añade otras extensiones en la imagen base de la aplicación. En una imagen base de PHP, `docker-php-ext-install` compila contra la misma `libphp.so`.

::: question ¿Por qué la imagen se construye `FROM scratch`?
Una imagen scratch contiene solo los archivos que la compilación copia en ella. Por eso, `COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /` copia solo los archivos de Rapira. Tú eliges la imagen base de la aplicación.
:::

Cada etiqueta identifica su versión menor de PHP. Estas etiquetas admiten amd64 y arm64:

| Etiqueta | A qué apunta |
| --- | --- |
| `X.Y.Z-php8.4`, `X.Y.Z-php8.5` | Una compilación de un release. La etiqueta no se mueve nunca. |
| `X.Y-php8.4`, `X.Y-php8.5` | El release estable más reciente con esa versión `X.Y`. |
| `php8.4`, `php8.5` | El release estable más reciente. |
| `nightly-php8.4`, `nightly-php8.5` | La compilación nightly más reciente. |

El registro también contiene etiquetas para una sola arquitectura, como `X.Y.Z-php8.5-amd64` y `X.Y.Z-php8.5-arm64`.

No hay etiqueta `latest`. Cada compilación de Rapira usa las cabeceras de una sola versión menor de PHP. Rapira no arranca con una `libphp.so` de otra versión menor de PHP. Por eso, cada etiqueta indica la versión menor de PHP que contiene.

::: question ¿A qué apunta una etiqueta nightly?
Cada ejecución correcta de CI en `main` construye imágenes a partir de ese commit. La compilación recibe una etiqueta inmutable `X.Y.Z-nightly.<short-sha>-php8.5`. `X.Y.Z` es la versión del repositorio. `<short-sha>` son los siete primeros caracteres del identificador del commit. La etiqueta `nightly-php8.5` apunta a esa compilación. El registro conserva las diez compilaciones nightly más recientes.
:::

## La compilación de libphp

Los paquetes y tarballs publicados para Linux y macOS usan `libphp` compilada con `--disable-all` y este conjunto fijo de extensiones:

- **Base del runtime**: session, filter, mbstring, iconv, ctype, tokenizer, fileinfo, phar, posix.
- **OPcache** y PCRE con JIT activado. En PHP 8.4, OPcache es un archivo `opcache.so` separado. Consulta [php.ini](#php-ini).
- **Red y compresión**: openssl, curl, zlib, sockets, ftp.
- **XML**: libxml, dom, xml, simplexml, xmlreader, xmlwriter.
- **Bases de datos**: PDO con `pdo_sqlite` y `pdo_pgsql`, además de `sqlite3` y `pgsql`.
- **Aritmética decimal e internacionalización**: bcmath e intl.
- **Serialización y caché**: igbinary y redis, con serialización igbinary activada para Redis.
- **Memoria compartida e IPC de System V**: shmop, sysvmsg, sysvsem, sysvshm.
- **Fechas, metadatos de imagen y traducciones**: calendar, exif, gettext.
- **Interfaz de funciones externas**: ffi.
- **Componentes necesarios de PHP**: Core, standard, SPL, date, json, hash, random, Reflection.

Para otras extensiones, como `pdo_mysql`, APCu o Imagick, compila `libphp` con las opciones necesarias. Después compila Rapira contra esa biblioteca. Consulta [Compilar desde el código](/es/docs/intro/build-from-source).

Cada artefacto usa la última versión de parche disponible de su rama PHP 8.4 o PHP 8.5. En un tarball, `share/php/PHP_VERSION.txt` contiene la versión exacta. En un servidor en ejecución, `PHP_VERSION` y `phpinfo()` la informan. Cuando `[observability.metrics]` está configurado, la etiqueta `php_version` de la métrica `rapira_build_info` también la informa. Consulta [Métricas y comprobaciones de estado](/es/docs/observability). `rapira --version` muestra solo la versión de Rapira.

::: question ¿Por qué `PHP_SAPI` devuelve `fastcgi` en PHP 8.4?
En PHP 8.4, OPcache solo arranca para una lista fija de nombres de SAPI. Rapira registra la SAPI como `fastcgi` para activar OPcache. PHP 8.5 eliminó esta lista, así que `PHP_SAPI` y `php_sapi_name()` devuelven `rapira`. La línea *Server API* de `phpinfo()` muestra `Rapira` en las dos versiones. El código que comprueba `PHP_SAPI` debe aceptar los dos valores.
:::

## php.ini

Los paquetes y tarballs para Linux y macOS no contienen `php.ini`, y Rapira no crea uno. Sin este archivo, PHP usa sus valores por defecto integrados. Rapira cambia dos de ellos: establece `display_errors=0` y `log_errors=1`. Un valor en `php.ini` sustituye estos dos ajustes. Consulta [Registros](/es/docs/logging). Apunta `PHPRC` a un archivo o a un directorio de búsqueda:

```bash
PHPRC=/etc/rapira/php.ini rapira serve /etc/rapira/rapira.toml
```

En PHP 8.4, OPcache es un archivo `opcache.so` separado en `lib/rapira`. PHP no carga este archivo automáticamente. Añade su ruta absoluta a `php.ini`:

```ini
; paquete deb o RPM
zend_extension=/usr/lib/rapira/opcache.so
; tarball en /opt/rapira
;zend_extension=/opt/rapira/lib/rapira/opcache.so
```

En PHP 8.5, OPcache forma parte de `libphp`. Esta línea no es necesaria.

::: question ¿Dónde busca PHP el `php.ini` por su cuenta?
PHP comprueba primero `PHPRC`. Después comprueba la ruta por defecto establecida durante la compilación de PHP. Esa ruta de compilación normalmente no existe en el sistema de destino. Rapira no lee `php.ini` desde el directorio actual.
:::

::: question ¿Por qué el archivo se llama `php.ini` y no `php-rapira.ini`?
PHP comprueba primero `php-<sapi-name>.ini` y después `php.ini`. El nombre de la SAPI es `fastcgi` en 8.4 y `rapira` en 8.5. Un `php.ini` normal sirve para las dos versiones.
:::

## Distribución

GitHub Releases contiene tarballs, paquetes y archivos de sumas de verificación. `ghcr.io/rapira-rs/rapira` contiene imágenes de contenedor. Todavía no hay repositorio de apt ni de yum. Para actualizar un paquete, descarga e instala la nueva versión. El gestor de paquetes sustituye la versión instalada.

Para actualizar un tarball, extrae el nuevo directorio junto al directorio anterior. Después cambia el enlace simbólico. Conserva el directorio anterior si tienes que restaurarlo.

Cada ejecución correcta de CI en `main` sube tarballs y un archivo de sumas de verificación a la prepublicación `nightly` de GitHub Releases, excepto en los commits de release. La prepublicación no contiene paquetes `.deb` ni `.rpm`. Una compilación nightly no es un release. Para las etiquetas nightly de contenedor, consulta [Docker](#docker). La [página de descargas](/es/download) enlaza las compilaciones nightly.

La compilación de macOS admite **Apple Silicon** y **macOS 14 o posterior**. Usa una firma ad hoc sin Developer ID ni notarización. macOS puede pedir confirmación antes de la primera ejecución. No hay compilación para Intel.

## Windows {#windows}

[rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows) proporciona compilaciones para Windows para desarrollo local. Usa Linux o macOS en producción. La última versión estable para Windows es v0.8.0. Sigue su [README de release](https://github.com/rapira-rs/rapira-windows/blob/v0.8.0/README.md) para conocer su configuración y conjunto de extensiones.

La compilación x64 admite Windows 10, Windows 11 y Windows Server. La compilación ARM64 admite Windows 11. Instala el [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) para la arquitectura seleccionada. Extrae el ZIP completo en un directorio. Mantén juntos `rapira.exe`, el runtime ZTS de PHP correspondiente, las DLL de extensiones y `php.ini`.

Windows v0.8.0 solo sirve HTTP. Su configuración usa una tabla `[pool]` de nivel superior. Ejecútalo desde el directorio extraído:

```powershell
.\rapira.exe serve --config C:\app\rapira.toml
```

Esta versión no admite la configuración de inicio rápido de v0.9 ni gRPC. Su perfil de PHP excluye OpenSSL, cURL, SQLite, XML e iconv. Cada release para Windows tiene un archivo `rapira-v<VERSION>-windows-<x86_64|arm64>-SHA256SUMS.txt` para cada arquitectura.

El [código fuente actual para Windows](https://github.com/rapira-rs/rapira-windows/blob/main/README.md) implementa la configuración de plugins de v0.9 y gRPC. Usa `rapira serve CONFIG` y un pool separado de hilos de intérprete por plugin. Rechaza `[observability]`, `grpc.interceptors` y `[grpc.auth]`. Estas funciones del código fuente no están en la descarga estable v0.8.0.

[Inicio rápido](/es/docs/intro/quickstart) explica cómo atender la primera petición después de instalar el binario.
