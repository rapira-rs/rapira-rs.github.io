# Rapira documentation

Documentation site for [Rapira](https://github.com/rapira-rs/rapira), built with [VitePress](https://vitepress.dev/).

## Local development

```bash
npm install       # install dependencies (once)
npm run dev       # dev server with hot reload
npm run build     # build static site into .vitepress/dist
npm run preview   # preview the production build
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

Every push to `main` is built and deployed to GitHub Pages automatically via
`.github/workflows/deploy.yml`. The Pages source must be set to **GitHub Actions**
(Settings → Pages → Build and deployment → Source).
