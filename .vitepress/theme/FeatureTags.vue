<script setup lang="ts">
interface Tag {
  /** Tag text, such as `HTTP/2` or `Keep-alive`. */
  label: string
  /** Defaults to true. False identifies a feature that is not available. */
  ready?: boolean
}

defineProps<{
  items: Tag[]
}>()
</script>

<template>
  <ul class="feature-tags">
    <li
      v-for="item in items"
      :key="item.label"
      class="feature-tag"
      :class="{ pending: item.ready === false }"
    >
      <span class="feature-tag-dot" aria-hidden="true"></span>
      {{ item.label }}
    </li>
  </ul>
</template>

<style scoped>
/* Remove standard `.vp-doc ul` markers and indentation. */
.feature-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 28px 0 0;
  padding: 0;
  list-style: none;
}

.feature-tag {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  padding: 5px 11px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.4;
  white-space: nowrap;
}

.feature-tag-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}

/* Show unavailable features with low contrast, a dashed border, and a hollow marker. */
.feature-tag.pending {
  background: transparent;
  border-style: dashed;
  color: var(--vp-c-text-3);
}

.feature-tag.pending .feature-tag-dot {
  background: transparent;
  box-shadow: inset 0 0 0 1px currentColor;
}
</style>
