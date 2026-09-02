---
title: 框架集成
description: "在 Rapira 上运行的每个框架都共通的机制：worker 循环、单请求状态与常驻状态、错误处理、静态文件和 OPcache。"
---

# 框架集成

经典模式下，框架应用无需任何改动就能跑在 Rapira 上：让服务器指向你现成的前端控制器即可。worker 模式下 PHP 进程在两次请求之间保持存活，而应用能常驻多少东西，取决于框架自身的设计。这一页讲的是不管用哪个框架都一样的那部分机制；后面三份分框架的指南默认你已经读过本页，只讲各自特有的部分。

::: info 验证环境

- **PHP 8.5.8**，NTS，embed SAPI
- **Rapira 0.8.0**
- **Symfony 7.4.15** 和 **8.1.2**、**Yii3** 应用模板 1.4（yii-runner-http 3.2.1）

本页的每一条结论，都来自在 Linux 上用单个 worker 进程实际跑这些应用观察到的结果。下面凡是讲框架行为的说法，都以这些实测为依据；配置键则来自 Rapira 自己的[配置](/zh/docs/configuration)参考。
:::

## 经典模式与 worker 模式

**经典模式下，什么都不变。**你的前端控制器就是入口脚本，Rapira 每来一个请求就把它从头跑一遍，凡是能在 php-fpm 下跑的框架，在这里照样跑，包括那些状态根本撑不过第二个请求的。更多内容见[经典模式](/zh/docs/classic)；下面几节里，只有静态文件、TLS 和 OPcache 适用于经典模式。

**Worker 模式下，进程不会退出。**脚本把应用启动一次，然后待在循环里，一遍遍向 Rapira 要下一个请求。框架不再在两次请求之间被拆掉。这个模式在三种模式中处于什么位置，见[执行模式](/zh/docs/execution-modes)；它的 API 参考见 [Worker 模式](/zh/docs/worker)。

同一份代码可以跑在两种模式下：`public/index.php` 原样留着，在旁边加一个 `worker.php`。验证过的 Symfony 和 Yii3 应用都是两个文件并存，跑哪一个由 `--mode` 参数选定：`rapira serve --mode classic public/index.php` 或者 `rapira serve --mode worker worker.php`。所以迁移期间经典模式一直是随时可用的回滚方案。

## 逐行读这个循环

