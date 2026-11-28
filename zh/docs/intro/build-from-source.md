---
title: 从源码构建
description: 在 Linux 和 macOS 上编译 Rapira 的要求和步骤。
---

# 从源码构建

Rapira 可以在 Linux 和 macOS 上从源码编译。源码构建可以支持预编译二进制文件不支持的平台和 PHP 扩展。构建需要 Rust、C 工具链和可嵌入的 PHP 库。预编译二进制文件请参阅[安装](/zh/docs/intro/installation)。

## 什么时候需要从源码构建

- **没有支持该平台的预编译二进制文件**。例如不常见的 CPU 架构。
- **发行版比软件包的要求更旧**。PHP 8.4 和 PHP 8.5 二进制文件需要 glibc 2.34 和 OpenSSL 3.0 或更新版本（Debian 12、Ubuntu 22.04、RHEL 9）。PHP 8.6 二进制文件需要 OpenSSL 3.3 以及 RHEL 9.7 或更新版本。
- **应用需要其他 PHP 扩展**。发布构建包含 SQLite、通过 `pdo_pgsql` 和 `pgsql` 提供的 PostgreSQL 支持、`bcmath`、`intl`、`sodium`，以及 PHP 8.4 和 PHP 8.5 上的 `igbinary`。完整扩展列表请参阅[安装](/zh/docs/intro/installation)。如果应用需要 `pdo_mysql` 或 `gd` 等扩展，请使用另一份 PHP 构建。
- **你要修改 Rapira**，或者需要还没有发布的更改。

## 工具链

构建需要以下工具：

