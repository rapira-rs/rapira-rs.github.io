---
title: 框架集成
description: Symfony、Laravel 或 Yii3 应用跑在 Rapira 上会有什么变化——worker 循环、两次请求之间哪些东西是全新的、哪些会留下来，以及一个常驻的 PHP 进程带来的那些坑。
---

# 框架集成

把框架应用跑到 Rapira 上，算不上移植。经典模式下甚至算不上改动：让服务器指向你现成的前端控制器，它就跑起来了。真正有意思的是 worker——PHP 进程在两次请求之间不退出，而框架也正是从这里开始有了自己的脾气。这一页讲的是共通的那一半：不管用哪个框架，机制都一样。后面三份分框架的指南默认你已经读过本页，只讲各自特有的部分。

::: info 验证环境

- **PHP 8.5.8**，NTS，embed SAPI
- **Rapira 0.6.0**
- **Symfony 7.4.15** 和 **8.1.2**、**Laravel 13.23.0**、**Yii3** 应用模板 1.4（yii-runner-http 3.2.1）

本页的每一条结论，都来自在 Linux 上用单个 worker 进程实际跑这些应用观察到的结果。有些说法听着不太顺耳，它们写在这里是因为确实测出来是这样，而不是因为听上去合理。
:::

## 把框架跑在 Rapira 上意味着什么

**经典模式下，什么都不变。**你的前端控制器就是入口脚本，Rapira 每来一个请求就把它从头跑一遍，凡是能在 php-fpm 下跑的框架，在这里照样跑——包括那些状态根本撑不过第二个请求的。如果你打算从这儿起步，该看的是[经典模式](/zh/docs/classic)；本页接下来只有最后三节——不从磁盘提供静态文件、TLS、OPcache——还跟你有关。

**到了 SAPI Worker 这一级，进程不再退出。**脚本把应用启动一次，然后待在循环里，一遍遍向 Rapira 要下一个请求。框架不会在两次请求之间被拆掉——一句话说完了全部好处，也说完了全部风险，而本页余下的篇幅讲的就是它意味着什么。这一级在阶梯上处于什么位置，见[执行模式](/zh/docs/execution-modes)；它的 API 参考是 [Worker 模式](/zh/docs/worker)。

## 逐行读这个循环

不管里面装的是哪个框架，worker 脚本都长同一个样：

```php
<?php
// worker.php
require __DIR__ . '/vendor/autoload.php';

use Rapira\Plugin\Http\HttpHandlerConfig;
use function Rapira\create_plugin_handler;

$http = create_plugin_handler(new HttpHandlerConfig());
$app = new App(); // booted once, reused for every request

$handler = static function () use ($app): void {
    header('Content-Type: text/plain');
    http_response_code(200);
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while ($http->handleRequest($handler)) {
    gc_collect_cycles();
}
```

从上往下读：

