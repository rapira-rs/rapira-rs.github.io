---
title: What is Rapira?
description: Rapira is a PHP application server written in Rust. It embeds PHP directly into the server process — no FastCGI, no sockets, no serialization in between.
---

# What is Rapira?

Rapira is a PHP application server written in Rust. It takes the place php-fpm usually occupies: it owns the listening socket, speaks HTTP to the outside world, and runs your PHP code.

What makes it different is what sits between the server and the interpreter — nothing does. Rapira embeds PHP into its own process through PHP's embed SAPI, the same interface that lets a C program host the engine. The host calls the interpreter directly: there is no FastCGI protocol, no local socket or pipe, and no per-request serialization of the request into some wire format and back. When a request arrives, the superglobals are filled in and PHP runs; when it finishes, the response bytes go straight back out.

HTTP itself is served by a front built on [Pingora](https://github.com/cloudflare/pingora), the Rust proxy framework Cloudflare runs its edge on. It ships inside the binary, so there is no second process to install, configure or keep alive — one `rapira` process tree is the whole server.

## What you need

A few constraints are worth knowing before you go further, because they are not negotiable:

- **Linux and macOS only.** There is no Windows build.
- **PHP 8.4 or 8.5.** The release archives and the `rapira-php8.4` / `rapira-php8.5` packages bundle a matching NTS PHP embed runtime, so the version you run is the artifact you pick — there is nothing to install alongside it.
- **NTS, never ZTS.** Rapira links a non-thread-safe PHP. That only becomes your concern if you compile Rapira against a PHP of your own — a thread-safe build is refused there rather than failing later.

Building against your own PHP instead — a different extension set, an unusual architecture, a musl-based distro? See [Build from source](/docs/build-from-source).

## Two ways to run your app

Rapira ships two ways of executing a PHP application today. A worker is what you get by default; classic is opt-in, a flag on the command line or a single key in the config file.

**[Classic](/docs/classic)** is the familiar one. Your front controller is executed from scratch on every request, exactly as it would be under php-fpm: the app boots, handles the request, and everything it built is thrown away. Nothing in your code has to change, which makes it the honest starting point for an existing application — and the fallback whenever something in your stack cannot survive a second request.

**[SAPI Worker](/docs/worker)** keeps the process alive. A resident script boots your application once — autoloader, container, connections — and then loops, handling one request after another with the superglobals refilled each time. The boot cost is paid at startup instead of on every request, but state now outlives the request, which is a real change in how you have to think about your code.

These are the first two rungs of a longer ladder — `Classic → SAPI Worker → PSR Worker → Async` — where each step gives PHP more control over the request lifecycle. Only the first two are shipped; [Execution modes](/docs/execution-modes) explains the whole ladder and how to tell which rung your application can actually reach.

::: tip
The rung an app can climb to is a property of the app, not a limit Rapira imposes. Global state that cannot survive a second request keeps you on Classic — that is your code talking, and it is fixable.
:::

## Where to go next

- **[Installation](/docs/installation)** — packages and archives for Linux and macOS; the PHP runtime ships inside them.
- **[Quickstart](/docs/quickstart)** — serve your first request, in both modes, in a few minutes.
- **[Configuration](/docs/configuration)** — the full `rapira.toml` reference, once flags stop being enough.

::: question Do I have to rewrite my application to use Rapira?
No. In classic mode an ordinary front controller runs unchanged — Rapira drops in where php-fpm was, and your code does not know the difference. Moving to a worker is a separate, optional step you take when you want it.
:::
