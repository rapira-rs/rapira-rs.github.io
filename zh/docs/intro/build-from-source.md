---
title: 从源码构建
description: "什么时候需要自己编译 Rapira，具体又该怎么做：Rust 和 C 工具链、带 embed SAPI 的 NTS 版 PHP，以及 Linux 和 macOS 上的链接细节。"
---

# 从源码构建

Rapira 可以在 Linux 和 macOS 上从源码构建。[安装](/zh/docs/intro/installation)页面上的预编译二进制文件覆盖不到的场景，就交给自己编译来解决；除了常规的 Rust 和 C 工具链之外，唯一的要求就是一个能被 Rapira 嵌入的 PHP。

## 什么时候需要从源码构建

- **你的平台没有预编译的二进制文件**--冷门的 CPU 架构，或者 Alpine 这类基于 musl 的发行版。
- **你的发行版比软件包支持的更老。**发布的二进制是针对 glibc 2.34 构建的，能装上的最老的系统是 Debian 12、Ubuntu 22.04 和 RHEL 9（见[安装](/zh/docs/intro/installation)）。
- **应用需要其他 PHP 扩展。**发布构建包含 SQLite、通过 `pdo_pgsql` 和 `pgsql` 提供的 PostgreSQL 支持，以及 `bcmath`、`intl`、`igbinary` 和 `redis`。完整扩展列表请参阅[安装](/zh/docs/intro/installation)。如果应用需要 `pdo_mysql` 或 `gd` 等扩展，请使用另一份 PHP 构建 Rapira。
- **你在开发 Rapira 本身**，或者想用上还没发布的东西。

## 工具链

构建需要以下工具：

