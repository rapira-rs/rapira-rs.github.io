<script setup lang="ts">
import { computed } from 'vue'
import { useData } from 'vitepress'
import { getLocaleByCode, getBlogUrl } from '../locales'

const { frontmatter, lang } = useData()

// Use the locale service for all locale URLs. Do not add fixed locale paths.
const locale = computed(() => getLocaleByCode(lang.value))
const blogUrl = computed(() => getBlogUrl(locale.value))
const backTitle = computed(() => locale.value.blogBackLabel)

function formatDate(date: string | Date): string {
  const d = new Date(date)
  return d.toISOString().slice(0, 10)
}
</script>

<template>
  <div class="blog-post-header" v-if="frontmatter.image || frontmatter.date || frontmatter.author">
    <div class="post-image-wrap" v-if="frontmatter.image">
      <a :href="blogUrl" class="back-to-blog" :title="backTitle">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M11 4L6 9L11 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </a>
      <img
        :src="frontmatter.image"
        :alt="frontmatter.title"
        class="post-hero-image"
      />
    </div>
    <div class="post-meta" v-if="frontmatter.date || frontmatter.author">
      <span v-if="frontmatter.date" class="post-date">{{ formatDate(frontmatter.date) }}</span>
      <span v-if="frontmatter.author" class="post-author">{{ frontmatter.author }}</span>
    </div>
  </div>
</template>

<style scoped>
.blog-post-header {
  margin-bottom: 1.5rem;
}

.post-image-wrap {
  position: relative;
}

.back-to-blog {
  position: absolute;
  top: 12px;
  left: -48px;
  display: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: all 0.2s;
}

.back-to-blog:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

@media (min-width: 1280px) {
  .back-to-blog {
    display: flex;
  }
}

.post-hero-image {
  width: 100%;
  height: auto;
  border-radius: 12px;
  margin-bottom: 1rem;
}

.post-meta {
  display: flex;
  gap: 1rem;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}
</style>
