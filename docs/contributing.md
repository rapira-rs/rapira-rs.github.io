# Contributing to the docs

This page documents every authoring feature the documentation engine supports — every block below is rendered from the same Markdown you'll write, so keep it handy as a cheat-sheet while editing pages.

To preview your edits, run `npm install` once, then `npm run dev` and open the local URL it prints. Translations live in per-language folders — `ru/`, `es/`, `zh/`, `pl/` — mirroring the English structure, and English is the source of truth.

## Callout blocks

Wrap text in a fenced `:::` container to get a colored, icon-marked callout:

```md
::: tip
Handy advice worth highlighting.
:::
::: info
Neutral, contextual information.
:::
::: warning
Something to watch out for.
:::
::: danger
A real risk — proceed carefully.
:::
```

::: tip
Handy advice worth highlighting.
:::

::: info
Neutral, contextual information.
:::

::: warning
Something to watch out for.
:::

::: danger
A real risk — proceed carefully.
:::

Add your own heading right after the type:

::: tip Pro tip
Give a block a custom title when the default label isn't specific enough.
:::

## Code blocks

Fenced code gets syntax highlighting, a language label, and a copy button:

```rust
fn main() {
    println!("Hello, Rapira!");
}
```

Point the reader at exact lines — highlight, focus, or show a diff with inline markers:

```rust{3}
fn main() {
    let answer = 42;
    println!("The answer is {answer}"); // this line is highlighted
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

Group alternative snippets into tabs:

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

## Diagrams

A fenced `mermaid` block renders as a diagram:

```mermaid
flowchart LR
  A[Write Markdown] --> B{Build}
  B --> C[Static site]
  B --> D[RSS feed]
```

## Tables and badges

Standard Markdown tables just work:

| Feature      | Included |
| ------------ | :------: |
| Callouts     |    ✅    |
| Code groups  |    ✅    |
| Mermaid      |    ✅    |

Inline badges are handy for status labels: <Badge type="tip" text="new" /> <Badge type="warning" text="beta" /> <Badge type="danger" text="deprecated" />.

## Page frontmatter

Set page options in a YAML block at the very top of the file:

```yaml
---
title: Custom title       # overrides the H1 for <title> / og:title
description: Short summary # meta description and og:description
outline: [2, 3]           # the "On this page" menu — see below
aside: false              # hide the right-hand column entirely
lastUpdated: false        # hide the "Updated" timestamp on this page
editLink: false           # hide the "Edit this page" link
prev: false               # hide the footer "previous" link
next:                     # or relabel / redirect a footer link
  text: Blog
  link: /blog/
---
```

The **outline** controls the "On this page" table of contents on the right:

```yaml
outline: [2, 3]   # default — show H2 and H3
outline: deep     # every level, H2–H6
outline: 2        # only H2
outline: false    # hide it
```

Use `layout: home` for a landing page or `layout: page` for a bare page with no sidebar or outline; regular pages use the default `doc` layout.
