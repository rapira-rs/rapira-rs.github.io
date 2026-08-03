<script setup lang="ts">
import { ref } from 'vue'

/**
 * A tab strip over short prose panels — one tab per alternative being
 * compared. The tab list is declared in the page's `<script setup>` and each
 * panel's prose goes in a `<template #…>` slot, so all copy stays in the
 * page's markdown, the same pattern `CodeTabs` uses.
 */
interface Tab {
  /** Tab label — the name of the approach being described. */
  name: string
  /** Name of the `<template #…>` slot holding this tab's prose. */
  slot: string
  /** Products built on the approach; drawn as small tags under the prose. */
  users?: string[]
}

defineProps<{
  tabs: Tab[]
}>()

const activeIndex = ref(0)
</script>

<template>
  <div class="text-tabs">
    <div class="text-tabs-bar" role="tablist">
      <button
        v-for="(tab, index) in tabs"
        :key="tab.slot"
        class="text-tabs-tab"
        :class="{ active: activeIndex === index }"
        role="tab"
        :aria-selected="activeIndex === index"
        @click="activeIndex = index"
      >{{ tab.name }}</button>
    </div>
    <div class="text-tabs-body">
      <!-- Panels share one grid cell, so the block keeps the height of its
           tallest panel and switching tabs never shifts the page. -->
      <div
        v-for="(tab, index) in tabs"
        :key="tab.slot"
        class="text-tabs-panel"
        :class="{ active: activeIndex === index }"
        role="tabpanel"
      >
        <slot :name="tab.slot"></slot>
        <ul v-if="tab.users?.length" class="text-tabs-users">
          <li v-for="user in tab.users" :key="user">{{ user }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.text-tabs {
  padding: 8px;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.text-tabs-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.text-tabs-tab {
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-family: var(--vp-font-family-base);
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: color 0.2s, background-color 0.2s;
}

.text-tabs-tab:hover {
  color: var(--vp-c-text-1);
}

.text-tabs-tab.active {
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  box-shadow: var(--vp-shadow-1);
}

.text-tabs-body {
  display: grid;
}

.text-tabs-panel {
  grid-area: 1 / 1;
  visibility: hidden;
  padding: 16px 12px 12px;
}

.text-tabs-panel.active {
  visibility: visible;
}

/* The prose arrives from a markdown slot, so it carries `.vp-doc` paragraph
   styling — scale it down to the panel. */
.text-tabs-panel :deep(p) {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

.text-tabs-users {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 16px 0 0;
  padding: 0;
  list-style: none;
}

.text-tabs-users li {
  margin: 0;
  padding: 2px 10px;
  border-radius: 99px;
  background: var(--vp-c-default-soft);
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-2);
}
</style>
