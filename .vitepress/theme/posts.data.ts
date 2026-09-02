import { createContentLoader } from 'vitepress'
import { getBlogGlobPatterns, isBlogIndexPath } from '../locales'

export interface Post {
  title: string
  url: string
  date: string
  description: string
  image?: string
  thumb?: string
  author?: string
}

// Create the optional list thumbnail path from the image path.
// BlogPosts.vue uses the full image when the thumbnail does not exist.
function getThumbUrl(imageUrl: string | undefined): string | undefined {
  if (!imageUrl) return undefined
  const ext = imageUrl.lastIndexOf('.')
  if (ext === -1) return undefined
  return `${imageUrl.slice(0, ext)}.thumb.jpg`
}

declare const data: Post[]
export { data }

export default createContentLoader(getBlogGlobPatterns(), {
  transform(raw): Post[] {
    return raw
      .filter((page) => !isBlogIndexPath(page.url))
      .map((page) => ({
        title: page.frontmatter.title,
        url: page.url,
        date: formatDate(page.frontmatter.date),
        description: page.frontmatter.description,
        image: page.frontmatter.image,
        thumb: getThumbUrl(page.frontmatter.image),
        author: page.frontmatter.author,
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  },
})

function formatDate(date: string | Date): string {
  const d = new Date(date)
  return d.toISOString().slice(0, 10)
}
