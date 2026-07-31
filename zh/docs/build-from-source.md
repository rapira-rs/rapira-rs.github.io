---
title: 从源码构建
description: "什么时候需要自己编译 Rapira，具体又该怎么做：Rust 和 C 工具链、带 embed SAPI 的 NTS 版 PHP，以及 Linux 和 macOS 上的链接细节。"
---

# 从源码构建

Rapira 可以在 Linux 和 macOS 上从源码构建。[安装](/zh/docs/installation)页面上的预编译二进制文件覆盖不到的场景，就交给自己编译来解决；除了常规的 Rust 和 C 工具链之外，唯一的要求就是一个能被 Rapira 嵌入的 PHP。

## 什么时候需要从源码构建

- **你的平台没有预编译的二进制文件**——冷门的 CPU 架构，或者 Alpine 这类基于 musl 的发行版。
- **你的发行版比软件包支持的更老。**发布的二进制是针对 glibc 2.34 构建的，能装上的最老的系统是 Debian 12、Ubuntu 22.04 和 RHEL 9（见[安装](/zh/docs/installation)）。
- **你需要另一套 PHP 扩展。**官方构建自带的 PHP 是照 [`ci/php-configure-flags.txt`](https://github.com/rapira-rs/rapira/blob/main/ci/php-configure-flags.txt) 里的参数列表编译的，而这份列表是刻意保持精简的：session、mbstring、OPcache、OpenSSL、curl、XML 家族，以及带 SQLite 的 PDO。如果你的应用要用 `pdo_mysql`、`intl` 或 `gd`，就得挑一个带这些扩展的 PHP 来构建 Rapira。
- **你在开发 Rapira 本身**，或者想用上还没发布的东西。

## 工具链

除了常规的编译工具，还需要三样东西：

- **Rust，stable 通道。**仓库里的 `rust-toolchain.toml` 已经把版本钉死，[rustup](https://rustup.rs/) 会自己选中正确的工具链。
- **一个 C 编译器和 `pkg-config`。**构建里有一部分是 C：几个对着 PHP 头文件编译的小垫片。
- **libclang**，因为到 Zend API 的绑定是构建时由 bindgen 生成的。这个包在 Debian/Ubuntu 上叫 `libclang-dev`，Fedora 上叫 `clang-devel`，Arch 上叫 `clang`。

## 带 embed SAPI 的 PHP

Rapira 把解释器直接链接进自己的进程，而不是通过 socket 与它通信，因此 PHP 必须以共享库的形式存在：**8.4 或 8.5 版本，NTS（非线程安全），并且用 `--enable-embed=shared` 配置**——正是这个开关产出了 `libphp.so`（macOS 上是 `libphp.dylib`）。

::: warning ZTS 构建会被拒绝
线程安全（ZTS）的 PHP 会让构建带着明确的错误停下来——Rapira 只支持 NTS，因为它给每个 worker 进程配一个解释器。如果 `PATH` 上的 PHP 是 ZTS 构建，就装一个 NTS 的，再把 `PHP_CONFIG` 指向它（见下文）。
:::

有几个发行版已经把 embed SAPI 打好包了：

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora/RHEL
sudo pacman -S php php-embed                  # Arch
sudo apk add php84-dev php84-embed            # Alpine
```

::: warning macOS 没有现成的 embed SAPI 包
Homebrew 的 `php` formula 在编译时没带上它，也就没有东西可供链接。在 macOS 上请自己从源码编译 PHP。
:::

### 自己编译 PHP

如果你的发行版没有 embed 包、你在 macOS 上，或者现成的包里缺少应用需要的扩展，就自己编译 PHP。

仓库里的 `ci/php-configure-flags.txt` 就是参考用的 configure 参数，官方发布的构建用的也是这一份。解开 PHP 源码后把它喂给 `configure`，再补上你的应用需要的扩展：

```bash
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/ci/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

在 macOS 上先把依赖装齐（`brew install pkg-config openssl@3 curl oniguruma libxml2 sqlite`），把它们的 `lib/pkgconfig` 目录加进 `PKG_CONFIG_PATH`，并在参数文件后面追加 `--with-iconv="$(xcrun --show-sdk-path)/usr"`——光写一个 `--with-iconv` 在那儿找不到 libiconv，而在 autoconf 里写在后面的那个说了算。

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

运行时 Rapira 会动态加载 `libphp.so`（macOS 上是 `libphp.dylib`）。如果它在标准位置，你什么都不用做；否则就把加载器指向它：

```bash
LD_LIBRARY_PATH=$HOME/.local/php-nts/lib ./target/release/rapira serve worker.php     # Linux
DYLD_LIBRARY_PATH=$HOME/.local/php-nts/lib ./target/release/rapira serve worker.php   # macOS
```

构建出来的就是软件包安装的那个服务器：[快速开始](/zh/docs/quickstart)带你写第一个脚本，[命令行](/zh/docs/cli)列出了 `serve` 接受的全部参数，[配置](/zh/docs/configuration)讲的是 `rapira.toml`。

## 参与 Rapira 本身的开发

`make test` 会把两套测试都跑一遍——进程内的那套，以及会拉起真实二进制的端到端那套；`make stubs` 从 `crates/php_sys/rapira.stub.php` 重新生成 arginfo 头文件；CI 则在每个 pull request 上跑构建、`cargo fmt`、clippy 和覆盖率。
