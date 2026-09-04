---
title: Static files
description: "Serving files before a request reaches PHP, including the [http.static] keys, middleware rules, and per-worker file cache."
faqLevel: 2
---

# Static files

Rapira uses static file middleware before a request reaches PHP. The middleware runs in the HTTP server before the PHP handler.
It answers a request that resolves to a file under its root. It passes every other request to the next handler without changes.

## Enabling the middleware

Two parts of `rapira.toml` enable the middleware. Add `static` to the `[http]` middleware list. Then add an `[http.static]` section that identifies the file directory.

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"     # Required. Relative paths use this file's directory.
forbid = [".php"]   # Optional. This list replaces the default.
```

`middleware` holds the middleware chain in list order. `static` is currently the only name it accepts.

`root` names the directory that contains the files to serve. It has no default, so the section must set it.
A relative path uses the configuration file directory as its base. `pool.entrypoint` uses the same rule.

`forbid` contains file-name suffixes that the middleware does not serve. Its default value is `[".php"]`. An explicit list replaces the default. For example, `forbid = [".php", ".env"]` blocks both suffixes.

::: danger
The value `forbid = []` permits all files under the root, including PHP source files. Do not use this value with a public root. It can expose application code and embedded secrets.
:::

Each entry starts with a dot and contains at least two characters. It cannot contain `/` or whitespace.
An invalid entry prevents server initialization.

See [Configuration](/docs/configuration) for the other configuration file keys.

::: question Why must a `forbid` entry look like a suffix?
The middleware compares each entry with the end of a file name. Rapira accepts only suffixes that have two or more characters, start with `.`, and contain no slash or whitespace.
:::

## Initialization validation

The server checks the root before it accepts requests. The root must exist and be a directory. The server account must have search permission for it. A failed check prevents initialization and reports the path.

The two configuration parts must occur together. A `"static"` middleware entry requires the `[http.static]` section, and the section requires the entry.
Rapira also rejects duplicate middleware names.

::: question Why does the server test the root twice?
The first test reads the root metadata. It confirms that the path exists and is a directory.
The second test resolves `.` inside the root. It checks the search permission required for file access.

Directory search and read permissions use different bits. Thus, the first test can pass while the second test fails. See [`stat`](https://pubs.opengroup.org/onlinepubs/9799919799/functions/stat.html) for the required permissions.
:::

## Serving rules

The middleware considers a request only when the method is `GET` or `HEAD`. Every other method goes to PHP.

The middleware applies these path rules:

- A path segment that starts with `.` goes to PHP. Thus, `/.env`, `/.git/config`, and `/../outside.txt` do not access files.
- The `forbid` check runs on the percent-decoded path and ignores case. With `.php` forbidden, `/index.php`, `/index%2Ephp` and `/Upper.PHP` all go to PHP.
- A directory URL goes to PHP. The middleware does not serve an index file.
- A path without a file goes to PHP. Permission errors and invalid file names also go to PHP.
- Any other read failure returns `500`. PHP does not receive the request, and Rapira logs the failure on the `http` target.

A request that goes to PHP arrives with its body, its fields and its extensions unchanged. See [HTTP requests and responses](/docs/http) for what PHP reads from it.

::: question Why is a directory URL not answered with `index.html`?
PHP controls the URL space, so a directory URL is an application route. An automatic index file would create two possible responses. The file system could return one response, while the application router returns another. The entry script would not receive requests for `/`.
:::

::: question How does the middleware separate a miss from a read failure?
Six results mean that no file is available. The path can be absent, inaccessible, or a directory. A path component can have the wrong type. The file name can be too long or contain a NUL byte. For these results, the request continues to PHP.

Other errors identify an existing file that Rapira cannot read. The middleware returns `500` for these errors.
:::

## Response fields

The following fields occur in a response that serves a file. The middleware `500` response does not contain them.

The middleware sets `Content-Type` from the file extension. A name with no known extension gets `application/octet-stream`.

The response contains `ETag` and `Last-Modified` fields. The middleware creates `Last-Modified` from the file modification time. It creates `ETag` from the modification time and the file length.
A file without a modification time gets neither field. A time before the epoch prevents only the `ETag`.

The middleware returns `304 Not Modified` when `If-None-Match` matches the `ETag`. A request without `If-None-Match` gets `304 Not Modified` when the file modification time is not later than the `If-Modified-Since` time.
This response contains only `ETag` and `Last-Modified`. It has no body.

The response also contains `Accept-Ranges: bytes`. A `Range` request can return `206 Partial Content` and a `Content-Range` field.
Rapira returns `416 Range Not Satisfiable` for an invalid range. PHP does not receive this request.

## The file cache

Each worker process holds files that it served in memory. You cannot configure the cache.
The cache always uses the following values.

A cache entry is valid for one second. After that period, the next request uses `stat` to compare the file. The worker keeps an entry with the same modification time and length. It reads a changed file again.

The cache does not store a file larger than 256 KiB. Such a file streams from disk on every request.

A worker stores at most 16 MiB. A full cache continues to serve its current entries. The cache first removes expired entries. If the cache remains full, it does not store the new file. Thus, each worker can use 16 MiB for this cache. A restart clears the cache.

Each worker validates its own entries. A deleted file affects responses after at most one second. A changed or replaced file affects responses after at most one second when its modification time or length changes.
A permission change does not remove an entry when the modification time and length remain equal.

Delete the file to remove the entry. A replacement removes the entry only with a new modification time or length. Alternatively, restart the server.

The root must use local storage. The middleware runs `stat` and `open` on the thread that serves requests.
A slow file system delays other connections in that worker.

::: question How does the cache detect a changed file?
The cache compares the file's modification time and length with its stored values. The ETag contains the same values. The cache does not detect a replacement that keeps both values.

Thus, each replaced file needs a new modification time or length.
:::

See [Configuration](/docs/configuration) for more information.
