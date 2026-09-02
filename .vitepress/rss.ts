import { writeFileSync, mkdirSync, readdirSync, readFileSync } from 'fs'
import path from 'path'
import { Feed } from 'feed'
import { createContentLoader, SiteConfig } from 'vitepress'
import type { Plugin } from 'vite'
// @ts-ignore
import matter from 'gray-matter'
import { locales, siteUrl as baseUrl, getBlogFolder, getBlogUrl, getFeedFilename, getBlogGlobPatterns } from './locales'

const projectName = 'Rapira'
const defaultAuthor = 'Rapira Team'

interface FeedConfig {
  title: string
  description: string
  filename: string
  blogFolder: string
  blogUrl: string
  lang: string
}

// Create feed configurations for each locale.
const feeds: FeedConfig[] = locales.map(locale => ({
  title: locale.blogTitle,
  description: locale.blogDescription,
  filename: getFeedFilename(locale),
  blogFolder: getBlogFolder(locale),
  blogUrl: getBlogUrl(locale),
  lang: locale.code,
}))

export async function generateRss(config: SiteConfig) {
  const posts = await createContentLoader(getBlogGlobPatterns(), {
    excerpt: false,
    render: false,
  }).load()

  for (const feedConfig of feeds) {
    const feed = new Feed({
      title: feedConfig.title,
      description: feedConfig.description,
      id: baseUrl,
      link: baseUrl,
      language: feedConfig.lang,
      copyright: `Copyright © ${new Date().getFullYear()} ${projectName}`,
      generator: 'VitePress + feed',
      feedLinks: {
        rss: `${baseUrl}/${feedConfig.filename}`,
      },
    })

    const filteredPosts = posts
      .filter((post) => post.url.startsWith(feedConfig.blogUrl) && post.url !== feedConfig.blogUrl)
      .sort((a, b) => {
        const dateA = new Date(a.frontmatter.date || 0).getTime()
        const dateB = new Date(b.frontmatter.date || 0).getTime()
        return dateB - dateA
      })

    for (const post of filteredPosts) {
      const url = `${baseUrl}${post.url}`
      const imageUrl = post.frontmatter.image ? `${baseUrl}${post.frontmatter.image}` : undefined

      feed.addItem({
        title: post.frontmatter.title || 'Untitled',
        id: url,
        link: url,
        description: post.frontmatter.description || '',
        date: new Date(post.frontmatter.date || Date.now()),
        author: post.frontmatter.author
          ? [{ name: post.frontmatter.author }]
          : [{ name: defaultAuthor }],
        image: imageUrl,
      })
    }

    const outDir = config.outDir
    const filePath = path.join(outDir, feedConfig.filename)

    // Create the output directory if necessary.
    mkdirSync(path.dirname(filePath), { recursive: true })

    // Create the RSS document.
    let rssContent = feed.rss2()

    // Add the Dublin Core namespace.
    if (!rssContent.includes('xmlns:dc=')) {
      rssContent = rssContent.replace(
        '<rss version="2.0"',
        '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"'
      )
    }

    // Add `dc:creator` to each post.
    for (const post of filteredPosts) {
      const author = post.frontmatter.author || defaultAuthor
      const url = `${baseUrl}${post.url}`
      // Insert `dc:creator` after this item description.
      rssContent = rssContent.replace(
        new RegExp(`(<guid isPermaLink="false">${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</guid>)`),
        `$1\n            <dc:creator><![CDATA[${author}]]></dc:creator>`
      )
    }

    writeFileSync(filePath, rssContent)
    console.log(`✓ RSS generated: ${feedConfig.filename} (${filteredPosts.length} posts)`)
  }
}

// Create development server RSS without `createContentLoader`.
function generateRssContent(feedConfig: FeedConfig, docsRoot: string): string {
  const feed = new Feed({
    title: feedConfig.title,
    description: feedConfig.description,
    id: baseUrl,
    link: baseUrl,
    language: feedConfig.lang,
    copyright: `Copyright © ${new Date().getFullYear()} ${projectName}`,
    generator: 'VitePress + feed',
    feedLinks: {
      rss: `${baseUrl}/${feedConfig.filename}`,
    },
  })

  const blogPath = path.join(docsRoot, feedConfig.blogFolder)

  // Read Markdown files directly.
  const posts: Array<{
    url: string
    frontmatter: Record<string, any>
  }> = []

  try {
    const files = readdirSync(blogPath).filter((f: string) => f.endsWith('.md') && f !== 'index.md')

    for (const file of files) {
      const filePath = path.join(blogPath, file)
      const content = readFileSync(filePath, 'utf-8')
      const { data: frontmatter } = matter(content)
      const slug = file.replace(/\.md$/, '')
      const url = `${feedConfig.blogUrl}${slug}`

      posts.push({ url, frontmatter })
    }
  } catch (e) {
    // Ignore a locale without a blog directory.
  }

  // Sort posts by date.
  posts.sort((a, b) => {
    const dateA = new Date(a.frontmatter.date || 0).getTime()
    const dateB = new Date(b.frontmatter.date || 0).getTime()
    return dateB - dateA
  })

  for (const post of posts) {
    const url = `${baseUrl}${post.url}`
    const imageUrl = post.frontmatter.image ? `${baseUrl}${post.frontmatter.image}` : undefined

    feed.addItem({
      title: post.frontmatter.title || 'Untitled',
      id: url,
      link: url,
      description: post.frontmatter.description || '',
      date: new Date(post.frontmatter.date || Date.now()),
      author: post.frontmatter.author
        ? [{ name: post.frontmatter.author }]
        : [{ name: defaultAuthor }],
      image: imageUrl,
    })
  }

  // Create the RSS document.
  let rssContent = feed.rss2()

  // Add the Dublin Core namespace.
  if (!rssContent.includes('xmlns:dc=')) {
    rssContent = rssContent.replace(
      '<rss version="2.0"',
      '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"'
    )
  }

  // Add `dc:creator` to each post.
  for (const post of posts) {
    const author = post.frontmatter.author || defaultAuthor
    const url = `${baseUrl}${post.url}`
    rssContent = rssContent.replace(
      new RegExp(`(<guid isPermaLink="false">${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</guid>)`),
      `$1\n            <dc:creator><![CDATA[${author}]]></dc:creator>`
    )
  }

  return rssContent
}

// Provide RSS through the Vite development server.
export function rssPlugin(): Plugin {
  let docsRoot: string

  return {
    name: 'vitepress-rss-dev',
    configResolved(config) {
      // Get the documentation root from VitePress.
      docsRoot = config.root
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''

        // Process RSS feed requests.
        const feedConfig = feeds.find(f => url === `/${f.filename}`)

        if (feedConfig) {
          const rssContent = generateRssContent(feedConfig, docsRoot)
          res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8')
          res.end(rssContent)
          return
        }

        next()
      })
    },
  }
}
