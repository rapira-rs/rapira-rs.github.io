# Rapira Documentation

This repository contains the **Rapira** documentation site. The site uses [VitePress](https://vitepress.dev/). It supports English, Russian, Spanish, Chinese, and Polish.

## What Rapira Is

**Rapira is an MIT-licensed PHP application server written in Rust.** The [`rapira-rs`](https://github.com/rapira-rs) GitHub organization maintains it. The maintainers also maintain RoadRunner.

**Rapira embeds PHP in the server process.** The host calls the interpreter directly. Rapira does not use FastCGI, sockets, serialization, Goridge, or CGO for this call.

**Existing applications continue to work.** The classic SAPI runs an ordinary entry script without code changes. Rapira replaces php-fpm and improves execution speed.

**Rapira has three execution modes:** Classic, Worker, and Dispatcher. These names are the `[pool] mode` values and the `Rapira\Mode` enum cases. Use the exact names in every language. Classic and Worker have documentation. Dispatcher is available, but its guide is not complete. Do not name modes after FrankenPHP or RoadRunner.

- **Classic** - the entry script runs from scratch on every request, exactly as it would under php-fpm.
- **Worker** - the process continues after each request. Rapira refills the superglobals for each request.
- **Dispatcher** - the script gets work units from the dispatcher instead of using superglobals. The script can process one unit at a time. It can also process concurrent units with fibers.

The server makes every mode available to every application. The application code can restrict the available modes. Global state can restrict an application to Classic. A library without fiber support prevents concurrent Dispatcher work. Describe each restriction as a property of the application code.

**Do not rank the modes.** Do not use ladder, rung, or climb metaphors in any language. List the modes without ranking them.

**The home page shows this mode list:** `Classic → Worker → Dispatcher`. The same card asks, "Which modes can your application use?" Put mode descriptions in the documentation.

Configuration selects the mode. The configuration format and PHP API can still change. Describe mode behavior. Verify keys and function names before publication.

**Experienced maintainers design and implement Rapira.** The same maintainers also build RoadRunner. State this fact directly. Do not mention vibe coding. Rapira does not publish performance measurements. Keep speed claims qualitative. Do not invent measurements.

The home page uses the `tagline` and `pitch` fields from each locale's `index.md`. Its `features` block describes direct interoperability, php-fpm compatibility, and execution modes. Write the English text first. Then update every translation.

Use a literal `tagline` in every language. Describe Rapira as a PHP application server written in Rust. Do not use the former *post-modern* wordplay.

## Structure

```
docs/         # English (root)
├── index.md  # Home page (layout: home)
├── download.md # Download page (selector for release data)
├── docs/     # Documentation pages (intro/ holds the entry page + getting started)
├── blog/     # Blog posts + index.md
└── .vitepress/
    ├── config.mts       # Config: nav, sidebar, locales, search, mermaid, RSS
    ├── faq.ts           # ::: question spoilers plugin
    ├── info-block.ts    # ::: block icons plugin
    ├── locales.ts       # Locale + blog path helpers
    ├── rss.ts           # RSS feed generation (build + dev server)
    └── theme/
        ├── index.ts          # DefaultTheme + GitHub stars + blog components
        ├── style.css         # Custom styles (brand colors, typography, blocks, FAQ)
        ├── fonts.css         # @font-face for the self-hosted faces (files in public/fonts/)
        ├── posts.data.ts      # Blog posts data loader
        ├── builds.data.ts     # Release builds data loader (GitHub API at build time)
        ├── GitHubStars.vue
        ├── GitHubIcon.vue      # Shared GitHub mark (nav stars + hero action)
        ├── RapiraHero.vue      # Home page header (wordmark, description, and actions)
        ├── RapiraSection.vue    # Home feature segment (heading, text, aside, footer)
        ├── FeatureTags.vue      # Tag row for segment features (ready/pending)
        ├── TextTabs.vue         # Tab strip over short prose panels
        ├── DownloadBuilds.vue   # Download picker (OS → arch → PHP → format)
        ├── BlogPosts.vue       # Blog index list
        ├── BlogPostHeader.vue  # Per-post hero image + meta
        └── CodeTabs.vue        # Editor-style file tabs around code blocks

ru/           # Russian locale   ┐
es/           # Spanish locale   │ same structure as root:
zh/           # Chinese locale   │ index.md + docs/ + blog/
pl/           # Polish locale    ┘
```

English is the **canonical version**. Every other locale uses the same structure.

The docs sidebar has one locale block for each language in `.vitepress/config.mts`. Every block has the same five groups and items. Only the labels differ.

The `docs/intro/` directory contains the Introduction group. It contains the entry page, Installation, Quickstart, and Build from source. The entry page is `index.md` at `/docs/intro/`. No page exists at `/docs/`. The `getDocsUrl()` function returns the entry URL. All other documentation pages are direct children of `docs/`.

## Style Guide

**Tone:** Use plain technical language that is suitable for new users. Use complete sentences. Explain concepts before code. Address the reader in second person. Refer to software in third person.

**English standard:** Follow ASD-STE100 Simplified Technical English. Use active voice and approved words. Limit descriptive sentences to 25 words. Limit procedural sentences to 20 words. Put one instruction in each sentence. Use one term for each meaning. Use literal language. Do not use idioms, slang, wordplay, or decorative prose.

**Register requirements for English and each translation:**

- **Open with a definition.** Make the product or feature the subject of the first sentence. You can add one scope sentence. Then start the first `##` section. Installation pages can omit the introduction. Do not start with motivation, a problem, or the reader.
- **Use second person only for reader actions and property.** Use "you" for an action that the reader performs. Use "your" only for reader property. Use an article for software property. Replace "your X" with "a X" or "the X" when the meaning does not change. Apply the same test in translations.
- **Use literal language.** Do not use metaphors, analogies, economic framing, personification, punchlines, or wordplay. Prefer `start` to `boot` when both mean initialization. Prefer `cached` to `warm`. Prefer `create a process` to `spin up`. Prefer `compatible replacement` to `drop-in replacement`. Describe cyclic memory use directly instead of using `sawtooth`. Describe a scheduled fallback check instead of a `backstop`.
- **Remove editorial language.** Do not use teasers, narrative transitions, marketing adjectives, rhetorical questions, or dramatic second person. Do not use emphasis words such as "honestly," "actually," or "genuinely."
- **Put background detail in `::: question` blocks.** Keep actions, choices, and decision facts in the main text. Put implementation explanations in a question block. Give each block the question that it answers. Set `faqLevel: 2` so questions collect after the relevant section. See `ru/docs/intro/installation.md` for an example.
- **Qualify only the software state.** Use "currently" or "not yet" when necessary. Do not use "probably", "generally", or similar knowledge hedges.
- **State each limitation as a direct present-tense fact.** Give its workaround in the same paragraph. Do not add an apology or dramatic language.
- **Choices:** Give parallel criteria or one paragraph for each option. State each recommendation and its reason directly.
- **Headings:** noun phrases or gerunds, sentence case. No slogans, full sentences, questions, or second person.
- **Cross-references:** Use the subject noun as the link text. End references with "See [X] for more information." End each page after its last technical item. Use "Next steps" lists only on index pages.
- **Sentence structure:** Use complete sentences and direct connections between sentences. Avoid fragments. Translations must preserve this direct style.

**Code examples:**
- List the options first, then a single code block with all examples (easier to read than many small blocks).
- Keep examples compact. Show the structure when the implementation does not matter.
- Show the contrast between approaches in examples.

**Text structure:**
- Avoid tautology in lists, fix typos.
- Small sections are sometimes better integrated into an existing one.

**Markdown callouts:** Use `::: tip`, `::: warning`, `::: info`, and `::: danger` blocks. Each type has an icon and color.
Use `::: question` for background information. See the Register requirements and the FAQ section.

## Working with Content

**Adding pages:**
1. Create the page in English (`docs/page.md`) **and** in every locale (`ru/docs/page.md`, `es/docs/page.md`, `zh/docs/page.md`, `pl/docs/page.md`).
2. Add the page to the sidebar in `.vitepress/config.mts` for **every** locale block.
3. Use `./page` or `/docs/page` for internal links. Do not add `.html` because `cleanUrls` is on.

**Syncing translations:**
- **CRITICAL:** When changing content (adding sections, examples, explanations), ALWAYS update the English version AND every locale.
- This rule applies to all content changes, including translation fixes.
- If you modify `docs/page.md`, you MUST also update the same page in each locale with a translated version (see the translation guideline at the bottom).
- Exception: fixing only translation quality in one locale does not require touching the English version.

**Dead links:** create a stub with a `::: tip Coming Soon` block rather than leaving a broken link.

## Locale Service

`.vitepress/locales.ts` is the **canonical locale configuration**. It defines the `locales` array and all locale-aware helper functions.

**Always use this service to resolve locales and create locale-specific URLs.** Do not hardcode locale conditions or locale URLs. Hardcoded values do not support new locales.

- Resolve a locale from a URL or src-relative path → `getLocaleByPath(path)`.
- Resolve a locale from a `lang` code (e.g. `useData().lang`) → `getLocaleByCode(code)`.
- Build URLs → `getDocsUrl(locale)`, `getDownloadUrl(locale)`, `getBlogUrl(locale)`, `getFeedFilename(locale)`, `getBlogFolder(locale)`.
- Blog predicates → `isBlogPath(path)`, `isBlogIndexPath(path)`, `getBlogGlobPatterns()`.
- Put shared per-locale UI strings in `LocaleConfig`. Add a field instead of adding `lang ===` maps to components.

The locale service supplies data to `config.mts`, `rss.ts`, and the locale-aware theme components. These consumers update automatically when you add a locale.

## Blog & RSS

English blog posts are in `blog/`. Each translation has a corresponding locale directory. Each locale has a `blog/index.md` file and an RSS feed. The `.vitepress/rss.ts` module creates the feeds during the build and development server startup.

**Adding a post:**
1. Create `blog/my-post.md` for the English post. Create the translated post in each locale directory.
2. Do not add a sidebar entry. The blog list sorts posts by date.

**Required frontmatter:**
```yaml
---
title: "Post Title"
date: 2026-01-01
description: "Short description for the blog list and RSS."
author: Author Name
---
```
- `title`, `date`, `description`: The blog list and RSS use these fields.
- `author`: Optional. The default value is "Rapira Team".
- `image`: Optional. The post header and `og:image` use this field. Omit it when no image exists.

**Post assets structure:** Store all post images in `public/blog/<page-name>/`. Use root-absolute references without the `public/` prefix.
- Preview: Use `public/blog/<page-name>/preview.jpg` and set `image: /blog/<page-name>/preview.jpg`. All locales normally use the same preview. Add a language suffix for a localized image.
- List thumbnail: Put `preview.thumb.jpg` next to the preview. `posts.data.ts` replaces the preview extension with `.thumb.jpg`. The `npm run thumbnails` command creates thumbnails. The build runs this command. Git ignores generated thumbnails. `BlogPosts.vue` uses the full preview when a thumbnail is absent.
- Store article images in the same folder (`img-1.png`, …). Add a language suffix to a locale-specific file, such as `img-2-ru.jpg`.
- `og:image` must be a raster image (PNG or JPG), preferably 1200×630. Social networks do not render SVG.

The theme disables `lastUpdated` and the edit link on blog posts.

## FAQ (`::: question`)

Use `::: question` blocks for implementation explanations in documentation pages and blog posts. The build groups these blocks into collapsible sections. The Register section defines suitable content.

**Syntax:**
```md
::: question Can I run the site without installing anything globally?
Run `npm install` locally. Then run `npm run dev`.
:::
```

**Frontmatter `faqLevel`** controls where questions render:
```yaml
faqLevel: 1       # Default. Insert after each h1 section.
faqLevel: 2       # Insert after each h2 section.
faqLevel: 0       # Insert at the end of the page.
faqLevel: false   # Keep questions at their source locations.
```

**Plugin:** `.vitepress/faq.ts`. **Styles:** `.faq-section`, `.faq-item` in `theme/style.css`.

## Home Page Header

Each locale home page uses `layout: home` without a `hero:` block. The `home-hero-before` slot contains `theme/RapiraHero.vue`. The component shows the RAPIRA wordmark first. It then shows the description and two text links. The links are "Get Started" and "GitHub."

- **Put the page description in frontmatter.** Use `tagline` for the first line and `pitch` for the second line. Both fields are optional. Translators edit these fields in `index.md`.
- `RapiraHero.vue` contains the locale-specific "Get Started" and "Download" labels. The locale service provides their URLs. Add both label entries when you add a locale.
- The header sets `user-select: none`, and the wordmark sets `draggable="false"`. The `.rapira-lede` rule permits text selection for the description.
- The `features:` frontmatter block still renders below the cover as usual.
- Styles: `.rapira-hero*`, `.rapira-lede*` in `theme/style.css`.

## Home Feature Segments

Each home page contains `<RapiraSection>` components after the `features:` cards. Each component has a full-width heading from the `title` property. The optional `eyebrow` property appears above the title. The default slot contains the text. The optional `link` and `link-text` properties add a link. The optional `#aside` slot adds a second column. The optional `#footer` slot adds a row below both columns. Whitespace separates adjacent sections. Add new sections before the sponsors section.

Put all section text, properties, and slot content in `index.md`. Do not put page text in the component. Define data-driven aside items in the page's `<script setup>` block.

Segment building blocks:

- **`FeatureTags`** shows a row of tags in the HTTP section footer. The `ready` property defaults to true. A false value uses a dimmed, dashed tag with a hollow marker. The component does not add a status caption.
- **`.rapira-section-art`** provides an optional image for the aside column. CSS positions the image and hides it in the single-column layout. No section currently uses this class. Keep its CSS for possible future use.
- **`TextTabs`** shows one short text panel for each alternative. Put each panel in a `<template #…>` slot. The `users` field lists products that use the alternative. The component shows these products as tags. All panels share one grid cell to prevent layout movement.

The `.rapira-section*` rules in `theme/style.css` define section styles. Their specificity must exceed `.vp-doc`. Keep aside-specific styles in the component.

**Sponsors block:** Each home page ends with `<div class="sponsors-section">`. It contains the sponsor logo and two links. "Become a Sponsor" links to the locale sponsor page. "Star on GitHub" links to GitHub. Translate the heading and link text in each locale. The `.sponsors-section` and `.sponsor-*` rules define the styles.

## Download Page

Each locale has a `download.md` page. The page selects an operating system, architecture, PHP version, and package format. It then shows a download button and SHA-256 value. The hero uses `getDownloadUrl(locale)` to link to this page.

- **`.vitepress/theme/builds.data.ts` creates release data during the build.** It requests the latest release from the Linux and Windows repositories. It parses each asset name into operating system, architecture, PHP version, and format. It associates each asset with its SHA-256 value. A request failure logs a warning and returns an empty list. The page then links to the releases. A new release appears after the next deployment.
- **`DownloadBuilds.vue` renders the selector.** The page passes all UI strings through the `labels` property. Translators edit `download.md`, not the component.
- Both workflows pass `GITHUB_TOKEN` to the build step. Anonymous requests from shared runner addresses can reach the API limit.

## Custom `:::` Blocks

`.vitepress/info-block.ts` changes blocks that do not have a custom title. It removes the default heading. It adds a `data-*-icon` attribute for the CSS icon. It does not change blocks that have custom titles.

## Markdown Features

Pages can use these features in addition to standard Markdown and `:::` blocks:

- **Code blocks** support syntax highlighting, language labels, copy buttons, and highlighted lines.
- Use inline markers for focused or changed lines: `// [!code focus]`, `// [!code --]`, and `// [!code ++]`.
- Use `::: code-group` for alternative code blocks. Label each fenced block, for example, `` ```bash [npm] ``.
- **File tabs** use the global `<CodeTabs :tabs="…">` component from `theme/CodeTabs.vue`.
- Declare the file list in a page `<script setup>` block with `{ name, slot, icon? }`.
- Put each file example in a `<template #slot>` element.
- The component selects an icon from the file extension in `name`.
- Add a language color in the component when you add support for a new file type.
- Use file tabs for related files. Use `::: code-group` for alternative versions of one example.
- **Mermaid diagrams** use a fenced ```` ```mermaid ```` block.
- **Badges** use `<Badge type="tip|warning|danger|info" text="…" />`.
- **Tables** use standard GFM syntax.

`docs/contributing.md` and its translations contain rendered examples. Update these pages when you change an authoring feature.

## Page Frontmatter

Any page can set these in the YAML block at the top:

- `title`, `description`: Override `<title>`, the meta description, and the `og:` tags.
- `outline`: Configure the right "On this page" menu. Use `[2, 3]`, `deep`, `2`, or `false`.
- `aside: false`: Hide the right column.
- `sidebar: false`: Hide the left sidebar.
- `lastUpdated: false`, `editLink: false`: Hide these items on that page. Blog posts hide them automatically.
- `prev` / `next`: Change a footer link or hide it with `false`.
- `layout`: Use `doc` by default. Use `home` for a home page. Use `page` for no sidebar or outline.
- `faqLevel`: Configure where `::: question` blocks collect. See FAQ above.
- Blog posts additionally use `date`, `author`, `image` (see Blog & RSS).
- Home pages also use `tagline` and `pitch` for the introduction. See Home Page Header.

## CSS & Styling

**Use VitePress features before you write custom CSS.** Keep `theme/style.css` small. Add only styles that the default theme cannot provide.

Use this order before you add a rule:

1. **CSS variables.** VitePress provides variables such as `--vp-c-brand-*`, `--vp-c-bg-soft`, and `--vp-c-divider`.
   Change a variable in `:root` or `.dark` instead of restyling a component.
   Do not set a color, background, or border when a theme variable provides the value.
2. **Built-in theme components.** Import components such as `VPButton`, `VPImage`, `VPBadge`, and `VPTeamMembers` from `vitepress/theme`.
   For example, `theme/RapiraHero.vue` uses `<VPImage>` to select the light or dark wordmark.
   Write custom markup only when no built-in component has the required design.
3. **Built-in classes and Markdown features.** Use `.vp-doc`, `.custom-block`, `.VPFeature`, code groups, `:::` containers, `[!code focus]`, and `vp-raw`.
4. **Frontmatter and configuration.** Configure the layout, hero, features, navigation, sidebar, aside, and outline without CSS overrides.
5. **Custom CSS.** Add custom CSS only for project-specific elements such as `.rapira-hero*` and `.faq-*`.

When custom CSS is unavoidable:

- Use existing variables for each color, space, and radius value.
- Add a `--rapira-*` variable only when several rules use the value.
- Prefix project-specific classes (`.rapira-*`, `.faq-*`) and keep them in the matching commented section of `style.css`.
- Avoid `!important` and overrides of internal `.VP*` classes. VitePress updates can change these classes.
- If an override is necessary, add a short comment that explains the reason.
- Verify each change in **both** light and dark themes.
- Delete a rule that duplicates default theme behavior.

## Typography

The site uses self-hosted **IBM Plex Sans** for text and **JetBrains Mono** for code. Both fonts use the OFL license.

- **Files:** `public/fonts/` contains variable fonts for each supported script.
- Each subset has a `unicode-range`. The browser downloads only the required subsets.
- The directory also contains both OFL license files.
- To update the fonts, download the same file names from the two `@fontsource-variable` packages.
- **`@font-face` rules:** `theme/fonts.css` contains the rules. `theme/index.ts` imports this file before `style.css`.
- The rules use `format('woff2-variations')`. This format lets the browser use intermediate font weights.
- **Families and weights:** the `TYPOGRAPHY` section in `theme/style.css` defines them.
- The `:lang(zh)` variant puts `'Punctuation SC'` first because the two project fonts do not contain Chinese characters.
- The `--rapira-fw-*` variables define one weight for each text role.
- VitePress sets weights in its stylesheets. The rules below the variables override these values.
- Change font weights only in the variables.
- Code elements disable ligatures with `font-variant-ligatures: none`. Examples show the exact characters that the reader must type.
- `mermaid.fontFamily` in `config.mts` sets the Mermaid font. Mermaid SVG output does not inherit the page variables.

## VitePress Commands

```bash
npm run dev      # Start the development server with hot reload.
npm run build    # Build the site in .vitepress/dist/.
npm run preview  # Preview the production build.
```

## Configuration

**File:** `.vitepress/config.mts`

- `locales`: `root` (EN) + `ru`, `es`, `zh`, `pl`, each with its own `nav`/`sidebar` and UI labels.
- `cleanUrls: true`, `lastUpdated: true`, `search.provider: 'local'`.
- Each `locales.*.themeConfig` block defines the navigation and sidebar for one locale.
- Brand accent color: `--vp-c-brand-*` at the top of `theme/style.css`.
- GitHub stars widget: the tracked repo is the `repo` constant in `theme/GitHubStars.vue`.
- **Adding a locale:** Add an entry to `locales` in `.vitepress/locales.ts`.
- Add a locale block to `.vitepress/config.mts` for navigation, UI labels, and the RSS link.
- The build then creates an RSS feed for the locale.

## Git Commits

**Do not add a `Co-Authored-By:` trailer to commit messages.** This project uses `Assisted-By:` instead.

End each commit message with one `Assisted-By:` trailer. Name **the model that did the work**.

```
Assisted-By: <model name> <noreply@anthropic.com>
```

Use the model's readable name instead of its API identifier. Include the context size only when it identifies the model variant.
For example, use `Assisted-By: Claude Sonnet 5 <noreply@anthropic.com>` for Sonnet 5. Ask for the model name if it is not available.

## CI & Deployment

Two workflows run `npm ci` and `npm run build` on Node 24:

- `.github/workflows/ci.yml` runs on each pull request to `main`. It builds the site without deployment.
- VitePress reports invalid internal links during this build.
- `.github/workflows/deploy.yml` runs on each push to `main`. It publishes `.vitepress/dist` to **https://rapira.rs/**.
- The workflow also accepts the `rapira-release` repository event from both release repositories.
- A scheduled job runs twice each day if a release event does not start the workflow.
- The build includes current release data in the download page. Therefore, each release requires a new site build.

Set the Pages source to **GitHub Actions** in Settings → Pages → Source. Make `Build` a required check in the `main` branch protection rules.

**Custom domain.** Two settings define the `rapira.rs` domain. Keep their values equal.

- `public/CNAME` contains one line. The build copies this file into `dist`.
- GitHub Pages reads the custom domain from this file. Do not delete it.
- `siteUrl` in `.vitepress/locales.ts` supplies the base for all absolute site URLs.
- Use `siteUrl` for metadata, RSS links, and RSS identifiers. Do not put the base URL in other files.

The `editLink.pattern` entries use `github.com/rapira-rs/…`. These repository links do not use the site domain.

---

# Translating the Documentation

The documentation has five languages. **English in the root is the canonical version.** Translations are in `ru/`, `es/`, `zh/`, and `pl/`.
Keep each locale synchronized with English. See "Syncing translations" for the required process.

## Translation method

A word-for-word translation can use incorrect word order and sentence structure. Write natural text in the target language during the first translation.

Use these rules during the first translation:
- Understand the English meaning before you write the translation.
- Use the sentence structure and word order of the target language.
- Split or combine sentences when the target language requires it.
- Replace each English idiom with a literal phrase in the target language.
- Prefer active voice and short sentences unless the target language requires a different structure.
- Review the translation before you continue. Rewrite text that does not sound natural.

Use the same direct technical tone as the English text. Use a consistent technical register in each locale.

## Buttons, links, and other UI text

Keep short UI text clear and concise:

- **Use a verb for an action.** Use «Поставить звезду» instead of «Звезда на GitHub».
- **Remove information that the context supplies.** A GitHub icon can make "on GitHub" unnecessary.
- **Use the shortest clear phrase.** Examples include «Поставить звезду», `Give us a star`, «Danos una estrella», 「点个星」, and „Zostaw gwiazdkę".
- Use requested text **without changes** when a task gives the exact text in quotation marks.

## Content without translation

- Code, identifiers (classes, methods, traits, crates, functions, attributes), package names, CLI flags, config keys.
- Code examples stay unchanged.
- Product and brand names, such as `Rapira`.
- A language can inflect a brand name when its grammar requires inflection.

## Per-language notes

Examples below are intentionally written in each target language.

### Russian (`ru`)
- Address the reader as «вы» (lowercase), never «ты».
- Use complete sentences.
- Put one instruction in each sentence: «Зарегистрируйте плагин. Затем вызовите его.»
- End every list item with a period.
- Prefer concrete wording over abstract CS jargon: «тот же самый экземпляр», not «идентичность по ссылке».
- Translate "bridge" as «адаптер» or «интеграция», as the context requires.
- Avoid «в разы».
- Use commas, colons, or conjunctions instead of unnecessary dashes.
- Avoid officialese: «проверить», not «осуществить проверку».

### Spanish (`es`)
- Address the reader with informal "tú". Use it consistently.
- Translate "library" as «biblioteca», not «librería».
- Translate "actual" as «actualmente» or «real», as the context requires.
- Translate "to support" as «admitir» or «ser compatible con», as the context requires.
- Use native punctuation, including opening marks: «¿Cómo…?», «¡…!».
- Use Spanish sentence structure. For example, use «una vez configurado…».

### Simplified Chinese (`zh`)
- Write natural Simplified Chinese. Do not copy English sentence structure.
- Use full-width punctuation for Chinese text（，。？！：、).
- Keep code, identifiers, and Latin terms in half-width ASCII.
- Put a space between Chinese characters and adjacent Latin words or numbers: «使用 Rapira 运行 3 个测试».
- Keep the text concise.
- Use a neutral voice or «你» consistently.

### Polish (`pl`)
- Address the reader informally in second person, for example, "Uruchom…" and "Zobacz…".
- Inflect the product name where grammar requires: «dokumentacja Rapiry», «pracę z Rapirą».
- Use Polish punctuation and spacing.
- Use Polish word order.
- Avoid anglicisms where a natural Polish term exists.

## Final quality check

- Confirm that the text sounds natural to a native developer.
- Confirm that the translation preserves the full technical meaning.
- Confirm that sections, headings, and structure match the English source.
