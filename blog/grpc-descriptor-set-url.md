---
title: "Load the gRPC descriptor set from a URL"
date: 2026-11-17
description: "The descriptor_set key of the gRPC listener accepts a local path or an HTTP or HTTPS URL. This post compares the two forms and lists the limits of the URL form."
author: Rapira Team
image: /blog/grpc-descriptor-set-url/preview.png
---

# Load the gRPC descriptor set from a URL

Rapira reads the gRPC schema from a descriptor set. This is one binary file that contains the compiled `.proto` files with their imports. Buf calls this file an image. The `descriptor_set` key of `[grpc]` now accepts two forms: a local path, and an HTTP or HTTPS URL.

::: info
The URL form needs a Rapira version later than 0.9.2.
:::

## What Rapira does with the set

Rapira uses the set to find the services and their methods, to convert Connect JSON messages, and to answer reflection requests. The master process loads the set one time at start, before it forks the workers. A set that Rapira cannot load stops the start. Rapira needs no `protoc` executable for this.

## The path form

```toml
[grpc]
descriptor_set = "api.binpb"
```

A relative path uses the directory of `rapira.toml` as its base. The file must be on the host or in the container before Rapira starts. There are three usual methods to put it there:

- Build the set in the pipeline of the application, and copy it into the container image.
- Mount the set from a volume or a ConfigMap. A ConfigMap [cannot hold more than 1 MiB](https://kubernetes.io/docs/concepts/configuration/configmap/#motivation).
- Download the set in an [init container](https://kubernetes.io/docs/concepts/workloads/pods/init-containers/) or in an entrypoint script.

With the first two methods, Rapira reads a local file at start and sends no request. With the third method, the start needs the host of the file, as with the URL form. When the set is in the image, the set and the application code deploy as one artifact. The cost is one more step for each service: a build stage with `buf` or `protoc`, or a script that gets the file.

## The URL form

```toml
[grpc]
descriptor_set = "https://schemas.example.com/billing/v42/api.binpb"
```

A value that starts with `http://` or `https://` is a URL. The master process downloads the set with a GET request at start. [Buf image inputs](https://buf.build/docs/reference/inputs/#image-formats) accept a remote location in the same way.

With this form, you can keep the descriptor sets of all services in one location. The pipeline of the `.proto` repository builds each set one time:

```sh
buf build proto --as-file-descriptor-set -o api.binpb
```

The pipeline then uploads `api.binpb` to a host that answers a GET request. An object storage bucket, an artifact repository, and a static file server are examples. Each Rapira instance names the URL in `rapira.toml`.

Rapira does the download itself. The application image contains no descriptor set and no step that builds one. A pod needs no init container and no volume for the schema. The same configuration works in a container, on a virtual machine, and on a developer computer.

## How the download works

- Rapira sends a GET request and follows a maximum of 10 redirects. A response status of 400 or above stops the start.
- HTTPS uses the certificate store of the system. `SSL_CERT_FILE` and `SSL_CERT_DIR` select a different store, for example for a private certificate authority.
- Rapira sends the userinfo of the URL (`https://user:password@host/api.binpb`) as HTTP Basic credentials. Log messages show the URL without its userinfo and its query.
- The download uses the proxy that `ALL_PROXY`, `HTTPS_PROXY`, or `HTTP_PROXY` names.
- The connection, the response head, and the body each have a time limit of 30 seconds. The maximum size of the set is 64 MiB.

## Limits of the URL form

The URL form moves one dependency from the build to the start of each instance. Read these limits before you use it.

- The start needs the schema host. If the download fails, Rapira exits with code 1. It does not try again, and it keeps no local copy. Your process supervisor or orchestrator must start it again. Instances that run are not affected, because they do not download the set again.
- A changed set needs a restart. A reload keeps the loaded set. If you replace the file at a URL, instances with different start times can use different sets. Put a version in the URL path, and change the URL for each schema release.
- Rapira does not verify the content. It checks no checksum and no signature. Use HTTPS and a host that you trust. With `http://`, each host on the network path can change the set.
- Authentication is simple. Rapira can send HTTP Basic credentials from the userinfo of the URL. The query of the URL can also hold credentials, as in a pre-signed URL. Rapira cannot send a bearer token, and it cannot sign a request for a cloud storage API. A pre-signed URL has an expiry time, and a start after that time fails. The credentials are in `rapira.toml`, so protect that file.
- The format is fixed. The response body must be the binary set. Buf can also read a compressed image such as `image.binpb.gz`, but Rapira cannot.
- Rapira does not use a schema registry API. It sends a plain GET request. Export the set from the registry, and upload it to a host that answers a GET request.
- Generated PHP classes stay in the application. An application that uses generated message classes still builds them into its image. The URL form removes only the descriptor set from the image. Keep the classes and the set at the same schema version.

## Which form to use

Use a path when the set ships with the application, or when Rapira must start without network access. Use a URL when many services or instances share one schema location, and that location is as available as your deployments require.

See [gRPC](/docs/grpc#descriptor-set-url) for the reference.
