---
title: Static files
description: "Serving files before a request reaches PHP, including the [http.static] keys, middleware rules, and per-worker file cache."
faqLevel: 2
---

# Static files

Rapira serves files from a directory with the static file middleware before a request reaches PHP. The middleware is in the HTTP front, before the PHP handler. It answers a request that resolves to a file under its root. It passes every other request to the next handler without changes.

## Enabling the middleware

Two parts of `rapira.toml` enable the middleware. Add `static` to the `[http]` middleware list. Then add an `[http.static]` section that identifies the file directory.

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # required; a relative path resolves against this file's directory
forbid = [".php"]   # optional; an explicit list replaces this default
```

`middleware` holds the middleware chain in list order. `static` is currently the only name it accepts.

`root` names the directory the middleware serves from. It has no default, so the section must set it. A relative path resolves against the directory that holds the config file, the same way `pool.entrypoint` does.

`forbid` holds the extensions that the middleware does not serve. Its default value is `[".php"]`. An explicit list replaces the default. For example, `forbid = [".php", ".env"]` blocks both extensions. The value `forbid = []` serves every file under the root, including PHP source files. Each entry starts with a dot and contains at least two characters. It cannot contain `/` or whitespace. An invalid entry stops the boot.

The other keys of the file are on the [Configuration](/docs/configuration) page.

::: question Why must a `forbid` entry look like an extension?
The middleware matches each entry against the end of the file name. A separator or space cannot end a file name. Therefore, an entry with either character cannot match a file. The validation rejects an entry that cannot protect a file.
:::

## Boot validation

The server checks the root before it serves anything. The root must exist, must be a directory, and must be searchable by the user the server runs as. A root that fails one of these checks stops the boot with a message that names the path.

The two configuration parts must agree with each other. `middleware = ["static"]` without a `[http.static]` section stops the boot, and a `[http.static]` section that `middleware` does not list stops the boot as well. A name that `middleware` lists twice is refused too.

::: question Why does the server test the root twice?
The first test reads the root metadata. This shows that the path exists and is a directory. The second test resolves `.` inside the root. This checks the search permission that every read under the root needs. Directory search and read permissions use different bits. A root can therefore pass the first test and fail the second. See [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html) for the permissions that each call needs.
:::

## Serving rules

The middleware considers a request only when the method is `GET` or `HEAD`. Every other method goes to PHP.

The path decides the rest:

- A path with a segment that starts with `.` goes to PHP, so `/.env`, `/.git/config` and `/../outside.txt` never reach the filesystem.
- The `forbid` check runs on the percent-decoded path and ignores case. With `.php` forbidden, `/index.php`, `/index%2Ephp` and `/Upper.PHP` all go to PHP.
- A directory URL goes to PHP. The middleware serves no index file for it, with or without a trailing slash.
- A path with no file behind it goes to PHP. A permission error goes to PHP as well, and so does a name the filesystem does not accept.
- Any other read failure answers `500`. That request does not reach PHP, and the failure is logged on the `http` target.

A request that goes to PHP arrives with its body, its fields and its extensions unchanged. See [HTTP requests and responses](/docs/http) for what PHP reads from it.

::: question Why is a directory URL not answered with `index.html`?
The URL space belongs to PHP, so a directory URL is an application route. An implicit index file would create two possible responses for one URL. One response would come from the filesystem, and the other would come from the router. It would also prevent the entry script from handling `/`.
:::

::: question How does the middleware separate a miss from a read failure?
Six outcomes mean that there is no file to serve. The path can be absent, unreadable, or a directory. A path component can also be the wrong type. The file name can be too long or contain a NUL byte. Each outcome is a miss, and the request continues to PHP. Every other error identifies a file that exists but cannot be read. The middleware reports that error as `500`.
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

A file larger than 256 KiB is not stored. Such a file streams from disk on every request.

A worker stores at most 16 MiB. A full cache continues to serve its current entries. It removes stale entries before it refuses a new file. Each process in `pool.processes` can therefore use up to 16 MiB for the cache. A restart empties the cache.

Each worker revalidates its own entries. A changed file reaches a client after at most one second. Deleted and replaced files leave the cache within the same period. A permission change does not remove an entry because `stat` reports the same modification time and length. To remove the entry, delete or replace the file, or restart the server.

The root must be on local storage. The middleware runs `stat` and `open` on the runtime thread that serves requests. A slow filesystem delays the other connections of that worker.

::: question How does the cache detect a changed file?
The cache compares the file's modification time and length with its stored values. The ETag contains the same values. The cache does not detect a replacement that keeps both values. Therefore, each replaced file needs a new modification time or length.
:::

See [Configuration](/docs/configuration) for more information.
