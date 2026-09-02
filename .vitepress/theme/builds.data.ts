import { defineLoader } from 'vitepress'

/**
 * Creates download page data from the latest stable releases.
 * It parses each asset into operating system, architecture, PHP, and format.
 * It adds SHA-256 values from the release checksum file.
 *
 * It runs during each build and development server start.
 * The client does not make GitHub API requests.
 * A new deployment adds new release data.
 * A failed request logs a warning and returns an empty list.
 */

/** Repositories that publish builds. Windows uses a separate repository. */
const REPOS = ['rapira-rs/rapira', 'rapira-rs/rapira-windows']

/** Maximum GitHub request duration before failure. */
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
  /** Asset SHA-256 from the release checksum file, or an empty string. */
  sha256: string
}

export interface BuildsData {
  builds: Build[]
}

declare const data: BuildsData
export { data }

// Parse the three release asset name formats.
// New PHP versions and architectures do not require a separate list.
function parseAsset(name: string): Pick<Build, 'os' | 'arch' | 'php' | 'format'> | null {
  let m = name.match(/^rapira-v[\d.]+-php([\d.]+)-(linux|macos|windows)-(x86_64|aarch64)\.(tar\.gz|zip)$/)
  if (m) return { php: m[1], os: m[2], arch: m[3], format: m[4] }
  m = name.match(/^rapira-php([\d.]+)_[\d.]+-\d+_(amd64|arm64)\.deb$/)
  if (m) return { php: m[1], os: 'linux', arch: m[2] === 'amd64' ? 'x86_64' : 'aarch64', format: 'deb' }
  m = name.match(/^rapira-php([\d.]+)-[\d.]+-\d+\.(x86_64|aarch64)\.rpm$/)
  if (m) return { php: m[1], os: 'linux', arch: m[2], format: 'rpm' }
  return null
}

/** Convert `sha256sum` lines into a map from file name to hash. */
function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>()
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/i)
    if (m) sums.set(m[2].trim(), m[1].toLowerCase())
  }
  return sums
}

async function loadRepo(repo: string): Promise<Build[]> {
  // GitHub Actions runners share API limits by IP address.
  // The workflow supplies `GITHUB_TOKEN` to prevent anonymous limit errors.
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
