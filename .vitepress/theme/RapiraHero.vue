<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import { VPImage } from 'vitepress/theme'
import GitHubIcon from './GitHubIcon.vue'
import { getLocaleByCode, getDocsUrl, getDownloadUrl } from '../locales'

// `tagline` and `pitch` come from each locale's index.md frontmatter, so the copy
// lives with the content instead of being another per-locale map in here.
const { lang, frontmatter } = useData()

// Action button labels per locale (UI strings). URLs come from the locale service.
const startLabels: Record<string, string> = {
  en: 'Get Started',
  ru: 'Быстрый старт',
  es: 'Empezar',
  zh: '开始使用',
  pl: 'Zacznij',
}

const downloadLabels: Record<string, string> = {
  en: 'Download',
  ru: 'Скачать',
  es: 'Descargar',
  zh: '下载',
  pl: 'Pobierz',
}

const locale = computed(() => getLocaleByCode(lang.value))
const t = computed(() => ({
  start: startLabels[lang.value] || startLabels.en,
  download: downloadLabels[lang.value] || downloadLabels.en,
  docs: getDocsUrl(locale.value),
  downloadUrl: getDownloadUrl(locale.value),
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
    <div class="rapira-hero-head">
      <div class="rapira-hero-logo">
        <VPImage :image="wordmark" draggable="false" />
      </div>
      <div v-if="frontmatter.tagline || frontmatter.pitch" class="rapira-lede">
        <p v-if="frontmatter.tagline" class="rapira-lede-title">{{ frontmatter.tagline }}</p>
        <p v-if="frontmatter.pitch" class="rapira-lede-text">{{ frontmatter.pitch }}</p>
      </div>
    </div>
    <div class="rapira-hero-actions">
      <a class="rapira-hero-action" :href="t.docs">{{ t.start }}</a>
      <a class="rapira-hero-action" :href="t.downloadUrl">{{ t.download }}</a>
      <a class="rapira-hero-action" :href="githubUrl" target="_blank" rel="noreferrer">
        <GitHubIcon />
        GitHub
      </a>
    </div>
  </div>
</template>
