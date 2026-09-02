<script setup lang="ts">
import { ref } from 'vue'

/**
 * Shows one text panel for each alternative.
 * The page `<script setup>` block declares the tabs.
 * Each `<template #…>` slot contains one panel.
 * This keeps translatable text in the Markdown page.
 */
interface Tab {
  /** Tab label for the described alternative. */
  name: string
  /** Name of the `<template #…>` slot holding this tab's prose. */
  slot: string
  /** Products that use the alternative. The panel shows them as tags. */
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
      <!-- One grid cell contains all panels.
           The tallest panel sets the height and prevents layout movement. -->
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
  font-weight: var(--rapira-fw-ui);
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

/* Override `.vp-doc` paragraph styles for this small panel. */
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
  font-weight: var(--rapira-fw-ui);
  color: var(--vp-c-text-2);
}
</style>
