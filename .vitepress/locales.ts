/**
 * Canonical locale configuration for the documentation.
 *
 * Use this module to identify a page locale and create locale URLs.
 * Do not add checks such as `path.startsWith('/ru/')` to other modules.
 * Such checks do not support new locales.
 *
 * Locale resolution:
 *   - from a URL or src-relative file path → `getLocaleByPath()`
 *   - from a `lang` code (e.g. VitePress `useData().lang`) → `getLocaleByCode()`
 *
 * The English (root) locale has an empty `prefix` and is the fallback.
 */

/**
 * Canonical origin of the published site, without a trailing slash.
 *
 * Metadata and RSS feeds use this value for absolute URLs.
 * Keep it equal to the domain in `public/CNAME`.
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

/** The default root locale is English. */
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

// ── Locale URL and path functions ────────────────────────────────────

/** Docs entry URL for a locale, e.g. '/docs/intro/' or '/ru/docs/intro/'. */
export function getDocsUrl(locale: LocaleConfig): string {
  return locale.prefix ? `/${locale.prefix}/docs/intro/` : '/docs/intro/'
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
