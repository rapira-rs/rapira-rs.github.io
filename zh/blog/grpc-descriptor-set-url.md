---
title: "从 URL 加载 gRPC 描述符集"
date: 2026-11-17
description: "gRPC 监听器的 descriptor_set 键接受本地路径或 HTTP、HTTPS URL。本文比较这两种形式，并列出 URL 形式的限制。"
author: Rapira Team
image: /blog/grpc-descriptor-set-url/preview.png
---

# 从 URL 加载 gRPC 描述符集

Rapira 从描述符集读取 gRPC 模式定义。描述符集是一个二进制文件，包含编译后的 `.proto` 文件及其导入的文件。Buf 将这种文件称为镜像（image）。`[grpc]` 的 `descriptor_set` 键现在接受两种形式：本地路径，以及 HTTP 或 HTTPS URL。

::: info
URL 形式需要高于 0.9.2 的 Rapira 版本。
:::

## Rapira 如何使用描述符集

Rapira 使用描述符集查找服务及其方法、转换 Connect JSON 消息，以及响应反射请求。master 进程在启动时加载一次描述符集，此操作在 fork 出 worker 之前完成。Rapira 无法加载的描述符集会使启动停止。此过程不需要 `protoc` 可执行文件。

## 路径形式

```toml
[grpc]
descriptor_set = "api.binpb"
```

相对路径以 `rapira.toml` 所在目录为基准。Rapira 启动前，文件必须已经位于主机或容器中。通常有三种方法把文件放到那里：

- 在应用的流水线中构建描述符集，并将它复制到容器镜像中。
- 从卷或 ConfigMap 挂载描述符集。ConfigMap [不能保存超过 1 MiB 的数据](https://kubernetes.io/docs/concepts/configuration/configmap/#motivation)。
- 在 [Init 容器](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/)或 entrypoint 脚本中下载描述符集。

使用前两种方法时，Rapira 在启动时读取本地文件，不发送任何请求。使用第三种方法时，启动需要文件所在的主机，与 URL 形式相同。当描述符集位于镜像中时，描述符集和应用代码作为一个制品部署。代价是每个服务多一个步骤：使用 `buf` 或 `protoc` 的构建阶段，或获取文件的脚本。

## URL 形式

```toml
[grpc]
descriptor_set = "https://schemas.example.com/billing/v42/api.binpb"
```

以 `http://` 或 `https://` 开头的值是 URL。master 进程在启动时通过 GET 请求下载描述符集。[Buf 镜像输入](https://buf.build/docs/reference/inputs/#image-formats)以相同方式接受远程位置。

使用此形式，可以把所有服务的描述符集放在一个位置。`.proto` 仓库的流水线将每个描述符集构建一次：

```sh
buf build proto --as-file-descriptor-set -o api.binpb
```

然后，流水线将 `api.binpb` 上传到一个响应 GET 请求的主机。对象存储桶、制品仓库和静态文件服务器都是此类主机的例子。每个 Rapira 实例在 `rapira.toml` 中指定该 URL。

Rapira 自己完成下载。应用镜像不包含描述符集，也不包含构建描述符集的步骤。Pod 不需要为模式定义准备 Init 容器或卷。相同的配置可以在容器、虚拟机和开发者计算机上使用。

## 下载如何工作

- Rapira 发送 GET 请求，最多跟随 10 次重定向。响应状态码为 400 或更高时，启动停止。
- HTTPS 使用系统的证书存储。在 Linux 上，`SSL_CERT_FILE` 和 `SSL_CERT_DIR` 替换该证书存储，例如用于私有证书颁发机构。在 macOS 上，证书存储是钥匙串，这两个变量不起作用。
- Rapira 将 URL 中的用户信息（`https://user:password@host/api.binpb`）作为 HTTP Basic 凭据发送。日志消息中显示的 URL 不含用户信息和查询部分。
- 下载使用 `ALL_PROXY`、`HTTPS_PROXY` 或 `HTTP_PROXY` 指定的代理。
- 连接、响应头和响应体各有 30 秒的时间限制。描述符集的最大大小为 64 MiB。

## URL 形式的限制

URL 形式把一个依赖从构建阶段移到每个实例的启动阶段。使用它之前，请阅读以下限制。

- 启动需要模式定义所在的主机。下载失败时，Rapira 以退出码 1 退出。它不会再次尝试，也不保留本地副本。你的进程管理器或编排器必须再次启动它。正在运行的实例不受影响，因为它们不会再次下载描述符集。
- 更改后的描述符集需要重启。重载会保留已加载的描述符集。如果替换某个 URL 上的文件，启动时间不同的实例可能使用不同的描述符集。请在 URL 路径中加入版本号，并在每次发布模式定义时更改 URL。
- Rapira 不验证内容。它不检查校验和，也不检查签名。请使用 HTTPS 和你信任的主机。使用 `http://` 时，网络路径上的每台主机都可以更改描述符集。Rapira 也会跟随从 `https://` URL 到 `http://` URL 的重定向。
- 身份验证方式很简单。Rapira 可以发送 URL 用户信息中的 HTTP Basic 凭据。URL 的查询部分也可以包含凭据，例如预签名 URL。Rapira 不能发送 bearer 令牌，也不能为云存储 API 签名请求。预签名 URL 有过期时间，过期后启动会失败。凭据位于 `rapira.toml` 中，因此请保护该文件。
- 格式是固定的。响应体必须是二进制描述符集。Buf 还能读取 `image.binpb.gz` 等压缩镜像，但 Rapira 不能。
- Rapira 不使用模式注册表 API。它发送普通的 GET 请求。请从注册表导出描述符集，并将它上传到响应 GET 请求的主机。
- 生成的 PHP 类仍在应用中。使用生成的消息类的应用仍需将这些类构建到镜像中。URL 形式只从镜像中移除描述符集。请让这些类和描述符集保持相同的模式定义版本。

## 选择哪种形式

当描述符集随应用一起发布，或 Rapira 必须在没有网络访问的情况下启动时，请使用路径。当许多服务或实例共用一个模式定义位置，并且该位置的可用性满足你的部署要求时，请使用 URL。

参考信息请参阅 [gRPC](/zh/docs/grpc#descriptor-set-url)。
