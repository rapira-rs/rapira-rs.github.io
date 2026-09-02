---
title: Static files
description: "Serving files from a directory before a request reaches PHP: the [http.static] keys, the rules that decide what the middleware answers, and the per-worker file cache."
faqLevel: 2
---

# Static files

Rapira serves files from a directory with the static file middleware, before a request reaches PHP. The middleware sits in the HTTP front, ahead of the PHP handler: it answers a request that resolves to a file under its root, and it passes every other request down the chain unchanged.

## Enabling the middleware

Two parts of `rapira.toml` turn the middleware on: the name `static` in the `[http]` middleware list, and a `[http.static]` section that says where the files are.

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # required; a relative path resolves against this file's directory
forbid = [".php"]   # optional; an explicit list replaces this default
```

`middleware` holds the middleware chain in list order. `static` is currently the only name it accepts.

`root` names the directory the middleware serves from. It has no default, so the section must set it. A relative path resolves against the directory that holds the config file, the same way `pool.entrypoint` does.

`forbid` holds the extensions the middleware never serves. It defaults to `[".php"]`, and an explicit list replaces that default: `forbid = [".php", ".env"]` keeps both extensions out of the answers, and `forbid = []` serves every file under the root, PHP sources included. Each entry is an extension with a leading dot, at least two characters long, with no `/` and no whitespace. An entry outside that shape stops the boot.

The other keys of the file are on the [Configuration](/docs/configuration) page.

::: question Why must a `forbid` entry look like an extension?
The middleware matches each entry as a suffix of the file name. A separator or a space can never end a file name, so an entry that holds one matches nothing, and the file it was meant to protect stays reachable. The check refuses such an entry instead of accepting a guard that does nothing.
:::

## Boot validation

The server checks the root before it serves anything. The root must exist, must be a directory, and must be searchable by the user the server runs as. A root that fails one of these checks stops the boot with a message that names the path.

The two configuration parts must agree with each other. `middleware = ["static"]` without a `[http.static]` section stops the boot, and a `[http.static]` section that `middleware` does not list stops the boot as well. A name that `middleware` lists twice is refused too.

::: question Why does the server test the root twice?
The first test reads the metadata of the root, which shows that the path exists and that it is a directory. The second test resolves `.` inside the root, which shows the search permission that every read under the root needs. Search permission on a directory is a different bit from read permission on it, so a root that answers the first test can still fail the second. See [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html) for the permissions each call needs.
:::

## Serving rules

The middleware considers a request only when the method is `GET` or `HEAD`. Every other method goes to PHP.

The path decides the rest:

- A path with a segment that starts with `.` goes to PHP, so `/.env`, `/.git/config` and `/../outside.txt` never reach the filesystem.
- The `forbid` check runs on the percent-decoded path and compares the last segment without case, so `/index.php`, `/index%2Ephp` and `/Upper.PHP` all go to PHP while `forbid` holds `.php`.
- A directory URL goes to PHP. The middleware serves no index file for it, with or without a trailing slash.
- A path with no file behind it goes to PHP. A permission error goes to PHP as well, and so does a name the filesystem does not accept.
- Any other read failure answers `500`. That request does not reach PHP, and the failure is logged on the `http` target.

A request that goes to PHP arrives with its body, its fields and its extensions unchanged. See [HTTP requests and responses](/docs/http) for what PHP reads from it.

::: question Why is a directory URL not answered with `index.html`?
The URL space belongs to PHP: a directory URL is the application's route. An implicit index file would give two answers for one URL, one from the filesystem and one from the router, and it would take `/` away from the front controller.
:::

::: question How does the middleware separate a miss from a read failure?
Six outcomes mean that there is no file to serve: the path is absent, the process may not read it, the path is a directory, a component of the path is not a directory, the name is too long for the filesystem, and the name holds a NUL byte. Each one is a miss, and the request continues to PHP. Every other error reports a file that exists and cannot be read, which PHP cannot answer either, so the middleware reports it as `500`.
:::

## Response fields

The fields below belong to an answer that serves a file. The `500` answer of the middleware carries none of them.

The middleware sets `Content-Type` from the file extension. A name with no known extension gets `application/octet-stream`.

The answer carries an `ETag` and a `Last-Modified` field. The middleware builds both fields from the modification time of the file. A file with no modification time gets neither field, and a file with a modification time before the epoch gets no `ETag`.

The middleware answers `304 Not Modified` when the `If-None-Match` or the `If-Modified-Since` field of the request matches the file. That answer carries the `ETag` and the `Last-Modified` fields only, and it has no body.

The answer also carries `Accept-Ranges: bytes`. A `Range` request is answered with `206 Partial Content` and a `Content-Range` field. A range the file cannot satisfy is answered with `416 Range Not Satisfiable`, and that request does not reach PHP either.

## The file cache

Each worker process holds served files in memory. The cache has no configuration keys, and the values below are fixed.

An entry stays fresh for one second. The first request after that window runs a `stat` and refreshes the entry when the modification time and the length still match the file. A file that changed is read again.

A file larger than 256 KiB is never stored. Such a file streams from disk on every request.

A worker stores at most 16 MiB. A cache at that limit keeps serving the entries it holds, and it drops its stale entries before it refuses a new file. The memory cost is therefore up to 16 MiB for each process in `pool.processes`. A restart empties the cache.

Each worker revalidates its own entries, so a change under the root reaches a client after at most one second. A deleted file and a replaced file both leave the cache inside that window. A permission change alone does not remove an entry, because `stat` reports the same modification time and the same length as before: delete the file, replace it, or restart the server to take it out of the cache.

The root must be on local storage. The middleware runs `stat` and `open` on the runtime thread that serves requests, so a filesystem that answers those calls slowly holds up the other connections of that worker.

::: question How does the cache detect a changed file?
It compares the modification time and the length of the file with the two values it stored, and the ETag encodes the same pair. A replacement that keeps both values is not detected, so a deploy that copies files has to leave a new modification time or a new length on each replaced file.
:::

See [Configuration](/docs/configuration) for more information.
