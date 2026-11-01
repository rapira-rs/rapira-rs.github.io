---
title: "Rapira 0.9.2"
date: 2026-11-01
description: "App restarts within worker processes, worker memory limits, HTTP and gRPC fixes, and Sodium in release builds."
author: Rapira Team
image: /blog/rapira-0-9-2/preview.jpg
---

# Rapira 0.9.2

Rapira 0.9.2 improves how workers restart apps, handle memory growth, and complete requests. This release also reduces request processing costs and adds Sodium to the PHP packages.

## Restart the app, keep the connections

In worker and dispatcher modes, `max_requests` now restarts the PHP app within the same worker process. The worker runs the entry script again. Open connections and queued requests remain available to the next app instance.

Reloads through SIGHUP or SIGUSR2 to the master use the same approach. Classic mode ignores these app restart triggers and `max_requests`, because each request already starts a new PHP request cycle.

A reload keeps the current configuration and gRPC descriptors. Restart Rapira to load changed configuration or descriptor files.

When a worker must stop, it can answer the next request on each existing HTTP/1.1 connection before closing it. This also applies to Connect and gRPC-Web calls, within the configured drain timeout.

## Set a memory limit for each worker

The new `max_memory_mb` setting in `[http.pool]` and `[grpc.pool]` sets a resident memory (RSS) threshold in MiB. The master checks RSS once per second. A worker above the threshold drains its connections and exits. The master then starts a replacement process. Set the value to `0` to disable the threshold.

This complements app restarts: a process replacement releases memory that can remain allocated between app instances.

## More reliable requests, less processing work

In worker mode, a client disconnect ends the current request without restarting the app. PHP `max_execution_time` timeouts keep the worker process alive. Classic mode also completes streamed responses when an exception handler calls `exit()`.

HTTP fixes cover uploads, `sendFile()` length checks, and HEAD responses. Static files handle `If-Range` correctly. Raw and URL-encoded request bodies reach PHP through a memory stream. File reads use larger blocks, and idle workers release unused allocator memory after two seconds.

gRPC and gRPC-Web responses use gzip only when the request used gzip. Connect responses can use gzip when the client accepts it.

## Before you upgrade

- Remove `unsafe_field_names` from `[http]`. Configurations that contain it fail at startup. Classic and worker modes always drop header names that can conflict in the CGI variables.
- Remove references to `Rapira\Grpc\Call\Protocol::Rest`. The supported cases are `Grpc`, `GrpcWeb`, and `Connect`.
- Check PHP `memory_limit` for apps that accept large request bodies. Raw and URL-encoded bodies now count toward that limit in classic and worker modes.

Release builds and Docker images now include the Sodium extension. Linux archives also include the required libraries of `libphp.so`.

See the [release notes](https://github.com/rapira-rs/rapira/pull/211) for the complete list of changes.
