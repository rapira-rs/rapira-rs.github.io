import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import sharp from 'sharp'
import matter from 'gray-matter'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const docsRoot = path.resolve(__dirname, '..')

const THUMB_WIDTH = 400

// Blog folders per locale (keep in sync with locales.ts).
const blogFolders = ['blog', 'ru/blog', 'es/blog', 'zh/blog', 'pl/blog']

async function generateThumbnails() {
  const images = []

  // Collect preview images from blog frontmatter across every locale.
  for (const blogFolder of blogFolders) {
    const blogPath = path.join(docsRoot, blogFolder)

    if (!existsSync(blogPath)) continue

    const files = readdirSync(blogPath).filter(f => f.endsWith('.md') && f !== 'index.md')

    for (const file of files) {
      const filePath = path.join(blogPath, file)
      const content = readFileSync(filePath, 'utf-8')
      const { data: frontmatter } = matter(content)

      if (frontmatter.image) {
        // Images live in the public/ folder.
        const imagePath = path.join(docsRoot, 'public', frontmatter.image)
        if (existsSync(imagePath)) {
          if (!images.includes(imagePath)) images.push(imagePath)
        } else {
          console.warn(`⚠ Image not found: ${frontmatter.image} (looked in public/)`)
        }
      }
    }
  }

  console.log(`Found ${images.length} images to process\n`)

  // Generate thumbnails.
  for (const imagePath of images) {
    const ext = path.extname(imagePath)
    const base = imagePath.slice(0, -ext.length)
    const thumbPath = `${base}.thumb.jpg`

    // Skip if the thumbnail exists and is newer than the original.
    if (existsSync(thumbPath)) {
      const origStat = statSync(imagePath)
      const thumbStat = statSync(thumbPath)
      if (thumbStat.mtimeMs >= origStat.mtimeMs) {
        console.log(`⏭ Skip (up to date): ${path.basename(thumbPath)}`)
        continue
      }
    }

    try {
      await sharp(imagePath)
        .resize(THUMB_WIDTH, null, {
          withoutEnlargement: true,
        })
        .jpeg({ quality: 80 })
        .toFile(thumbPath)

      console.log(`✓ Generated: ${path.basename(thumbPath)}`)
    } catch (err) {
      console.error(`✗ Failed: ${path.basename(imagePath)}`, err.message)
    }
  }

  console.log('\nDone!')
}

generateThumbnails()
