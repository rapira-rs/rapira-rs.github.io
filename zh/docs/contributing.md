# 参与文档贡献

想帮忙改进 Rapira 文档吗？太好了。本页实时展示了文档引擎的全部能力——下面的每个区块都由你会写的同样的 Markdown 生成，编辑页面时可以把它当作速查表。

## 提示块

用 `:::` 容器包裹文本，就能得到带颜色和图标的提示块：

```md
::: tip
值得强调的实用建议。
:::
::: info
中性的补充信息。
:::
::: warning
需要留意的地方。
:::
::: danger
真正的风险——请谨慎操作。
:::
```

::: tip
值得强调的实用建议。
:::

::: info
中性的补充信息。
:::

::: warning
需要留意的地方。
:::

::: danger
真正的风险——请谨慎操作。
:::

在类型后面可以直接写自定义标题：

::: tip 小贴士
当默认标签不够贴切时，给区块起一个自己的标题。
:::

## 代码块

围栏代码块会获得语法高亮、语言标签和复制按钮：

```rust
fn main() {
    println!("Hello, Rapira!");
}
```

把读者的注意力引到具体的行——高亮、聚焦，或展示改动：

```rust{3}
fn main() {
    let answer = 42;
    println!("The answer is {answer}"); // 这一行被高亮
}
```

```rust
fn main() {
    let ready = true;      // [!code focus]
    println!("{ready}");
}
```

```rust
fn setup() {
    let retries = 1;       // [!code --]
    let retries = 3;       // [!code ++]
}
```

把同一命令的不同写法收进选项卡：

::: code-group

```bash [npm]
npm install
```

```bash [pnpm]
pnpm install
```

```bash [yarn]
yarn
```

:::

## 图表

`mermaid` 代码块会渲染成图表：

```mermaid
flowchart LR
  A[编写 Markdown] --> B{构建}
  B --> C[静态站点]
  B --> D[RSS 订阅源]
```

## 表格与徽章

普通的 Markdown 表格开箱即用：

| 功能          | 是否内置 |
| ------------- | :------: |
| 提示块        |    ✅    |
| 代码分组      |    ✅    |
| Mermaid       |    ✅    |
| FAQ 折叠      |    ✅    |

行内徽章很适合标注状态：<Badge type="tip" text="新" /> <Badge type="warning" text="测试版" /> <Badge type="danger" text="已弃用" />。

## 页面 frontmatter

在文件最顶部的 YAML 块中设置页面选项：

```yaml
---
title: 自定义标题         # 覆盖 H1，用于 <title> / og:title
description: 简短摘要      # meta description 和 og:description
outline: [2, 3]           # “本页目录”菜单——见下文
aside: false              # 完全隐藏右侧栏
lastUpdated: false        # 隐藏本页的“最后更新于”时间
editLink: false           # 隐藏“编辑此页面”链接
prev: false               # 隐藏页脚的“上一页”链接
next:                     # 或者重命名 / 重定向页脚链接
  text: 博客
  link: /zh/blog/
faqLevel: 2               # ::: question 块的收集位置（见上文）
---
```

**outline** 控制右侧的“本页目录”：

```yaml
outline: [2, 3]   # 默认——H2 和 H3
outline: deep     # 所有层级，H2–H6
outline: 2        # 仅 H2
outline: false    # 隐藏
```

落地页用 `layout: home`，没有侧边栏和目录的空白页用 `layout: page`；普通页面使用默认的 `doc` 布局。

## 问答（FAQ 折叠）

在页面的任何位置写一个 `::: question` 块：

```md
::: question 如何在本地运行站点？
先 `npm install` 一次，再 `npm run dev`。
:::
```

引擎会把文中所有问题抽取出来，折叠收纳到章节末尾——就像下面这样。

它们出现在哪里由你决定：在页面 frontmatter 中设置 `faqLevel`：

```yaml
---
faqLevel: 1       # 默认——每个 H1 章节的末尾（通常就是页面末尾）
faqLevel: 2       # 每个 H2 章节的末尾
faqLevel: 0       # 页面最末尾，忽略标题
faqLevel: false   # 不分组——每个问题就留在你书写的位置
---
```

::: question 如何在本地运行站点？
先执行一次 `npm install`，然后运行 `npm run dev`，打开它输出的本地地址即可。
:::

::: question 翻译放在哪里？
每种语言都有自己的目录——`ru/`、`es/`、`zh/`、`pl/`——结构与英文版一致。英文是内容的基准。
:::
