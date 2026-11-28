---
title: 指标和健康检查
description: "[observability] 监听器：/livez、/readyz 和 /metrics 端点，Kubernetes 探针，Prometheus 抓取，以及指标参考。"
faqLevel: 2
---

# 指标和健康检查

`[observability]` 小节在服务器进程内的独立线程（`rapira-obs`）上启动监听器，提供健康探针和 Prometheus 指标。此线程不运行 PHP，直接从进程内状态读取进程池计数器。服务器架构见[进程模型](/zh/docs/process-model)。

如果没有 `[observability]` 小节，Rapira 不启动此监听器。Windows 构建不支持此小节，并将它作为未知字段拒绝。

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

此监听器使用 `observability` 目标写入日志记录。目标级别见[日志](/zh/docs/logging)。

## 端点

此监听器提供不带 TLS 的 HTTP/1.1。它只响应以下请求：

| 请求 | 启用方式 | 状态码 | 响应体 |
| --- | --- | --- | --- |
| `GET /livez` | `[observability.probes]` | 始终为 `200` | `ok` |
| `GET /readyz` | `[observability.probes]` | `200` 或 `503` | `ok`，或者每个未就绪的进程池一行 `pool <name>: no ready worker` |
| `GET /metrics` | `[observability.metrics]` | `200` | Prometheus 文本格式 |

其他所有方法或路径都收到 `404` 和空响应体。已禁用子表的路径也收到 `404`。响应体的每一行都以换行符结束。探针使用 `text/plain; charset=utf-8` 内容类型。`/metrics` 使用 `text/plain; version=0.0.4; charset=utf-8`。

## 存活和就绪

`/livez` 不做任何检查。只要服务器响应，它就返回 `200`。关闭期间，可观测性监听器随服务器一起停止。

`/readyz` 检查每个 PHP 进程池：先 `http`，然后 `grpc`。当进程池至少有一个 worker 空闲或正在处理工作单元时，此进程池就绪。正在启动或正在排空的 worker 不计算在内。`/readyz` 在以下情况下返回 `503`：

- 进程池的 worker 正在启动，还没有等待工作单元。在 Worker 和 Dispatcher 模式下，入口脚本必须先完成启动。
- 入口脚本启动失败。worker 按退避延迟重试，启动成功后进程池变为就绪。不需要任何请求。
- 进程池的每个 worker 都在排空。

重载会让 `/readyz` 保持 `200`，因为 worker 线程仍在运行。重载内容见[信号](/zh/docs/process-model#signals)。

有些情况下完全没有响应。停止开始时，可观测性监听器停止接受连接。如果 worker 在其进程池处理任何工作单元之前达到 `max_boot_failures`，服务器以退出码 `70` 退出。见[退出码](/zh/docs/cli#exit-codes)。

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

输出包含以下指标。`pool` 标签为 `http` 或 `grpc`。一个工作单元是一个 HTTP exchange 或一个 gRPC 调用。

| 指标 | 类型 | 标签 | 含义 |
| --- | --- | --- | --- |
| `rapira_workers` | gauge | `pool`、`state` | 每种状态下的 worker 数量。`state` 的值为 `starting`、`idle`、`active` 和 `draining`。 |
| `rapira_workers_configured` | gauge | `pool` | 进程池的 `workers` 值。 |
| `rapira_requests_total` | counter | `pool` | worker 已处理或宿主拒绝的工作单元。 |
| `rapira_requests_failed_total` | counter | `pool` | 宿主无法完成的工作单元，例如丢失的调用或队列饱和后被拒绝的工作单元。 |
| `rapira_requests_failed_on_full_queue_total` | counter | `pool` | 遇到进程池队列已满、从未进入队列的工作单元。当队列在 30 秒内一直已满时，Rapira 拒绝此工作单元。 |
| `rapira_requests_queued` | gauge | `pool` | 在进程池中等待 worker 的工作单元。 |
| `rapira_script_restarts_total` | counter | `pool` | worker 线程上的应用回收次数，例如在 `max_requests`、重载或致命错误之后。 |
| `rapira_build_info` | gauge | `version`、`php_version` | Rapira 版本和链接的 PHP 版本。值始终为 `1`。 |

请求计数器描述 PHP 工作，而非监听器的全部流量。它们不包括协议层在分发给 PHP 前处理的身份验证拒绝、无效 JSON 请求、健康检查和反射。宿主将已完成的 gRPC `fail()` 响应计为已处理，不计为宿主失败。后续响应转换为 JSON 时的失败不会增加失败计数器。因此，`rapira_requests_failed_total` 不统计非 OK 的 gRPC 状态。

计数器仅在服务器重启时归零。抓取和探针读取进程内计数器，不读取 `/proc` 文件。

## 安全

这些端点没有身份验证，也没有 TLS。`/metrics` 显示 Rapira 和 PHP 的版本以及进程池指标。请将监听器绑定到环回地址或私有网络地址。`:port` 地址绑定所有 IPv4 接口。

`unix:` 监听器以模式 `0666` 创建它的套接字。请使用套接字所在目录的权限控制访问。

生产环境设置见[生产环境部署](/zh/docs/deployment)。