- **`require .../vendor/autoload.php`**——自动加载器在 worker 的一生里只注册一次，它解析过的每个类此后都留在内存里。光是这一条，就已经是你换来的大部分收益。
- **`create_plugin_handler(new HttpHandlerConfig())`**——向 Rapira 要一个 handler；真正决定选用哪个插件的，是配置对象的*类*。在经典模式下它会抛异常，因为那里没有常驻循环，handler 交不出去。
- **`$app = new App();`**——你的启动过程，只在起步时付一次。三份框架指南的分歧全都落在这一行上，别处并无二致：常驻的内核写在这里，每请求重建的应用不写在这里。
- **`$handler = static function () use ($app): void`**——handler 不接收任何参数。请求就在超全局变量里；它还需要别的什么，用 `use` 捕获进去。
- **`header()`、`http_response_code()`、`echo`**——响应的写法和经典脚本一模一样。这些东西怎么变成网络上的字节，见 [HTTP](/zh/docs/http)。
- **`while ($http->handleRequest($handler))`**——`handleRequest()` 会一直阻塞到请求到来，为它填好超全局变量，跑你的 handler，把请求收尾，然后返回 `true`。服务器开始关闭时它返回 `false`，循环也就是这样结束的。
- **`gc_collect_cycles();`**——循环体跑在两次请求*之间*。凡是你希望发生在一个可预期的时刻、而不是某个请求处理到一半的活儿，都该放在这里。它是对付普通循环引用的日常清理，不是内存问题的解药——见[内存与回收](#内存与回收)。

动手写这个文件之前，有件事值得先知道：入口脚本叫 `worker.php`，于是 `SCRIPT_NAME` 是 `/worker.php`，`DOCUMENT_ROOT` 是它所在的目录，而客户端真正请求的路径在 `REQUEST_URI` 里。三个框架在这个前提下都能正确路由、正确生成 URL，不需要给 `$_SERVER` 打任何补丁。

## 哪些是全新的，哪些会留下来

这张表值得记在脑子里。左边一列 Rapira 每个请求都会重建，所以读它们的普通 PHP 代码照常工作；右边一列，从现在起归你自己管。

| 每个请求都是全新的 | 跨请求留下来的 |
| ------------------ | -------------- |
| `$_GET`、`$_POST`、`$_SERVER`、`$_COOKIE`——用这次请求的数据重新填好 | Composer 自动加载器，以及通过它加载过的每一个类 |
| `php://input`——这次请求的原始请求体，旁边配好 `CONTENT_TYPE` 和 `CONTENT_LENGTH` | `static` 属性和静态变量，它们会跨请求一路累加 |
| `$_FILES`，以及它背后那些上传的临时文件 | 循环之前创建的对象——容器、内核、你的应用 |
| session 那一套：`session_start()`、进来的 cookie、出去的 `Set-Cookie` | 已经打开的资源：数据库句柄、缓存客户端、流 |
| 响应状态：状态码、响应头、`setcookie()`、输出缓冲区 | 进程本身——同一个 pid，每个 worker 一个常驻的 PHP 解释器 |
| 在 handler **内部**注册的 shutdown 函数 | worker 自己的计数器：`handled` 和 `errors` 会一直往上走 |
| `max_execution_time` 的计时，每个请求重新起算 | |

`max_execution_time` 那一行有个细节值得说清楚。在 Linux（以及 FreeBSD）上，Zend 的单请求计时器是存在的，计时会为每个请求重新起算，worker 停下来等下一个请求的那段时间从不计入其中，只有请求本身在计时。其他平台上——包括 macOS——根本不会设置单请求超时。

有三件事的表现会出乎意料。三件都经过验证，三件都在启动阶段咬人，而且三件都是常驻 PHP 的性质，跟 Rapira 无关。

::: warning 常驻对象的析构函数在第一个请求结束时就跑了

给一个在循环*之外*创建的对象写上用户态的 `__destruct`，它是会跑的——就一次，在**第一个**请求结束时，PHP 在请求关闭阶段遍历对象存储的那一刻。对象本身之后完好无损：还是那个对象，方法照样能调，而析构函数再也不会触发，后续请求不会，worker 关闭时也不会。

所以，一个在析构函数里关句柄、刷缓冲区或者写一行“再见”日志的类，会在你背后早早地干这一次，此后进程的余生里再也不干了。凡是打算常驻的东西，都别把清理逻辑放进析构函数。
:::

::: warning 启动阶段的 `register_shutdown_function()` 只跑一次，之后再也不跑

在 handler 之外调用时，回调会在第一个请求结束时执行，然后就被释放掉。第二个请求不会跑它，第一千个也不会。在 handler *内部*注册，它的行为和 php-fpm 下完全一致：每个请求结束时都跑一次，每个请求都跑。

如果你的启动流程会装一个 shutdown 处理器——刷指标、兜住致命错误、关掉什么东西——那就改成在 handler 里面注册，每转一圈循环注册一次。
:::

::: warning `$_ENV` 会在请求中途被悄悄重建

在默认的 ini 设置下（`variables_order = "GPCS"`、`auto_globals_jit = On`），PHP 每个请求都会重新给 `$_ENV` 挂上 JIT 标记。这次请求里第一个提到 `$_ENV` 的文件一被编译，PHP 就会重建这个超全局变量——而 `variables_order` 里没有 `E`，就没有任何东西可导入，于是重建出来的 `$_ENV` 是**空的**，Dotenv 那类启动流程在 worker 启动时写进去的一切，就在请求中途消失了，既没有警告也没有报错。

麻烦之处在于，它取决于文件*什么时候*被编译。框架在启动阶段就急切解析掉的配置早已缓存好，看上去一切正常；而任何拖到第一个请求才延迟解析的东西，读到的都是刚被清空的 `$_ENV`。同一个应用在一个环境里一切正常、在另一个环境里每个请求都 500，原因往往就在这里。

有两条出路。第一条经过验证：让启动流程把这些值同时写进真正的环境变量——`putenv()` 扛得住这次重建，而会回退到 `getenv()` 的框架就能找到它们。第二条本来就是生产环境更好的答案：把真正的环境变量写在 unit 文件或者容器里，别再在运行时解析 `.env`。两条路都不会往 `$_ENV` 里放回任何东西——在 `GPCS` 下，不管环境变量是怎么设进去的，它都是空的，能看到这些值的是 `getenv()`。具体的故障现场和那行一句话的修复，见 [Symfony 指南](/zh/docs/frameworks/symfony)。

这不是 Rapira 的怪癖。任何让进程跨请求活着的 PHP 运行时都会撞上它。
:::

## 出问题的时候

三种出错形态，全都是盯着单个 worker、跟踪它的 pid 观察出来的：

- **handler 里的 `exit` 或 `die`**——响应会刷给客户端，状态码和已经产出的响应体都在里面，worker 继续服务。框架用这一手比你以为的多（Laravel 的维护模式检查就以 `exit` 收尾），所以“它不会要了进程的命”这一点很重要。
- **未捕获的异常**——一个 `500`。实际上多半是框架自己的错误处理器先接住它，渲染出自己的错误页；要是没人接，Rapira 就用空的响应体应答 `500`。无论哪种情况，worker 都继续服务。
- **未捕获的 `Error`**——比如调用了一个不存在的函数。PHP 会以 `Uncaught Error` 把它记下来；它走的路径和其他未捕获的 throwable 一样——一个 `500`，worker 照旧在同一个 pid 上继续服务。

后两种形态会让 worker 的 `errors` 往上走；`exit` 那个请求是普通的 `200`，只动 `handled`。三种情况下 `recycles` 和 `restarts` 都停在零：未捕获的 throwable 既不会把 worker 带走，也碰不到下一个请求。慌慌张张翻错误日志之前，先知道这一点。只有 bailout 级的致命错误做得更多——它会让常驻脚本直接终止，于是 worker 从头把它重跑一遍，你的应用也随之重新启动，`recycles` 数的就是这件事。想在 PHP 里读到这些计数，用 [Worker 模式](/zh/docs/worker)页里的 `getInfo()`。

## Rapira 不从磁盘提供任何内容

这里没有 document root 查找，也没有“文件存在就直接返回文件”这条规则。不管 URL 是什么，跑的都是你的入口脚本，客户端想去哪儿由 `$_SERVER['REQUEST_URI']` 告诉应用——效果等同于 nginx 里那条“把一切重写到 `index.php`”的规则，只是连规则都省了，而且经典模式和 worker 模式下完全一样。

这也意味着静态资源需要有东西挡在前面：一个 CDN，或者[生产环境部署](/zh/docs/deployment)里搭起来的那层反向代理。否则打包好的 JS 和 CSS、图片、favicon——每一个都会变成一次 PHP 请求。

## TLS 与代理

Rapira 的监听器只说明文 HTTP，配置里也没有 TLS 这一段。让 TLS 在你已经在跑的那层代理上终结，再由它通过环回地址或者 Unix socket 连到 Rapira；代理在入站方向唯一要守的规矩是：转发字段的名字用 `-` 连接，绝不要用 `_`，因为两种写法会折叠到同一个 `$_SERVER` 键上。这套映射见 [HTTP](/zh/docs/http)，代理的具体配方见[生产环境部署](/zh/docs/deployment)。

## 内存与回收

如果你的 worker 是在 handler 里重建应用——Laravel 今天就得这么干，Yii3 两种写法里较简单的那种也是——那么每个请求都会丢下一整张废弃的对象图。PHP 不会一个一个把它们收走：它们被循环引用拴在一起，于是堆内存随着请求一路往上爬，直到循环回收器跑起来，一次性收掉一大批。这是锯齿，不是泄漏，但这条锯齿的峰值比任何单个请求的内存占用都高出不少。

自己调 `gc_collect_cycles()` 抹不平它——放在循环里调和放在 handler 里调都验证过了。旧的对象图在下一次启动把它们释放掉之前一直被强引用着，回收器是真的还没东西可收。由此有两条结论。一是给 `memory_limit` 留出真正的余量，因为要装得下的是峰值，不是平均值。二是设一个回收配额：

```toml
[pool]
max_requests = 100
```

worker 处理够这么多请求就退休（另外加一点抖动，免得整个进程池齐刷刷一起换血），master 再 fork 一个顶上，新进程从一张干净的堆开始。几百个连续请求、跨越好几轮回收，都验证过：worker 正常轮换，内存每一轮都重置回去，没有一个请求被丢掉，也没有一个请求的应答不是 `200`。对于这种内存曲线本来完全由回收器说了算的模式，它就是那个确定性的兜底。

常驻式的写法——Symfony 的内核、Yii3 那个藏在 `StateResetter` 后面的容器——相比之下是平的：同样的跑法下内存一直很稳。即便如此，回收作为一张网仍然值得留着。配置项见[配置](/zh/docs/configuration)，回收对进程池意味着什么见[进程模型](/zh/docs/process-model)。

## OPcache 与改动过的代码

Rapira 只启动一次 PHP，在 master 里，而且是在 fork 出任何一个 worker *之前*——所以 OPcache 的共享内存段只创建一次，每个 worker 继承的都是同一份映射。编译好的脚本既跨请求、*也*跨整个进程池保持热度，两种模式下都是如此。worker 重新 include 框架的文件时，并不会重新解析它们。

生产环境里，`opcache.validate_timestamps = 0` 能省掉每个请求对每个文件的那次 stat。代价是再也没有东西会让缓存失效：那个内存段属于 master，比任何一代 worker 都活得久，于是滚动重载只会接着吐旧的 opcode，部署得整个重启才行。具体步骤见[生产环境部署](/zh/docs/deployment)。

开发的时候会遇到同样的结果，只是原因不同。不管 OPcache 在干什么，一个常驻的启动流程都不会去重读它启动时加载的代码——改一个容器已经造好的服务，或者改 worker 脚本本身，跑着的进程都不会察觉。改一次重启一次，你就永远不用去想到底是这两个原因里的哪一个：`rapira serve` 跑在前台，从不 daemonize，所以 Ctrl-C 之后再跑一遍就是了。

## 挑一个框架

- **[Symfony](/zh/docs/frameworks/symfony)**——内核只启动一次，之后一直常驻，框架自带的 `services_resetter` 会在两次请求之间把有状态的服务恢复原样。同一个 worker 文件一字不差地同时适用于 7.4 和 8.1。
- **[Laravel](/zh/docs/frameworks/laravel)**——每个请求重建一个全新的应用，因为这是今天诚实的答案：常驻应用那套是 Laravel 自家的 Octane，而 Rapira 没有 Octane driver。你留住的是预热好的自动加载器和热着的 OPcache，留不住的是容器。
- **[Yii3](/zh/docs/frameworks/yii3)**——容器常驻，每个请求通过 `StateResetter` 重置一次，这本来就是 Yii3 为长期运行的进程设计的方案（它的 RoadRunner runner 也是这个形状）；如果你更想从简单的起步，也可以每个请求起一个全新的 runner。

::: question 我用的框架不在这三个里，还能跑吗？
多半能。worker 脚本就十来行，唯一真正的问题是你的应用扛不扛得住被要求处理第二个请求。先从在 handler 里重建应用开始——这就是 Laravel 的形状，对框架没有任何要求——之后随着你摸清哪些东西留着是安全的，再一点点把它们提到 handler 外面。要是两种都扛不住，[经典模式](/zh/docs/classic)原封不动就能跑它。
:::

::: question 入口脚本叫 `worker.php`，会不会把 URL 生成搞坏？
三个框架都没有。`SCRIPT_NAME` 是 `/worker.php`，真实路径在 `REQUEST_URI` 里，而 Symfony、Laravel 和 Yii3 都能正确路由，生成的 URL 也很干净、里面没有 `worker.php`——任何地方都不需要覆盖 `$_SERVER`。如果你自己的框架是拿 `SCRIPT_NAME` 拼 URL 的，那这就是首先要检查的地方。
:::

::: question 每个请求都重新启动一次，真的比经典模式好吗？
好，只是没有常驻应用那么惊人。自动加载器和已经加载的每个类都留在内存里，不必每次从零重建，而且循环归你掌控——你可以在弄清楚什么东西经得住之后，一块一块地把活儿从 handler 里挪出去。你拿不到的是那个最大的奖品：请求到来时容器已经造好了。
:::

::: question 同一份代码能同时跑两种模式吗？
能，而且这才是靠谱的迁移方式：`public/index.php` 原封不动留着，在旁边加一个 `worker.php`。三个验证过的应用都是两个文件都有。跑哪个由一个参数决定——`rapira serve --classic public/index.php` 还是 `rapira serve worker.php`——所以在你慢慢摸熟 worker 的这段时间里，经典模式一直是随时可用的回滚方案。
:::
