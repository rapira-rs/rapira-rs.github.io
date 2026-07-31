---
title: 安装
description: 通过 deb、rpm 或压缩包安装 Rapira。每个发布产物都自带 PHP，不需要事先单独装好一套 PHP。
---

# 安装

Rapira 的发行内容由两部分组成：一个二进制文件，加上它内嵌的 PHP。下载之前，值得先把后半部分弄明白——它和你装过的其他 PHP 工具都不一样。

Rapira 通过 embed SAPI 运行 PHP，这个接口让程序可以把解释器当作库来加载。用它需要一个以 `--enable-embed=shared` 编译的 PHP，编译产物是 `libphp.so`。有些发行版确实提供了现成的包——Fedora 和 RHEL 上是 `php-embedded`，Arch 上是 `php-embed`，Debian 和 Ubuntu 上是 deb.sury.org 的 `libphpX.Y-embed`——但它的次版本号和扩展集，你只能照单全收（Homebrew 的 `php` 干脆就没有 embed SAPI）。与其把这件事交给包管理器，Rapira 的每个版本都从官方源码包编译 PHP，并把结果直接放在 `rapira` 二进制文件旁边。

## 你选的是 PHP 版本，而不是一套 PHP 环境

每个下载文件都标着 `php8.4` 或 `php8.5`，这个标记说的是文件**里面**那个 PHP。没有“先装 PHP”这一步，不用指定 `php-config`，也没有版本需要保持同步。机器上已经有 PHP 也没关系——系统自带的 `php`、php-fpm 进程池、Homebrew 编译的版本——Rapira 既不会用它，也不会动它。它们只是碰巧运行同一门语言的两个不相干的程序。

所以你唯一要做的选择，就是让应用跑在哪个次版本上：**8.4** 还是 **8.5**。除非技术栈里还有东西把你钉在 8.4，否则就选 8.5。

deb 和 rpm 包把这一点贯彻得很彻底。`rapira-php8.4` 和 `rapira-php8.5` 装到完全相同的路径，因此两者都对虚拟包 `rapira` 声明了 `provides`、`conflicts` 和 `replaces`：它们互斥，装上一个就顶替掉另一个，而不是并排放着。切换 PHP 版本也正是这么做——装上另一个包，剩下的交给包管理器。

## 该下载哪个文件

