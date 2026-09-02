<script setup lang="ts">
import { computed, useSlots } from 'vue'

/**
 * Shows a full-width home page section.
 * An optional `aside` slot creates a second column for related content.
 *
 * The page supplies headings and text through properties and slots.
 * Translators change `index.md`, not this component.
 */
defineProps<{
  /** Optional category label above the title. */
  eyebrow?: string
  title: string
  /** Optional link below the text. Rendering requires both properties. */
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
