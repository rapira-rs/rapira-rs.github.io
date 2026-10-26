---
title: "PHP2Shell and RoadRunner"
date: 2026-10-27
description: "Why the PHP2Shell vulnerabilities (CVE-2026-109618 and CVE-2026-109619) do not affect RoadRunner, how other servers run PHP, and what to do if you run WordPress."
author: Aleksei Gagarin
---

On October 21, PHP released unscheduled updates 8.5.12, 8.4.27, 8.3.36, and 8.2.35. They fix two critical vulnerabilities that the researchers named [PHP2Shell](https://calif.io/php2shell/): [CVE-2026-109618](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w) and [CVE-2026-109619](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp). Both allow unauthenticated remote code execution and have a CVSS v4 score of 9.2. The researchers demonstrated the attack on WordPress, Drupal, Joomla, Magento, Nextcloud, Laravel, Symfony, and other applications.

The most interesting thing about these vulnerabilities is their location. They are not in framework code or in new language features. They are in the server-side code of PHP itself: the code that parses POST request bodies and file uploads. The file `main/rfc1867.c`, which parses `multipart/form-data`, was added to the repository in 1999. `main/php_variables.c` followed in 2000.

::: warning
Update PHP, whatever server you use. The sections below explain why some ways of running PHP suffered more than others. That is not a reason to delay the update.
:::

## How the attack works

All variants of the attack share one idea. The attacker makes PHP fail with a fatal error while data structures in memory are only partly filled. Most often, the request makes PHP use more memory than `memory_limit`. Deeply nested form fields in `multipart` can do this. A body without a declared length can do it too: a chunked body in HTTP/1.1, or an HTTP/2 body without `Content-Length`. The `post_max_size` check looks at the declared length and lets such data through.

Calif describes three attack paths:

1. **POST parsing.** PHP runs out of memory while it parses an `application/x-www-form-urlencoded` or `multipart/form-data` body at request startup. The hash table keeps an element that is already counted but has no key yet.
2. **`session.upload_progress`.** A file part of a `multipart` body starts a session while PHP is still parsing the body. The fatal error interrupts request startup, and the session does not close. Its data points to memory that PHP has already freed.
3. **Decoding after startup.** The fatal error occurs in `unserialize()`, `session_decode()`, or `session_start()` after the request has started and application code is running. The decoder state continues to point to freed memory. This path depends on the application: it must decode data that the attacker controls.

In all three cases, the corrupted state is harmless by itself. The next request that the same process receives turns it into code execution. The attack works only if the PHP process survives the fatal error. That is why the way a server runs PHP and passes requests to it decides almost everything.

## How servers talk to PHP

| Server                   | How it runs PHP              | What parses the request body | Does the process survive a fatal error                                  | Result for PHP2Shell          |
|--------------------------|------------------------------|------------------------------|-------------------------------------------------------------------------|-------------------------------|
| Apache + mod_php         | Module inside Apache         | PHP                          | Yes                                                                     | Vulnerable, all three paths   |
| PHP-FPM                  | Separate processes, FastCGI  | PHP                          | No after a failure at request startup, yes after a failure in app code  | Vulnerable, path 3            |
| FrankenPHP               | Embedded in a Go server      | PHP                          | Yes, like mod_php                                                       | Listed as affected            |
| Swoole                   | PHP extension                | Swoole                       | No                                                                      | Not affected                  |
| RoadRunner               | Separate PHP processes       | Go                           | No, RoadRunner starts a new process                                     | Not affected                  |
| Rapira [Classic, Worker] | Embedded in a Rust server    | PHP                          | Yes, only the application restarts                                      | Same conditions as mod_php    |
| Rapira [Dispatcher]      | Embedded in a Rust server    | Rust                         | Yes, only the application restarts                                      | Paths 1 and 2 do not work     |

**mod_php** suffered the most: Calif demonstrates RCE against an arbitrary PHP script with default settings.

**PHP-FPM** stops the worker if request startup fails. So paths 1 and 2, which break request startup, do not work on FPM. Path 3 works: the fatal error in the decoder occurs after startup, and the worker stays alive. The Calif demonstration uses exactly this setup: nginx and PHP-FPM.

**FrankenPHP** embeds PHP as a separate SAPI and calls the standard `php_request_startup()`, so PHP itself parses the request body. The PHP team added FrankenPHP to the list of affected servers. The advisory notes that FrankenPHP calls request shutdown even after a failed startup, like mod_php. FrankenPHP released [v1.13.2](https://github.com/php/frankenphp/releases) with the fixed PHP on the same day.

**Swoole** parses HTTP and `multipart` with its own code and does not support `session.upload_progress`. The Swoole maintainers [stated](https://github.com/swoole/swoole-src/issues/6343) that these CVEs do not affect Swoole.

**RoadRunner** also parses HTTP outside PHP, and a worker exits after a fatal error. None of the three attack paths works here. The next section explains why in more detail.

## How RoadRunner talks to PHP

RoadRunner does not embed PHP and does not use FastCGI. A worker is a regular `php worker.php` process that runs in the CLI SAPI. RoadRunner and the worker exchange [Goridge](https://github.com/roadrunner-server/goridge) protocol frames over STDIN/STDOUT or a socket. Each frame is a header with the length and a checksum, followed by the data.

The RoadRunner http plugin handles the whole HTTP request. It accepts the connection, checks `max_request_size`, parses `application/x-www-form-urlencoded` and `multipart/form-data`, and saves uploaded files to a temporary directory. PHP receives a ready-made DTO: the request context and the body. The context contains the method, URI, headers, cookies, parsed fields, and the list of uploads. The `roadrunner/http` PHP package builds a PSR-7 request from this DTO.

What this means for PHP2Shell:

- Path 1: `rfc1867_post_handler()` and `php_std_post_handler()` never see HTTP requests. The CLI worker starts once, without a request body.
- Path 2: `session.upload_progress` does not run.
- Path 3: a fatal error ends the CLI script, and the process ends with it. RoadRunner sees that the worker exited and starts a new one. The corrupted state does not survive until the next request.

In this design, the twenty-year-old request parsing code in PHP simply does not run. Pipes appeared in Unix in 1973, and since then nobody has managed to break them. RoadRunner and PHP share no memory and no threads, and RoadRunner uses no clever hooks into the engine. Only bytes go through the pipe. If a PHP process crashes, RoadRunner simply starts a new one, and the next request goes to a clean process.

We have said before that RoadRunner is as reliable as PHP-FPM. PHP2Shell showed that RoadRunner is even more secure. Where FPM needed an urgent update, RoadRunner does not run the vulnerable code at all. And this is clearly not the end of the story.

::: info
Update PHP anyway: the fix changes how PHP behaves when it runs out of memory.
:::

## The application that never dies

This architecture has a cost: the application must be able to run in a long-lived process. The worker loads the framework once and then handles requests in a loop. Static properties, singletons, and global state survive from one request to the next, so the code must not keep request data in them.

WordPress cannot work this way. Symfony, Laravel, and Yii3 applications, however, can most likely move to RoadRunner painlessly, unless they use static state carelessly. Ready-made bridges make this possible:

- Symfony: [Symfony Runtime](https://github.com/php-runtime/runtime) or [baldinof/roadrunner-bundle](https://github.com/baldinof/roadrunner-bundle).
- Laravel: [Laravel Octane](https://laravel.com/docs/octane) or [spiral/roadrunner-laravel](https://github.com/spiral/roadrunner-laravel).
- Yii3: [yiisoft/yii-runner-roadrunner](https://github.com/yiisoft/yii-runner-roadrunner).

::: info
If you are starting a new project, take a look at our framework, [Spiral](https://spiral.dev/). We designed it for RoadRunner from the start, and it runs in a long-lived process without bridges or compromises. Out of the box, Spiral uses RoadRunner features to the full: HTTP, gRPC, queues, key-value storage, WebSocket through Centrifugo, Temporal, and metrics.
:::

## But I run WordPress!

Our new project, [Rapira](/docs/intro/), is the next step after RoadRunner. We build it in Rust thoughtfully and do not hand everything off to AI. Before a release, the architecture of Rapira and of its PHP contracts goes through several rounds of review and benchmarks. The application uses these contracts to talk to the server. Rapira runs PHP in one of [three modes](/docs/execution-modes): Classic, Worker, and Dispatcher.

**Classic** suits WordPress and legacy codebases. The script runs again for each request, as under php-fpm, and you do not need to rewrite the application. Rapira supports PHP 8.4 and 8.5, so you will still have to migrate to PHP 8.4+.

**Worker** keeps the application in memory and populates the superglobals for each request. This is the same model as the FrankenPHP worker mode, but without CGO and without ZTS threads. Each worker is a separate process with one NTS interpreter.

**Dispatcher** is the fastest mode. It works like RoadRunner: the application receives a request object instead of superglobals, and Rust parses `multipart` itself. But unlike RoadRunner, it has no Goridge layer and no serialization. All workers share the OPcache of the master process.

Yii3 benchmarks on different servers, including all three Rapira modes, are available at [yii3-benchmarks.github.io](https://yii3-benchmarks.github.io/app-api/).

::: warning PHP2Shell and Rapira
Rapira rejects some dangerous requests before PHP runs. Rapira buffers the whole body and responds with `413` if the body is larger than `http.max_body_size_mb`. So the `post_max_size` bypass through chunked bodies in HTTP/1.1 or through HTTP/2 without `Content-Length` does not work.

However, in the Classic and Worker modes, PHP itself parses the request body. This leaves an attack vector through nested `multipart` fields: such a body fits within the size limit but uses more than `memory_limit` during parsing.
:::

Aim to write your application so that it works in the Dispatcher mode. This improves not only performance but also the reliability and security of the application. You can try this approach today on the ultra-stable RoadRunner.

As a last resort, there is a radical fix: `pm.max_requests = 1` in PHP-FPM or `max_jobs: 1` in the RoadRunner pool. Each request gets a fresh process, just like CGI in 1997. We mean this as a joke, but security is no joke.

## Summary

PHP2Shell is not the last vulnerability of this kind. The C code for request startup, POST parsing, and file uploads was written more than twenty years ago. Expect more bugs in the server-side code of PHP. The less of this code stands between the network and your application, the smaller the attack surface. RoadRunner and the Dispatcher mode in Rapira parse HTTP outside PHP. For applications that need classic PHP, the main protection is to keep PHP up to date.