不管里面装的是哪个框架，worker 脚本都长同一个样：

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // booted once, reused for every request

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
    gc_collect_cycles();
}
```

从上往下读：

- **`require .../vendor/autoload.php`**——自动加载器在 worker 的一生里只注册一次，它解析过的每个类此后都留在内存里。
- **`$app = new App();`**——应用在这里启动，只启动一次，而且在循环开始之前。两份 worker 指南的分歧从这一行开始：Symfony 在这里保留一个常驻的内核，Yii3 要么在这里保留一个常驻的 runner，要么在 handler 内部构建一个——每份指南在循环之上还有各自的引导代码，handler 内部也有各自的单请求清理。
- **`$handler = static function () use ($app): void`**——handler 不接收任何参数。请求就在超全局变量里；它还需要别的什么，用 `use` 捕获进去。
- **`header()`、`http_response_code()`、`echo`**——响应的写法和经典脚本一模一样。这些东西怎么变成网络上的字节，见 [HTTP](/zh/docs/http)。
- **`while (\Rapira\handle_request($handler))`**——`handle_request()` 会一直阻塞到请求到来，为这个请求填好超全局变量，跑你的 handler，把请求收尾，然后返回 `true`。worker 开始排空时它返回 `false`，循环也就是这样结束的。它只能在启动脚本的顶层调用；在 Worker 模式之外调用会抛出 `Rapira\Exception\NotInWorkerModeError`。
- **`gc_collect_cycles();`**——循环体跑在两次请求*之间*，凡是应当发生在一个可预期的时刻、而不是在处理请求过程中的活儿，都该放在这里。它回收的是普通的循环引用，并不是内存增长的解决办法——见[内存与回收](#内存与回收)。

入口脚本是 `worker.php`，于是 `SCRIPT_NAME` 是 `/worker.php`，`DOCUMENT_ROOT` 是它所在的目录，而客户端真正请求的路径在 `REQUEST_URI` 里。Symfony 和 Yii3 在这个前提下都能正确路由、正确生成 URL，生成出来的 URL 里没有 `worker.php`，也不需要给 `$_SERVER` 打任何补丁。如果某个框架是拿 `SCRIPT_NAME` 而不是 `REQUEST_URI` 拼 URL，那这就是首先要检查的情况。

## 单请求状态与常驻状态

左边一列的东西 Rapira 每个请求都会重建，所以读它们的普通 PHP 代码照常工作。右边一列的东西在 worker 的整个生命周期里一直存在，得由 worker 脚本自己管理。

| 每个请求都是全新的 | 跨请求留下来的 |
| ------------------ | -------------- |
| `$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE`——用这次请求的数据重新填好 | Composer 自动加载器，以及通过它加载过的每一个类 |
| `php://input`——这次请求的原始请求体，旁边配好 `CONTENT_TYPE` 和 `CONTENT_LENGTH` | `static` 属性和静态变量，它们会跨请求一路累加 |
| `$_FILES`，以及它背后那些上传的临时文件 | 循环之前创建的对象——容器、内核、你的应用 |
| session 那一套：`session_start()`、进来的 cookie、出去的 `Set-Cookie` | 已经打开的资源：数据库句柄、缓存客户端、流 |
| 响应状态：状态码、响应头、`setcookie()`、输出缓冲区 | 进程本身——同一个 pid，每个 worker 一个常驻的 PHP 解释器 |
| 在 handler **内部**注册的 shutdown 函数 | worker 自己的计数器：`handled` 和 `errors` 会持续累加 |
| `max_execution_time` 的计时，每个请求重新起算 | |

在 Linux（以及 FreeBSD）上，Zend 的单请求计时器是存在的，`max_execution_time` 的计时会为每个请求重新起算，worker 停下来等下一个请求的那段时间从不计入其中，只有请求本身在计时。其他平台上——包括 macOS——根本不会设置单请求超时。

下面三种行为是常驻 PHP 的性质，跟 Rapira 无关。三种都经过验证，三种都出现在启动阶段。

::: warning 常驻对象的析构函数在第一个请求结束时就跑了

给一个在循环*之外*创建的对象写上用户态的 `__destruct`，它是会跑的——就一次，在**第一个**请求结束时，PHP 在请求关闭阶段遍历对象存储的那一刻。对象本身之后完好无损：还是那个对象，方法照样能调，而析构函数再也不会触发，后续请求不会，worker 关闭时也不会。

因此，一个在析构函数里关句柄、刷缓冲区或者写一行“再见”日志的类，只会在第一个请求结束时执行一次，此后进程的余生里再也不执行。凡是打算常驻的东西，都别把清理逻辑放进析构函数。
:::

::: warning 启动阶段的 `register_shutdown_function()` 只跑一次，之后再也不跑

在 handler 之外调用时，回调会在第一个请求结束时执行，然后就被释放掉；之后的请求都不会再跑它。在 handler *内部*注册，它的行为和 php-fpm 下完全一致：每个请求结束时都跑一次，每个请求都跑。

如果你的启动流程会装一个 shutdown 处理器——刷指标、兜住致命错误、关掉什么东西——那就改成在 handler 里面注册，每转一圈循环注册一次。
:::

::: warning `$_ENV` 会在请求中途被悄悄重建

在默认的 ini 设置下（`variables_order = "GPCS"`、`auto_globals_jit = On`），PHP 每个请求都会重新给 `$_ENV` 挂上 JIT 标记。这次请求里第一个提到 `$_ENV` 的文件一被编译，PHP 就会重建这个超全局变量——而 `variables_order` 里没有 `E`，就没有任何东西可导入，于是重建出来的 `$_ENV` 是**空的**：Dotenv 那类启动流程在 worker 启动时写进去的一切，都在请求中途丢失，而 PHP 不会给出任何诊断信息。

