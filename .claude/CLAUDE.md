# Rapira Documentation

Documentation site for **Rapira**, built with [VitePress](https://vitepress.dev/). Multilingual: English (root) + Russian (`ru/`), Spanish (`es/`), Chinese (`zh/`), Polish (`pl/`).

## What Rapira Is

**A PHP application server written in Rust**, MIT-licensed. It lives in the [`rapira-rs`](https://github.com/rapira-rs) GitHub organization, which describes itself as *"a PHP application server with extensions from the RoadRunner maintainers"* — that lineage is the project's main credibility claim.

**PHP runs with nothing in between.** It is embedded in the server process and the host calls the interpreter directly, so between Rust and PHP there is no FastCGI, no sockets and no serialization of any kind. RoadRunner reaches its PHP workers over Goridge and FrankenPHP embeds PHP through CGO; Rapira needs neither.

**Existing applications keep working.** The classic SAPI is supported, so an ordinary front controller runs as it is: Rapira takes php-fpm's place with no changes to the code, and runs faster doing it.

**Four execution modes**: Classic, SAPI Worker, PSR Worker, Async — listed in order of how much control PHP gets over the request lifecycle. Classic and SAPI Worker are shipped; PSR Worker and Async are planned. The names are the site's own: they say what the mode *is* — whether the worker stays alive, and the contract it speaks — instead of pointing at the product that made the shape familiar. Never name the modes after FrankenPHP or RoadRunner on the site:

- **Classic** — the entry script runs from scratch on every request, exactly as it would under php-fpm.
- **SAPI Worker** — the same shape, except the worker does not die: the superglobals are refilled for each request while the warmed-up process keeps running.
- **PSR Worker** — the PHP side pulls requests from Rapira through an API call and decides what to do with each one: fill the superglobals for compatibility, or skip them entirely and work with a PSR-7 message. One request at a time.
- **Async** — the same API, except the worker asks for more than one request at once and handles them concurrently, which PHP 8.1 fibers make possible.

Any application can use any mode; what limits the choice is the application's own code, never the server. Global state that cannot survive a second request restricts an application to Classic; a library that is not fiber-safe rules out Async. State it that way — as a property of the application's code.

**The ladder/rung/climb metaphor for the modes is banned** — in English and in every translation, docs and home page alike. The modes are listed, not ranked; earlier drafts used "ladder"/"rung" vocabulary and it must not come back.

**The home page shows a shortened mode list,** `Classic → Worker → Async` — three names, because four names plus their distinctions do not fit a feature card and the middle pair differ in a detail (who initiates the request) that means nothing to someone seeing the project for the first time. There, `Worker` stands for both worker modes. The full list of four belongs in the documentation, where there is room to explain it.

The mode is selected in the config, but neither the config format nor the PHP-side API is stable yet — describe the modes by what they do, and check specific keys and function names before they reach the site.

**It is engineered.** A considered architecture and carefully written code, backed by years of building RoadRunner — the same maintainers. State this affirmatively and never mention vibe coding on the site: naming the thing you are not invites the reader to weigh the accusation, and the site does not need to argue with it. No performance numbers are published, so keep any claim about speed qualitative and never invent figures or percentages.

This positioning is what the home page carries: the lede comes from the `tagline` and `pitch` frontmatter fields of each locale's `index.md`, and the three feature cards — zero interop, php-fpm compatibility, the execution modes — from its `features` block. English is written first, then every translation follows.

**One deliberate exception:** the English `tagline` calls Rapira *post-modern* — a nod to the "Modern PHP" era of Composer and the PSRs, which an English-speaking reader catches at once. That reference does not exist in the other languages, so there is no "modern" to be "post" of, and the calque lands as art-criticism irony instead. Every translated `tagline` therefore stays plain — the equivalent of "PHP application server, written in Rust" — and this gap is intentional, not an out-of-sync translation to be fixed.

## Structure

```
docs/         # English (root)
├── index.md  # Home page (layout: home)
├── download.md # Download page (picker over baked release data)
├── docs/     # Documentation pages
├── blog/     # Blog posts + index.md
└── .vitepress/
    ├── config.mts       # Config: nav, sidebar, locales, search, mermaid, RSS
    ├── faq.ts           # ::: question spoilers plugin
    ├── info-block.ts    # ::: block icons plugin
    ├── locales.ts       # Locale + blog path helpers
    ├── rss.ts           # RSS feed generation (build + dev server)
    └── theme/
        ├── index.ts          # DefaultTheme + GitHub stars + blog components
        ├── style.css         # Custom styles (brand colors, blocks, FAQ)
        ├── posts.data.ts      # Blog posts data loader
        ├── builds.data.ts     # Release builds data loader (GitHub API at build time)
        ├── GitHubStars.vue
        ├── GitHubIcon.vue      # Shared GitHub mark (nav stars + hero action)
        ├── RapiraHero.vue      # Home landing cover (wordmark + lede + actions)
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

English (root) is the **source of truth**. Every other locale mirrors its structure.

The docs sidebar (five per-locale blocks in `.vitepress/config.mts`) has six groups — Introduction, Getting started, Writing your app, Running the server, Framework integration, Contributing — with an identical group/item structure in every locale; only the labels are translated.

## Style Guide

**Tone:** Plain technical documentation, in the register of Zed's docs (zed.dev/docs). Write for newcomers — full sentences, explain concepts before showing code, no telegraphic style ("Register plugin. Call it."). Second person for the reader, third person for the software; contractions are fine.

**Register — binding for English and every translation:**

- **Open with a definition.** The first sentence says what the subject is, with the product or feature as grammatical subject; optionally one scope sentence naming what the page covers; then the first `##`. Installation-type pages may skip the intro entirely. Never open with motivation, a problem statement, or the reader.
- **No metaphors, no analogies.** No ladder/rung/climb (banned outright, see above), no economic framing ("paid once at boot", "the price is"), no personification ("your code does not know the difference"), no punchlines or reveals ("…: nothing."). Standard technical idiom stays: boot, warm, spin up, drop-in replacement, sawtooth, graceful shutdown, backstop.
- **No teasers or narrative transitions** ("and that is why the next section exists"), no editorializing ("worth knowing", "the entire point", "honestly", "actually"/"genuinely" as emphasis), no marketing adjectives, no rhetorical questions, no dramatized second person ("now your responsibility", "yours to manage").
- **No FAQ blocks.** Docs pages carry no `::: question` containers — in English or any translation. An answer worth writing belongs in the body, in the section that owns the topic; a recurring reader question means the body is missing something, so fix the body.
- **Hedge about the software's state, never about knowledge:** "currently", "not yet" — never "probably", "generally", "in practice you'll almost always".
- **Limitations are flat present-tense facts stated in place**, each paired with its workaround in the same paragraph. No apology, no drama.
- **Choices:** give parallel criteria ("Use A if …; use B if …") or one plain paragraph per option; recommendations are stated flatly with the reason attached, never sold.
- **Headings:** noun phrases or gerunds, sentence case. No slogans, full sentences, questions, or second person.
- **Cross-references:** inline links with the noun as link text; terminal references are "See [X] for more information." Pages stop after the last technical item — no summary or outro paragraphs; "Next steps" bullet lists only on hub pages.
- **Do not over-sterilize.** Full subordinated sentences (~20 words on average) are the norm, not fragments; plain connective sentences between sections are fine. Translators must render the same plain register — never "improve" it into literary prose.

**Code examples:**
- List the options first, then a single code block with all examples (easier to read than many small blocks).
- Keep examples compact — show structure, not implementation, when the implementation doesn't matter.
- Show the contrast between approaches in examples.

**Text structure:**
- Avoid tautology in lists, fix typos.
- Small sections are sometimes better integrated into an existing one.

**Markdown callouts:** Use `::: tip`, `::: warning`, `::: info`, `::: danger` blocks — each renders with its own icon and color. The `::: question` spoiler plugin exists but is not used in the docs (see the Register block); do not add FAQ containers.

## Working with Content

**Adding pages:**
1. Create the page in English (`docs/page.md`) **and** in every locale (`ru/docs/page.md`, `es/docs/page.md`, `zh/docs/page.md`, `pl/docs/page.md`).
2. Add the page to the sidebar in `.vitepress/config.mts` for **every** locale block.
3. Internal links: `./page` or `/docs/page` (no `.html`; `cleanUrls` is on).

**Syncing translations:**
- **CRITICAL:** When changing content (adding sections, examples, explanations), ALWAYS update the English version AND every locale.
- This applies to content changes, not just translation-quality fixes.
- If you modify `docs/page.md`, you MUST also update the same page in each locale with a translated version (see the translation guideline at the bottom).
- Exception: fixing only translation quality in one locale does not require touching the English version.

**Dead links:** create a stub with a `::: tip Coming Soon` block rather than leaving a broken link.

## Locale Service

`.vitepress/locales.ts` is the **single source of truth for locales**. It defines the `locales` array (code, prefix, blog title/description/labels, "back to blog" label) and every locale-aware helper.

**Always resolve locales and build locale-specific URLs through this service. Never hardcode `path.startsWith('/ru/')`, `lang === 'ru'` branches, or literal `/ru/blog/` URLs** — they silently break the moment a locale is added.

- Resolve a locale from a URL or src-relative path → `getLocaleByPath(path)`.
- Resolve a locale from a `lang` code (e.g. `useData().lang`) → `getLocaleByCode(code)`.
- Build URLs → `getDocsUrl(locale)`, `getDownloadUrl(locale)`, `getBlogUrl(locale)`, `getFeedFilename(locale)`, `getBlogFolder(locale)`.
- Blog predicates → `isBlogPath(path)`, `isBlogIndexPath(path)`, `getBlogGlobPatterns()`.
- Per-locale UI strings that belong to the service (blog title/description/label, back-to-blog label) live as fields on `LocaleConfig` — add a field there instead of scattering `lang ===` maps across components.

Consumers already wired to it: `config.mts`, `rss.ts`, `theme/posts.data.ts`, `theme/index.ts`, `theme/RapiraHero.vue`, `theme/BlogPostHeader.vue`. Everything path/URL-driven (RSS, blog listing, back links) then updates automatically when a locale is added.

## Blog & RSS

Blog posts live in `blog/` (EN) plus one folder per locale (`ru/blog/`, `es/blog/`, `zh/blog/`, `pl/blog/`). Each locale has its own index (`blog/index.md`) that renders `<BlogPosts folder="/blog/" />`, and its own RSS feed at `/feed.xml`, `/ru/feed.xml`, `/es/feed.xml`, … (generated by `.vitepress/rss.ts` at build time and served live in dev).

**Adding a post:**
1. Create `blog/my-post.md` (EN) and the translated post in each locale's `blog/` folder.
2. No sidebar entry needed — posts are listed automatically by date, newest first.

**Required frontmatter:**
```yaml
---
title: "Post Title"
date: 2026-01-01
description: "Short description for the blog list and RSS."
author: Author Name
---
```
- `title`, `date`, `description` — used by both the blog list and RSS.
- `author` — optional; falls back to "Rapira Team".
- `image` — optional; shown as the post hero and in `og:image`. Omit it if you have no asset (no broken image is rendered).

**Post assets structure:** each post gets its own folder `public/blog/<page-name>/` holding *all* of its images — the preview plus every in-article image. Reference them root-absolute (no `public/` prefix):
- Preview: `public/blog/<page-name>/preview.jpg` → `image: /blog/<page-name>/preview.jpg`. One preview is normally shared by every locale (the same `image` path in all translations); for a localized image add a language suffix, e.g. `preview-ru.jpg`.
- List thumbnail: `preview.thumb.jpg` next to the preview. `posts.data.ts` derives the path by swapping the extension for `.thumb.jpg`; thumbnails are generated by `npm run thumbnails` (`scripts/generate-thumbnails.mjs`, using `sharp`), which `npm run build` runs automatically. They are gitignored (regenerated on every build); if one is missing, `BlogPosts.vue` falls back to the full preview.
- In-article images live in the same folder (`img-1.png`, …); locale-specific variants use a language suffix, e.g. `img-2-ru.jpg`.
- `og:image` must be a raster (PNG/JPG), ideally 1200×630 — social networks don't render SVG.

`lastUpdated` and the edit link are automatically disabled on blog posts.

## FAQ (`::: question`)

Documentation pages do not use this plugin (see the Register block above); it stays available for blog posts. Questions can be written anywhere in an article using `::: question` blocks. At build time they are extracted from their positions and grouped into collapsible spoilers.

**Syntax:**
```md
::: question Can I run the site without installing anything globally?
Yes — `npm install` locally, then `npm run dev`.
:::
```

**Frontmatter `faqLevel`** controls where questions render:
```yaml
faqLevel: 1       # default — end of each h1 section (= end of page for most docs)
faqLevel: 2       # end of each h2 section
faqLevel: 0       # end of page (ignores headings)
faqLevel: false   # no collection — questions stay in place as inline spoilers
```

**Plugin:** `.vitepress/faq.ts`. **Styles:** `.faq-section`, `.faq-item` in `theme/style.css`.

## Home Landing Cover

The home pages (`index.md` in each locale) use `layout: home` **without** a `hero:` frontmatter block. The landing cover is a custom component, `theme/RapiraHero.vue`, injected via the `home-hero-before` layout slot. Top to bottom: the theme-aware RAPIRA wordmark (`public/rapira-bg-light.svg` / `rapira-bg-dark.svg`) centered on the page background — no card, frame or border — then the lede saying what the project is, then two frameless text actions, "Get Started" + "GitHub" (plain links styled via `.rapira-hero-action`, not `VPButton`; the GitHub one carries `GitHubIcon.vue`).

- **The lede copy lives in frontmatter**, not in the component: `tagline` (what Rapira is) and `pitch` (the line below it). Both are optional — each `<p>` is skipped when its field is missing. Keeping them in `index.md` means translators edit content, not Vue.
- The "Get Started" and "Download" labels *are* per-locale UI strings in `RapiraHero.vue`, since they are UI rather than content; the URLs come from the locale service (`getDocsUrl`, `getDownloadUrl`). Add a `startLabels` and a `downloadLabels` entry when adding a locale.
- The cover sets `user-select: none` (decoration, and a stray drag-select looks broken) and the wordmark is `draggable="false"`. `.rapira-lede` opts back into selection — it is prose worth copying.
- The `features:` frontmatter block still renders below the cover as usual.
- Styles: `.rapira-hero*`, `.rapira-lede*` in `theme/style.css`.

## Home Feature Segments

Below the `features:` cards each home page carries a series of full-width segments, written in the page's markdown as `<RapiraSection>` (`theme/RapiraSection.vue`, registered globally): a heading row spanning the segment's full width (`title` prop, optional `eyebrow` above it), then the markdown prose from the default slot plus an optional `link` + `link-text` under it. An optional `#aside` slot puts a second column on the right (cards, a code block, an image); without it the prose runs single-column at a capped measure. An optional `#footer` slot renders a full-width row under both columns (the networking segment puts its `FeatureTags` there). One shared frame keeps the series consistent; the aside is individual. Segments are separated by whitespace alone — no rules between them — so a new one only has to be appended before the sponsors block.

All copy lives in `index.md` — props and slot content, never in the component — so translators never open a `.vue` file. Data-driven asides declare their items in a `<script setup>` block on the page, the same pattern `CodeTabs` uses.

Segment building blocks:

- **`FeatureTags`** (HTTP-server segment, `#footer`) — a flat tag row (`items: [{ label, ready? }]`). `ready` defaults to true; a tag with `ready: false` is drawn dimmed, dashed and with a hollow dot: that is how the site shows a feature that is not shipped yet, and the drawing is left to say it — there is no caption spelling it out.
- **`.rapira-section-art`** (HTTP-server segment, `#aside`) — a decorative theme-aware image (`VPImage`) painted as the background of the aside column: absolutely positioned, fitted to the height the text gives the row, hidden together with its column on the stacked layout. The Pingora banner files are `public/pingora-banner-{light,dark}.png`.
- **`TextTabs`** (interop segment, `#aside`) — a tab strip over short prose panels, one per alternative being compared (`tabs: [{ name, slot, users? }]`). Each panel's prose goes in a `<template #…>` slot; `users` names the products built on that approach and is drawn as small tags under the prose. Panels share one grid cell, so the block keeps the height of its tallest panel and switching tabs never shifts the page. Styles are scoped in the component.

Frame styles are `.rapira-section*` in `theme/style.css` (they have to outrank `.vp-doc`, since the segments render inside the home page's markdown container); aside internals stay scoped in their own component.

**Sponsors block:** each home page ends with a `<div class="sponsors-section">` showing the sponsor logo (`public/sponsors/logo-buhta.svg`, links to buhta.com) plus a "Become a Sponsor | Star on GitHub" CTA. "Become a Sponsor" points to the in-site sponsor page (`/sponsor`, `/ru/sponsor`, …); the heading and CTA text are translated inline per locale. Styles: `.sponsors-section`, `.sponsor-*` in `theme/style.css` (the logo is auto-inverted in dark mode). The sponsor pages themselves live at `sponsor.md` in each locale.

## Download Page

`download.md` in every locale (`/download`, `/ru/download`, …) walks the visitor from OS (preselected from the User-Agent) through architecture, PHP version and package format down to one download button, with the asset's SHA-256 shown under it. The hero's "Download" action links here via `getDownloadUrl(locale)`.

- **Data is baked at build time** by `.vitepress/theme/builds.data.ts`: at `npm run build` (and once per dev-server start) it fetches `releases/latest` of `rapira-rs/rapira` **and** `rapira-rs/rapira-windows` (Windows builds live in their own repo and are dev-only — the page says so in the `#windows-note` slot, shown only while Windows is selected), parses the asset names into (os, arch, php, format) and joins each asset with its hash from the release's `SHA256SUMS.txt`. Everything is derived from asset names, so a new PHP version or architecture appears without code changes; a fetch failure logs a warning and yields an empty list (the page then links to the releases) instead of failing the build. Freshness caveat: a release published between deploys reaches the page with the next deploy.
- **`DownloadBuilds.vue`** renders the picker. All UI strings arrive through the `labels` prop from the page's `<script setup>`, so translators edit `download.md`, never the component. Styles are scoped in the component.
- Both workflows pass `GITHUB_TOKEN` to the build step — anonymous API calls from shared Actions runner IPs hit the rate limit.

## Custom `:::` Blocks

`.vitepress/info-block.ts` enhances `::: info`, `::: tip`, `::: warning`, `::: danger` blocks **without a custom title**: it drops the default heading and adds a `data-*-icon` attribute so CSS can draw an icon on the left border. Blocks with a custom title (`::: info My Title`) are left untouched.

## Markdown Features

Beyond standard Markdown, the `:::` callouts, and `::: question` spoilers, pages can use:

- **Code blocks**: syntax highlighting + language label + copy button; line highlighting (```` ```rust{2,4} ````); focus / diff via inline `// [!code focus]`, `// [!code --]`, `// [!code ++]` markers; tabbed groups (`::: code-group` with fenced blocks inside, each labelled `` ```bash [npm] ``).
- **File tabs**: `<CodeTabs :tabs="…">` (`theme/CodeTabs.vue`, registered globally) wraps several code blocks in an editor-style tab bar — one tab per file. The tab list is declared in a `<script setup>` block on the page (`{ name, slot, icon? }`) and each snippet goes in a `<template #slot>`. The icon is derived from the extension in `name`; the glyphs are drawn inline in the component, so a new language needs an accent colour there rather than an asset in `public/`. Use it for files that belong together (entry script + config); use `::: code-group` for alternative forms of the same thing (npm/pnpm/yarn).
- **Mermaid diagrams**: a fenced ```` ```mermaid ```` block (via `vitepress-plugin-mermaid`).
- **Badges**: `<Badge type="tip|warning|danger|info" text="…" />` for inline status labels.
- **Tables**: standard GFM tables.

**Live, rendered examples of all of the above live in `docs/contributing.md`** (and its per-locale translations) — the contributor cheat-sheet page. Update it when adding or changing an authoring feature.

## Page Frontmatter

Any page can set these in the YAML block at the top:

- `title`, `description` — override `<title>` / meta description and the `og:` tags.
- `outline` — the right-hand "On this page" menu: `[2, 3]` (default, H2–H3), `deep` (H2–H6), `2` (only H2), `false` (hidden).
- `aside: false` — hide the right column; `sidebar: false` — hide the left sidebar.
- `lastUpdated: false`, `editLink: false` — hide those on that page (auto-disabled on blog posts).
- `prev` / `next` — relabel/redirect footer nav (`{ text, link }`) or hide with `false`.
- `layout` — `doc` (default), `home` (landing), `page` (bare, no sidebar/outline).
- `faqLevel` — where `::: question` blocks collect (see FAQ above).
- Blog posts additionally use `date`, `author`, `image` (see Blog & RSS).
- Home pages additionally use `tagline` and `pitch` for the landing lede (see Home Landing Cover).

## CSS & Styling

**Rule of thumb: reach for VitePress first, write CSS last.** `theme/style.css` must stay small — it is for the handful of things the default theme genuinely can't express, not a dumping ground for customization the framework already offers.

Before adding a single rule, in this order:

1. **CSS variables.** VitePress exposes a large set (`--vp-c-brand-*`, `--vp-c-bg-soft`, `--vp-c-divider`, `--vp-code-bg`, `--vp-custom-block-*-border/bg`, `--vp-layout-max-width`, …). Retheming means reassigning a variable in `:root` / `.dark`, not restyling a component. Never hardcode a color, background or border that a variable already covers — that breaks dark mode.
2. **Built-in theme components.** Import from `vitepress/theme` instead of rebuilding markup: `VPButton`, `VPImage`, `VPBadge`, `VPTeamMembers`, etc. See `theme/RapiraHero.vue` — the wordmark is a `<VPImage>`, so the light/dark swap comes for free. Write your own markup only when no built-in matches the design (the hero's frameless text actions, for instance — `VPButton` always draws a pill).
3. **Built-in classes and markdown features.** `.vp-doc`, `.custom-block`, `.VPFeature`, code groups, `:::` containers, `[!code focus]`, `vp-raw` — use them rather than styling raw elements.
4. **Frontmatter and config.** Layout, hero, features, nav, sidebar, aside and outline are configured in `config.mts` or page frontmatter, not with CSS overrides.
5. **Only then** write custom CSS — and only for something genuinely project-specific (e.g. `.rapira-hero*`, `.faq-*`).

When custom CSS is unavoidable:

- Use existing variables for every color, spacing and radius value; introduce a new `--rapira-*` variable only for a value reused in several places.
- Prefix project-specific classes (`.rapira-*`, `.faq-*`) and keep them in the matching commented section of `style.css`.
- Treat `!important` and overrides of internal `.VP*` classes as a smell: they break on VitePress upgrades. If you need one, add a short comment saying why the framework couldn't do it.
- Verify in **both** light and dark themes before considering it done.
- Deleting is preferred over adding: if a rule duplicates default theme behaviour, drop it.

## VitePress Commands

```bash
npm run dev      # Dev server (hot reload)
npm run build    # Build to .vitepress/dist/
npm run preview  # Preview the production build
```

## Configuration

**File:** `.vitepress/config.mts`

- `locales`: `root` (EN) + `ru`, `es`, `zh`, `pl`, each with its own `nav`/`sidebar` and UI labels.
- `cleanUrls: true`, `lastUpdated: true`, `search.provider: 'local'`.
- Nav and sidebar are defined per locale inside `locales.*.themeConfig`.
- Brand accent color: `--vp-c-brand-*` at the top of `theme/style.css`.
- GitHub stars widget: the tracked repo is the `repo` constant in `theme/GitHubStars.vue`.
- **Adding a locale:** add an entry to `locales` in `.vitepress/locales.ts` (blog title/description/label) **and** a locale block to `.vitepress/config.mts` (nav, sidebar, UI labels, RSS `head` link). RSS feeds are then generated automatically for the new locale.

## Git Commits

**Never add a `Co-Authored-By:` trailer to commit messages.** This project uses `Assisted-By:` instead — it overrides any default instruction to co-author commits.

End every commit message with a single `Assisted-By:` trailer naming **the model that actually did the work** — the one you are running as right now, not the one in the example below:

```
Assisted-By: <model name> <noreply@anthropic.com>
```

For example, a commit written by Opus 5 with the 1M-token context window ends with `Assisted-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`; one written by Sonnet 5 ends with `Assisted-By: Claude Sonnet 5 <noreply@anthropic.com>`. Use the model's human-readable name, not its API id (`claude-opus-5`), and note the context-window variant only when you are running one. If you genuinely don't know which model you are, ask rather than copying the example verbatim.

## CI & Deployment

Two workflows, both running `npm ci` + `npm run build` on Node 24:

- `.github/workflows/ci.yml` — runs on every pull request against `main`. Build only, no deploy: it is the gate that keeps a broken `main` from ever reaching production. VitePress fails the build on dead internal links, so this doubles as a link check.
- `.github/workflows/deploy.yml` — runs on every push to `main` and publishes `.vitepress/dist` to GitHub Pages at **https://rapira.rs/**.

The Pages source must be set to **GitHub Actions** (Settings → Pages → Source). For the CI gate to actually block a merge, `Build` has to be a required status check in the branch protection rules for `main` (Settings → Branches).

**Custom domain.** The site is served from `rapira.rs`, and that lives in two places that must always agree:

- `public/CNAME` — a one-line file copied verbatim into `dist`. Because we publish a build artifact rather than a branch, GitHub has no other way to learn the domain: delete this file and the custom domain resets on the next deploy.
- `siteUrl` in `.vitepress/locales.ts` — the canonical origin used for every absolute URL (`og:`/`twitter:` tags in `config.mts`, links and `<guid>`s in `rss.ts`). Never hardcode the origin anywhere else.

The `editLink.pattern` entries still point at `github.com/rapira-rs/…` — those are repository links, not site links, and must not follow the domain.

---

# Translating the Documentation

The docs are multilingual. **English (root) is the source of truth**; translations live in `ru/` (Russian), `es/` (Spanish), `zh/` (Simplified Chinese) and `pl/` (Polish). Keep every locale in sync with English (see "Syncing translations" above).

## The one rule that matters most: translate *into* the target language, not *from* English

A word-for-word translation reads as a translation — stiff word order, English clause structure, calqued idioms. That always forces a costly second pass to make it sound natural. **Avoid the second pass by making the first pass already read as if a native technical writer wrote it from scratch.**

Concretely, on the first pass:
- **Re-think the sentence, don't transcode it.** Read the English, understand it, then say the same thing the way a native speaker would. Do not mirror the source's sentence and clause structure.
- **Restructure freely.** Split or merge sentences, reorder clauses, and move emphasis to match the target language's natural rhythm and word order.
- **Replace idioms with native equivalents**, never a literal calque.
- **Prefer active voice and short, direct sentences** unless the target language conventionally prefers otherwise.
- **Read it aloud in your head.** If it sounds translated, rewrite it *before* moving on — that is the whole point.

Match the tone of the English source: informal but technically precise. Write for newcomers — context and motivation first, then the detail. Use the register a native technical audience expects, and keep it consistent within a locale.

## Buttons, links and other UI microcopy

Short strings suffer the most from flat, literal translation. Make them **lively and as short as the context allows**:

- **Use a verb, not a noun phrase.** A button is an action: «Поставить звезду», not «Звезда на GitHub»; "Give us a star", not "GitHub star".
- **Drop what the context already says.** A link that points to GitHub does not need "on GitHub" in its text; an icon or the surrounding label already carries it. Redundant qualifiers make microcopy heavier and less human.
- **Shortest natural phrasing wins.** If a shorter wording reads just as clearly, use it — «Поставить звезду», `Give us a star`, «Danos una estrella», 「点个星」, „Zostaw gwiazdkę".
- When someone quotes a phrasing they want (in the task, in quotes), use it **verbatim** — don't pad it.

## What never gets translated

- Code, identifiers (classes, methods, traits, crates, functions, attributes), package names, CLI flags, config keys.
- Code examples stay unchanged.
- Product/brand names (e.g. `Rapira`), though they may inflect where the language grammatically requires it (e.g. Polish `Rapiry`, Russian «Rapira» stays Latin).

## Per-language notes

Examples below are intentionally written in each target language.

### Russian (`ru`)
- Address the reader as «вы» (lowercase), never «ты».
- Full sentences, never a telegraphic style: «Зарегистрируйте плагин и вызовите его», not «Зарегистрируйте плагин. Вызовите.»
- End every list item with a period.
- Prefer concrete wording over abstract CS jargon: «тот же самый экземпляр», not «идентичность по ссылке».
- Don't calque "bridge" as «мост» — use «адаптер» or «интеграция» by context.
- Avoid «в разы»; don't overuse dashes — where a line reads telegraphic, use commas, colons or conjunctions.
- Avoid officialese: «проверить», not «осуществить проверку».

### Spanish (`es`)
- Address the reader with informal "tú" (modern dev-doc convention) and keep it consistent.
- Watch false friends: "library" → «biblioteca» (not «librería»); "actual" → «actualmente/real» (not «actual»); "to support" → «admitir/ser compatible con» (not «soportar»).
- Use native punctuation, including opening marks: «¿Cómo…?», «¡…!».
- Don't calque English structure: «una vez configurado…» reads better than a literal «después de que hayas configurado…».

### Simplified Chinese (`zh`)
- Write natural Simplified Chinese; do not transcode English sentence structure.
- Use full-width punctuation for Chinese text（，。？！：、), and keep code, identifiers and Latin terms in half-width ASCII.
- Put a space between Chinese characters and adjacent Latin words or numbers: «使用 Rapira 运行 3 个测试».
- Keep it concise, as Chinese technical writing tends to be; use a neutral/impersonal voice or «你» consistently.

### Polish (`pl`)
- Address the reader informally in second person ("Uruchom…", "Zobacz…"), consistent with dev-doc convention.
- Inflect the product name where grammar requires: «dokumentacja Rapiry», «pracę z Rapirą».
- Keep native punctuation and spacing; don't calque English word order.
- Avoid anglicisms where a natural Polish term exists.

## Quality check before finalizing

- Would a native developer phrase it this way?
- Does it sound natural when read aloud — not like a translation?
- Is the technical meaning fully preserved?
- Do the sections, headings and structure still match the English source?
