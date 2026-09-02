# Rapira documentation

This repository contains the [Rapira](https://github.com/rapira-rs/rapira) documentation site. The site uses [VitePress](https://vitepress.dev/).

## Local development

```bash
npm install       # Install dependencies once.
npm run dev       # Start the development server with hot reload.
npm run build     # Build the static site in .vitepress/dist.
npm run preview   # Preview the production build.
```

## Structure

```
index.md              # Home page (English)
docs/                 # Documentation pages (English)
blog/                 # Blog posts + index (English)
ru/                   # Russian locale (index.md + docs/ + blog/)
.vitepress/
├── config.mts        # Site config: nav, sidebar, locales, RSS
├── faq.ts            # ::: question spoilers plugin
├── info-block.ts     # ::: block icons plugin
├── rss.ts            # RSS feed generation
└── theme/            # Custom theme (styles, GitHub stars, blog)
```

## Deployment

The `.github/workflows/deploy.yml` workflow builds each push to `main`. It deploys the result to GitHub Pages.
Set the Pages source to **GitHub Actions** in Settings → Pages → Build and deployment → Source.