这个效应取决于文件*什么时候*被编译。框架在启动阶段就急切解析掉的配置早已缓存好，工作正常；而任何拖到第一个请求才延迟解析的东西，读到的都是刚被清空的 `$_ENV`。同一个应用在一个环境里一切正常、在另一个环境里每个请求都 500，原因往往就在这里。

有两种绕开的办法。第一种经过验证：让启动流程把这些值同时写进真正的环境变量——`putenv()` 扛得住这次重建，而会回退到 `getenv()` 的框架就能找到它们。生产环境里优先用第二种：把真正的环境变量写在 unit 文件或者容器里，别再在运行时解析 `.env`。两条路都不会往 `$_ENV` 里放回任何东西——在 `GPCS` 下，不管环境变量是怎么设进去的，它都是空的，能看到这些值的是 `getenv()`。具体的故障现场和那行一句话的修复，见 [Symfony 指南](/zh/docs/frameworks/symfony)。

任何让进程跨请求活着的 PHP 运行时都会撞上这一点。
:::

## 错误处理

三种出错形态，全都是盯着单个 worker、跟踪它的 pid 观察出来的：

- **handler 里的 `exit` 或 `die`**——响应会刷给客户端，状态码和已经产出的响应体都在里面，worker 继续服务。框架在正常运行中就会这么做——比如维护模式检查以 `exit` 结束请求——而这对进程来说并不致命。
- **未捕获的异常**——一个 `500`。如果框架自己的错误处理器先接住了它，就渲染出自己的错误页；如果没有任何东西接住，Rapira 就用空的响应体应答 `500`。无论哪种情况，worker 都继续服务。
- **未捕获的 `Error`**——比如调用了一个不存在的函数。PHP 会以 `Uncaught Error` 把它记下来；它走的路径和其他未捕获的 throwable 一样——一个 `500`，worker 照旧在同一个 pid 上继续服务。

后两种形态会让 worker 的 `errors` 往上走；`exit` 那个请求是普通的 `200`，只动 `handled`。三种情况下 `recycles` 和 `restarts` 都停在零：未捕获的 throwable 既不会把 worker 带走，也碰不到下一个请求。只有 bailout 级的致命错误做得更多——它会让常驻脚本直接终止，于是 worker 从头把它重跑一遍，你的应用也随之重新启动，`recycles` 数的就是这件事。[进程模型](/zh/docs/process-model)页里那份状态快照，会把这几个计数逐个 worker 打印出来。

## 静态文件

Rapira 用[静态文件中间件](/zh/docs/static-files)提供静态资源。把 `[http.static]` 里的 `root` 指向框架的 `public/` 目录，再在 `[http]` 里把中间件列出来：

```toml
[http]
middleware = ["static"]

[http.static]
root = "public"
```

只有路径在这个根目录下确实对应到一个文件时，中间件才会应答。它默认的 `forbid` 列表把 `.php` 文件挡在外面，所以 `public/` 里的前端控制器绝不会被当作文件发出去。其余的 URL 照旧跑入口脚本，经典模式和 Worker 模式下都是如此，客户端想去哪儿由 `$_SERVER['REQUEST_URI']` 告诉应用。目录 URL 同样跑入口脚本，因为这个中间件不为它提供任何索引文件。

当然，也可以让前面的 CDN 或反向代理来提供这些资源，[生产环境部署](/zh/docs/deployment)里就搭了这么一层代理。

## TLS 与代理

Rapira 的监听器只说明文 HTTP，配置里也没有 TLS 这一段。让 TLS 在你已经在跑的那层代理上终结，再由它通过环回地址或者 Unix socket 连到 Rapira。代理必须把转发字段的名字用 `-` 连接，绝不要用 `_`，因为两种写法会折叠到同一个 `$_SERVER` 键上。这套映射见 [HTTP](/zh/docs/http)，代理的具体配置见[生产环境部署](/zh/docs/deployment)。

## 内存与回收

在 handler 里重建应用的 worker——也就是 Yii3 两种写法里较简单的那种——常驻的东西比 Symfony 那种内核少，但比经典模式多，而且循环就在你自己的脚本里，所以可以随着确认哪些内容能挺过第二个请求，一块一块地把工作挪出 handler。这种写法给不了你的，是一个在请求到来时就已经造好的容器。

