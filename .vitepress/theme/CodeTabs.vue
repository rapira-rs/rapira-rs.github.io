<script setup lang="ts">
import { computed, ref } from 'vue'

interface Tab {
  /** Tab label, normally a file name — `worker.php`, `rapira.toml`. */
  name: string
  /** Name of the `<template #…>` slot holding this tab's code block. */
  slot: string
  /** Icon alias; derived from the label's extension when omitted. */
  icon?: string
}

const props = defineProps<{
  tabs: Tab[]
}>()

const activeIndex = ref(0)

// The glyph is drawn inline rather than loaded from `public/`: one shape serves
// every file type, so all a language needs is its accent colour — no light/dark
// asset pairs to keep in sync, and a typo in an alias cannot 404.
const SHEET = 'M4.5 1.5h4l3 3v9a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z'
const FOLD = 'M8.5 1.5v3h3'

// Accent colours follow GitHub's language palette, so they read as the language
// they mark. `null` means the glyph inherits the tab's own colour.
const accents: Record<string, string | null> = {
  php: '#8892bf',
  rust: '#d0894f',
  toml: '#a9603c',
  yaml: '#cb171e',
  json: '#d9a441',
  shell: '#4eaa25',
  file: null,
}

const extensions: Record<string, string> = {
  php: 'php',
  rs: 'rust',
  toml: 'toml',
  yaml: 'yaml',
  yml: 'yaml',
  json: 'json',
  sh: 'shell',
  bash: 'shell',
}

function iconOf(tab: Tab): string {
  if (tab.icon) return tab.icon
  const extension = tab.name.split('.').pop()?.toLowerCase() ?? ''
  return extensions[extension] ?? 'file'
}

const icons = computed(() => props.tabs.map((tab) => {
  const alias = iconOf(tab)
  const accent = accents[alias] ?? null
  return {
    terminal: alias === 'shell',
    style: accent ? { color: accent } : undefined,
  }
}))
</script>

<template>
  <div class="code-tabs">
    <div class="code-tabs-bar">
      <button
        v-for="(tab, index) in tabs"
        :key="tab.slot"
        class="code-tab"
        :class="{ active: activeIndex === index }"
        @click="activeIndex = index"
      >
        <svg class="code-tab-icon" viewBox="0 0 16 16" aria-hidden="true" :style="icons[index].style">
          <template v-if="icons[index].terminal">
            <rect x="0.75" y="2.75" width="14.5" height="10.5" rx="1.5" />
            <path d="M4 6.5 6 8.5 4 10.5" />
            <path d="M8 10.5h4" />
          </template>
          <template v-else>
            <path :d="SHEET" fill="currentColor" fill-opacity="0.16" />
            <path :d="FOLD" />
          </template>
        </svg>
        <span class="code-tab-name">{{ tab.name }}</span>
      </button>
    </div>

    <div class="code-tabs-body">
      <div v-for="(tab, index) in tabs" v-show="activeIndex === index" :key="tab.slot" class="code-tab-panel">
        <slot :name="tab.slot"></slot>
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-tabs {
  margin: 24px 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-code-block-bg);
}

.code-tabs-bar {
  display: flex;
  overflow-x: auto;
  background: var(--vp-c-bg-elv);
  border-bottom: 1px solid var(--vp-c-divider);
  scrollbar-width: none;
}

.code-tabs-bar::-webkit-scrollbar {
  display: none;
}

.code-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: none;
  border-right: 1px solid var(--vp-c-divider);
  background: transparent;
  color: var(--vp-c-text-3);
  font-family: var(--vp-font-family-base);
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 0.2s, color 0.2s;
}

.code-tab:hover {
  color: var(--vp-c-text-2);
}

/* The open tab carries the code area's background, so the two merge into one
   surface instead of the tab reading as a button. */
.code-tab.active {
  background: var(--vp-code-block-bg);
  color: var(--vp-c-text-1);
  box-shadow: inset 0 -2px 0 var(--vp-c-brand-1);
}

.code-tab-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* The margin, rounding and shadow a code block normally carries are dropped in
   style.css, next to the rule that adds them. Only the language label is this
   component's business: the tab already names the file. */
.code-tab-panel :deep(div[class*='language-'] > span.lang) {
  display: none;
}
</style>
