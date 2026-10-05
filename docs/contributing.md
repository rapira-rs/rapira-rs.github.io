# Contributing to the docs

This page documents the authoring features of the documentation site.

Use Node.js 24. Run `npm ci` to install the locked dependencies. Then run `npm run dev`. Open the local URL that the command prints. Translation directories have the same structure as the canonical English files.

Run `npm run build` before you submit a change. It generates thumbnails and checks the VitePress configuration, Markdown rendering, and internal links.

## Callout blocks

Put text in a fenced `:::` container to create a callout with a color and icon:

```md
::: tip
Useful advice.
:::
::: info
Neutral, contextual information.
:::
::: warning
A condition that requires attention.
:::
::: danger
A condition that can cause damage.
:::
```

::: tip
Useful advice.
:::

::: info
Neutral, contextual information.
:::

::: warning
A condition that requires attention.
:::

::: danger
A condition that can cause damage.
:::

Write a title after the type, for example `::: tip Specific title`:

::: tip Specific title
Use a custom title when the default label is not specific.
:::

## Code blocks

Fenced code gets syntax highlighting, a language label, and a copy button:

```rust
fn main() {
    println!("Hello, Rapira!");
}
```

Add `{3}` after the language name to highlight line 3. Add a `// [!code focus]` comment at the end of a line to focus it. Add `// [!code --]` or `// [!code ++]` to mark a removed or an added line. The build removes these markers from the output:

```rust{3}
fn main() {
    let answer = 42;
    println!("The answer is {answer}"); // VitePress highlights this line.
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

Put alternative snippets in a `::: code-group` container. Write the tab label in square brackets after the language name, for example `bash [npm]`:

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

## File tabs

A `<CodeTabs>` block shows one tab for each file. It shows the selected file below the tabs. List the tabs in a page `<script setup>` block. Put each example in a `<template>` that matches the tab `slot`.

````md
<script setup>
const appTabs = [
  { name: 'index.php', slot: 'classic' },
  { name: 'worker.php', slot: 'worker' },
  { name: 'rapira.toml', slot: 'config' },
]
</script>

<CodeTabs :tabs="appTabs">

<template #classic>

```php
<?php
require __DIR__ . '/vendor/autoload.php';

echo (new App())->handle($_SERVER['REQUEST_URI']);
```

</template>

<template #worker>

```php
<?php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // The worker creates this object once and reuses it.

$handler = static function () use ($app): void {
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
}
```

</template>

<template #config>

```toml
[http.pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
```

</template>

</CodeTabs>
````

The file name extension selects the tab icon. The component supports `.php`, `.rs`, `.toml`, `.yaml`, `.yml`, `.json`, `.sh`, and `.bash`. Other extensions use a generic file icon. To override the icon, set `icon` to `php`, `rust`, `toml`, `yaml`, `json`, `shell`, or `file`.

The block renders as follows:

<script setup>
const appTabs = [
  { name: 'index.php', slot: 'classic' },
  { name: 'worker.php', slot: 'worker' },
  { name: 'rapira.toml', slot: 'config' },
]
</script>

<CodeTabs :tabs="appTabs">

<template #classic>

```php
<?php
require __DIR__ . '/vendor/autoload.php';

echo (new App())->handle($_SERVER['REQUEST_URI']);
```

</template>

<template #worker>

```php
<?php
require __DIR__ . '/vendor/autoload.php';

$app = new App(); // The worker creates this object once and reuses it.

$handler = static function () use ($app): void {
    echo $app->handle($_SERVER['REQUEST_URI']);
};

while (\Rapira\handle_request($handler)) {
}
```

</template>

<template #config>

```toml
[http.pool]
entrypoint = "worker.php"
mode = "worker"
processes = 4
```

</template>

</CodeTabs>

## Diagrams

A fenced `mermaid` block renders as a diagram:

```mermaid
flowchart LR
  A[Write Markdown] --> B{Build}
  B --> C[Static site]
  B --> D[RSS feed]
```

## Tables and badges

Standard Markdown creates tables:

| Feature      | Included |
| ------------ | :------: |
| Callouts     |    ✅    |
| Code groups  |    ✅    |
| Mermaid      |    ✅    |

Use the `<Badge>` component to show a status label, for example `<Badge type="tip" text="new" />`. The `type` value can be `tip`, `warning`, `danger`, or `info`:

<Badge type="tip" text="new" /> <Badge type="warning" text="beta" /> <Badge type="danger" text="deprecated" /> <Badge type="info" text="info" />

## FAQ blocks

Use a `::: question` block for an implementation detail that the main procedure does not need. Write the question after `question`:

```md
::: question Can I run the site if I install nothing globally?
Run `npm ci` locally. Then run `npm run dev`.
:::
```

The build collects the questions into a section of collapsible items. Set the position of the section with the `faqLevel` frontmatter key:

```yaml
faqLevel: 1       # After each h1 section (default).
faqLevel: 2       # After each h2 section.
faqLevel: 0       # At the end of the page.
faqLevel: false   # Keep questions at their source positions.
```

This page uses the default level. Thus, the rendered example is at the end of the page.

::: question Can I run the site if I install nothing globally?
Run `npm ci` locally. Then run `npm run dev`.
:::

## Page frontmatter

Set page options in a YAML block at the very top of the file:

```yaml
---
title: Custom title        # Replaces the H1 in <title> and og:title.
description: Short summary # Sets the meta description and og:description.
outline: [2, 3]            # Sets the "On this page" menu. See the options below.
aside: false               # Hides the right column.
lastUpdated: false         # Hides the "Updated" time on this page.
editLink: false            # Hides the "Edit this page" link.
prev: false                # Hides the "previous" footer link.
next:                      # Changes the label or target of a footer link.
  text: Blog
  link: /blog/
---
```

The **outline** controls the "On this page" table of contents on the right:

```yaml
outline: 2        # Default. Shows only H2.
outline: [2, 3]   # Shows H2 and H3.
outline: deep     # Shows each level from H2 through H6.
outline: false    # Hides the menu.
```

Use `layout: home` for a home page. Use `layout: page` for a page without a sidebar or outline. Other pages use the default `doc` layout.
