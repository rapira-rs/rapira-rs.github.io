<script setup lang="ts">
import { computed, useSlots } from 'vue'

/**
 * A full-width home-page segment: a heading row, then the prose — with an
 * optional `aside` slot that puts anything (cards, a code block, an image)
 * in a second column on the right. Without it the text runs single-column.
 *
 * The frame is shared by every segment so they read as one series. Copy comes
 * from the page — props for the headings, the default slot for the prose — so
 * translators edit `index.md` and never this component.
 */
defineProps<{
  /** Small label above the title, naming the area (`Networking`, …). */
  eyebrow?: string
  title: string
  /** Optional link under the text; both props are needed for it to render. */
  link?: string
  linkText?: string
}>()

const slots = useSlots()
const hasAside = computed(() => !!slots.aside)
const hasFooter = computed(() => !!slots.footer)
</script>

<template>
  <section class="rapira-section">
    <header class="rapira-section-head">
      <p v-if="eyebrow" class="rapira-section-eyebrow">{{ eyebrow }}</p>
      <h2 class="rapira-section-title">{{ title }}</h2>
    </header>
    <div class="rapira-section-body" :class="{ 'has-aside': hasAside }">
      <div class="rapira-section-text">
        <slot />
        <a v-if="link && linkText" class="rapira-section-link" :href="link">{{ linkText }}</a>
      </div>
      <div v-if="hasAside" class="rapira-section-aside">
        <slot name="aside" />
      </div>
    </div>
    <div v-if="hasFooter" class="rapira-section-footer">
      <slot name="footer" />
    </div>
  </section>
</template>
