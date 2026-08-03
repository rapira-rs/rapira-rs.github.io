import { defineLoader } from 'vitepress'

/**
 * Build-time data for the download page: the latest stable release of every
 * build repo, its assets parsed into (os, arch, php, format) coordinates and
 * joined with their SHA-256 sums from the release's SHA256SUMS.txt.
 *
 * Runs at `npm run build` and once per dev-server start, so the page is fully
 * static — no GitHub API calls, rate limits or CORS in the visitor's browser.
 * The price is freshness: a new release reaches the site with the next
 * deploy. A failed fetch logs a warning and yields an empty list (the page
 * then shows its error state) rather than failing the whole docs build.
 */

/** Every repo that publishes builds. Windows builds live in their own repo. */
const REPOS = ['rapira-rs/rapira', 'rapira-rs/rapira-windows']

/** A hung GitHub request must fail the fetch, not stall the whole build. */
const FETCH_TIMEOUT_MS = 15_000

export interface Build {
  version: string
  os: string
  arch: string
  php: string
  format: string
  name: string
  url: string
  size: number
  /** SHA-256 of the asset, from the release's SHA256SUMS.txt ('' if absent). */
  sha256: string
}

export interface BuildsData {
  builds: Build[]
}

declare const data: BuildsData
export { data }

// The three asset naming schemes the releases use. Everything is derived from
// the file name, so a new PHP version or architecture shows up by itself.
function parseAsset(name: string): Pick<Build, 'os' | 'arch' | 'php' | 'format'> | null {
  let m = name.match(/^rapira-v[\d.]+-php([\d.]+)-(linux|macos|windows)-(x86_64|aarch64)\.(tar\.gz|zip)$/)
  if (m) return { php: m[1], os: m[2], arch: m[3], format: m[4] }
  m = name.match(/^rapira-php([\d.]+)_[\d.]+-\d+_(amd64|arm64)\.deb$/)
  if (m) return { php: m[1], os: 'linux', arch: m[2] === 'amd64' ? 'x86_64' : 'aarch64', format: 'deb' }
  m = name.match(/^rapira-php([\d.]+)-[\d.]+-\d+\.(x86_64|aarch64)\.rpm$/)
  if (m) return { php: m[1], os: 'linux', arch: m[2], format: 'rpm' }
  return null
}

/** Lines are `<hash>  <filename>` (sha256sum format); returns filename → hash. */
function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i)
    if (m) sums.set(m[2].trim(), m[1].toLowerCase())
  }
  return sums
}

async function loadRepo(repo: string): Promise<Build[]> {
  // In GitHub Actions the runners share API rate limits by IP, so the
  // workflow passes GITHUB_TOKEN; locally the anonymous limit is plenty.
  const headers: Record<string, string> = { 'User-Agent': 'rapira-docs-build' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`

  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${repo}: HTTP ${res.status}`)
  const release = await res.json()

  const version = String(release.tag_name ?? '').replace(/^v/, '')
  let sums = new Map<string, string>()
  const sumsAsset = release.assets.find((a: any) => a.name.endsWith('SHA256SUMS.txt'))
  if (sumsAsset) {
    const sumsRes = await fetch(sumsAsset.browser_download_url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (sumsRes.ok) sums = parseChecksums(await sumsRes.text())
  }

  const builds: Build[] = []
  for (const asset of release.assets) {
    const parsed = parseAsset(asset.name)
    if (parsed) builds.push({
      ...parsed,
      version,
      name: asset.name,
      url: asset.browser_download_url,
      size: asset.size,
      sha256: sums.get(asset.name) ?? '',
    })
  }
  return builds
}

export default defineLoader({
  async load(): Promise<BuildsData> {
    const results = await Promise.allSettled(REPOS.map(loadRepo))
    const builds: Build[] = []
    for (const [i, result] of results.entries()) {
      if (result.status === 'fulfilled') builds.push(...result.value)
      else console.warn(`[builds.data] failed to fetch releases of ${REPOS[i]}:`, result.reason?.message ?? result.reason)
    }
    return { builds }
  },
})
