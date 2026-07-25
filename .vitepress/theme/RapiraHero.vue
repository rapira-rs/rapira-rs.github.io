<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import { VPImage } from 'vitepress/theme'
import GitHubIcon from './GitHubIcon.vue'
import { getLocaleByCode, getDocsUrl } from '../locales'

const { lang } = useData()

// "Get Started" button label per locale (UI string). Docs URL comes from the locale service.
const startLabels: Record<string, string> = {
  en: 'Get Started',
  ru: 'Быстрый старт',
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
      <VPImage :image="wordmark" draggable="false" />
    </div>
    <div class="rapira-hero-actions">
      <a class="rapira-hero-action" :href="t.docs">{{ t.start }}</a>
      <a class="rapira-hero-action" :href="githubUrl" target="_blank" rel="noreferrer">
        <GitHubIcon />
        GitHub
      </a>
    </div>
  </div>
</template>
