<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import { VPImage } from 'vitepress/theme'
import GitHubIcon from './GitHubIcon.vue'
import { getLocaleByCode, getDocsUrl, getDownloadUrl } from '../locales'

// Each locale index.md supplies `tagline` and `pitch`.
// This keeps translated text with the page content.
const { lang, frontmatter } = useData()

// These are action labels for each locale. The locale service supplies URLs.
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
