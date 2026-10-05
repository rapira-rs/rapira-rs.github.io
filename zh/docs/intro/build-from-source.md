---
title: 从源码构建
description: 在 Linux 和 macOS 上编译 Rapira 的要求和步骤。
---

# 从源码构建

Rapira 可以在 Linux 和 macOS 上从源码编译。源码构建可以支持预编译二进制文件不支持的平台和 PHP 扩展。构建需要 Rust、C 工具链和可嵌入的 PHP 库。预编译二进制文件请参阅[安装](/zh/docs/intro/installation)。

## 什么时候需要从源码构建

- **没有支持该平台的预编译二进制文件**。例如不常见的 CPU 架构，以及 Alpine 这类基于 musl 的发行版。
- **发行版比软件包的要求更旧**。发布的二进制文件需要 glibc 2.34 或更新版本。支持的最旧系统是 Debian 12、Ubuntu 22.04 和 RHEL 9。
- **应用需要其他 PHP 扩展**。发布构建包含 SQLite、通过 `pdo_pgsql` 和 `pgsql` 提供的 PostgreSQL 支持，以及 `bcmath`、`intl`、`igbinary` 和 `redis`。完整扩展列表请参阅[安装](/zh/docs/intro/installation)。如果应用需要 `pdo_mysql` 或 `gd` 等扩展，请使用另一份 PHP 构建。
- **你要修改 Rapira**，或者需要还没有发布的更改。

## 工具链

构建需要以下工具：

