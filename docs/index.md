---
title: What is Rapira?
description: Rapira is a PHP application server written in Rust; this page covers its requirements and the two ways it runs a PHP application.
---

# What is Rapira?

Rapira is a PHP application server written in Rust.

It embeds PHP into its own process through PHP's embed SAPI, the same interface that lets a C program host the engine. The host calls the interpreter directly: there is no FastCGI protocol, no local socket or pipe, and no per-request serialization of the request into some wire format and back. When a request arrives, the superglobals are filled in and PHP runs; when it finishes, the response bytes go straight back out.

HTTP itself is served by a front built on [Pingora](https://github.com/cloudflare/pingora), Cloudflare's Rust proxy framework. It ships inside the binary, so there is no second process to install, configure or keep alive.

## What you need

Rapira has three requirements.

- **Linux and macOS only.** There is no Windows build.
- **PHP 8.4 or 8.5.** The release archives and the `rapira-php8.4` / `rapira-php8.5` packages bundle a matching NTS PHP embed runtime, so the version you run is the artifact you pick — there is nothing to install alongside it.
- **NTS, never ZTS.** Rapira links a non-thread-safe PHP. This matters only if you compile Rapira against a PHP of your own, where a thread-safe build is refused rather than failing later.

To build against your own PHP — a different extension set, an unusual architecture, a musl-based distro — see [Build from source](/docs/build-from-source).

## Two ways to run your app

Rapira ships two ways of executing a PHP application today. Worker mode is the default; classic is opt-in, a flag on the command line or a single key in the config file.

**[Classic](/docs/classic)** executes your front controller from scratch on every request, exactly as it would be under php-fpm: the app boots, handles the request, and everything it built is thrown away. Nothing in your code has to change.

**[SAPI Worker](/docs/worker)** keeps the process alive. A resident script boots your application once — autoloader, container, connections — and then loops, handling one request after another with the superglobals refilled each time. Boot work happens once at startup instead of on every request, and state outlives the request.

[Execution modes](/docs/execution-modes) adds a bit more information about the differences between the two, and how to choose which one to use.

## Where to go next

- **[Installation](/docs/installation)** — packages and archives for Linux and macOS; the PHP runtime ships inside them.
- **[Quickstart](/docs/quickstart)** — serve your first request in both modes.
- **[Configuration](/docs/configuration)** — the full `rapira.toml` reference.
