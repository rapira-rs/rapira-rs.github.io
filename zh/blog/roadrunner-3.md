---
title: "RoadRunner 3"
date: 2026-10-19
description: "RoadRunner 3 发布：服务端有哪些变化，PHP 包统一改名为 roadrunner/*，TCP 插件何去何从，roadrunner/cli 改用 DLoad，以及一个已知的 Composer 问题。"
author: Rapira Team
image: /blog/roadrunner-3/preview.png
---

# RoadRunner 3 正式发布

很高兴地宣布，[RoadRunner 3](https://github.com/roadrunner-server/roadrunner/releases/tag/v3.0.0) 已经发布。

RoadRunner 3 是可预见的未来里最后一个大版本，API 极其稳定。借着这次发布，我们清空了以往各个版本积压的 backlog，版本号也回归了清晰的规则：告别日历版本号（CalVer），重新采用 SemVer。RoadRunner 3 会继续获得 bug 修复和安全更新，不过团队今后的主要精力会放在 Rapira 上。

下面介绍服务端和 PHP 包各有哪些变化，以及如何升级。

## 主要变化

完整列表请查看[发布说明](https://docs.roadrunner.dev/docs/releases/v3-0-0)，这里只挑重点：

- **默认构建内置的插件。** 新增 NSQ 队列驱动、HTTP 限流（rate limiting）、Zstd 压缩和 protobuf 注册表（Protoreg）；移除了 TCP 插件。
- **HTTP。** 支持 PROXY protocol v1 和 v2，需要显式配置受信任的代理列表。`rate_limiter` 中间件会返回 `429` 并带上 `Retry-After` 头。`static` 新增了缓存相关配置，以及 `rr reset static` 命令。
- **gRPC。** 基于 Protoreg 实现 server reflection；错误日志中会输出 `google.rpc.Status` 的详细信息。
- **Jobs。** 支持命名 worker 池：可以把某个 pipeline 绑定到单独的 PHP worker 池。AMQP 支持命名连接，可同时连接多个 broker。Kafka 可以只消费指定的分区。
- **Lock。** 新增 Redis 后端，可以在多个 RoadRunner 实例之间加锁。
- **Logger。** 日志改用 Go 的 `log/slog` 实现，写入输出不再阻塞。
- **Unix socket。** 监听器和 worker relay 使用的 socket 可以设置权限、属主和属组。
- **Status。** `/livez` 和 `/readyz` 分别作为 `/health` 和 `/ready` 的别名。

## 破坏性变更

逐项说明请参考 [v2025 升级到 v3 的迁移指南](https://docs.roadrunner.dev/docs/general/v3-migration)。影响最大的几项如下：

| 模块                 | 变化                                                                                                     |
|----------------------|----------------------------------------------------------------------------------------------------------|
| HTTP middleware      | 请求按从左到右的顺序经过 `http.middleware`。如需保持原来的执行顺序，请把列表倒过来。                     |
| HTTP/2               | 明文 HTTP/2（h2c）只支持 prior knowledge 方式，不再支持 `Upgrade: h2c`。                                 |
| AMQP                 | broker 配置迁移到命名连接中，`config.version` 已移除。                                                   |
| Logger               | 移除了 `file_logger_options` 和内置的日志轮转，请改用 `output` 配合外部轮转工具。队列满时会丢弃新的日志。 |
| 链路追踪             | 移除了原生的 Zipkin exporter，请改用 OTLP。                                                              |
| RPC                  | Goridge v4 不再支持 MessagePack，可选 JSON、protobuf、Gob 和 raw。                                       |
| Jobs                 | `pool` 头被保留，用于把任务路由到命名池。`pipeline_size` 的默认值改为 `100000`。                          |
| NATS                 | 停止 pipeline 时默认保留 stream。                                                                        |
| Centrifuge           | 移除了 `centrifuge.RateLimit` 方法。                                                                     |
| `envfile`            | 根级 `envfile` 无需开启 experimental 模式即可加载，但指定的文件必须存在。                                |
| `server.on_init.env` | 这里配置的值会覆盖继承来的环境变量。                                                                     |
| TCP 插件             | RoadRunner 3 不再支持。                                                                                  |

`.rr.yaml` 根级仍然写 `version: "3"`。从源码构建需要 Go 1.27 及以上。Go 插件作者需要迁移到 `api-go/v6`、`api-plugins/v6`、`pool/v2`、`goridge/v4` 和 `*slog.Logger`。构建工具 Velox 改用新的模块配置格式，同时去掉了远程构建服务器和 Windows 构建目标。不过发布页仍然提供 Windows 的预编译二进制。


## PHP 包

PHP 包也随服务端一起更新了，要点如下：

- 最低 PHP 版本为 8.2。
- 所有包统一使用新的 vendor 名 `roadrunner/*`（取代 `spiral/*` 和 `roadrunner-php/*`）。
- 为了保持向后兼容，类的命名空间没有变化。
- 每个新包都通过 `replace` 以 `self.version` 声明替代旧包名。元包是个例外，见下文。
- 元包 `spiral/roadrunner` 更名为 `roadrunner/roadrunner`，各个 `roadrunner/*` 包都依赖 `roadrunner/roadrunner ^3.0`。改名帮我们避开了几个麻烦：
  - 2023.x–2025.x 这些不符合 SemVer 的日历版本号，总是被当成最新的稳定版本冒出来。CalVer 版本留在了 `spiral/roadrunner` 下。
  - 安全公告 [CVE-2025-22871](https://github.com/advisories/GHSA-g9pc-8g42-g6vq) 把 `spiral/roadrunner < 2025.1.0` 标记为存在漏洞，导致无法通过 Composer 安装 RoadRunner 3。换了新包名，这个包袱也就没有了。
- 所有包都要求 RoadRunner 3。旧版 RoadRunner 搭配新包能否正常工作，不作保证。
- RoadRunner 3 彻底移除了 TCP 插件。用到 TCP 插件的应用，建议继续使用 RoadRunner v2025。注意这和 RPC 以及 worker relay 使用的 `tcp://` 传输无关，后者照常可用。

其他打磨：

- 测试改用 [Testo](https://github.com/php-testo/testo) 重写。
- Code Coverage、Mutation Testing 和 Static Analysis 各项指标都有提升。
- RoadRunner CLI 3.0.0 改用 [DLoad](https://github.com/php-internal/dload) 下载二进制文件。

| 旧包名 | 新包名 | 状态 |
|---|---|---|
| `spiral/roadrunner` | `roadrunner/roadrunner` | [![版本](https://img.shields.io/packagist/v/roadrunner/roadrunner.svg?label=)](https://packagist.org/packages/roadrunner/roadrunner) |
| `spiral/roadrunner-worker` | `roadrunner/worker` | [![版本](https://img.shields.io/packagist/v/roadrunner/worker.svg?label=)](https://packagist.org/packages/roadrunner/worker) [![Psalm](https://shepherd.dev/github/roadrunner-php/worker/level.svg)](https://shepherd.dev/github/roadrunner-php/worker) [![覆盖率](https://codecov.io/gh/roadrunner-php/worker/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/worker/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fworker%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/worker/3.x) |
| `spiral/roadrunner-http` | `roadrunner/http` | [![版本](https://img.shields.io/packagist/v/roadrunner/http.svg?label=)](https://packagist.org/packages/roadrunner/http) [![Psalm](https://shepherd.dev/github/roadrunner-php/http/level.svg)](https://shepherd.dev/github/roadrunner-php/http) [![覆盖率](https://codecov.io/gh/roadrunner-php/http/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/http/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fhttp%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/http/4.x) |
| `spiral/roadrunner-grpc` | `roadrunner/grpc` | [![版本](https://img.shields.io/packagist/v/roadrunner/grpc.svg?label=)](https://packagist.org/packages/roadrunner/grpc) [![Psalm](https://shepherd.dev/github/roadrunner-php/grpc/level.svg)](https://shepherd.dev/github/roadrunner-php/grpc) [![覆盖率](https://codecov.io/gh/roadrunner-php/grpc/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/grpc/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fgrpc%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/grpc/3.x) |
| `spiral/roadrunner-jobs` | `roadrunner/jobs` | [![版本](https://img.shields.io/packagist/v/roadrunner/jobs.svg?label=)](https://packagist.org/packages/roadrunner/jobs) [![Psalm](https://shepherd.dev/github/roadrunner-php/jobs/level.svg)](https://shepherd.dev/github/roadrunner-php/jobs) [![覆盖率](https://codecov.io/gh/roadrunner-php/jobs/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/jobs/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fjobs%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/jobs/4.x) |
| `spiral/roadrunner-kv` | `roadrunner/kv` | [![版本](https://img.shields.io/packagist/v/roadrunner/kv.svg?label=)](https://packagist.org/packages/roadrunner/kv) [![Psalm](https://shepherd.dev/github/roadrunner-php/kv/level.svg)](https://shepherd.dev/github/roadrunner-php/kv) [![覆盖率](https://codecov.io/gh/roadrunner-php/kv/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/kv/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fkv%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/kv/4.x) |
| `spiral/roadrunner-metrics` | `roadrunner/metrics` | [![版本](https://img.shields.io/packagist/v/roadrunner/metrics.svg?label=)](https://packagist.org/packages/roadrunner/metrics) [![Psalm](https://shepherd.dev/github/roadrunner-php/metrics/level.svg)](https://shepherd.dev/github/roadrunner-php/metrics) [![覆盖率](https://codecov.io/gh/roadrunner-php/metrics/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/metrics/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fmetrics%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/metrics/3.x) |
| `spiral/roadrunner-services` | `roadrunner/services` | [![版本](https://img.shields.io/packagist/v/roadrunner/services.svg?label=)](https://packagist.org/packages/roadrunner/services) [![Psalm](https://shepherd.dev/github/roadrunner-php/services/level.svg)](https://shepherd.dev/github/roadrunner-php/services) [![覆盖率](https://codecov.io/gh/roadrunner-php/services/branch/2.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/services/branch/2.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fservices%2F2.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/services/2.x) |
| `spiral/goridge` | `roadrunner/goridge` | [![版本](https://img.shields.io/packagist/v/roadrunner/goridge.svg?label=)](https://packagist.org/packages/roadrunner/goridge) [![Psalm](https://shepherd.dev/github/roadrunner-php/goridge/level.svg)](https://shepherd.dev/github/roadrunner-php/goridge) [![覆盖率](https://codecov.io/gh/roadrunner-php/goridge/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/goridge/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fgoridge%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/goridge/4.x) |
| `spiral/roadrunner-cli` | `roadrunner/cli` | [![版本](https://img.shields.io/packagist/v/roadrunner/cli.svg?label=)](https://packagist.org/packages/roadrunner/cli) [![Psalm](https://shepherd.dev/github/roadrunner-php/cli/level.svg)](https://shepherd.dev/github/roadrunner-php/cli) [![覆盖率](https://codecov.io/gh/roadrunner-php/cli/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/cli/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fcli%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/cli/3.x) |
| `roadrunner-php/app-logger` | `roadrunner/app-logger` | [![版本](https://img.shields.io/packagist/v/roadrunner/app-logger.svg?label=)](https://packagist.org/packages/roadrunner/app-logger) [![Psalm](https://shepherd.dev/github/roadrunner-php/app-logger/level.svg)](https://shepherd.dev/github/roadrunner-php/app-logger) [![覆盖率](https://codecov.io/gh/roadrunner-php/app-logger/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/app-logger/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fapp-logger%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/app-logger/1.x) |
| `roadrunner-php/centrifugo` | `roadrunner/centrifugo` | [![版本](https://img.shields.io/packagist/v/roadrunner/centrifugo.svg?label=)](https://packagist.org/packages/roadrunner/centrifugo) [![Psalm](https://shepherd.dev/github/roadrunner-php/centrifugo/level.svg)](https://shepherd.dev/github/roadrunner-php/centrifugo) [![覆盖率](https://codecov.io/gh/roadrunner-php/centrifugo/branch/2.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/centrifugo/branch/2.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fcentrifugo%2F2.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/centrifugo/2.x) |
| `roadrunner-php/lock` | `roadrunner/lock` | [![版本](https://img.shields.io/packagist/v/roadrunner/lock.svg?label=)](https://packagist.org/packages/roadrunner/lock) [![Psalm](https://shepherd.dev/github/roadrunner-php/lock/level.svg)](https://shepherd.dev/github/roadrunner-php/lock) [![覆盖率](https://codecov.io/gh/roadrunner-php/lock/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/lock/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Flock%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/lock/1.x) |
| `roadrunner-php/symfony-lock-driver` | `roadrunner/symfony-lock-driver` | [![版本](https://img.shields.io/packagist/v/roadrunner/symfony-lock-driver.svg?label=)](https://packagist.org/packages/roadrunner/symfony-lock-driver) [![Psalm](https://shepherd.dev/github/roadrunner-php/symfony-lock-driver/level.svg)](https://shepherd.dev/github/roadrunner-php/symfony-lock-driver) [![覆盖率](https://codecov.io/gh/roadrunner-php/symfony-lock-driver/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/symfony-lock-driver/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fsymfony-lock-driver%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/symfony-lock-driver/1.x) |
| `roadrunner-php/version-checker` | `roadrunner/version-checker` | [![版本](https://img.shields.io/packagist/v/roadrunner/version-checker.svg?label=)](https://packagist.org/packages/roadrunner/version-checker) [![Psalm](https://shepherd.dev/github/roadrunner-php/version-checker/level.svg)](https://shepherd.dev/github/roadrunner-php/version-checker) [![覆盖率](https://codecov.io/gh/roadrunner-php/version-checker/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/version-checker/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fversion-checker%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/version-checker/1.x) |
| `roadrunner-php/roadrunner-api-dto` | `roadrunner/api-dto` | [![版本](https://img.shields.io/packagist/v/roadrunner/api-dto.svg?label=)](https://packagist.org/packages/roadrunner/api-dto) |

迁移时，只需在 `composer.json` 中替换包名和版本约束即可。

## 更加稳定

RoadRunner 与 PHP 的集成本来就是最可靠的——还有什么比 STDIN/STDOUT 更稳定呢？即便如此，我们在 v3 中仍然找到了可以改进的地方：内存占用更加平稳，性能也又提升了一些。

![负载逐步增加时 RoadRunner v2025、RoadRunner v3 与 Rapira dispatcher 的内存占用](/blog/roadrunner-3/benches.png)

不过，如果你追求 HTTP 或 gRPC 端点的极致性能，或许是时候试试 [Rapira](/zh/docs/intro/) 了。