- **Rust 稳定通道。**`rust-toolchain.toml` 文件通过 [rustup](https://rustup.rs/) 选择版本。
- **C 编译器和 `pkg-config`。**构建会使用 PHP 头文件编译小型 C 适配器。
- **libclang。**Bindgen 使用它创建 Zend API 绑定。Debian 和 Ubuntu 的软件包名为 `libclang-dev`，Fedora 为 `clang-devel`，Arch 为 `clang`。

## 带 embed SAPI 的 PHP

Rapira 将解释器链接到其进程中，不使用 socket。PHP 必须是 8.4 或 8.5 版本的 NTS 共享库。 使用 `--enable-embed=shared` 配置 PHP。此选项创建 `libphp.so`，在 macOS 上创建 `libphp.dylib`。

::: warning ZTS 构建会被拒绝
线程安全 PHP 会导致构建错误。Rapira 要求使用 NTS，因为每个 worker 进程运行一个解释器。 如果 `PATH` 选择 ZTS 构建，请安装 NTS PHP。将 `PHP_CONFIG` 设为其 `php-config` 路径。
:::

有几个发行版已经把 embed SAPI 打好包了：

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora/RHEL
sudo pacman -S php php-embed                  # Arch
sudo apk add php84-dev php84-embed            # Alpine
```

::: warning macOS 没有现成的 embed SAPI 包
Homebrew 的 `php` formula 不包含 embed SAPI。请在 macOS 上从源代码构建 PHP。
:::

### 从源代码构建 PHP

如果没有 embed 软件包，请构建 PHP。软件包缺少所需扩展时，也请构建 PHP。

`.github/php-configure-flags.txt` 包含 PHP 随附扩展的配置选项，其中包括 `bcmath`、`intl`、`pdo_pgsql` 和 `pgsql`。

请安装 ICU 和 PostgreSQL 客户端开发库，以启用 `intl` 和 PostgreSQL 支持。Debian 或 Ubuntu 上的软件包名为 `libicu-dev` 和 `libpq-dev`，Rocky Linux 上则为 `libicu-devel` 和 `libpq-devel`。`intl` 扩展还需要 C++ 编译器。

在 macOS 上，请安装构建依赖：

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq
```

在 Rapira 源代码目录中，运行对应平台的目标：

::: code-group

```bash [Linux]
make php PHP_SRC=/path/to/php-src PHP_PREFIX="$HOME/.local/php-nts"
```

```bash [macOS]
make php-macos PHP_SRC=/path/to/php-src PHP_PREFIX="$HOME/.local/php-nts"
```

:::

两个目标都会运行 `buildconf`、配置并编译 PHP，然后将其安装到 `PHP_PREFIX`。它们启用 `.github/php-configure-flags.txt` 中列出的 PHP 随附扩展。`php-macos` 目标还会设置 Homebrew 库路径和 iconv 的 SDK 路径。

如需自定义扩展集，请在 PHP 源代码目录中直接配置 PHP。将所需扩展选项追加到 `./configure`：

```bash
./buildconf --force
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

在 macOS 上手动配置时，请使用 `php-macos` 目标中的库路径和配置选项。

发布 CI 还将 `igbinary` 和 `redis` 编译进 `libphp`，并为 Redis 启用 igbinary 序列化。它们的源代码版本和校验和固定在[发布工作流](https://github.com/rapira-rs/rapira/blob/main/.github/workflows/build-binaries.yml)中。运行 `./buildconf --force` 前，请将它们的源代码解压到 PHP 的 `ext/igbinary` 和 `ext/redis` 目录。将 `--enable-igbinary --enable-redis --enable-redis-igbinary` 添加到 `./configure`。

### 不带版本号的 `libphp.so`

构建时链接的是 `-lphp`，搜索范围只有 PHP 安装前缀下的 `lib` 和 `lib64`，所以这两个目录里必须有一个文件严格叫 `libphp.so`（或 `libphp.dylib`）。Debian 和 Ubuntu 只提供带版本号的 `libphp8.4.so`；Alpine 那份的名字虽然不带版本号，但文件放在不会被搜索的 `lib/phpXX` 里。两种情况下链接都会失败，除非你在前缀的 `lib` 或 `lib64` 里放一个不带版本号的符号链接：

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
sudo ln -sf /usr/lib/php84/libphp.so /usr/lib/libphp.so     # Alpine
```

没有 root 权限的话，把符号链接放进自己的目录，再让链接器和动态加载器都指向那里：

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="-L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## 构建 Rapira

PHP 就位之后，构建本身就是一次普通的 cargo build：

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
cargo build --release
```

产物落在 `target/release/rapira`。

PHP 是通过 `php-config` 找到的。如果 `PATH` 上的那个并不是你想让 Rapira 嵌入的构建，就明确指定它：

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
`make test` 会跑测试套件，并替你处理库路径：它在 `php-config` 的前缀下找到 embed 库（`lib`、`lib64`、`lib/phpXX`，带不带版本号都行），再把它规整成链接器需要的那个不带版本号的名字。在依赖自己的构建之前，先运行它确认环境是否配置妥当。
:::

## 运行你构建出的二进制

运行时 Rapira 会动态加载 `libphp.so`（macOS 上是 `libphp.dylib`）。如果它在标准位置，你什么都不用做；否则就把加载器指向它。使用[快速上手](/zh/docs/intro/quickstart)里的 `worker.php`，在它旁边创建 `rapira.toml`：

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

构建出来的就是软件包安装的那个服务器：[快速开始](/zh/docs/intro/quickstart)带你写第一个脚本，[命令行](/zh/docs/cli)列出了 `serve` 接受的全部参数，[配置](/zh/docs/configuration)讲的是 `rapira.toml`。

## 参与 Rapira 本身的开发

`make test` 会把两套测试都跑一遍--进程内的那套，以及会拉起真实二进制的端到端那套；`make stubs` 从 `crates/php_sys/rapira.stub.php` 重新生成 arginfo 头文件；CI 则在每个 pull request 上跑构建、`cargo fmt`、clippy 和覆盖率。