- **Rust stable**。请通过 [rustup](https://rustup.rs/) 安装 Rust。`rust-toolchain.toml` 会自动选择 stable 通道。发行版提供的 Rust 软件包可能是较旧的版本。
- **C 编译器**。构建会使用 PHP 头文件编译小型 C 接口文件。
- **libclang**。Bindgen 在构建时使用它创建 Zend API 绑定。Debian 和 Ubuntu 的软件包名为 `libclang-dev`，Fedora 为 `clang-devel`，Arch 为 `clang`。

## 带 embed SAPI 的 PHP

Rapira 将 PHP 解释器链接到自己的进程中，不使用 socket。使用 `--enable-zts --enable-embed=shared --disable-zend-signals` 构建线程安全（ZTS）的 PHP 8.4、8.5 或 8.6。这会创建 `libphp.so`，在 macOS 上创建 `libphp.dylib`。

启用 OPcache 的多 worker 运行需要 [PHP 线程锁修复](https://github.com/php/php-src/commit/36c6d1f500f7ec477f6eae0b0f5c46b041d82347)。Rapira 会检查各个次版本中是否为 PHP 8.4.29、8.5.14、8.6.1 或更高版本。

::: info NTS PHP 回退
发行版中的 embed 软件包通常是非线程安全（NTS）的。链接到 NTS PHP 的构建只能运行一个包含单个 worker 的进程池。当 `workers` 大于 `1` 时，Rapira 会发出警告，并且会拒绝第二个 PHP 进程池。
:::

有几个发行版打包了 NTS embed SAPI：

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora
sudo pacman -S php php-embed                  # Arch
```

::: warning macOS 没有 embed SAPI 软件包
Homebrew 的 `php` formula 不包含 embed SAPI。请在 macOS 上从源码构建 PHP。
:::

### 从源码构建 PHP

如需多 worker 或自定义扩展，请从源码构建 ZTS PHP。

`.github/php-configure-flags.txt` 包含随 PHP 发布打包的扩展的配置选项，其中包括 `bcmath`、`intl`、`pdo_pgsql`、`pgsql` 和 `sodium`。

在 Debian 或 Ubuntu 上，请安装构建依赖：

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl git autoconf bison re2c libclang-dev llvm-dev libssl-dev libcurl4-openssl-dev libxml2-dev libonig-dev libsqlite3-dev zlib1g-dev libffi-dev libicu-dev libpq-dev libargon2-dev libreadline-dev libsodium-dev
```

在 macOS 上，请安装构建依赖：

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq argon2 readline libsodium
export PATH="$(brew --prefix bison)/bin:$PATH"
```

在 Rapira 源码目录中，使用单独的 `php-src` 检出运行 `php` 目标：

```bash
make php PHP_SRC=/path/to/php-src
```

此目标构建带共享 embed 库的 ZTS PHP，并将其安装到 `$HOME/.local/share/php-zts` 下。它在前缀的 `etc/php/conf.d` 目录中启用 `sodium`。设置 `PHP_PREFIX` 可安装到其他位置。

对于发布版扩展集，请在 PHP 源码目录中直接配置 PHP：

```bash
./buildconf --force
./configure --prefix="$HOME/.local/share/php-zts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

PHP 8.4 和 PHP 8.5 上的发布构建还会将 `igbinary` 编译进 `libphp`。[构建脚本](https://github.com/rapira-rs/rapira/blob/main/.github/build-php.sh)固定了其源码版本和校验和。Rapira 不随附 `redis`。

### 不带版本号的 `libphp.so` 名称

构建链接 `-lphp`。它搜索 PHP 前缀下的 `lib` 和 `lib64`。其中一个目录必须包含 `libphp.so`，在 macOS 上为 `libphp.dylib`。Debian 和 Ubuntu 只提供带版本号的 `libphp8.4.so`。请在前缀的 `lib` 或 `lib64` 目录中创建所需名称的链接：

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
```

没有 root 权限时，请将链接放在用户目录中。配置链接器和加载器使用它：

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="--cfg tokio_unstable -L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## 构建 Rapira

安装 PHP 之后，使用 Cargo 构建 Rapira：

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
export PHP_CONFIG="$HOME/.local/share/php-zts/bin/php-config"
export LD_LIBRARY_PATH="$("$PHP_CONFIG" --prefix)/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" # Linux
export RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--cfg tokio_unstable"
cargo build --release
```

当内核允许时，Tokio 文件读取器在 Linux 上使用 io_uring。设置 `RUSTFLAGS` 时请保留 `--cfg tokio_unstable`。构建将二进制文件写入 `target/release/rapira`。

::: tip
运行 `make test` 验证构建配置。它通过 `PHP_CONFIG` 查找 `libphp.so` 或 `libphp.dylib`，并自动传递 `--cfg tokio_unstable`。
:::

## 运行你构建的二进制文件

Rapira 在进程启动时加载 `libphp.so` 或 `libphp.dylib`。位于标准系统目录中的库不需要额外配置。如果库在其他目录中，请配置加载器。加载的库必须与构建时 `php-config` 选择的 PHP 具有相同的 PHP 次版本。否则，Rapira 会在启动时报错并停止。

使用[快速开始](/zh/docs/intro/quickstart)中的 `worker.php`。在它旁边创建 `rapira.toml`：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "worker.php"
mode = "worker"
```

```bash
LD_LIBRARY_PATH="$HOME/.local/share/php-zts/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml         # Linux
DYLD_LIBRARY_PATH="$HOME/.local/share/php-zts/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml   # macOS
```

::: tip PHP 8.4 上的 OPcache
PHP 8.4 将 OPcache 构建为单独的 `opcache.so` 文件。请在 `php.ini` 中将 `zend_extension` 设为其绝对路径以加载它。PHP 8.5 和 PHP 8.6 的 `libphp` 已包含 OPcache。
:::

构建结果与软件包提供的服务器功能相同。请参阅[快速开始](/zh/docs/intro/quickstart)、[命令行](/zh/docs/cli)和[配置](/zh/docs/configuration)。

## 参与 Rapira 本身的开发

`make test` 运行单元测试和端到端测试。`make stubs` 根据 `crates/` 下每个 `*.stub.php` 文件重新生成旁边的 `*_arginfo.h` 头文件。它使用 PHP 的 `gen_stub.php`。如果 `make` 找不到该文件，请设置 `GEN_STUB`。对于每个 pull request，CI 运行构建、测试、`cargo fmt`、Clippy 和覆盖率检查。

- `make test_unit` 运行工作区单元测试。
- `make test_e2e` 构建服务器，并串行运行基于二进制文件的端到端测试。`make test` 会依次运行这两个测试套件。
- `make coverage` 将单元测试和端到端测试的覆盖率写入 `lcov.info`。它需要 `cargo-llvm-cov` 和 Rust 组件 `llvm-tools-preview`。
- `make grpc_fixtures` 重新生成 gRPC 测试描述符。它默认使用 Go。设置 `BUF=/path/to/buf` 可使用已安装的 Buf 可执行文件。

有关测试位置、lint 命令和模糊测试命令，请参阅[核心贡献指南](https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md)。模糊测试工作流在 pull request 中为每个目标运行 60 秒，并且每周两次为每个目标运行 30 分钟。
