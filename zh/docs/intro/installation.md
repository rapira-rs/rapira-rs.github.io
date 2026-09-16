---
title: 安装
description: "通过 deb、rpm 或压缩包安装 Rapira，校验下载的文件，并了解每个发布产物里带的是哪个 libphp 构建。"
faqLevel: 2
---

# 安装

每个 Rapira 软件包或压缩包都包含 `rapira` 二进制文件及其解释器库 `libphp`。服务器将此库加载到自己的进程中。软件包和压缩包不包含 `php` 命令、php-fpm 或 ini 目录。Rapira 不需要系统安装 PHP。

::: question `libphp` 是什么，为什么它不等于「PHP」？
同一份 PHP 源码可以编译出好几种通往引擎的接口，它们叫 SAPI。引擎始终是同一个--Zend 加上各种扩展；不同的只是外面那层包装，以及由谁来掌控程序的走向：

| SAPI | 编译出什么 | 谁说了算 |
| --- | --- | --- |
| CLI | `php` 命令 | PHP：启动、执行脚本、退出。 |
| FPM | `php-fpm` | PHP：自己监听 socket，自己维护 worker 池。 |
| embed | `libphp.so` | 宿主程序：像调用普通库一样调用解释器。 |

Rapira 带的是 embed 构建，因为掌控请求流程的是服务器而不是 PHP。`php` 命令属于另一个 SAPI、另一件事，所以产物里不会有它。
:::

::: question 为什么 `libphp` 不从系统里取？
它必须是用 `--enable-embed=shared` 编译出来的 PHP--只有这样编译才会产出 `libphp.so`。发行版很少打这个包，即使有--Fedora 和 RHEL 的 `php-embedded`、Arch 的 `php-embed`、Debian 与 Ubuntu 上来自 deb.sury.org 的 `libphpX.Y-embed`--次版本号和扩展集也只能照单全收；而 Homebrew 的 `php` 根本没有 embed SAPI。所以 Rapira 每次发版都从 PHP 官方源码包编译出 `libphp`，放在二进制文件旁边。
:::

