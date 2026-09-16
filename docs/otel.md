---
title: OpenTelemetry
description: "Native traces, logs, metrics, OTLP export, and PHP trace context."
---

# OpenTelemetry

The `otel` plugin exports native traces, logs, and metrics through OTLP over HTTP/protobuf. The `http` plugin owns the PHP worker pool. The `otel` plugin owns one exporter process.

## Enable telemetry

Add this section to `rapira.toml`:

```toml
[otel]
enabled = true
endpoint = "http://localhost:4318"
service_name = "rapira"
sample_ratio = 1.0
```

`enabled` defaults to `false`. When telemetry is disabled, the PHP trace context APIs return empty arrays. Rapira reads its telemetry settings from TOML. It does not read `OTEL_*` environment variables. PHP SDK configuration is independent.

The root Cargo feature `otel` is enabled by default. The crate is `otel` at `crates/plugins/otel`. To build without the SDK and exporter, use:

```sh
cargo build --release --no-default-features
```

This binary rejects `[otel].enabled = true`. See [Configuration](./configuration#otel) for all defaults and validation rules.

The endpoint is an HTTP or HTTPS base URL. Rapira appends `/v1/traces`, `/v1/logs`, or `/v1/metrics` after its path prefix. For example, `https://collector.example/tenant` sends traces to `https://collector.example/tenant/v1/traces`.

## Processes and delivery

The master supervises one child that starts through `exec`. This exporter batches records, retries requests, and sends OTLP. The single-threaded master runs no network exporter or background SDK threads.

Workers send records directly to the exporter through nonblocking local Unix streams. Master records use the same exporter. Bounded buffers drop records during overload or exporter unavailability. Request execution does not wait for export. Each encoded IPC record is less than 1 MiB.

- Complete records that the exporter already accepted remain there after a worker crash.
- Unsubmitted records and incomplete spans disappear with the worker.
- The exporter keeps queues in memory, without persistent storage.
- An exporter crash loses its queued records. The master replaces the exporter, and producers reconnect.
- Normal shutdown drains pending records within `export_timeout_secs`.
- Process failure records contain `worker_pid`, `pool`, and `exit_code` or `signal`.

Rapira does not capture request snapshots or reconstruct traces from shared memory. The master does not trace PHP activity.

## Trace context and sampling

Rapira continues an upstream trace from the W3C `traceparent` and `tracestate` headers. Missing or invalid parents start a fresh trace. Rapira combines repeated `tracestate` fields. Native operations get new local span IDs. PHP receives the context of the native `php.execute` span.

You control root sampling with `sample_ratio`. The ParentBased sampler honors the incoming sampled or unsampled state. It uses `sample_ratio` only for traces without a parent. `traces`, `logs`, and `metrics` are independent export switches. With `traces = false`, Rapira still propagates context.

::: info SDK constraint
The Rust `opentelemetry` 0.32 SDK rejects valid multi-tenant `tracestate` keys whose system ID has exactly 14 characters, such as `tenant@abcdefghijklmn`. This drops the full `tracestate`. The trace ID and sampled flag still propagate. See the [SDK validation source](https://docs.rs/opentelemetry/0.32.0/src/opentelemetry/trace/span_context.rs.html) and the [W3C key grammar](https://www.w3.org/TR/trace-context/#key).
:::

## Native signals

Native spans cover startup, request admission, middleware, body collection, multipart parsing, `queue.wait`, and `php.execute`. They also cover response streaming, sendfile, drain, and worker shutdown.

| Metric | Type and unit | Attributes |
| --- | --- | --- |
| `http.server.request.duration` | Histogram, seconds (`s`) | `http.request.method`, `http.response.status_code` |
| `rapira.operation.duration` | Histogram, seconds (`s`) | `rapira.operation` |
| `rapira.otel.dropped_records` | Counter, records | None |

Completed requests and native operations trigger cumulative snapshots. OTLP resources contain `service.name`, `process.pid`, and `rapira.role`. Each process also has a stable random `service.instance.id`. Worker resources also contain `rapira.pool`.

Log records correlate with the active native span. `[log]` and `RUST_LOG` control stderr filtering only. OTLP uses its own signal switches. Native spans continue below the stderr log level.

Exporter and internal SDK diagnostics stay on stderr and do not re-enter OTLP. All processes use the same stderr filter and format settings. See [Logging](./logging).

## PHP application spans

Rapira supplies two carriers with the type `array<string, string>`:

- `Rapira\Http\Request::$traceContext` holds the native carrier. `Request` is a `final readonly` class. Its final public constructor argument is `array $traceContext`.
- Host-created request objects capture their own carrier. Lazy creation or a retained request object keeps that request's context.
- `Rapira\trace_context(): array` returns the active Worker callback or Dispatcher exchange carrier. It returns an empty array outside active work.

Worker mode keeps the native scope through per-job shutdown and teardown. Dispatcher scope ends when the exchange finalizes. Rust keeps the request context while PHP runs. PHP does not return a span ID to Rust.

PHP owns its child spans, context activation, SDK, sampling, flushing, and exporter. Rapira does not automatically instrument PHP code or its Fiber scheduler. Use the [PHP SDK context support](https://opentelemetry.io/docs/languages/php/context/#context-in-asynchronous-environments) for concurrent Fibers.

### Dispatcher example

Configure the PHP SDK before you run this example. Put the setup in `instrumentation.php`. Follow the official [SDK setup](https://opentelemetry.io/docs/languages/php/instrumentation/#initialize-the-sdk) and [exporter guide](https://opentelemetry.io/docs/languages/php/exporters/). Register the tracer provider before the request loop. Configure PHP sampling and flushing for your application.

The example extracts a parent for each request and creates a PHP child span. It follows the standard [PHP propagation API](https://opentelemetry.io/docs/languages/php/propagation/#manual-context-propagation).

```php
<?php

use OpenTelemetry\API\Globals;
use OpenTelemetry\API\Trace\Propagation\TraceContextPropagator;
use OpenTelemetry\Context\Context;
use Rapira\Exception\ClosedException;

require __DIR__ . '/vendor/autoload.php';
require __DIR__ . '/instrumentation.php';

$tracer = Globals::tracerProvider()->getTracer('app');
$dispatcher = \Rapira\get_dispatcher();

while (true) {
    try {
        $exchange = $dispatcher->receive();
    } catch (ClosedException) {
        break;
    }

    $request = $exchange->getRequest();
    $parent = TraceContextPropagator::getInstance()->extract($request->traceContext, null, Context::getRoot());
    $span = $tracer->spanBuilder('app.handle')->setParent($parent)->startSpan();
    $scope = $span->activate();

    try {
        $exchange->writeHead(200, ['content-type' => ['text/plain']]);
        $exchange->writeBody("Hello\n");
    } finally {
        $scope->detach();
        $span->end();
    }
}
```

Extract context for each request. Activate the context for that request. Detach the scope in `finally`. End the span in the same block. A process-global parent set once at worker startup cannot identify later requests.

### Worker carrier

Inside the `Rapira\handle_request()` callback, use this parent extraction with the same child-span and `finally` pattern:

```php
$parent = TraceContextPropagator::getInstance()->extract(\Rapira\trace_context(), null, Context::getRoot());
```

Use Worker response functions such as `header()` and `echo` inside that callback. See [Worker mode](./worker) for the loop.
