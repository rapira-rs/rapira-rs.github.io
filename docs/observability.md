---
title: Metrics and health checks
description: "The [observability] process: the /livez, /readyz, and /metrics endpoints, Kubernetes probes, a Prometheus scrape, and the metric reference."
faqLevel: 2
---

# Metrics and health checks

The `[observability]` section starts one more process that serves health probes and Prometheus metrics. This process does not run PHP. It reads the state of the PHP workers from shared memory. The master supervises, reloads, and stops it together with the PHP workers. See [Process model](/docs/process-model) for the master and its workers.

Without an `[observability]` section, Rapira does not start this process. The Windows build does not support the section and rejects it as an unknown field.

## Enabling the endpoints

Add the `[observability]` section and at least one of its sub-tables. The configuration must also contain `[http]` or `[grpc]`. This minimal `rapira.toml` enables all endpoints:

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

`[observability.metrics]` and `[observability.probes]` accept no keys. Use a `listen` address that the `http` and `grpc` listeners do not use. See [the `[observability]` section](/docs/configuration#observability) for all keys.

Start the server, then send a request to each endpoint:

```bash
curl -i http://127.0.0.1:9180/livez
curl -i http://127.0.0.1:9180/readyz
curl http://127.0.0.1:9180/metrics
```

The process writes log records with the `observability` target. See [Logging](/docs/logging) for target levels.

## Endpoints

The process serves HTTP/1.1 without TLS. It answers only these requests:

| Request | Enabled by | Status | Body |
| --- | --- | --- | --- |
| `GET /livez` | `[observability.probes]` | Always `200` | `ok` |
| `GET /readyz` | `[observability.probes]` | `200` or `503` | `ok`, or one line `pool <name>: no ready worker` for each pool that is not ready |
| `GET /metrics` | `[observability.metrics]` | `200` | The Prometheus text format |

Every other method or path gets `404` with an empty body. A path of a disabled sub-table also gets `404`. Each body line ends with a newline. The probes use the `text/plain; charset=utf-8` content type. `/metrics` uses `text/plain; version=0.0.4; charset=utf-8`.

## Liveness and readiness

`/livez` does no checks. It returns `200` when the process answers. When the master stops, the observability process also stops. Thus, a `200` answer shows that the master runs. The master replaces failed PHP workers itself, so `/livez` does not check them.

`/readyz` checks each PHP pool: `http`, then `grpc`. A pool is ready when at least one of its workers is idle or busy with a request. Workers that start or drain do not count. `/readyz` returns `503` in these cases:

- The workers of a pool start and do not yet wait for a request. In Worker and Dispatcher modes, the entry script must boot first.
- The entry script fails to boot. The worker tries again, and the pool becomes ready after a boot succeeds. No request is necessary.
- A reload starts new workers that do not boot. After `process_control_timeout_secs`, the master stops the old workers anyway.
- For a short time, each worker of a pool drains, for example after `max_requests`, and no replacement waits for a request yet.

A normal reload keeps `/readyz` at `200`. The master starts a new worker before it stops an old one. See [Signals](/docs/process-model#signals) for the reload sequence.

Some cases give no answer at all. At the start of a stop, the observability process stops accepting connections. If the workers of a pool fail to boot before the pool serves a request, the master exits with code `70`. See [Exit codes](/docs/cli#exit-codes).

### Kubernetes probes

The kubelet sends probes to the pod IP address, so a loopback address does not work. Bind the listener to all interfaces of the pod. Do not add the port to a Service.

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

## Prometheus metrics

A Prometheus server on the same host can scrape the loopback address. Prometheus uses `/metrics` as the default `metrics_path`.

```yaml
scrape_configs:
  - job_name: rapira
    static_configs:
      - targets: ["127.0.0.1:9180"]
```

The output contains these metrics. The `pool` label is `http` or `grpc`. The metrics do not include the observability process. A unit of work is one HTTP request or one gRPC call.

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `rapira_workers` | gauge | `pool`, `state` | Workers in each state. The `state` values are `starting`, `idle`, `active`, and `draining`. |
| `rapira_workers_configured` | gauge | `pool` | The `processes` value of the pool. |
| `rapira_requests_total` | counter | `pool` | Units of work that the workers finished. Failed units are included. |
| `rapira_requests_failed_total` | counter | `pool` | Units of work that the host could not complete, for example a lost call or a unit rejected after queue saturation. |
| `rapira_requests_failed_on_full_queue_total` | counter | `pool` | Units of work that found the worker queue full and never entered it. Rapira rejects such a unit when the queue stays full for 30 seconds. |
| `rapira_requests_queued` | gauge | `pool` | Units of work that wait for the PHP thread of a worker. |
| `rapira_script_restarts_total` | counter | `pool` | Restarts of the entry script inside a worker process, for example after a fatal error. |
| `rapira_worker_exits_total` | counter | `pool`, `reason` | Worker process exits. See the reasons below. |
| `rapira_worker_rss_bytes` | gauge | `pool`, `worker` | The resident memory of a worker in bytes. Linux only. |
| `rapira_worker_pss_bytes` | gauge | `pool`, `worker` | The proportional memory of a worker in bytes. Linux only. |
| `rapira_build_info` | gauge | `version`, `php_version` | The Rapira version and the version of the linked PHP. The value is always `1`. |

The request counters describe PHP work, not all listener traffic. They exclude auth rejections, invalid JSON requests, health checks, and reflection, which the protocol layer handles before PHP dispatch. The host counts a completed gRPC `fail()` response as handled without a host failure. A later JSON response conversion failure does not increase the failure counter. Thus, `rapira_requests_failed_total` is not a count of non-OK gRPC statuses.

The `reason` label of `rapira_worker_exits_total` has these values:

| Reason | Meaning |
| --- | --- |
| `drained` | The worker exited with code `0`, for example after a stop or a reload. |
| `recycled` | The worker reached `max_requests`. |
| `unhealthy` | The worker reported that it cannot serve, for example after repeated boot failures. |
| `timeout` | A request ran longer than `request_terminate_timeout_secs`, and the master stopped the worker. |
| `crashed` | The worker exited with another code or because of a signal. |

The counters keep their values when the master replaces or reloads a worker. They go back to zero only when the master starts again. A scrape reads one `/proc` file for each live worker. The probes read no files.

::: question Why is the worker label not a process ID?
The `worker` label is the slot number of the worker in its pool. A replacement worker can use the same slot, so the series continue after a replacement. Each pool has two slots for each worker. Thus, the numbers go from `0` to two times `processes` minus one.
:::

::: question Why does a pool show more workers than rapira_workers_configured?
During a reload, the master starts a new worker before it stops an old one. Both workers appear in `rapira_workers` until the old worker exits.
:::

## Security

The endpoints have no authentication and no TLS. `/metrics` shows the Rapira and PHP versions and the memory of each worker. Bind the listener to a loopback address or to a private network address. A `:port` address binds all IPv4 interfaces.

A `unix:` listener creates its socket with mode `0666`. Use the permissions of the socket directory to control access.

See [Running in production](/docs/deployment) for the production setup.
