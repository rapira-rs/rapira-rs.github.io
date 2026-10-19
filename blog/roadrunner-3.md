---
title: "RoadRunner 3"
date: 2026-10-19
description: "RoadRunner 3: server changes, PHP packages renamed to roadrunner/*, the removal of the TCP plugin, DLoad in roadrunner/cli, and a known Composer issue."
author: Rapira Team
image: /blog/roadrunner-3/preview.png
---

# RoadRunner 3 is available

We are glad to announce the release of [RoadRunner 3](https://github.com/roadrunner-server/roadrunner/releases/tag/v3.0.0).

RoadRunner 3 is the last major version for the foreseeable future, and its API is very stable. For this release, we closed the backlog of earlier RoadRunner versions. We also went back to a clear versioning scheme: we stopped using calendar versions and returned to SemVer. RoadRunner 3 will continue to get bug fixes and security updates. But the team now puts most of its effort into Rapira.

This post describes the changes in the server and in the PHP packages. It also tells you how to upgrade.

## Main changes

The [release notes](https://docs.roadrunner.dev/docs/releases/v3-0-0) contain the full list. These are the main changes:

- **Plugins in the default build.** The default build now includes the NSQ jobs driver, HTTP rate limiting, Zstd compression, and the protobuf registry (Protoreg). We removed the TCP plugin.
- **HTTP.** RoadRunner supports PROXY protocol v1 and v2 with an explicit list of trusted proxies. The `rate_limiter` middleware returns `429` with a `Retry-After` header. `static` has new cache settings and the new `rr reset static` command.
- **gRPC.** RoadRunner supports server reflection through Protoreg. Error logs include `google.rpc.Status` details.
- **Jobs.** You can bind a pipeline to a named pool of PHP workers. AMQP supports named connections to different brokers. Kafka can consume selected partitions.
- **Lock.** A new Redis backend shares locks between multiple RoadRunner instances.
- **Logger.** The logger now uses Go `log/slog`. Writes to the output do not block.
- **Unix sockets.** You can set the permissions, owner, and group of sockets for listeners and worker relays.
- **Status.** `/livez` and `/readyz` work as aliases of `/health` and `/ready`.

## Breaking changes

The [upgrade guide from v2025 to v3](https://docs.roadrunner.dev/docs/general/v3-migration) gives the full step-by-step list. These are the most important changes:

| Area                 | Change                                                                                                                                     |
|----------------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| HTTP middleware      | A request goes through `http.middleware` from left to right. To keep the old order, reverse the list.                                      |
| HTTP/2               | Cleartext HTTP/2 works only with prior knowledge. RoadRunner no longer supports `Upgrade: h2c`.                                            |
| AMQP                 | Broker settings move to named connections. The `config.version` option no longer exists.                                                   |
| Logger               | `file_logger_options` and the built-in rotation no longer exist. Use `output` and an external rotation tool. When the queue is full, the logger drops new entries. |
| Tracing              | The native Zipkin exporter no longer exists. Use OTLP.                                                                                     |
| RPC                  | Goridge v4 does not support MessagePack. You can use JSON, protobuf, Gob, and raw.                                                         |
| Jobs                 | RoadRunner reserves the `pool` header to route jobs to a named pool. The default `pipeline_size` is now `100000`.                          |
| NATS                 | When a pipeline stops, RoadRunner keeps the stream by default.                                                                             |
| Centrifuge           | The `centrifuge.RateLimit` method no longer exists.                                                                                        |
| `envfile`            | RoadRunner loads the root `envfile` without experimental mode. The specified file must exist.                                              |
| `server.on_init.env` | The values override inherited environment variables.                                                                                       |
| TCP plugin           | RoadRunner 3 does not support it.                                                                                                          |

The root of `.rr.yaml` still sets `version: "3"`. To build from source, you need Go 1.27 or later.

Go plugin authors must move to `api-go/v6`, `api-plugins/v6`, `pool/v2`, `goridge/v4`, and `*slog.Logger`. The Velox builder uses a new module configuration. Velox no longer has the remote build server or the Windows targets. The release still includes prebuilt Windows binaries.

## PHP packages

We also updated the PHP packages. These are the main changes:

- The minimum PHP version is 8.2.
- All packages use the new `roadrunner/*` vendor name instead of `spiral/*` and `roadrunner-php/*`.
- Class namespaces stay the same for backward compatibility.
- Each new package declares `replace` for its old name with `self.version`. The metapackage is an exception, as described below.
- The `spiral/roadrunner` metapackage is now `roadrunner/roadrunner`. The `roadrunner/*` packages require `roadrunner/roadrunner ^3.0`. The new name solves these problems:
  - The calendar versions 2023.x–2025.x do not follow SemVer, but they often appeared as the latest stable versions. CalVer stays in `spiral/roadrunner`.
  - The advisory [CVE-2025-22871](https://github.com/advisories/GHSA-g9pc-8g42-g6vq) marks `spiral/roadrunner < 2025.1.0` as vulnerable. This advisory blocked the installation of RoadRunner 3 through Composer. The new name does not have this problem.
- All packages require RoadRunner 3. We do not guarantee that older RoadRunner versions work with the new packages.
- RoadRunner 3 does not include the TCP plugin. If your application uses the TCP plugin, we recommend that you stay on RoadRunner v2025. This change does not affect the `tcp://` transport for RPC and worker relays. That transport works as before.

Other improvements:

- We rewrote the tests with [Testo](https://github.com/php-testo/testo).
- We improved the code coverage, mutation testing, and static analysis scores.
- RoadRunner CLI 3.0.0 uses [DLoad](https://github.com/php-internal/dload) to download binaries.

| Old name | New name | Status |
|---|---|---|
| `spiral/roadrunner` | `roadrunner/roadrunner` | [![Version](https://img.shields.io/packagist/v/roadrunner/roadrunner.svg?label=)](https://packagist.org/packages/roadrunner/roadrunner) |
| `spiral/roadrunner-worker` | `roadrunner/worker` | [![Version](https://img.shields.io/packagist/v/roadrunner/worker.svg?label=)](https://packagist.org/packages/roadrunner/worker) [![Psalm](https://shepherd.dev/github/roadrunner-php/worker/level.svg)](https://shepherd.dev/github/roadrunner-php/worker) [![Coverage](https://codecov.io/gh/roadrunner-php/worker/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/worker/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fworker%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/worker/3.x) |
| `spiral/roadrunner-http` | `roadrunner/http` | [![Version](https://img.shields.io/packagist/v/roadrunner/http.svg?label=)](https://packagist.org/packages/roadrunner/http) [![Psalm](https://shepherd.dev/github/roadrunner-php/http/level.svg)](https://shepherd.dev/github/roadrunner-php/http) [![Coverage](https://codecov.io/gh/roadrunner-php/http/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/http/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fhttp%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/http/4.x) |
| `spiral/roadrunner-grpc` | `roadrunner/grpc` | [![Version](https://img.shields.io/packagist/v/roadrunner/grpc.svg?label=)](https://packagist.org/packages/roadrunner/grpc) [![Psalm](https://shepherd.dev/github/roadrunner-php/grpc/level.svg)](https://shepherd.dev/github/roadrunner-php/grpc) [![Coverage](https://codecov.io/gh/roadrunner-php/grpc/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/grpc/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fgrpc%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/grpc/3.x) |
| `spiral/roadrunner-jobs` | `roadrunner/jobs` | [![Version](https://img.shields.io/packagist/v/roadrunner/jobs.svg?label=)](https://packagist.org/packages/roadrunner/jobs) [![Psalm](https://shepherd.dev/github/roadrunner-php/jobs/level.svg)](https://shepherd.dev/github/roadrunner-php/jobs) [![Coverage](https://codecov.io/gh/roadrunner-php/jobs/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/jobs/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fjobs%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/jobs/4.x) |
| `spiral/roadrunner-kv` | `roadrunner/kv` | [![Version](https://img.shields.io/packagist/v/roadrunner/kv.svg?label=)](https://packagist.org/packages/roadrunner/kv) [![Psalm](https://shepherd.dev/github/roadrunner-php/kv/level.svg)](https://shepherd.dev/github/roadrunner-php/kv) [![Coverage](https://codecov.io/gh/roadrunner-php/kv/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/kv/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fkv%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/kv/4.x) |
| `spiral/roadrunner-metrics` | `roadrunner/metrics` | [![Version](https://img.shields.io/packagist/v/roadrunner/metrics.svg?label=)](https://packagist.org/packages/roadrunner/metrics) [![Psalm](https://shepherd.dev/github/roadrunner-php/metrics/level.svg)](https://shepherd.dev/github/roadrunner-php/metrics) [![Coverage](https://codecov.io/gh/roadrunner-php/metrics/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/metrics/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fmetrics%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/metrics/3.x) |
| `spiral/roadrunner-services` | `roadrunner/services` | [![Version](https://img.shields.io/packagist/v/roadrunner/services.svg?label=)](https://packagist.org/packages/roadrunner/services) [![Psalm](https://shepherd.dev/github/roadrunner-php/services/level.svg)](https://shepherd.dev/github/roadrunner-php/services) [![Coverage](https://codecov.io/gh/roadrunner-php/services/branch/2.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/services/branch/2.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fservices%2F2.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/services/2.x) |
| `spiral/goridge` | `roadrunner/goridge` | [![Version](https://img.shields.io/packagist/v/roadrunner/goridge.svg?label=)](https://packagist.org/packages/roadrunner/goridge) [![Psalm](https://shepherd.dev/github/roadrunner-php/goridge/level.svg)](https://shepherd.dev/github/roadrunner-php/goridge) [![Coverage](https://codecov.io/gh/roadrunner-php/goridge/branch/4.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/goridge/branch/4.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fgoridge%2F4.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/goridge/4.x) |
| `spiral/roadrunner-cli` | `roadrunner/cli` | [![Version](https://img.shields.io/packagist/v/roadrunner/cli.svg?label=)](https://packagist.org/packages/roadrunner/cli) [![Psalm](https://shepherd.dev/github/roadrunner-php/cli/level.svg)](https://shepherd.dev/github/roadrunner-php/cli) [![Coverage](https://codecov.io/gh/roadrunner-php/cli/branch/3.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/cli/branch/3.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fcli%2F3.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/cli/3.x) |
| `roadrunner-php/app-logger` | `roadrunner/app-logger` | [![Version](https://img.shields.io/packagist/v/roadrunner/app-logger.svg?label=)](https://packagist.org/packages/roadrunner/app-logger) [![Psalm](https://shepherd.dev/github/roadrunner-php/app-logger/level.svg)](https://shepherd.dev/github/roadrunner-php/app-logger) [![Coverage](https://codecov.io/gh/roadrunner-php/app-logger/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/app-logger/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fapp-logger%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/app-logger/1.x) |
| `roadrunner-php/centrifugo` | `roadrunner/centrifugo` | [![Version](https://img.shields.io/packagist/v/roadrunner/centrifugo.svg?label=)](https://packagist.org/packages/roadrunner/centrifugo) [![Psalm](https://shepherd.dev/github/roadrunner-php/centrifugo/level.svg)](https://shepherd.dev/github/roadrunner-php/centrifugo) [![Coverage](https://codecov.io/gh/roadrunner-php/centrifugo/branch/2.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/centrifugo/branch/2.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fcentrifugo%2F2.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/centrifugo/2.x) |
| `roadrunner-php/lock` | `roadrunner/lock` | [![Version](https://img.shields.io/packagist/v/roadrunner/lock.svg?label=)](https://packagist.org/packages/roadrunner/lock) [![Psalm](https://shepherd.dev/github/roadrunner-php/lock/level.svg)](https://shepherd.dev/github/roadrunner-php/lock) [![Coverage](https://codecov.io/gh/roadrunner-php/lock/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/lock/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Flock%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/lock/1.x) |
| `roadrunner-php/symfony-lock-driver` | `roadrunner/symfony-lock-driver` | [![Version](https://img.shields.io/packagist/v/roadrunner/symfony-lock-driver.svg?label=)](https://packagist.org/packages/roadrunner/symfony-lock-driver) [![Psalm](https://shepherd.dev/github/roadrunner-php/symfony-lock-driver/level.svg)](https://shepherd.dev/github/roadrunner-php/symfony-lock-driver) [![Coverage](https://codecov.io/gh/roadrunner-php/symfony-lock-driver/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/symfony-lock-driver/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fsymfony-lock-driver%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/symfony-lock-driver/1.x) |
| `roadrunner-php/version-checker` | `roadrunner/version-checker` | [![Version](https://img.shields.io/packagist/v/roadrunner/version-checker.svg?label=)](https://packagist.org/packages/roadrunner/version-checker) [![Psalm](https://shepherd.dev/github/roadrunner-php/version-checker/level.svg)](https://shepherd.dev/github/roadrunner-php/version-checker) [![Coverage](https://codecov.io/gh/roadrunner-php/version-checker/branch/1.x/graph/badge.svg)](https://codecov.io/gh/roadrunner-php/version-checker/branch/1.x) [![MSI](https://img.shields.io/endpoint?label=MSI&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Froadrunner-php%2Fversion-checker%2F1.x)](https://dashboard.stryker-mutator.io/reports/github.com/roadrunner-php/version-checker/1.x) |
| `roadrunner-php/roadrunner-api-dto` | `roadrunner/api-dto` | [![Version](https://img.shields.io/packagist/v/roadrunner/api-dto.svg?label=)](https://packagist.org/packages/roadrunner/api-dto) |

To migrate, replace the package names and versions in `composer.json`.

## Even more stable

RoadRunner already had the most reliable integration with PHP. What can be more stable than STDIN and STDOUT? Even so, we found things to improve in version 3. Memory use is now steadier, and performance is slightly higher.

![Memory use of RoadRunner v2025, RoadRunner v3, and the Rapira dispatcher as the load increases](/blog/roadrunner-3/benches.png)

However, if you need the highest performance for HTTP or gRPC endpoints, it may be time to try [Rapira](/docs/intro/).