- **Rust 1.99 或更新版本**。请通过 [rustup](https://rustup.rs/) 安装 Rust。仓库中的 `rust-toolchain.toml` 选择 stable 通道。如果已安装的 stable 版本低于 1.99，请运行 `rustup update stable`。发行版提供的 Rust 软件包可能版本太旧。
- **C 编译器**。构建会使用 PHP 头文件编译小型 C 接口文件。
- **libclang**。Bindgen 在构建时使用它创建 Zend API 绑定。Debian 和 Ubuntu 的软件包名为 `libclang-dev`，Fedora 为 `clang-devel`，Arch 为 `clang`。

## 带 embed SAPI 的 PHP

Rapira 将 PHP 解释器链接到自己的进程中，不使用 socket。PHP 必须是 8.4 或 8.5 版本的 NTS 共享库。使用 `--enable-embed=shared` 配置 PHP。此选项创建 `libphp.so`，在 macOS 上创建 `libphp.dylib`。

::: warning 构建拒绝 ZTS
线程安全的 PHP 会导致构建错误。Rapira 要求 NTS，因为它在每个 worker 进程中运行一个解释器。如果 `PATH` 选择了 ZTS 构建，请安装 NTS PHP。将 `PHP_CONFIG` 设为其 `php-config` 路径。
:::

有几个发行版已经提供 embed SAPI 软件包：

```bash
sudo apt install php8.4-dev libphp8.4-embed   # Debian/Ubuntu (deb.sury.org / ppa:ondrej)
sudo dnf install php-devel php-embedded       # Fedora/RHEL
sudo pacman -S php php-embed                  # Arch
sudo apk add php84-dev php84-embed            # Alpine
```

::: warning macOS 没有 embed SAPI 软件包
Homebrew 的 `php` formula 不包含 embed SAPI。请在 macOS 上从源码构建 PHP。
:::

### 从源码构建 PHP

如果没有 embed 软件包，请构建 PHP。软件包缺少所需扩展时，也请构建 PHP。

`.github/php-configure-flags.txt` 包含 PHP 随附扩展的配置选项，其中包括 `bcmath`、`intl`、`pdo_pgsql` 和 `pgsql`。

请安装 ICU 和 PostgreSQL 客户端开发库，以支持 `intl` 和 PostgreSQL。Debian 或 Ubuntu 上的软件包名为 `libicu-dev` 和 `libpq-dev`，Rocky Linux 上为 `libicu-devel` 和 `libpq-devel`。`intl` 扩展还需要 C++ 编译器。

在 Debian 或 Ubuntu 上，请安装构建依赖：

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config curl git autoconf bison re2c libclang-dev llvm-dev libssl-dev libcurl4-openssl-dev libxml2-dev libonig-dev libsqlite3-dev zlib1g-dev libffi-dev libicu-dev libpq-dev
```

在 macOS 上，请安装构建依赖：

```bash
brew install autoconf bison re2c pkg-config openssl@3 curl oniguruma libxml2 sqlite libffi gettext icu4c libpq
export PATH="$(brew --prefix bison)/bin:$PATH"
```

在 Rapira 源码目录中，运行 `php` 目标：

```bash
make php PHP_SRC=/path/to/php-src PHP_PREFIX="$HOME/.local/php-nts"
```

此目标运行 `buildconf`，配置并编译 PHP，然后将其安装到 `PHP_PREFIX` 下。它启用 `.github/php-configure-flags.txt` 中的 PHP 随附扩展。它会检测 macOS，并设置 Homebrew 库路径和 iconv 的 SDK 路径。

如需自定义扩展集，请在 PHP 源码目录中直接配置 PHP。将所需扩展选项追加到 `./configure`：

```bash
./buildconf --force
./configure --prefix="$HOME/.local/php-nts" $(tr '\n' ' ' < /path/to/rapira/.github/php-configure-flags.txt)
make -j"$(getconf _NPROCESSORS_ONLN)"
make install
```

在 macOS 上手动配置时，请使用 `php` 目标中的库路径和配置选项。

`make` 目标不会添加 `igbinary` 和 `redis`。发布 CI 将这两个扩展编译进 `libphp`，并为 Redis 启用 igbinary 序列化。[发布工作流](https://github.com/rapira-rs/rapira/blob/main/.github/workflows/build-binaries.yml)固定了它们的源码版本和校验和。要添加它们，请将其源码解压到 PHP 的 `ext/igbinary` 和 `ext/redis` 目录。请在运行 `./buildconf --force` 之前完成此操作。然后将 `--enable-igbinary --enable-redis --enable-redis-igbinary` 添加到 `./configure`。

### 不带版本号的 `libphp.so` 名称

构建链接 `-lphp`。它只搜索 PHP 前缀下的 `lib` 和 `lib64`。其中一个目录必须包含 `libphp.so`，在 macOS 上为 `libphp.dylib`。Debian 和 Ubuntu 只提供带版本号的 `libphp8.4.so`。Alpine 将 `libphp.so` 放在 `lib/phpXX` 中，构建不搜索该目录。请在前缀的 `lib` 或 `lib64` 目录中创建所需名称的链接：

```bash
sudo ln -sf /usr/lib/libphp8.4.so /usr/lib/libphp.so        # Debian/Ubuntu
sudo ln -sf /usr/lib/php84/libphp.so /usr/lib/libphp.so     # Alpine
```

没有 root 权限时，请将链接放在用户目录中。然后配置链接器和加载器使用它：

```bash
mkdir -p ~/.local/phplib
ln -sf /usr/lib/libphp8.4.so ~/.local/phplib/libphp.so
export RUSTFLAGS="-L native=$HOME/.local/phplib"
export LD_LIBRARY_PATH="$HOME/.local/phplib:/usr/lib"
```

## 构建 Rapira

安装 PHP 之后，使用 Cargo 构建 Rapira：

```bash
git clone https://github.com/rapira-rs/rapira.git
cd rapira
cargo build --release
```

构建将二进制文件写入 `target/release/rapira`。

构建通过 `php-config` 查找 PHP。如果 `PATH` 没有选择所需的 PHP，请设置 `PHP_CONFIG`：

```bash
PHP_CONFIG=$HOME/.local/php-nts/bin/php-config cargo build --release
```

::: tip
运行 `make test` 验证构建配置。它在 PHP 前缀下的 `lib`、`lib64` 或 `lib/phpXX` 中查找 PHP 库。它接受不带版本号和带版本号的库名称，并创建链接器需要的不带版本号的名称。
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
LD_LIBRARY_PATH="$HOME/.local/php-nts/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml         # Linux
DYLD_LIBRARY_PATH="$HOME/.local/php-nts/lib${DYLD_LIBRARY_PATH:+:$DYLD_LIBRARY_PATH}" ./target/release/rapira serve /path/to/app/rapira.toml   # macOS
```

::: tip PHP 8.4 上的 OPcache
PHP 8.4 将 OPcache 构建为单独的 `opcache.so` 文件。请在 `php.ini` 中添加 `zend_extension=opcache` 来加载它。PHP 8.5 的 `libphp` 已包含 OPcache。
:::

构建结果与软件包提供的服务器功能相同。请参阅[快速开始](/zh/docs/intro/quickstart)、[命令行](/zh/docs/cli)和[配置](/zh/docs/configuration)。

## 参与 Rapira 本身的开发

`make test` 运行单元测试和端到端测试。`make stubs` 根据 `crates/` 下每个 `*.stub.php` 文件重新生成旁边的 `*_arginfo.h` 头文件。它使用 PHP 的 `gen_stub.php`。如果 `make` 找不到该文件，请设置 `GEN_STUB`。对于每个 pull request，CI 运行构建、测试、`cargo fmt`、Clippy 和覆盖率检查。

- `make test_nts` 运行工作区单元测试。
- `make test_e2e` 构建服务器，并使用服务器二进制文件运行端到端测试。请与 `test_nts` 分开运行。`make test` 会依次运行这两个目标。
- `make coverage` 将单元测试和端到端测试的覆盖率写入 `lcov.info`。它需要 `cargo-llvm-cov` 和 Rust 组件 `llvm-tools-preview`。
- `make grpc_fixtures` 重新生成 gRPC 测试描述符。它默认使用 Go。设置 `BUF=/path/to/buf` 可使用已安装的 Buf 可执行文件。

有关测试位置、lint 命令和模糊测试命令，请参阅[核心贡献指南](https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md)。模糊测试工作流在 pull request 中为每个目标运行 60 秒，并且每周两次为每个目标运行 30 分钟。
