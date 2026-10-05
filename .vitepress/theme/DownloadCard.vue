<script setup lang="ts">
/**
 * Frames one download method on the download page.
 * The slot contains Markdown content with an `h2` heading.
 */
</script>

<template>
  <section class="download-card">
    <slot />
  </section>
</template>

<style scoped>
.download-card {
  margin: 32px 0;
  padding: 24px 32px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
}

.download-card :slotted(h2) {
  margin-top: 0;
  padding-top: 0;
  border-top: none;
}

.download-card :slotted(:last-child) {
  margin-bottom: 0;
}

@media (max-width: 639px) {
  .download-card {
    padding: 20px 16px;
  }
}
</style>