这种写法下，每个请求都会丢下一整张废弃的对象图。PHP 不会一个一个把它们收走：它们被循环引用拴在一起，于是堆内存随着请求一路增长，直到循环回收器跑起来，一次性收掉一大批。这是锯齿，不是泄漏，但这条锯齿的峰值比任何单个请求的内存占用都高出不少。

自己调 `gc_collect_cycles()` 也无法消除它——放在循环里调和放在 handler 里调都验证过了。旧的对象图在下一次启动把它们释放掉之前一直被强引用着，所以回收器还没有东西可收。由此有两条结论。一是给 `memory_limit` 留出真正的余量，因为要装得下的是峰值，不是平均值。二是设一个回收配额：

```toml
[pool]
max_requests = 100
```

worker 处理够这么多请求就结束（另外加一点抖动，免得整个进程池同时轮换），master 再 fork 一个顶上，新进程从一张干净的堆开始。几百个连续请求、跨越好几轮回收，都验证过：worker 正常轮换，内存每一轮都重置回去，没有一个请求被丢掉，也没有一个请求的应答不是 `200`。对于一条本来完全交给回收器决定的内存曲线，它是一个确定性的上界。

常驻式的写法——Symfony 的内核、Yii3 那个藏在 `StateResetter` 后面的容器——相比之下是平的：同样的跑法下内存一直很稳。对它们也把回收开着，作为一层保障。配置项见[配置](/zh/docs/configuration)，回收对进程池意味着什么见[进程模型](/zh/docs/process-model)。

## OPcache 与改动过的代码

Rapira 只启动一次 PHP，在 master 里，而且是在 fork 出任何一个 worker *之前*——所以 OPcache 的共享内存段只创建一次，每个 worker 继承的都是同一份映射。编译好的脚本既跨请求、*也*跨整个进程池保持热度，两种模式下都是如此。worker 重新 include 框架的文件时，并不会重新解析它们。

生产环境里，`opcache.validate_timestamps = 0` 能省掉每个请求对每个文件的那次 stat。代价是再也没有东西会让缓存失效：那个内存段属于 master，比任何一代 worker 都活得久，于是滚动重载只会接着吐旧的 opcode，部署得整个重启才行。具体步骤见[生产环境部署](/zh/docs/deployment)。

开发的时候，同样的结果来自另一个原因。不管 OPcache 在干什么，一个常驻的启动流程都不会去重读它启动时加载的代码：改动容器已经造好的服务，或者改动 worker 脚本本身，都传不到跑着的进程里。每改一次就重启一次——`rapira serve` 跑在前台，从不 daemonize，所以 Ctrl-C 之后再跑一遍就是了。

## 框架指南

- **[Symfony](/zh/docs/frameworks/symfony)**——内核只启动一次，之后一直常驻，框架自带的 `services_resetter` 会在两次请求之间把有状态的服务恢复原样。同一个 worker 文件一字不差地同时适用于 7.4 和 8.1。
- **[Laravel](/zh/docs/frameworks/laravel)**——经典模式：原装的 `public/index.php` 原封不动就能跑。Laravel 的 worker 模式还在开发中——常驻的 Laravel 应用需要 Octane 实现的那套状态复原，而 Rapira 目前还没有 Octane driver。
- **[Yii3](/zh/docs/frameworks/yii3)**——容器常驻，每个请求通过 `StateResetter` 重置一次，这本来就是 Yii3 为长期运行的进程设计的方案（它的 RoadRunner runner 也是这个形状）；如果你更想从简单的起步，也可以每个请求起一个全新的 runner。

这些指南都没覆盖到的框架，用的是同一个 worker 脚本，而它能不能跑在 worker 模式下，取决于应用能否在同一个进程里处理第二个请求。可以从在 handler 里重建应用这种写法起步，因为它对框架没有任何要求；之后再过渡到常驻应用加每请求重置状态的写法。如果两种写法都不行，[经典模式](/zh/docs/classic)原封不动就能跑这个应用。
