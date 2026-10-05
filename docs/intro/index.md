---
title: What is Rapira?
description: Rapira is a PHP application server written in Rust. It supports Classic, Worker, and Dispatcher modes.
---

# What is Rapira?

Rapira is a PHP application server written in Rust.

The RoadRunner maintainers design and implement Rapira. Rapira calls PHP directly in the server process.

Rapira supports HTTP and [gRPC](/docs/grpc). Each protocol has its own listener and PHP worker pool.

The [blog](/blog/) contains project updates.

## HTTP

Rapira includes an HTTP server that uses the [hyper](https://hyper.rs) library. It accepts plain HTTP/1.1 and HTTP/1.0 connections. Rapira does not terminate TLS. A [TLS termination proxy](https://en.wikipedia.org/wiki/TLS_termination_proxy) accepts HTTPS from a client, decrypts the connection, and sends plain HTTP to Rapira. See [Running in production](/docs/deployment) for proxy configuration.

Rapira supports three PHP execution modes:

- Classic: Rapira initializes the application for each request, as php-fpm does.
- Worker: Rapira initializes the application once. A loop handles requests, and Rapira refills PHP superglobals for each request.
- Dispatcher: Rapira initializes the application once. The script gets request objects through an API call. Each worker handles one request at a time.

::: info
See [Execution modes](/docs/execution-modes) for mode behavior and selection criteria.
:::

## gRPC

Rapira serves unary gRPC, gRPC-Web, and Connect calls on one listener. The PHP application receives and returns binary protobuf messages through a dispatcher. The master loads the service schemas from a descriptor set before the workers start.

The gRPC pool uses Dispatcher mode. HTTP and gRPC can run together with separate entrypoints. See [gRPC](/docs/grpc) for a complete service, protobuf class generation, and client commands.

## Metrics and health checks

An optional `[observability]` table starts one more process that does not run PHP. The `[observability.metrics]` sub-table turns on Prometheus metrics at `/metrics`. The `[observability.probes]` sub-table turns on the `/livez` and `/readyz` probes. See [Metrics and health checks](/docs/observability) for the configuration and the endpoints.
