---
title: "Rapira 0.9.2"
date: 2026-11-01
description: "在 worker 进程内重启应用、设置 worker 内存限制、修复 HTTP 和 gRPC 问题，并在发布构建中包含 Sodium。"
author: Rapira Team
image: /blog/rapira-0-9-2/preview.jpg
---

# Rapira 0.9.2

Rapira 0.9.2 改进了 worker 重启应用、处理内存增长和完成请求的方式。此版本还降低了请求处理开销，并在 PHP 软件包中加入了 Sodium。

## 重启应用，保留连接

在 Worker 和 Dispatcher 模式下，`max_requests` 现在会在同一个 worker 进程内重启 PHP 应用。worker 会重新运行入口脚本。已打开的连接和排队的请求会保留，供下一个应用实例继续处理。

向 master 发送 SIGHUP 或 SIGUSR2 触发的重载也使用相同方式。Classic 模式忽略这些应用重启信号和 `max_requests`，因为每个请求已经会启动一个新的 PHP 请求周期。

重载会保留当前配置和 gRPC 描述符。要加载修改后的配置或描述符文件，请重启 Rapira。

当 worker 必须停止时，它可以先响应每个现有 HTTP/1.1 连接上的下一个请求，再关闭该连接。这也适用于 Connect 和 gRPC-Web 调用，但必须在配置的排空超时时间内完成。

## 为每个 worker 设置内存限制

`[http.pool]` 和 `[grpc.pool]` 中新增的 `max_memory_mb` 设置指定以 MiB 为单位的常驻内存（RSS）阈值。master 每秒检查一次 RSS。超过阈值的 worker 会排空连接并退出。随后，master 会启动一个替代进程。将值设为 `0` 可禁用此阈值。

此机制补充了应用重启机制：替换进程可以释放在不同应用实例之间仍然占用的内存。

## 请求处理更可靠，处理开销更低

在 Worker 模式下，客户端断开连接只会结束当前请求，不会重启应用。PHP `max_execution_time` 超时会保留 worker 进程。Classic 模式也能在异常处理器调用 `exit()` 时完成流式响应，包括 Yii2 错误页面。

HTTP 修复涵盖上传、`sendFile()` 长度检查和 HEAD 响应。静态文件会正确处理 `If-Range`。原始请求体和 URL 编码的请求体通过内存流传给 PHP。文件读取使用更大的块，空闲 worker 会在两秒后释放分配器中未使用的内存。

gRPC 和 gRPC-Web 响应仅在请求使用 gzip 时使用 gzip。Connect 响应可以在客户端接受 gzip 时使用 gzip。

## 升级前

- 从 `[http]` 中移除 `unsafe_field_names`。包含此设置的配置会导致启动失败。Classic 和 Worker 模式始终丢弃可能在 CGI 变量中产生冲突的请求头名称。
- 移除对 `Rapira\Grpc\Call\Protocol::Rest` 的引用。支持的枚举项为 `Grpc`、`GrpcWeb` 和 `Connect`。
- 对于接受大型请求体的应用，检查 PHP `memory_limit`。在 Classic 和 Worker 模式下，原始请求体和 URL 编码的请求体现在计入此限制。

发布构建和 Docker 镜像现在包含 Sodium 扩展。Linux 压缩包也包含 `libphp.so` 所需的库。

完整变更列表见[发布说明](https://github.com/rapira-rs/rapira/pull/211)。
