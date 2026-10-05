---
title: Static files
description: "Serving files before a request reaches PHP, including the [http.static] keys, middleware rules, and per-worker file cache."
faqLevel: 2
---

# Static files

The static file middleware serves files from a directory before a request reaches PHP. It answers a request that resolves to a file under its root. It sends every other request to PHP without changes.

## Enabling the middleware

Two parts of `rapira.toml` enable the middleware. Add `static` to the `[http]` middleware list. Then add an `[http.static]` table that sets the file directory.

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # Required. Relative paths use this file's directory.
forbid = [".php"]   # Optional. This list replaces the default.
```

`middleware` holds the middleware chain in list order. `static` is currently the only name it accepts.

`root` names the directory that contains the files to serve. It has no default, so the table must set it. A relative path uses the configuration file directory as its base, as `http.pool.entrypoint` does.

`forbid` contains file-name suffixes that the middleware does not serve. Its default value is `[".php"]`. An explicit list replaces the default. For example, `forbid = [".php", ".env"]` blocks both suffixes.

::: danger
The value `forbid = []` permits all files under the root, including PHP source files. Do not use this value with a public root. It can expose application code and embedded secrets.
:::

Each entry starts with a dot and contains at least two characters. It cannot contain `/` or whitespace. An invalid entry stops the server initialization.

See [Configuration](/docs/configuration) for the other configuration file keys.

## Initialization validation

The server checks the root before it accepts requests. The root must exist and be a directory. The server account must have search permission for it. A failed check prevents initialization and reports the path.

The two configuration parts must occur together. A `"static"` middleware entry requires the `[http.static]` table, and the table requires the entry. Rapira also rejects duplicate and unknown middleware names.

::: question Why does the server test the root twice?
The first test reads the root metadata. It confirms that the path exists and is a directory. The second test resolves `.` inside the root. It checks the search permission that file access requires.

Directory search and read permissions use different bits. Thus, the first test can pass while the second test fails. See [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html) for the required permissions.
:::

## Serving rules

The middleware considers a request only when the method is `GET` or `HEAD`. Every other method goes to PHP.

The middleware applies these path rules:

- A path segment that starts with `.` goes to PHP. Thus, `/.env`, `/.git/config`, and `/../outside.txt` do not access files.
- The `forbid` check runs on the percent-decoded path and ignores case. With `.php` forbidden, `/index.php`, `/index%2Ephp` and `/Upper.PHP` all go to PHP.
- A path with a percent-encoding that does not decode to UTF-8 goes to PHP. For example, `/%FF.css` goes to PHP.
- A directory URL goes to PHP. The middleware does not serve an index file.
- A missing file, a permission error, or an invalid file name goes to PHP. An invalid file name is too long or contains a NUL byte.
- Any other read failure returns `500`. PHP does not receive the request, and Rapira logs the failure on the `http` target.

A request that goes to PHP arrives without changes. See [HTTP requests and responses](/docs/http) for what PHP reads from it.

::: question Why is a directory URL not answered with `index.html`?
PHP controls the URL space, so a directory URL is an application route. An automatic index file would create two possible responses. The file system could return one response, while the application router returns another. The entry script would not receive requests for `/`.
:::

## Response fields

The following fields occur in a response that serves a file. The middleware `500` response does not contain them.

The middleware sets `Content-Type` from the file extension. A name with no known extension gets `application/octet-stream`.

The response contains `ETag` and `Last-Modified` fields. The middleware creates `Last-Modified` from the file modification time. It creates `ETag` from the modification time and the file length. A file without a modification time gets neither field.

The middleware returns `304 Not Modified` when `If-None-Match` matches the `ETag`. A request without `If-None-Match` gets `304 Not Modified` when the file modification time is not later than the `If-Modified-Since` time. This response contains only `ETag` and `Last-Modified`. It has no body.

The response also contains `Accept-Ranges: bytes`. A `Range` request can return `206 Partial Content` and a `Content-Range` field. Rapira returns `416 Range Not Satisfiable` for an invalid range or for more than one range. PHP does not receive this request.

A failed `If-Match` or `If-Unmodified-Since` condition returns `412 Precondition Failed`.

The middleware does not set `Cache-Control`. Set this field in a reverse proxy when clients need it.

## The file cache

Each worker process keeps the files that it serves in memory. You cannot configure the cache. It uses these fixed values:

- A cache entry is valid for one second.
- The cache does not store a file larger than 256 KiB. Such a file streams from disk on each request.
- Each worker stores at most 16 MiB. Thus, the cache can use 16 MiB of memory for each process in `http.pool.processes`.

After one second, the next request for a file runs `stat` on it. The worker keeps the entry when the modification time and the length are the same. Otherwise, it reads the file again. Rapira stops serving a deleted file after at most one second.

A full cache continues to serve its entries. It removes expired entries first. If the cache is still full, it does not store the new file.

A new worker process starts with an empty cache. Thus, a reload, a worker replacement, or a restart clears the cache.

The root must use local storage. The middleware runs `stat` and `open` on the thread that serves requests. A slow file system delays other connections in that worker.

::: question Why does the cache not detect my changed file?
The cache compares only the modification time and the length of the file. The `ETag` contains the same values. The cache does not detect a replacement that keeps both values. A permission change also keeps the entry. To remove the entry, delete the file, change its modification time, or [reload](/docs/process-model#signals) the server.
:::
