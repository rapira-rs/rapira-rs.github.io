---
title: 指标和健康检查
description: "[observability] 进程：/livez、/readyz 和 /metrics 端点，Kubernetes 探针，Prometheus 抓取，以及指标参考。"
faqLevel: 2
---

# 指标和健康检查

`[observability]` 小节再启动一个进程，此进程提供健康探针和 Prometheus 指标。此进程不运行 PHP。它从共享内存读取 PHP worker 的状态。master 与 PHP worker 一起监管、重载和停止此进程。master 和它的 worker 见[进程模型](/zh/docs/process-model)。

如果没有 `[observability]` 小节，Rapira 不启动此进程。Windows 构建不支持此小节，并将它作为未知字段拒绝。

## 启用端点

添加 `[observability]` 小节和它的至少一个子表。配置还必须包含 `[http]` 或 `[grpc]`。以下最小的 `rapira.toml` 启用所有端点：

```toml
[http]
listen = "127.0.0.1:8000"

[http.pool]
entrypoint = "index.php"

[observability]
listen = "127.0.0.1:9180"

[observability.metrics]   # GET /metrics

[observability.probes]    # GET /livez and GET /readyz
```

`[observability.metrics]` 和 `[observability.probes]` 不接受任何键。请使用 `http` 和 `grpc` 监听器不使用的 `listen` 地址。所有键见[`[observability]` 小节](/zh/docs/configuration#observability)。

启动服务器，然后向每个端点发送请求：

```bash
curl -i http://127.0.0.1:9180/livez
curl -i http://127.0.0.1:9180/readyz
curl http://127.0.0.1:9180/metrics
```

此进程使用 `observability` 目标写入日志记录。目标级别见[日志](/zh/docs/logging)。

## 端点

此进程提供不带 TLS 的 HTTP/1.1。它只响应以下请求：

| 请求 | 启用方式 | 状态码 | 响应体 |
| --- | --- | --- | --- |
| `GET /livez` | `[observability.probes]` | 始终为 `200` | `ok` |
| `GET /readyz` | `[observability.probes]` | `200` 或 `503` | `ok`，或者每个未就绪的进程池一行 `pool <name>: no ready worker` |
| `GET /metrics` | `[observability.metrics]` | `200` | Prometheus 文本格式 |

其他所有方法或路径都收到 `404` 和空响应体。已禁用子表的路径也收到 `404`。响应体的每一行都以换行符结束。探针使用 `text/plain; charset=utf-8` 内容类型。`/metrics` 使用 `text/plain; version=0.0.4; charset=utf-8`。

## 存活和就绪

`/livez` 不做任何检查。只要此进程响应，它就返回 `200`。master 停止时，可观测性进程也停止。因此，`200` 响应表示 master 正在运行。master 自己替换失败的 PHP worker，所以 `/livez` 不检查它们。

`/readyz` 依次检查每个 PHP 进程池：先 `http`，然后 `grpc`。当进程池至少有一个 worker 空闲或正在处理请求时，此进程池就绪。正在启动或正在排空的 worker 不计算在内。`/readyz` 在以下情况下返回 `503`：

- 进程池的 worker 正在启动，还没有等待请求。在 Worker 和 Dispatcher 模式下，入口脚本必须先完成启动。
- 入口脚本启动失败。worker 再次尝试，启动成功后进程池变为就绪。不需要任何请求。
- 重载启动的新 worker 没有完成启动。经过 `process_control_timeout_secs` 后，master 仍然停止旧 worker。
- 进程池的每个 worker 在短时间内都在排空，例如在达到 `max_requests` 之后，并且还没有替换 worker 等待请求。

正常重载使 `/readyz` 保持 `200`。master 先启动一个新 worker，然后停止一个旧 worker。重载过程见[信号](/zh/docs/process-model#信号)。

有些情况下完全没有响应。停止开始时，可观测性进程停止接受连接。如果进程池的 worker 在进程池处理请求之前启动失败，master 以退出码 `70` 退出。见[退出码](/zh/docs/cli#退出码)。

### Kubernetes 探针

kubelet 向 pod IP 地址发送探针，所以环回地址不能工作。请将监听器绑定到 pod 的所有接口。不要将此端口添加到 Service。

```toml
[observability]
listen = ":9180"

[observability.probes]
```

```yaml
containers:
  - name: app
    image: registry.example.com/app:latest
    livenessProbe:
      httpGet:
        path: /livez
        port: 9180
      periodSeconds: 10
    readinessProbe:
      httpGet:
        path: /readyz
        port: 9180
      periodSeconds: 5
```

## Prometheus 指标

同一主机上的 Prometheus 服务器可以抓取环回地址。Prometheus 使用 `/metrics` 作为默认的 `metrics_path`。

```yaml
scrape_configs:
  - job_name: rapira
    static_configs:
      - targets: ["127.0.0.1:9180"]
```

输出包含以下指标。`pool` 标签为 `http` 或 `grpc`。指标不包括可观测性进程。一个工作单元是一个 HTTP 请求或一个 gRPC 调用。

| 指标 | 类型 | 标签 | 含义 |
| --- | --- | --- | --- |
| `rapira_workers` | gauge | `pool`、`state` | 每种状态下的 worker 数量。`state` 的值为 `starting`、`idle`、`active` 和 `draining`。 |
| `rapira_workers_configured` | gauge | `pool` | 进程池的 `processes` 值。 |
| `rapira_requests_total` | counter | `pool` | worker 完成的工作单元。包括失败的工作单元。 |
| `rapira_requests_failed_total` | counter | `pool` | 宿主无法完成的工作单元，例如丢失的调用或队列饱和后被拒绝的工作单元。 |
| `rapira_requests_failed_on_full_queue_total` | counter | `pool` | 遇到 worker 队列已满、从未进入队列的工作单元。当队列在 30 秒内一直已满时，Rapira 拒绝此工作单元。 |
| `rapira_requests_queued` | gauge | `pool` | 等待 worker 的 PHP 线程的工作单元。 |
| `rapira_script_restarts_total` | counter | `pool` | worker 进程内入口脚本的重启次数，例如在致命错误之后。 |
| `rapira_worker_exits_total` | counter | `pool`、`reason` | worker 进程的退出次数。原因见下文。 |
| `rapira_worker_rss_bytes` | gauge | `pool`、`worker` | worker 的常驻内存，单位为字节。仅限 Linux。 |
| `rapira_worker_pss_bytes` | gauge | `pool`、`worker` | worker 的比例内存，单位为字节。仅限 Linux。 |
| `rapira_build_info` | gauge | `version`、`php_version` | Rapira 版本和链接的 PHP 版本。值始终为 `1`。 |

请求计数器描述 PHP 工作，而非监听器的全部流量。它们不包括协议层在分发给 PHP 前处理的身份验证拒绝、无效 JSON 请求、健康检查和反射。宿主将已完成的 gRPC `fail()` 响应计为已处理，不计为宿主失败。后续响应转换为 JSON 时的失败不会增加失败计数器。因此，`rapira_requests_failed_total` 不统计非 OK 的 gRPC 状态。

`rapira_worker_exits_total` 的 `reason` 标签有以下值：

| 原因 | 含义 |
| --- | --- |
| `drained` | worker 以退出码 `0` 退出，例如在停止或重载之后。 |
| `recycled` | worker 达到了 `max_requests`。 |
| `unhealthy` | worker 报告它不能提供服务，例如在多次启动失败之后。 |
| `timeout` | 请求运行时间超过 `request_terminate_timeout_secs`，master 停止了此 worker。 |
| `crashed` | worker 以其他退出码退出，或因信号退出。 |

master 替换或重载 worker 时，计数器保留它们的值。只有 master 再次启动时，计数器才归零。每次抓取为每个存活的 worker 读取一个 `/proc` 文件。探针不读取任何文件。

::: question 为什么 worker 标签不是进程 ID？
`worker` 标签是 worker 在其进程池中的槽位编号。替换 worker 可以使用同一个槽位，所以替换后时间序列继续。每个进程池为每个 worker 提供两个槽位。因此，编号从 `0` 到 `processes` 的两倍减一。
:::

::: question 为什么进程池显示的 worker 多于 rapira_workers_configured？
重载期间，master 先启动一个新 worker，然后停止一个旧 worker。在旧 worker 退出之前，两个 worker 都出现在 `rapira_workers` 中。
:::

## 安全

这些端点没有身份验证，也没有 TLS。`/metrics` 显示 Rapira 和 PHP 的版本以及每个 worker 的内存。请将监听器绑定到环回地址或私有网络地址。`:port` 地址绑定所有 IPv4 接口。

`unix:` 监听器以模式 `0666` 创建它的套接字。请使用套接字所在目录的权限控制访问。

生产环境设置见[生产环境部署](/zh/docs/deployment)。
