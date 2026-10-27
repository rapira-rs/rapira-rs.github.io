---
title: "PHP2Shell 与 RoadRunner"
date: 2026-10-27
description: "PHP2Shell 漏洞（CVE-2026-109618 和 CVE-2026-109619）为什么影响不到 RoadRunner，其他服务器是怎样运行 PHP 的，以及用 WordPress 的项目该怎么办。"
author: Aleksei Gagarin
image: /blog/php2shell/preview.jpg
---

10 月 21 日，PHP 发布了计划外的更新版本 8.5.12、8.4.27、8.3.36 和 8.2.35，修复了两个严重漏洞：[CVE-2026-109618](https://github.com/php/php-src/security/advisories/GHSA-w8hw-w9fx-j79w) 和 [CVE-2026-109619](https://github.com/php/php-src/security/advisories/GHSA-6wmf-4rv5-p3rp)，发现者将其命名为 [PHP2Shell](https://calif.io/php2shell/)。两个漏洞都能让攻击者无需认证即可远程执行代码，CVSS v4 评分为 9.2。研究人员演示了针对 WordPress、Drupal、Joomla、Magento、Nextcloud、Laravel、Symfony 等应用的攻击。

::: details 漏洞并非纸上谈兵
不少人认为 PHP2Shell 太过复杂，难以用于实际攻击。一位 Hacker News 用户决定验证一下，发起了 [stealmybitcoin.com](https://stealmybitcoin.com/) 挑战：一台运行未打补丁 PHP 的服务器上放着一个装有真实比特币的钱包，谁能攻破服务器，币就归谁。10 月 25 日，这个存有 0.025 BTC（约 2000 美元）的钱包被清空。获胜者公开了[分析报告](https://github.com/KillaBoi/StealMyBitcoin-PoC)，讲解了自己构造的利用链：从解析 `multipart` 时超出 `memory_limit` 开始，一直到在存活下来的 PHP worker 中执行命令。LiveOverflow 详细复盘了这次挑战的经过：

<iframe class="video-embed" src="https://www.youtube-nocookie.com/embed/VhNiMWtOutw" title="The $2,000 php2shell Challenge Was Unexploitable" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

不过，这种攻击也谈不上简单。它依赖特定的 PHP 构建，需要在 worker 之间赢得竞态，还要摸清进程内存中的地址，而这些地址在每次启动时都由系统随机分配。在报告作者的测试环境中，攻击 10 次成功了 7 次。[Hacker News](https://news.ycombinator.com/item?id=50224916) 上也有人争论这个测试环境是否贴近现实：其中的 PHP 运行在内置开发服务器 `php -S` 下。这种攻击在高负载的生产环境中能否奏效，目前仍无定论。但再说它不可能实现，已经站不住脚了。
:::

这两个漏洞最值得关注的是它们所在的位置。问题既不在框架代码里，也不在语言的新特性里，而是在 PHP 自身的服务端部分：POST 请求体解析和文件上传。负责解析 `multipart/form-data` 的 `main/rfc1867.c` 早在 1999 年就进了代码仓库，`main/php_variables.c` 则是 2000 年。

::: warning
无论使用哪种服务器，都请升级 PHP。下文讨论的是为什么有些 PHP 运行方式受影响更严重，但这不能成为推迟升级的理由。
:::

## 攻击原理

各种攻击方式的核心思路是一样的：攻击者设法让 PHP 在内存结构只填充了一部分时因 fatal error 退出。最常见的手段是让请求消耗超过 `memory_limit` 的内存，比如在 `multipart` 中构造深度嵌套的表单字段，或者发送未声明长度的请求体：HTTP/1.1 的 chunked 传输，或不带 `Content-Length` 的 HTTP/2。`post_max_size` 检查只看声明的长度，所以这类数据能绕过它。

这些漏洞由安全研究团队 [Calif](https://calif.io/) 与 OpenAI、Wiz 共同发现。Calif 描述了三条攻击路径：

1. **POST 解析。** PHP 在请求启动阶段解析 `application/x-www-form-urlencoded` 或 `multipart/form-data` 请求体时内存耗尽，哈希表中留下一个已计数、但键还没创建的元素。
2. **`session.upload_progress`。** 带文件的 `multipart` 分段会在解析请求体的过程中直接启动会话。fatal error 打断了请求启动，会话没能正常结束，会话数据指向已经释放的内存。
3. **启动后的解码。** fatal error 发生在 `unserialize()`、`session_decode()` 或 `session_start()` 中，此时请求已经启动，应用代码正在执行。解码器的状态仍然指向已释放的内存。这条路径取决于应用本身：应用必须解码攻击者可控的数据。

三种情况下，被破坏的状态本身都无害。真正把它变成代码执行的，是同一个进程接收的下一个请求。只有 PHP 进程在 fatal error 之后存活下来，攻击才能成功。因此，服务器如何运行 PHP、如何把请求交给 PHP，几乎决定了一切。

## 各服务器与 PHP 的交互方式

| 服务器                   | PHP 运行方式            | 由谁解析请求体 | 进程能否在 fatal error 后存活                  | PHP2Shell 结论           |
|--------------------------|-------------------------|----------------|------------------------------------------------|--------------------------|
| Apache + mod_php         | Apache 内部的模块       | PHP            | 能                                             | 存在漏洞，三条路径均可   |
| PHP-FPM                  | 独立进程，FastCGI       | PHP            | 请求启动阶段出错时不能，应用代码中出错时能     | 存在漏洞，路径 3         |
| FrankenPHP               | 内嵌于 Go 服务器        | PHP            | 能，与 mod_php 相同                            | 在受影响列表中           |
| Swoole                   | PHP 扩展                | Swoole         | 不能                                           | 不受影响                 |
| RoadRunner               | 独立的 PHP 进程         | Go             | 不能，RoadRunner 会启动新进程                  | 不受影响                 |
| Rapira [Classic, Worker] | 内嵌于 Rust 服务器      | PHP            | 能，只重启应用                                 | 条件与 mod_php 相同      |
| Rapira [Dispatcher]      | 内嵌于 Rust 服务器      | Rust           | 能，只重启应用                                 | 路径 1 和 2 无法触发     |

**mod_php** 受影响最严重：Calif 演示了在默认配置下对任意 PHP 脚本实现 RCE。

**PHP-FPM** 在请求启动失败时会结束 worker 进程。所以破坏请求启动的路径 1 和 2 在 FPM 上不起作用。路径 3 则可行：解码器中的 fatal error 发生在启动之后，worker 进程仍然存活。Calif 的演示用的恰恰就是 nginx 加 PHP-FPM。

**FrankenPHP** 把 PHP 作为独立的 SAPI 嵌入，调用标准的 `php_request_startup()`，因此请求体由 PHP 自己解析。PHP 已将 FrankenPHP 列入受影响的服务器名单。安全公告指出，FrankenPHP 与 mod_php 一样，即使请求启动失败也会执行请求收尾。FrankenPHP 当天就发布了搭载修复版 PHP 的 [v1.13.2](https://github.com/php/frankenphp/releases)。

**Swoole** 用自己的代码解析 HTTP 和 `multipart`，也不支持 `session.upload_progress`。Swoole 维护者[表示](https://github.com/swoole/swoole-src/issues/6343)这两个 CVE 不影响 Swoole。

**RoadRunner** 同样在 PHP 之外解析 HTTP，而 worker 在 fatal error 后会退出。三条攻击路径在这里都无法触发。下面具体说说原因。

## RoadRunner 如何与 PHP 交互

RoadRunner 既不把 PHP 嵌入自身，也不使用 FastCGI。worker 就是一个运行在 CLI SAPI 下的普通 `php worker.php` 进程。RoadRunner 和 worker 通过 STDIN/STDOUT 或 socket 交换 [Goridge](https://github.com/roadrunner-server/goridge) 协议帧。每一帧由包含长度和校验和的帧头加上数据组成。

HTTP 请求完全由 RoadRunner 的 http 插件处理：接受连接、检查 `max_request_size`、解析 `application/x-www-form-urlencoded` 和 `multipart/form-data`，并把上传的文件保存到临时目录。PHP 拿到的是现成的 DTO：请求上下文（方法、URI、请求头、cookies、解析好的字段、上传文件列表）和请求体。PHP 包 `roadrunner/http` 再据此构建 PSR-7 请求。

这对 PHP2Shell 意味着：

- 路径 1：`rfc1867_post_handler()` 和 `php_std_post_handler()` 根本看不到 HTTP 请求。CLI worker 只启动一次，而且启动时不带请求体。
- 路径 2：`session.upload_progress` 不会执行。
- 路径 3：fatal error 会结束 CLI 脚本，进程也随之退出。RoadRunner 发现 worker 退出后会启动一个新的。被破坏的状态活不到下一个请求。

在这种架构下，PHP 里那套二十多年历史的请求解析代码压根不会运行。管道早在 1973 年就出现在了 Unix 中，从那以后还没有人能把它弄坏。RoadRunner 和 PHP 之间没有共享内存，没有共享线程，也没有什么巧妙的引擎钩子，只有管道里的字节。PHP 进程一旦崩溃，RoadRunner 直接启动一个新进程，下一个请求就会进入一个干净的进程。

我们以前就说过，RoadRunner 的可靠性不输 PHP-FPM。PHP2Shell 事件说明，在安全性上它甚至更胜一筹：FPM 不得不紧急升级的时候，RoadRunner 根本不会运行有漏洞的代码。而且这件事显然还没完。

::: info
PHP 还是值得升级的：这次修复改变了 PHP 在内存不足时的行为。
:::

## 常驻内存的应用

这种架构也有代价：应用必须能在长生命周期的进程中运行。worker 只加载一次框架，之后循环处理请求。静态属性、单例和全局状态会跨请求保留，所以代码不能把请求数据存放在这些地方。

WordPress 做不到这一点。而基于 Symfony、Laravel 和 Yii3 的应用，只要没有滥用静态变量，借助现成的桥接包，多半可以轻松迁移到 RoadRunner：

- Symfony：[Symfony Runtime](https://github.com/php-runtime/runtime) 或 [baldinof/roadrunner-bundle](https://github.com/baldinof/roadrunner-bundle)；
- Laravel：[Laravel Octane](https://laravel.com/docs/octane) 或 [spiral/roadrunner-laravel](https://github.com/spiral/roadrunner-laravel)；
- Yii3：[yiisoft/yii-runner-roadrunner](https://github.com/yiisoft/yii-runner-roadrunner)。

::: info
如果你正要开始一个新项目，不妨看看我们的 [Spiral](https://spiral.dev/) 框架。它从一开始就是为 RoadRunner 打造的，无需桥接、不用妥协，就能在长生命周期的进程中运行。Spiral 开箱即可充分利用 RoadRunner 的各项能力：HTTP、gRPC、队列、键值存储、通过 Centrifugo 实现的 WebSocket、Temporal 以及指标。
:::

## 可我用的是 WordPress！

我们的新项目 [Rapira](/zh/docs/intro/) 是 RoadRunner 之后的下一步。我们用 Rust 认真打磨它，不会把一切都交给 AI。Rapira 自身的架构，以及应用与服务器通信所用的 PHP 契约，在进入正式版之前都要经过多轮评审和基准测试。Rapira 以[三种模式](/zh/docs/execution-modes)之一运行 PHP：Classic、Worker 和 Dispatcher。

**Classic** 适合 WordPress 和老旧代码库。和 php-fpm 一样，每个请求都会重新执行脚本，应用无需重写。Rapira 支持 PHP 8.4 和 8.5，所以迁移到 PHP 8.4+ 这一步还是免不了的。

**Worker** 把应用常驻在内存中，并在每次请求时填充超全局变量。这就是 FrankenPHP worker 模式的模型，只不过没有 CGO，也没有 ZTS 线程：每个 worker 都是一个独立进程，内含一个 NTS 解释器。

**Dispatcher** 是性能最高的模式。它的工作方式与 RoadRunner 相同：应用拿到的是请求对象而不是超全局变量，`multipart` 由 Rust 自己解析。但与 RoadRunner 不同的是，这里没有 Goridge 这一中间层，也没有序列化开销，而且所有 worker 共用主进程的 OPcache。

Yii3 在不同服务器上的基准测试结果（包括 Rapira 的全部三种模式）见 [yii3-benchmarks.github.io](https://yii3-benchmarks.github.io/app-api/)。

::: warning PHP2Shell 与 Rapira
一部分危险请求在 PHP 启动之前就会被 Rapira 拦下。Rapira 会完整缓冲请求体，如果超过 `http.max_body_size_mb` 就返回 `413`。因此，借助 HTTP/1.1 的 chunked 请求体或不带 `Content-Length` 的 HTTP/2 来绕过 `post_max_size` 的做法行不通。

不过在 Classic 和 Worker 模式下，请求体仍由 PHP 自己解析。这就留下了通过嵌套 `multipart` 字段发起攻击的途径：这样的请求体不超过大小限制，但解析时占用的内存会超过 `memory_limit`。
:::

尽量让你的应用能在 Dispatcher 模式下运行。这样不仅能提升性能，还能提高应用的可靠性和安全性。这种做法现在就可以在超级稳定的 RoadRunner 上体验。

实在不行，还有一剂猛药：PHP-FPM 里设置 `pm.max_requests = 1`，或者在 RoadRunner 的池配置里设置 `max_jobs: 1`。每个请求都会拿到一个全新的进程，仿佛梦回 1997 年的 CGI 时代。这话虽是玩笑，安全问题可开不得玩笑。

## 总结

PHP2Shell 不会是这类漏洞的最后一个。请求启动、POST 解析和文件上传的代码是二十多年前用 C 写的，PHP 的服务端部分今后还会不止一次被挖出问题。网络和应用之间夹着的这类代码越少，攻击面就越小。RoadRunner 和 Rapira 的 Dispatcher 模式都在 PHP 之外解析 HTTP。而对于需要传统 PHP 运行方式的应用，最主要的防护手段就是及时升级 PHP。
