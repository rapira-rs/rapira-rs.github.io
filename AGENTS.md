# Rapira documentation

Rapira is an MIT-licensed PHP application server written in Rust, and this repository contains its multilingual VitePress documentation.

## Content structure

English files are at the repository root. Russian, Spanish, Chinese, and Polish files use the same structure under `ru/`, `es/`, `zh/`, and `pl/`.

```text
index.md                 # Home page
download.md              # Download page
docs/intro/index.md      # Documentation entry page
docs/                    # Documentation pages
blog/                    # Blog index and posts
.vitepress/config.mts    # Navigation and sidebars
.vitepress/locales.ts    # Locale configuration and URL helpers
.vitepress/theme/        # Components, data loaders, and styles
public/blog/             # Blog images
```

English is canonical. Apply each content change to English and all four translations. A correction that changes only translation quality does not require an English change. Translations must keep the complete technical meaning of the English source. Do not translate identifiers, package names, CLI flags, configuration keys, or functional code. You may translate explanatory comments and user-facing text in examples.

When you add a documentation page:

1. Create it in `docs/` and in each locale's `docs/` directory.
2. Add it to every locale sidebar in `.vitepress/config.mts`.
3. Use clean internal links such as `./page` or `/docs/page`. Do not add `.html`.

The documentation entry URL is `/docs/intro/`. No page exists at `/docs/`.

Use `.vitepress/locales.ts` to resolve locales. Use it to build locale URLs. Do not hardcode locale conditions or URLs. Put shared translated UI text in `LocaleConfig`.

## Commits

Follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages. Use `<type>[optional scope]: <description>` for the first line.

## GitHub

Prefer the GitHub CLI (`gh`) for GitHub operations when it is available. This preference does not authorize writes. Keep GitHub operations read-only unless the user explicitly permits a write.

## Writing rule

English content must follow ASD-STE100 Simplified Technical English. Use active voice. Use literal language. Use one term for each meaning.

Limit descriptive sentences to 25 words. Limit procedural sentences to 20 words. Put one instruction in each procedural sentence. Use no more than six sentences in each paragraph.

Do not hard-wrap prose inside a paragraph. Use a blank line to separate paragraphs.

## Page tools

Use VitePress frontmatter to configure pages:

- `title` and `description` set metadata.
- `outline`, `aside`, and `sidebar` control navigation columns.
- `lastUpdated`, `editLink`, `prev`, and `next` control page links.
- `layout` accepts `doc`, `home`, or `page`.
- `faqLevel` controls FAQ placement.
- Home pages use `tagline` and `pitch`.
- Blog posts use `date`, `author`, and `image`.

Pages support standard Markdown and these features:

- Use `::: tip`, `::: info`, `::: warning`, and `::: danger` for callouts.
- Use `// [!code focus]`, `// [!code --]`, and `// [!code ++]` inside code blocks.
- Use `::: code-group` for alternative versions of one example.
- Use `<CodeTabs :tabs="tabs">` and `</CodeTabs>` around examples from related files. Declare `const tabs = [{ name: 'worker.php', slot: 'worker' }]` in `<script setup>`. Add a matching `<template #worker>` block.
- Use fenced `mermaid` blocks for diagrams.
- Use `<Badge type="tip" text="new" />` for badges. The `type` value can be `tip`, `warning`, `danger`, or `info`.
- Use GFM syntax for tables.

`docs/contributing.md` and its translations contain rendered examples. Update those pages when you change an authoring feature.

Use VitePress variables, components, classes, and frontmatter before you add custom CSS. Use theme variables for colors and spacing. Prefix project classes with `rapira-` or the feature name. Verify CSS in light and dark themes.

## FAQ

Use `::: question` for implementation details that are not required for the main procedure:

```md
::: question Can I run the site if I install nothing globally?
Run `npm ci` locally. Then run `npm run dev`.
:::
```

Set FAQ placement in frontmatter:

```yaml
faqLevel: 1       # After each h1 section (default).
faqLevel: 2       # After each h2 section.
faqLevel: 0       # At the end of the page.
faqLevel: false   # Keep questions at their source positions.
```

The implementation is in `.vitepress/faq.ts`. The styles are `.faq-section` and `.faq-item` in `.vitepress/theme/style.css`.

## Adding a blog post

Create the English post as `blog/<page-name>.md`. Create the same post in each locale's `blog/` directory. Do not add posts to a sidebar; the blog list sorts them by date.

Use this frontmatter:

```yaml
---
title: "Post title"
date: 2026-01-01
description: "Short description for the blog list and RSS."
author: Author Name
image: /blog/<page-name>/preview.jpg
---
```

`title`, `date`, and `description` are required. `author` defaults to `Rapira Team`. `image` is optional.

Store images in `public/blog/<page-name>/`. Reference them as `/blog/<page-name>/<file>`. Use a PNG or JPG preview, preferably 1200×630. The thumbnail generator creates `preview.thumb.jpg`. Git ignores generated thumbnails.

## Development and validation

Use Node.js 24. Install the locked dependencies with `npm ci`.

```bash
npm run dev          # Start the development server.
npm run thumbnails   # Generate blog thumbnails.
npm run build        # Generate thumbnails and build .vitepress/dist/.
npm run preview      # Preview the production build.
```

The project has no separate lint script. Run `npm run build` as the complete validation step. It checks the VitePress configuration, Markdown rendering, and internal links. CI runs `npm ci` and `npm run build`.

The build requests current release data from GitHub. Set `GITHUB_TOKEN` if anonymous API requests reach the rate limit.
