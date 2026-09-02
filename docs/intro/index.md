---
title: What is Rapira?
description: Rapira is a PHP application server written in Rust. It supports Classic, Worker, and Dispatcher modes.
---

# What is Rapira?

Rapira is a PHP application server written in Rust.

The RoadRunner maintainers design and implement Rapira. Rapira calls PHP directly in the server process.

Rapira currently supports HTTP. The project plans to support more RoadRunner plugin functions.
The [blog](/blog/) contains project updates.

## HTTP

Rapira includes an HTTP server that uses the [hyper](https://hyper.rs) library. It accepts plain HTTP connections directly.
The server does not terminate TLS. A [TLS termination proxy](https://en.wikipedia.org/wiki/TLS_termination_proxy) accepts HTTPS from a client, decrypts the connection, and sends plain HTTP to Rapira.
See [Running in production](/docs/deployment) for proxy configuration.

Rapira supports three PHP execution modes:

- Classic: Rapira initializes the application for each request, as php-fpm does.
- Worker: Rapira initializes the application once. A loop handles requests, and Rapira refills PHP superglobals for each request.
- Dispatcher: Rapira initializes the application once. The script gets request objects through an API call. It can process requests sequentially or concurrently with [fibers](https://www.php.net/manual/en/language.fibers.php).

::: info
See [Execution modes](/docs/execution-modes) for mode behavior and selection criteria.
:::
