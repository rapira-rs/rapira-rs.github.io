---
title: What is Rapira?
description: Rapira is a fast, secure PHP application server written in Rust — it takes HTTP requests directly and supports classic, worker and dispatcher modes.
---

# What is Rapira?

Rapira is a fast, secure PHP application server written in Rust.

Years of maintaining RoadRunner went into its design: we wanted the way it works with PHP to be as efficient and stable as possible, and neither development nor day-to-day operation to cost you extra effort.

Rapira does not stop at HTTP. Support for all the popular RoadRunner plugins is on our roadmap — follow our [blog](/blog/) for updates.

## HTTP

Serving HTTP requests is a PHP server's first job. Cloudflare's technology lets Rapira take them directly, without nginx or Apache, with support for every modern HTTP and encryption standard.

On the PHP side, every execution model is supported:

- Classic (SAPI) — every request boots the application from scratch, exactly as it does under php-fpm.
- Worker (SAPI Worker) — the application boots once at startup and then handles one request after another in a loop through the SAPI interface (PHP's superglobals are refilled for each request).
- Dispatcher — the application stays alive, and requests and responses travel over a separate API. In this mode you are free to handle requests one at a time (the way RoadRunner does) or concurrently, using [fibers](https://www.php.net/manual/language.fibers.php).

::: info
[Execution modes](/docs/execution-modes) covers the differences between the modes in detail, and how to pick the one you need.
:::