::: question 「PHP 跑在 Rapira 进程内」是什么意思？
初始化期间，`rapira` 进程将 `libphp` 加载到其地址空间。Rapira 在同一进程中调用 PHP 函数。 它不使用 socket、FastCGI 或请求序列化。此库仍是二进制文件旁的独立文件。 因此，不要只移动二进制文件。请参阅 [Linux 与 macOS 压缩包](#linux-与-macos-压缩包)。
:::

## 选择 PHP 版本

每个下载文件的名字里都带着 `php8.4` 或 `php8.5`--那是编译出包内 `libphp` 所用的 PHP 版本。挑你的应用能跑的那个次版本；除非技术栈里有什么东西必须用 8.4，否则就选 8.5。

机器上已经装着的 PHP--系统的 `php`、php-fpm 进程池、Homebrew 编译的那份--Rapira 既不使用也不改动。任何产物里都没有 `php` 命令，所以 Composer、`bin/console` 和 `artisan` 照旧使用你自己的 PHP CLI。

::: question 为什么每个 PHP 版本都要有自己的 Rapira 构建？
产物里的 `libphp` 不是可替换的依赖，而是构建的一部分：`rapira` 二进制文件链接的是某一份具体的库，而这个库的 ABI 在 PHP 次版本之间会变。因此一个 Rapira 构建只对应一条 PHP 分支，版本号就写在文件名里。作为交换，这里没有「先装 PHP」这一步，没有需要指向的 `php-config`，也没有需要同步维护的版本。
:::

::: question 怎么从 8.4 切到 8.5？
装另一个版本的软件包，替换由包管理器完成。`rapira-php8.4` 和 `rapira-php8.5` 占用的路径完全相同，所以两者都对虚拟包 `rapira` 声明了 `provides`、`conflicts` 和 `replaces`（rpm 里是 `obsoletes`）：它们不会并存，后装的会顶掉先装的。压缩包之间没有这种排斥--各自解压到各自的目录，8.4 和 8.5 的目录树可以并排放着，从不同路径分别启动。
:::

## 发布产物

Linux 和 macOS 文件位于 [Rapira 发布页](https://github.com/rapira-rs/rapira/releases)。Windows 文件位于 [Rapira Windows 发布页](https://github.com/rapira-rs/rapira-windows/releases)。[下载页](/zh/download)会按你的平台--系统、架构、PHP 版本、包格式--挑好产物，并显示它的 SHA-256；每个 `php8.5` 产物都有一个对应的 `php8.4`。

在 Linux 上，软件包使用标准文件路径并自动安装库依赖项。 压缩包适用于单目录、容器镜像、部署产物或无 root 权限的安装。 Linux 压缩包还需要系统库。请参阅 [Linux 与 macOS 压缩包](#linux-与-macos-压缩包)。

两种情况都请在安装前用 `rapira-v0.8.0-SHA256SUMS.txt` 核对一遍，命令见[验证校验和](#验证校验和)。

::: question 为什么要在安装前核对校验和？
`.deb` 和 `.rpm` 会以 root 身份执行自己的安装脚本，也就是说被人动过手脚的文件在你启动服务器之前就已经拿到了 root。核对只要一条命令，这个风险就没了。
:::

## Debian 与 Ubuntu

下载 `.deb`，用 `apt` 按路径安装：

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-php8.5_0.8.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.8.0-1_amd64.deb
rapira --version
```

软件包只装服务器本身：既不会加 systemd 服务单元，也不会加配置文件或 ini 目录。让 Rapira 跑在 systemd 下是单独的一步，见[生产环境部署](/zh/docs/deployment)。

软件包基于 glibc 2.34 构建，因此能装上的最老系统是 **Debian 12 和 Ubuntu 22.04**，更新的都没问题。

::: question 文件名前面的 `./` 是干什么的？
正是开头这个 `./` 告诉 apt：这是一个本地文件，不是要去仓库里查的包名。
:::

::: question 系统里会多出哪些文件？
软件包安装 `/usr/bin/rapira`、`/usr/lib/rapira/libphp.so`，并将 ICU 库安装到 `/usr/lib/rapira/`。许可证和 README 安装在 `/usr/share/doc/rapira/` 中。
:::

## RHEL、Rocky 与 Fedora

使用 `dnf` 安装 RPM：

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.8.0/rapira-php8.5-0.8.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.8.0-1.x86_64.rpm
rapira --version
```

同样的 glibc 2.34 下限决定了最低要求：**RHEL 9** 及其重构版--Rocky 9、AlmaLinux 9--再加上任何当前的 Fedora。

## Linux 与 macOS 压缩包

压缩包解压出来是一个目录，整台服务器都在里面：

```text
rapira-v0.8.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

在 Linux 上，`lib/rapira` 包含 `libphp.so` 和所需的 ICU 库。

把目录挪到它长期存放的位置，再用符号链接把二进制文件放进 `PATH`：

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

### 无 root 权限安装

如果没有 root 权限，请将整个目录保存在你的主目录中。在 `~/.local/bin` 中创建符号链接：

```bash
mkdir -p "$HOME/.local/opt" "$HOME/.local/bin"
mv rapira-v0.8.0-php8.5-linux-x86_64 "$HOME/.local/opt/rapira"
ln -s "$HOME/.local/opt/rapira/bin/rapira" "$HOME/.local/bin/rapira"
"$HOME/.local/bin/rapira" --version
```

在 macOS 上，请把源目录名换成解压后的 macOS 目录名。如果 shell 尚未包含此目录，请将 `$HOME/.local/bin` 添加到 `PATH`。

::: warning
二进制文件是在自己旁边找解释器的，所以目录只能整个搬：`cp bin/rapira /usr/local/bin/` 会让它起不来。要进 `PATH`，请照上面的命令做符号链接。
:::

::: question 为什么符号链接可以，复制二进制文件却不行？
解释器的路径是以**相对 rpath** 的形式写进二进制文件的--Linux 上是 `$ORIGIN/../lib/rapira`，macOS 上是 `@loader_path/../lib/rapira`--而基准点是二进制文件真正所在的位置。`/usr/local/bin` 旁边并没有 `lib/rapira`，所以复制过去的那份找不到解释器。符号链接则会先被加载器解析，然后才展开 rpath，因此链接放在哪里都行，真正的目录树保持完整。
:::

::: question 压缩包需要系统提供哪些库？
在 macOS 上，`lib/rapira` 包含 `libphp.dylib` 和所有必需的非系统库。该目录包含完整的运行依赖。

在 Linux 上，`lib/rapira` 包含 `libphp.so` 和所需的 ICU 库。每个产物都包含构建其解释器时使用的 ICU 版本。系统必须提供 OpenSSL 3、libcurl、libxml2、SQLite、Oniguruma、zlib、libpq 和 libstdc++。deb 和 RPM 软件包将这些库、glibc 和 libgcc 声明为依赖项。
:::

## 验证校验和

每个发行版本只有一个校验和文件，覆盖它的全部产物，所以校验时得挑出你真正下载的那些。在 Linux 上用 `--ignore-missing` 参数；在 macOS 上用 `grep` 把需要的那一行交给 `shasum`：

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

`ghcr.io/rapira-rs/rapira` 是一个容器镜像，里面装着 `rapira` 二进制文件，以及它编译时链接的那份 `libphp.so`。镜像用 `FROM scratch` 构建：没有基础系统，没有 shell，也没有 entrypoint，所以它自己跑不起来。把它的内容拷进你自己的镜像里：

```dockerfile
FROM php:8.5-cli-trixie
COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /
RUN apt-get update \
    && xargs -r apt-get install -y --no-install-recommends < /usr/local/share/rapira/debian-packages.txt \
    && rm -rf /var/lib/apt/lists/*
COPY . /app
CMD ["rapira", "serve", "/app/rapira.toml"]
```

应用目录里放着一份 `rapira.toml`：

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

::: question 镜像为什么用 `FROM scratch` 构建？
scratch 镜像里除了构建时拷进去的东西什么都没有，所以 `COPY --from=ghcr.io/rapira-rs/rapira:php8.5 / /` 只会取走这份内容，别的一概不带。基础镜像仍然由你自己挑，这次拷贝也不会在它上面再压一个发行版。
:::

每个标签都写明了自己的 PHP 次版本。下面这些标签都是多架构的，每一个都同时覆盖 amd64 和 arm64。

| 标签 | 指向什么 |
| --- | --- |
| `X.Y.Z-php8.4`、`X.Y.Z-php8.5` | 某一次发布构建。这个标签永不移动。 |
| `X.Y-php8.4`、`X.Y-php8.5` | `X.Y` 这条线上最新的稳定发布。 |
| `php8.4`、`php8.5` | 最新的稳定发布。 |
| `nightly-php8.4`、`nightly-php8.5` | 最新的 nightly 构建。 |

registry 里还有构建过程中先产出的那些单架构标签，比如 `X.Y.Z-php8.5-amd64` 和 `X.Y.Z-php8.5-arm64`。

这里没有 `latest` 标签。Rapira 在构建时就把 Zend 的结构体绑死了，碰上别的 PHP 次版本的 `libphp.so` 会拒绝启动，所以每个标签都必须写明自己带的是哪个次版本。

::: question nightly 标签指向什么？
`main` 上每一次通过的 CI 运行，都会用那个提交重新构建镜像。构建会拿到一个不可变的标签 `X.Y.Z-nightly.<short-sha>-php8.5`：`X.Y.Z` 是仓库当前的版本号，`<short-sha>` 是提交号的前七位。会移动的 `nightly-php8.5` 标签随后指向这次构建。registry 只保留最近十次 nightly 构建，更早的会被删掉。
:::

## libphp 构建

发布的软件包和压缩包使用以 `--disable-all` 构建的 `libphp`，并启用以下固定扩展：

- **运行时基础**：session、filter、mbstring、iconv、ctype、tokenizer、fileinfo、phar、posix。
- **OPcache**，以及开启了 JIT 的 PCRE。
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

每个版本使用其 PHP 分支中可用的最新补丁版本。压缩包的 `share/php/PHP_VERSION.txt` 包含确切版本。 在运行的服务器上，`PHP_VERSION` 和 `phpinfo()` 会报告此版本。

::: question 为什么在 PHP 8.4 上 `PHP_SAPI` 返回 `fastcgi`？
在 PHP 8.4 上，OPcache 只对固定的一批 SAPI 名字启动，名字不在名单里就意味着压根没有共享 opcode 缓存--所以在那里 SAPI 注册成了 `fastcgi`。PHP 8.5 去掉了这份名单，于是 `PHP_SAPI` 和 `php_sapi_name()` 返回 `rapira`。而 `phpinfo()` 里的 *Server API* 一行两种情况下都显示 `Rapira`。按 `PHP_SAPI` 分支的代码要能认得这两个值。
:::

## php.ini

软件包和压缩包里都没有 `php.ini`，Rapira 也不会生成一个，所以原封不动的安装跑的是 PHP 的内置默认值。用 `PHPRC` 指向真正的文件，或者指向存放它的目录：

```bash
PHPRC=/etc/rapira/php.ini rapira serve /etc/rapira/rapira.toml
```

::: question PHP 自己会去哪里找 `php.ini`？
按它一贯的顺序：先看 `PHPRC`，再看当前工作目录，最后是编译时写死的路径--那个路径指向编译 PHP 时所在的目录，在你的机器上哪儿也到不了。
:::

::: question 为什么文件叫 `php.ini`，而不是 `php-rapira.ini`？
PHP 会先找 `php-<sapi-name>.ini`，找不到才用普通的 `php.ini`，而 SAPI 名字随版本而变--8.4 上是 `fastcgi`，8.5 上是 `rapira`。普通的 `php.ini` 两边都适用。
:::

## 分发

构建发布在两个地方：GitHub Releases 上是压缩包、软件包和一个校验和文件，`ghcr.io/rapira-rs/rapira` 上是容器镜像。目前还没有 apt 或 yum 仓库，所以升级就是下载新产物、覆盖旧的装上去，而不是执行 `apt upgrade`。软件包会就地替换已安装的版本；用压缩包的话，把新目录解压到旧目录旁边，再把符号链接切过去：原来的目录树还在，回滚只要一条命令。

发布之外还并行着一条 nightly 通道。`main` 上每一次通过的 CI 运行都会发布 nightly 容器标签，同一次运行还会把压缩包传到 GitHub Releases 上那个滚动的 `nightly` 预发布里。发布提交上会跳过这次上传，因为发布构建本身已经把这些压缩包挂在正式发布上了。这个预发布只带压缩包和它们的校验和文件，既没有 `.deb`，也没有 `.rpm`。nightly 构建是 `main` 的构建，不是一次发布。

macOS 版本**只支持 Apple Silicon**，面向 **macOS 14 及以上**，并且只做了 ad-hoc 签名：没有 Developer ID，也没有公证，所以首次运行时 macOS 可能会要你确认。没有 Intel 版本。Windows 版本单独发布在 [rapira-rs/rapira-windows](https://github.com/rapira-rs/rapira-windows)，只用于本地开发--生产环境请在 Linux 或 macOS 上运行 Rapira。

二进制文件就位之后，怎么处理第一个请求，见[快速开始](/zh/docs/intro/quickstart)。
