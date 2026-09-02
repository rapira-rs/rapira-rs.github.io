<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { data } from './builds.data'

/**
 * Selects a release asset from build-time data in `builds.data.ts`.
 * The controls select the operating system, architecture, PHP, and format.
 * The result contains a download button and SHA-256 value.
 *
 * The `labels` property supplies all translated UI text.
 * Each locale defines the text in its `download.md`.
 * The `dev-note` slot appears when the selected system is not Linux.
 */
interface Labels {
  os: string
  arch: string
  php: string
  format: string
  /** Download button text. The component adds the version number. */
  download: string
  /** Message shown when no build data is available. */
  error: string
  /** Releases page link text for the error state. */
  releases: string
}

defineProps<{ labels: Labels }>()

const RELEASES_URL = 'https://github.com/rapira-rs/rapira/releases'

const builds = data.builds

const os = ref('')
const arch = ref('')
const php = ref('')
const format = ref('')

const OS_ORDER = ['linux', 'macos', 'windows']
const OS_NAMES: Record<string, string> = { linux: 'Linux', macos: 'macOS', windows: 'Windows' }
const ARCH_NAMES: Record<string, string> = { x86_64: 'x86-64', aarch64: 'ARM64' }
const ARCH_ORDER = ['x86_64', 'aarch64']
const FORMAT_NAMES: Record<string, string> = { 'tar.gz': 'tar.gz', zip: 'zip', deb: '.deb', rpm: '.rpm' }
const FORMAT_ORDER = ['tar.gz', 'zip', 'deb', 'rpm']

const unique = (values: string[]) => [...new Set(values)]

const osList = computed(() => OS_ORDER.filter(o => builds.some(b => b.os === o)))
const archList = computed(() => ARCH_ORDER.filter(a => builds.some(b => b.os === os.value && b.arch === a)))
const phpList = computed(() => unique(
  builds.filter(b => b.os === os.value && b.arch === arch.value).map(b => b.php),
).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))
const formatList = computed(() => FORMAT_ORDER.filter(f => builds.some(
  b => b.os === os.value && b.arch === arch.value && b.php === php.value && b.format === f,
)))

// Update each selection when an earlier selection makes it invalid.
// Select the newest PHP and the first available architecture and format.
watch(osList, list => { if (!list.includes(os.value)) os.value = list[0] ?? '' }, { immediate: true })
watch(archList, list => { if (!list.includes(arch.value)) arch.value = list[0] ?? '' }, { immediate: true })
watch(phpList, list => { if (!list.includes(php.value)) php.value = list[list.length - 1] ?? '' }, { immediate: true })
watch(formatList, list => { if (!list.includes(format.value)) format.value = list[0] ?? '' }, { immediate: true })

const build = computed(() => builds.find(
  b => b.os === os.value && b.arch === arch.value && b.php === php.value && b.format === format.value,
))

const sizeLabel = computed(() => build.value ? `${(build.value.size / 1048576).toFixed(1)} MB` : '')

onMounted(() => {
  // Select the client operating system after hydration.
  // Before this selection, rendered markup uses the first system in the list.
  const ua = navigator.userAgent
  const detected = /Windows/i.test(ua) ? 'windows' : /Mac/i.test(ua) ? 'macos' : 'linux'
  if (osList.value.includes(detected)) os.value = detected
})
</script>

<template>
  <div class="download-builds">
    <p v-if="!builds.length" class="db-status">
      {{ labels.error }}
      <a :href="RELEASES_URL" target="_blank" rel="noopener">{{ labels.releases }}</a>
    </p>
    <template v-else>
      <div class="db-row">
        <span class="db-label">{{ labels.os }}</span>
        <div class="db-pills" role="group" :aria-label="labels.os">
          <button
            v-for="o in osList"
            :key="o"
            class="db-pill"
            :class="{ active: os === o }"
            :aria-pressed="os === o"
            @click="os = o"
          >{{ OS_NAMES[o] ?? o }}</button>
        </div>
      </div>
      <div class="db-row">
        <span class="db-label">{{ labels.arch }}</span>
        <div class="db-pills" role="group" :aria-label="labels.arch">
          <button
            v-for="a in archList"
            :key="a"
            class="db-pill"
            :class="{ active: arch === a }"
            :aria-pressed="arch === a"
            @click="arch = a"
          >{{ ARCH_NAMES[a] ?? a }}</button>
        </div>
      </div>
      <div class="db-row">
        <span class="db-label">{{ labels.php }}</span>
        <div class="db-pills" role="group" :aria-label="labels.php">
          <button
            v-for="p in phpList"
            :key="p"
            class="db-pill"
            :class="{ active: php === p }"
            :aria-pressed="php === p"
            @click="php = p"
          >PHP {{ p }}</button>
        </div>
      </div>
      <div v-if="formatList.length > 1" class="db-row">
        <span class="db-label">{{ labels.format }}</span>
        <div class="db-pills" role="group" :aria-label="labels.format">
          <button
            v-for="f in formatList"
            :key="f"
            class="db-pill"
            :class="{ active: format === f }"
            :aria-pressed="format === f"
            @click="format = f"
          >{{ FORMAT_NAMES[f] ?? f }}</button>
        </div>
      </div>

      <slot v-if="os !== 'linux'" name="dev-note" />

      <div v-if="build" class="db-result">
        <a class="db-button" :href="build.url">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M8 1.5v9m0 0 3.5-3.5M8 10.5 4.5 7M2.5 13h11" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          {{ labels.download }} {{ build.version }}
        </a>
        <p class="db-file">
          <span>{{ build.name }}</span>
          <span>·</span>
          <span>{{ sizeLabel }}</span>
        </p>
        <p v-if="build.sha256" class="db-sha">
          <span>SHA-256</span>
          <code>{{ build.sha256 }}</code>
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.download-builds {
  margin: 32px 0;
}

.db-status {
  color: var(--vp-c-text-2);
}

.db-row {
  display: flex;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 16px;
}

.db-label {
  flex-shrink: 0;
  width: 180px;
  font-size: 14px;
  color: var(--vp-c-text-2);
}

.db-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.db-pill {
  padding: 6px 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: transparent;
  font-family: var(--vp-font-family-base);
  font-size: 14px;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 0.2s, border-color 0.2s, background-color 0.2s;
}

.db-pill:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
}

.db-pill.active {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.db-result {
  margin-top: 32px;
}

.db-button {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 10px 24px;
  border-radius: 8px;
  background: var(--vp-button-brand-bg);
  color: var(--vp-button-brand-text) !important;
  font-size: 15px;
  font-weight: var(--rapira-fw-ui-title);
  text-decoration: none !important;
  transition: background-color 0.2s;
}

.db-button:hover {
  background: var(--vp-button-brand-hover-bg);
}

.db-file {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.db-sha {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-top: 4px;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.db-sha code {
  padding: 0;
  background: transparent;
  font-size: 12px;
  color: var(--vp-c-text-2);
  word-break: break-all;
}

@media (max-width: 639px) {
  .db-row {
    flex-direction: column;
    gap: 8px;
  }

  .db-label {
    width: auto;
  }
}
</style>