所有文件都在 [GitHub 发布页](https://github.com/rapira-rs/rapira/releases)上。`v0.6.0` 发布了下面这些，下表中每个 `php8.5` 的名字都有一个对应的 `php8.4` 版本：

| 平台                    | 文件                                         |
| ----------------------- | -------------------------------------------- |
| Debian / Ubuntu，x86_64 | `rapira-php8.5_0.6.0-1_amd64.deb`            |
| Debian / Ubuntu，ARM    | `rapira-php8.5_0.6.0-1_arm64.deb`            |
| RHEL / Fedora，x86_64   | `rapira-php8.5-0.6.0-1.x86_64.rpm`           |
| RHEL / Fedora，ARM      | `rapira-php8.5-0.6.0-1.aarch64.rpm`          |
| Linux 压缩包，x86_64    | `rapira-v0.6.0-php8.5-linux-x86_64.tar.gz`   |
| Linux 压缩包，ARM       | `rapira-v0.6.0-php8.5-linux-aarch64.tar.gz`  |
| macOS，Apple Silicon    | `rapira-v0.6.0-php8.5-macos-aarch64.tar.gz`  |
| 以上全部文件的校验和    | `rapira-v0.6.0-SHA256SUMS.txt`               |

在 Linux 上优先选安装包：它会把文件放到发行版预期的位置，还能让 `apt` 或 `dnf` 顺带装上 PHP 需要的共享库。如果你希望整个服务器待在一个自包含的目录里，那就用压缩包——容器镜像、部署产物，或者你没有 root 权限的机器。

## Debian 与 Ubuntu

下载 `.deb`，带上路径交给 `apt`——开头的 `./` 就是在告诉 apt 这是一个本地文件，而不是要去仓库里查的包名：

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5_0.6.0-1_amd64.deb
sudo apt install ./rapira-php8.5_0.6.0-1_amd64.deb
rapira --version
```

一共落地四个文件：`/usr/bin/rapira` 的二进制文件、`/usr/lib/rapira/libphp.so` 的内置解释器，以及 `/usr/share/doc/rapira/` 下的许可证和 README。其他什么都没动——没有 service unit，没有配置文件，也没有 ini 目录。把 Rapira 接进 systemd 是一个单独的、需要你主动去做的步骤，[生产环境部署](/zh/docs/deployment)一页有详细说明。

这些包针对 glibc 2.34 构建，所以能装上的最老版本是 **Debian 12 和 Ubuntu 22.04**，更新的都没问题。

## RHEL、Rocky 与 Fedora

做法一样，换成 `dnf`：

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-php8.5-0.6.0-1.x86_64.rpm
sudo dnf install ./rapira-php8.5-0.6.0-1.x86_64.rpm
rapira --version
```

同样的 glibc 2.34 下限把基线定在 **RHEL 9** 及其重构版——Rocky 9、AlmaLinux 9——再加上任何当前版本的 Fedora。

## 压缩包：Linux 与 macOS

压缩包解开后是一个目录，整个服务器都装在里面：

```
rapira-v0.6.0-php8.5-linux-x86_64/
├── bin/rapira
├── lib/rapira/libphp.so
├── share/php/PHP_VERSION.txt
├── README.md
└── LICENSE
```

在 macOS 上，`lib/rapira` 里除了 `libphp.dylib`，还放着它依赖的全部非系统库，所以这棵目录树是真正独立的。在 Linux 上只打包了 `libphp.so`，常见的系统库——OpenSSL 3、libcurl、libxml2、SQLite、Oniguruma、zlib——需要系统里本来就有。正常的发行版上它们都在；deb 和 rpm 声明的依赖就是这一串，外加 glibc 和 libgcc。

把目录放到你习惯放这类东西的地方，再把二进制文件链接进 `PATH`：

```bash
curl -LO https://github.com/rapira-rs/rapira/releases/download/v0.6.0/rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
tar xzf rapira-v0.6.0-php8.5-linux-x86_64.tar.gz
sudo mv rapira-v0.6.0-php8.5-linux-x86_64 /opt/rapira
sudo ln -s /opt/rapira/bin/rapira /usr/local/bin/rapira
rapira --version
```

::: warning
二进制文件是靠**相对 rpath** 找到解释器的——Linux 上是 `$ORIGIN/../lib/rapira`，macOS 上是 `@loader_path/../lib/rapira`——基准点是二进制文件自身的真实位置。整个目录你想搬到哪儿都行，但千万别把二进制文件单独拎出来：`cp bin/rapira /usr/local/bin/` 会让查找失败，因为 `/usr/local/bin` 旁边根本没有叫 `lib/rapira` 的目录。请像上面那样做符号链接。加载器会先解析链接、再展开 rpath，所以链接可以放在任何地方，而真正的目录树保持完整。
:::

## 校验下载的文件

每个版本都会发布一个校验和文件，覆盖该版本的所有产物。加上 `--ignore-missing`，你就能只校验实际下载的那一两个文件：

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

## 里面都有什么

内置的 PHP 用 `--disable-all` 编译，然后有选择地把一批扩展重新打开——一套常见的 Web 基线，而不是把现有的扩展全塞进来：

- **运行时基础**——session、filter、mbstring、iconv、ctype、tokenizer、fileinfo、phar
- **OPcache**，以及开启了 JIT 的 PCRE
- **网络与压缩**——openssl、curl、zlib
- **XML**——libxml、dom、xml、simplexml、xmlreader、xmlwriter
- **数据库**——PDO 加 `pdo_sqlite`，另有 `sqlite3`
- PHP 永远内建的那些——Core、standard、SPL、date、json、hash、random、Reflection

每个版本都会取所构建分支上最新的补丁版本。压缩包把具体是哪一个记在 `share/php/PHP_VERSION.txt` 里；服务器跑起来之后，`PHP_VERSION` 和 `phpinfo()` 也能回答同一个问题。

::: info SAPI 名称
在 PHP 8.4 上，SAPI 会把自己注册成 `fastcgi`：那个版本的 OPcache 只对固定的一份 SAPI 名单启动，名字不在单子上就完全没有共享 opcode 缓存。PHP 8.5 去掉了这份名单，所以在那里 `PHP_SAPI` 和 `php_sapi_name()` 返回的是 `rapira`。而 `phpinfo()` 里的 *Server API* 一行，两个版本都显示 `Rapira`。根据 `PHP_SAPI` 做分支的代码，两个值都要认。
:::

盒子里**没有**的东西：`pdo_mysql`、`pgsql`、redis、apcu、imagick，以及这一类的其他所有扩展。如果你的应用需要其中之一，发布产物就帮不上忙了——自己编译一个带所需扩展的 PHP，再基于它编译 Rapira，[从源码构建](/zh/docs/build-from-source)把整个流程从头讲到尾。

## 不附带 php.ini

安装包和压缩包里都没有 `php.ini`，Rapira 也不会生成一个。PHP 会走它平常的查找流程：先看 `PHPRC`，再看当前工作目录，最后是编译进去的那个路径——那个路径指向 PHP 当初的构建目录，在你的机器上永远找不到。实际结果就是：一份没动过的安装，跑的是 PHP 的内置默认值。

用 `PHPRC` 指向一个真实的文件，或者一个供它查找的目录：

```bash
PHPRC=/etc/rapira/php.ini rapira serve --config /etc/rapira/rapira.toml
```

写这个文件时有个细节值得知道：PHP 会先找 `php-<sapi-name>.ini`，再找普通的 `php.ini`，而 SAPI 名称随版本而变（见上文）——所以在 8.4 和 8.5 上都管用的写法是 `php.ini`。

## 构建产物从哪儿来

只有 GitHub Releases，别无他处——目前还没有 apt 或 yum 仓库，所以升级就是下载新的产物、覆盖装到旧的上面，而不是执行 `apt upgrade`。

macOS 版本**只支持 Apple Silicon**，面向 **macOS 14 及以上**，并且只做了 ad-hoc 签名：没有 Developer ID，也没有公证，所以首次运行时 macOS 可能会要你确认。没有 Intel 版本，也没有 Windows 版本——Rapira 只有 Linux 和 macOS。

二进制文件就位之后，[快速开始](/zh/docs/quickstart)大约一分钟就能让服务器处理第一个请求。

::: question 安装 Rapira 之前需要先装好 PHP 吗？
不需要。每个产物都自带 `libphp`，而且是用 Rapira 所需的 embed SAPI 编译的。系统里的 PHP 既不会被用到，也不会被改动——php-fpm 在跑就继续跑，完全不受影响。
:::

::: question PHP 8.4 和 8.5 可以并存吗？
用安装包不行：`rapira-php8.4` 和 `rapira-php8.5` 在虚拟包 `rapira` 上互相冲突，同一时间只能装一个。但压缩包是自包含的目录，你可以把两个都解开，从不同路径分别运行。
:::

::: question 怎么升级到新版本？
下载新的产物，按同样的方式装上。安装包会就地替换旧版本；用压缩包的话，把新目录解到旧目录旁边，再把符号链接指过去——这样回滚也只要一条命令。
:::
