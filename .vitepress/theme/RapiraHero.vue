<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import { VPImage, VPButton } from 'vitepress/theme'
import { getLocaleByCode, getDocsUrl } from '../locales'

const { lang } = useData()

// "Get Started" button label per locale (UI string). Docs URL comes from the locale service.
const startLabels: Record<string, string> = {
  en: 'Get Started',
  ru: 'Начать',
  es: 'Empezar',
  zh: '开始使用',
  pl: 'Zacznij',
}

const locale = computed(() => getLocaleByCode(lang.value))
const t = computed(() => ({
  start: startLabels[lang.value] || startLabels.en,
  docs: getDocsUrl(locale.value),
}))

const wordmark = {
  light: '/rapira-bg-light.svg',
  dark: '/rapira-bg-dark.svg',
  alt: 'RAPIRA',
}

const githubUrl = 'https://github.com/rapira-rs/rapira'
</script>

<template>
  <div class="rapira-hero">
    <div class="rapira-hero-logo">
      <VPImage :image="wordmark" />
    </div>
    <div class="rapira-hero-actions">
      <VPButton theme="brand" :text="t.start" :href="t.docs" />
      <VPButton theme="alt" text="GitHub" :href="githubUrl" />
    </div>
  </div>
</template>
