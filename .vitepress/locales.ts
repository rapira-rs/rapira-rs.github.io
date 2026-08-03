/**
 * Locale service — the single source of truth for locales in the docs.
 *
 * Every place that needs to know "which locale is this page/file in?" or
 * "what is the blog/docs/feed URL for locale X?" MUST go through this module.
 * Do NOT hardcode checks like `path.startsWith('/ru/')` anywhere else — such
 * code silently breaks the moment a new locale is added. Add the locale here
 * once, and every consumer keeps working.
 *
 * Resolving a locale:
 *   - from a URL or src-relative file path → `getLocaleByPath()`
 *   - from a `lang` code (e.g. VitePress `useData().lang`) → `getLocaleByCode()`
 *
 * The English (root) locale has an empty `prefix` and is the fallback.
 */

/**
 * Canonical origin of the published site, without a trailing slash.
 *
 * Used wherever an absolute URL is required — `og:` / `twitter:` tags and the
 * RSS feeds. Keep it in sync with `public/CNAME`: that file is what tells
 * GitHub Pages which custom domain to serve, this constant is what the
 * generated markup points at. Changing the domain means changing both.
 */
export const siteUrl = 'https://rapira.rs'

export interface LocaleConfig {
  code: string             // 'en', 'ru', 'es', 'zh', 'pl'
  prefix: string           // '' for root (EN), otherwise the URL/folder prefix
  blogTitle: string        // RSS + blog index title
  blogDescription: string  // RSS + blog index description
  blogLabel: string        // Nav/label text: 'Blog', 'Блог', …
  blogBackLabel: string    // "Back to blog" link title on a post
}

export const locales: LocaleConfig[] = [
  {
    code: 'en',
    prefix: '',
    blogTitle: 'Rapira Blog',
    blogDescription: 'Updates from the Rapira project',
    blogLabel: 'Blog',
    blogBackLabel: 'Back to blog',
  },
  {
    code: 'ru',
    prefix: 'ru',
    blogTitle: 'Блог Rapira',
    blogDescription: 'Новости проекта Rapira',
    blogLabel: 'Блог',
    blogBackLabel: 'Назад в блог',
  },
  {
    code: 'es',
    prefix: 'es',
    blogTitle: 'Blog de Rapira',
    blogDescription: 'Novedades del proyecto Rapira',
    blogLabel: 'Blog',
    blogBackLabel: 'Volver al blog',
  },
  {
    code: 'zh',
    prefix: 'zh',
    blogTitle: 'Rapira 博客',
    blogDescription: 'Rapira 项目动态',
    blogLabel: '博客',
    blogBackLabel: '返回博客',
  },
  {
    code: 'pl',
    prefix: 'pl',
    blogTitle: 'Blog Rapiry',
    blogDescription: 'Nowości z projektu Rapira',
    blogLabel: 'Blog',
    blogBackLabel: 'Powrót do bloga',
  },
]

/** The default (root) locale — English. */
export const defaultLocale: LocaleConfig = locales[0]

// ── Locale resolution ────────────────────────────────────────────────

/**
 * Resolve the locale from a URL or src-relative path.
 * Accepts both `/ru/docs/x` and `ru/docs/x`. Falls back to the root locale.
 */
export function getLocaleByPath(path: string): LocaleConfig {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return locales.find(l => l.prefix && normalized.startsWith(`/${l.prefix}/`)) ?? defaultLocale
}

/** Resolve the locale from a `lang` code (e.g. VitePress `useData().lang`). */
export function getLocaleByCode(code: string): LocaleConfig {
  return locales.find(l => l.code === code) ?? defaultLocale
}

// ── URL / path helpers (always locale-aware) ─────────────────────────

/** Docs index URL for a locale, e.g. '/docs/' or '/ru/docs/'. */
export function getDocsUrl(locale: LocaleConfig): string {
  return locale.prefix ? `/${locale.prefix}/docs/` : '/docs/'
}

/** Download page URL, e.g. '/download' or '/ru/download'. */
export function getDownloadUrl(locale: LocaleConfig): string {
  return locale.prefix ? `/${locale.prefix}/download` : '/download'
}

/** Blog folder (src-relative), e.g. 'blog' or 'ru/blog'. */
export function getBlogFolder(locale: LocaleConfig): string {
  return locale.prefix ? `${locale.prefix}/blog` : 'blog'
}

/** Blog index URL, e.g. '/blog/' or '/ru/blog/'. */
export function getBlogUrl(locale: LocaleConfig): string {
  return locale.prefix ? `/${locale.prefix}/blog/` : '/blog/'
}

/** RSS feed filename (output-relative), e.g. 'feed.xml' or 'ru/feed.xml'. */
export function getFeedFilename(locale: LocaleConfig): string {
  return locale.prefix ? `${locale.prefix}/feed.xml` : 'feed.xml'
}

// ── Blog path predicates ─────────────────────────────────────────────

/** True for an individual blog post (not the blog index) in any locale. */
export function isBlogPath(path: string): boolean {
  return locales.some(locale => {
    const blogUrl = getBlogUrl(locale)
    return path.startsWith(blogUrl) && path !== blogUrl
  })
}

/** True for a blog index page (`/blog/`, `/ru/blog/`, …). */
export function isBlogIndexPath(path: string): boolean {
  return locales.some(locale => path === getBlogUrl(locale))
}

/** Glob patterns for all blog folders (for content loaders). */
export function getBlogGlobPatterns(): string[] {
  return locales.map(locale => `${getBlogFolder(locale)}/*.md`)
}

/** All blog index URLs (for filtering). */
export function getBlogIndexUrls(): string[] {
  return locales.map(locale => getBlogUrl(locale))
}
