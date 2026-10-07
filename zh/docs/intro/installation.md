---
title: 安装
description: "通过 deb、RPM 或压缩包安装 Rapira。校验文件的校验和。确认随附的 libphp 构建。"
faqLevel: 2
---

# 安装

每个 Linux 或 macOS 软件包或压缩包都包含 `rapira` 二进制文件及其解释器库 `libphp`。服务器将此库加载到自己的进程中。这些软件包和压缩包不包含 `php` 命令、php-fpm 或 ini 目录。Rapira 不需要系统安装 PHP。Windows ZIP 文件请参阅 [Windows](#windows)。

::: question `libphp` 是什么，它与 PHP 命令有什么不同？
PHP 为其引擎构建多种接口。这些接口叫服务器应用程序编程接口，即 SAPI。每种 SAPI 都使用 Zend 引擎和扩展，但程序接口不同：

| SAPI | 产出什么 | 由谁控制 |
| --- | --- | --- |
| CLI | `php` 命令 | PHP：它启动、运行脚本、退出。 |
| FPM | `php-fpm` | PHP：它监听 socket 并维护 worker 池。 |
| embed | `libphp.so` | 宿主程序：它像调用其他库一样调用解释器。 |

Rapira 包含 embed SAPI，因为请求由服务器控制。`php` 命令使用另一种 SAPI，所以产物不包含它。
:::

::: question 为什么 Rapira 包含自己的 `libphp`？
PHP 必须使用 `--enable-embed=shared` 才能生成 `libphp.so`。很少有发行版提供这种构建。Fedora 和 RHEL 提供 `php-embedded`，Arch 提供 `php-embed`。deb.sury.org 为 Debian 和 Ubuntu 提供 `libphpX.Y-embed`。

这些软件包的 PHP 版本和扩展集是固定的。Homebrew PHP 不包含 embed SAPI。因此，每个 Rapira 发布都从 PHP 官方源码包构建 `libphp`，并将它与二进制文件一起提供。
:::

::: question 「PHP 在 Rapira 进程内运行」是什么意思？
初始化期间，`rapira` 进程将 `libphp` 加载到其地址空间。Rapira 在同一进程中调用 PHP 函数。它不使用 socket、FastCGI 或请求序列化。此库仍是二进制文件旁的独立文件。因此，不要只移动二进制文件而不移动此库。请参阅 [Linux 与 macOS 压缩包](#linux-与-macos-压缩包)。
:::

## 选择 PHP 版本

每个下载文件名都包含 `php8.4` 或 `php8.5`。此文本表示其 `libphp` 的 PHP 次版本。请选择 8.5，除非应用的某个依赖项需要 8.4。

Rapira 不使用也不更改已有的系统 PHP、php-fpm 池或 Homebrew PHP。Composer、`bin/console` 和 `artisan` 继续使用系统的 PHP CLI。

::: question 为什么每个 PHP 版本都有自己的 Rapira 构建？
产物中的 `libphp` 是构建的一部分，不能替换。`rapira` 二进制文件链接到一个特定的库。PHP ABI 在次版本之间会变化。因此，一个 Rapira 构建只支持一个 PHP 次版本。文件名标明此版本。你不需要安装 PHP，也不需要配置 `php-config`。
:::

::: question 如何从 8.4 切换到 8.5？
安装另一个 PHP 版本的软件包。包管理器会替换已安装的 Rapira 软件包。两个软件包使用相同的路径。它们声明 `provides`、`conflicts` 和 `replaces`，RPM 中为 `obsoletes`。压缩包安装使用不同的目录，可以同时存在。从各自的路径启动每个版本。
:::

## 发布产物

[Rapira 发布页](https://github.com/rapira-rs/rapira/releases)包含 Linux 和 macOS 发布文件。[Rapira Windows 发布页](https://github.com/rapira-rs/rapira-windows/releases)包含 Windows 发布文件。使用[下载页](/zh/download)选择操作系统、架构、PHP 版本和包格式。下载页还显示 SHA-256 值。每个 `php8.5` 产物都有一个对应的 `php8.4` 产物。

在 Linux 上，如需标准文件路径和自动安装库依赖项，请使用软件包。如需单个目录、容器镜像、部署产物或无 root 权限的安装，请使用压缩包。Linux 压缩包还需要系统库。库列表请参阅 [Linux 与 macOS 压缩包](#linux-与-macos-压缩包)。

安装前，请用 `rapira-v0.9.0-SHA256SUMS.txt` 检查文件。请参阅[验证校验和](#验证校验和)。

::: question 为什么必须在安装前验证校验和？
`.deb` 和 `.rpm` 软件包以 root 身份运行安装脚本。被更改的软件包可能以 root 权限执行不需要的代码。校验和验证可以在安装前发现被更改的软件包。
:::

## Debian 与 Ubuntu

下载 `.deb` 文件。使用 `apt` 按路径安装：

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-php8.5_0.9.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.9.0-1_amd64.deb
rapira --version
```

软件包安装服务器，但不安装服务单元、配置文件或 ini 目录。如需配置 systemd，请参阅[生产环境部署](/zh/docs/deployment)。

软件包需要 glibc 2.34 或更新版本。最低支持版本是 **Debian 12 和 Ubuntu 22.04**。

::: question 为什么文件路径以 `./` 开头？
开头的 `./` 告诉 apt 使用本地文件，而不是仓库中的软件包名。
:::

::: question 软件包安装哪些文件？
软件包安装 `/usr/bin/rapira`、`/usr/lib/rapira/libphp.so`，并将 ICU 库安装到 `/usr/lib/rapira/`。在 PHP 8.4 上，它还安装 `/usr/lib/rapira/opcache.so`。许可证和 README 安装在 `/usr/share/doc/rapira/` 中。
:::

## RHEL、Rocky 与 Fedora

使用 `dnf` 安装 RPM：

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.9.0/rapira-php8.5-0.9.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.9.0-1.x86_64.rpm
rapira --version
```

RPM 需要 glibc 2.34 或更新版本。**RHEL 9**、Rocky 9、AlmaLinux 9 和当前的 Fedora 版本满足此要求。

## Linux 与 macOS 压缩包

压缩包解压为一个目录，此目录包含整个服务器：

```text
rapira-v0.9.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

在 Linux 上，`lib/rapira` 包含 `libphp.so` 和所需的 ICU 库。在 PHP 8.4 上，Linux 和 macOS 的 `lib/rapira` 还包含 `opcache.so`。

将目录移到其长期位置。在 `PATH` 中为二进制文件添加符号链接：

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

### 无 root 权限安装

如果没有 root 权限，请将整个目录保存在你的主目录中。在 `~/.local/bin` 中创建符号链接：

```bash
mkdir -p "$HOME/.local/opt" "$HOME/.local/bin"
mv rapira-v0.9.0-php8.5-linux-x86_64 "$HOME/.local/opt/rapira"
ln -s "$HOME/.local/opt/rapira/bin/rapira" "$HOME/.local/bin/rapira"
"$HOME/.local/bin/rapira" --version
```

在 macOS 上，请把源目录名换成解压后的 macOS 目录名。如果 shell 尚未包含此目录，请将 `$HOME/.local/bin` 添加到 `PATH`。

::: warning
二进制文件使用相对路径查找其解释器。请整体移动完整的目录。不要只把 `bin/rapira` 复制到 `/usr/local/bin/`。请按上面的示例使用符号链接。
:::

::: question 为什么符号链接可以，复制二进制文件却不行？
二进制文件包含指向解释器的**相对 rpath**。Linux 使用 `$ORIGIN/../lib/rapira`，macOS 使用 `@loader_path/../lib/rapira`。加载器先解析符号链接，再解析 rpath。因此，rpath 从二进制文件的实际位置开始。`/usr/local/bin` 中的副本旁边没有 `lib/rapira` 目录，所以找不到解释器。
:::

::: question 压缩包需要哪些系统库？
在 macOS 上，`lib/rapira` 包含 `libphp.dylib` 和所有必需的非系统库。该目录包含完整的运行依赖。

在 Linux 上，`lib/rapira` 包含 `libphp.so` 和其构建所用的 ICU 库。系统必须提供 OpenSSL 3、libcurl、libxml2、SQLite、Oniguruma、zlib、libpq 和 libstdc++。deb 和 RPM 软件包将这些库、glibc 和 libgcc 声明为依赖项。
:::

## 验证校验和

每个 Linux 和 macOS 发布都有一个校验和文件，覆盖所有发布文件。只验证已下载的文件。在 Linux 上，使用 `--ignore-missing`。在 macOS 上，使用 `grep` 将所选的行传给 `shasum`：

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

`ghcr.io/rapira-rs/rapira` 容器镜像包含 `rapira` 二进制文件及其 `libphp.so`。镜像使用 `FROM scratch`，没有基础系统、shell 或 entrypoint。它不能单独运行。请将它的文件复制到应用镜像中：

```dockerfile
FROM php:8.5-cli-trixie
COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /
RUN apt-get update \
    && xargs -r apt-get install -y --no-install-recommends < /usr/local/share/rapira/debian-packages.txt \
    && rm -rf /var/lib/apt/lists/*
COPY . /app
CMD ["rapira", "serve", "/app/rapira.toml"]
```

应用目录包含一个 `rapira.toml`：

```toml
[http]
listen = ":8000"

[http.pool]
entrypoint = "/app/public/index.php"
mode = "classic"
```

镜像包含 `/usr/local/bin/rapira`、`/usr/local/lib/libphp.so` 和 OPcache。在 PHP 8.4 上，OPcache 是独立的 `opcache.so`，并附带一个 ini 文件。在 PHP 8.5 上，它是 `libphp.so` 的一部分。

镜像还包含 `bcmath`、`intl`、`pdo_pgsql`、`pgsql`、`igbinary` 和 `redis` 共享模块，以及启用这些模块的 INI 文件。Redis 支持 igbinary 序列化。

`/usr/local/share/rapira` 目录还包含两个文件。`PHP_VERSION.txt` 记录随附 PHP 的补丁版本。`debian-packages.txt` 列出 `libphp` 及其共享扩展所需的运行时软件包。请在应用镜像中安装这些软件包，即使基础镜像已包含 PHP。

镜像构建使用 `php:8.4-cli-trixie` 或 `php:8.5-cli-trixie` 中的 `libphp.so`，并添加上述六个共享扩展。请在应用的基础镜像中添加其他扩展。在 PHP 基础镜像中，`docker-php-ext-install` 会针对同一份 `libphp.so` 编译扩展。

::: question 为什么镜像使用 `FROM scratch` 构建？
scratch 镜像只包含构建复制到其中的文件。因此，`COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /` 只复制 Rapira 文件。应用的基础镜像由你选择。
:::

每个标签都标明其 PHP 次版本。这些标签支持 amd64 和 arm64：

| 标签 | 指向什么 |
| --- | --- |
| `X.Y.Z-php8.4`、`X.Y.Z-php8.5` | 一个发布构建。此标签永不移动。 |
| `X.Y-php8.4`、`X.Y-php8.5` | 该 `X.Y` 版本的最新稳定发布。 |
| `php8.4`、`php8.5` | 最新的稳定发布。 |
| `nightly-php8.4`、`nightly-php8.5` | 最新的 nightly 构建。 |

registry 还包含特定架构的标签，例如 `X.Y.Z-php8.5-amd64` 和 `X.Y.Z-php8.5-arm64`。

没有 `latest` 标签。每个 Rapira 构建使用一个 PHP 次版本的头文件。Rapira 不会使用其他 PHP 次版本的 `libphp.so` 启动。因此，每个标签都标明其包含的 PHP 次版本。

::: question nightly 标签指向什么？
`main` 上每次成功的 CI 运行都会从该提交构建镜像。此构建获得一个不可变的标签 `X.Y.Z-nightly.<short-sha>-php8.5`。`X.Y.Z` 是仓库版本。`<short-sha>` 是提交标识符的前七个字符。`nightly-php8.5` 标签指向此构建。registry 保留最新的十个 nightly 构建。
:::

## libphp 构建

Linux 和 macOS 发布的软件包和压缩包使用以 `--disable-all` 构建的 `libphp`，并启用以下固定扩展：

- **运行时基础**：session、filter、mbstring、iconv、ctype、tokenizer、fileinfo、phar、posix。
- **OPcache**，以及启用了 JIT 的 PCRE。在 PHP 8.4 上，OPcache 是独立的 `opcache.so` 文件。请参阅 [php.ini](#php-ini)。
- **网络与压缩**：openssl、curl、zlib、sockets、ftp。
- **XML**：libxml、dom、xml、simplexml、xmlreader、xmlwriter。
- **数据库**：带 `pdo_sqlite` 和 `pdo_pgsql` 的 PDO，以及 `sqlite3` 和 `pgsql`。
- **十进制运算和国际化**：bcmath 和 intl。
- **序列化和缓存**：igbinary 和 redis，并为 Redis 启用 igbinary 序列化。
- **共享内存与 System V IPC**：shmop、sysvmsg、sysvsem、sysvshm。
- **日期、图像元数据与翻译**：calendar、exif、gettext。
- **外部函数接口**：ffi。
- **必要的 PHP 组件**：Core、standard、SPL、date、json、hash、random、Reflection。

如需 `pdo_mysql`、APCu 或 Imagick 等其他扩展，请用所需选项构建 `libphp`。然后使用该库编译 Rapira。请参阅[从源码构建](/zh/docs/intro/build-from-source)。

每个产物使用其 PHP 8.4 或 PHP 8.5 系列中最新可用的补丁版本。压缩包的 `share/php/PHP_VERSION.txt` 包含确切版本。在运行的服务器上，`PHP_VERSION` 和 `phpinfo()` 会报告此版本。设置 `[observability.metrics]` 后，`rapira_build_info` 指标的 `php_version` 标签也会报告此版本。请参阅[指标与健康检查](/zh/docs/observability)。`rapira --version` 只显示 Rapira 版本。

::: question 为什么在 PHP 8.4 上 `PHP_SAPI` 返回 `fastcgi`？
在 PHP 8.4 上，OPcache 只对固定列表中的 SAPI 名称启动。Rapira 将 SAPI 注册为 `fastcgi` 以启用 OPcache。PHP 8.5 删除了此列表，所以 `PHP_SAPI` 和 `php_sapi_name()` 返回 `rapira`。在两个版本中，`phpinfo()` 的 *Server API* 行都显示 `Rapira`。检查 `PHP_SAPI` 的代码必须接受这两个值。
:::

## php.ini

Linux 和 macOS 软件包和压缩包不包含 `php.ini`，Rapira 也不会创建此文件。没有此文件时，PHP 使用其内置默认值。Rapira 更改其中两个值：它设置 `display_errors=0` 和 `log_errors=1`。`php.ini` 中的值会覆盖这两个设置。请参阅[日志](/zh/docs/logging)。将 `PHPRC` 设置为一个文件或搜索目录：

```bash
PHPRC=/etc/rapira/php.ini rapira serve /etc/rapira/rapira.toml
```

在 PHP 8.4 上，OPcache 是 `lib/rapira` 中独立的 `opcache.so` 文件。PHP 不会自动加载此文件。请将其绝对路径添加到 `php.ini`：

```ini
; deb 或 RPM 软件包
zend_extension=/usr/lib/rapira/opcache.so
; 位于 /opt/rapira 的压缩包
;zend_extension=/opt/rapira/lib/rapira/opcache.so
```

在 PHP 8.5 上，OPcache 是 `libphp` 的一部分。不需要此行。

::: question PHP 自己会在哪里查找 `php.ini`？
PHP 先检查 `PHPRC`。然后检查 PHP 构建时设置的默认路径。此构建路径通常在目标系统上不存在。Rapira 不从当前目录读取 `php.ini`。
:::

::: question 为什么文件叫 `php.ini`，而不是 `php-rapira.ini`？
PHP 先检查 `php-<sapi-name>.ini`，然后检查 `php.ini`。SAPI 名称在 8.4 上是 `fastcgi`，在 8.5 上是 `rapira`。普通的 `php.ini` 支持这两个版本。
:::

## 分发

GitHub Releases 包含压缩包、软件包和校验和文件。`ghcr.io/rapira-rs/rapira` 包含容器镜像。目前还没有 apt 或 yum 仓库。要更新软件包，请下载并安装新版本。包管理器会替换已安装的版本。

要更新压缩包，请将新目录解压到旧目录旁边。然后更改符号链接。如果可能需要恢复，请保留之前的目录。

`main` 上每次成功的 CI 运行都会将压缩包和一个校验和文件上传到 GitHub Releases 上的 `nightly` 预发布，但发布提交除外。此预发布不包含 `.deb` 或 `.rpm` 软件包。nightly 构建不是发布。nightly 容器标签请参阅 [Docker](#docker)。[下载页](/zh/download)提供 nightly 构建的链接。

macOS 版本支持 **Apple Silicon** 和 **macOS 26 或更新版本**。最低版本是构建该发布的 GitHub `macos-latest` runner 的 macOS 主版本。macOS 版本使用 ad hoc 签名，没有 Developer ID，也没有公证。首次运行前，macOS 可能会请求确认。没有 Intel 版本。

## Windows {#windows}

[rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows) 提供用于本地开发的 Windows 版本。生产环境请使用 Linux 或 macOS。Windows 的最新稳定发布是 v0.8.0。其配置和扩展集请参阅[发布 README](https://github.com/rapira-rs/rapira-windows/blob/v0.8.0/README.md)。

x64 构建支持 Windows 10、Windows 11 和 Windows Server。ARM64 构建支持 Windows 11。请安装对应架构的 [Microsoft Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist)。将完整 ZIP 解压到一个目录中。将 `rapira.exe`、匹配的 ZTS PHP 运行时、扩展 DLL 和 `php.ini` 保留在一起。

Windows v0.8.0 仅提供 HTTP 服务。其配置使用顶层 `[pool]` 表。请从解压目录运行：

```powershell
.\rapira.exe serve --config C:\app\rapira.toml
```

此发布不支持 v0.9 快速开始配置或 gRPC。其 PHP 配置不包含 OpenSSL、cURL、SQLite、XML 和 iconv。每个 Windows 发布为每种架构提供一个 `rapira-v<VERSION>-windows-<x86_64|arm64>-SHA256SUMS.txt` 文件。

[当前 Windows 源码](https://github.com/rapira-rs/rapira-windows/blob/main/README.md)实现了 v0.9 插件配置和 gRPC。它使用 `rapira serve CONFIG`，并为每个插件提供独立的解释器线程池。它拒绝 `[observability]`、`grpc.interceptors` 和 `[grpc.auth]`。这些源码功能不包含在稳定版 v0.8.0 下载中。

安装二进制文件后，[快速开始](/zh/docs/intro/quickstart)说明如何处理第一个请求。
