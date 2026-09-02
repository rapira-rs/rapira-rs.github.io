---
title: What is Rapira?
description: Rapira is a fast, secure PHP application server written in Rust — it takes HTTP requests directly and supports Classic, Worker and Dispatcher modes.
---

# What is Rapira?

Rapira is a fast, secure PHP application server written in Rust.

Years of RoadRunner maintenance shaped Rapira's design. Rapira interacts with PHP efficiently and consistently. The same design supports straightforward development and operations.

Rapira does not stop at HTTP. Support for all the popular RoadRunner plugins is on our roadmap — follow our [blog](/blog/) for updates.

## HTTP

Rapira has its own HTTP front, built on the [hyper](https://hyper.rs) library. The front accepts plaintext HTTP connections directly, so nothing has to sit in front of it to reach your PHP application. The front does not terminate TLS. If you need TLS, terminate it in a proxy in front of Rapira; see [Running in production](/docs/deployment) for that setup.

On the PHP side, every execution model is supported:

- Classic: every request boots the application from scratch, exactly as it does under php-fpm.
- Worker: the application boots once at startup and then handles one request after another in a loop. Rapira refills PHP's superglobals for each request.
- Dispatcher: the application boots once and stays alive. The script pulls each request through an API call, and works with the request as a value instead of the superglobals. The script handles one request at a time, or several at the same time with [fibers](https://www.php.net/manual/en/language.fibers.php).

::: info
[Execution modes](/docs/execution-modes) covers the differences between the modes in detail, and how to pick the one you need.
:::
