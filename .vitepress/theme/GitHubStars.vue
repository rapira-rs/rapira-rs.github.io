<script setup lang="ts">
import { ref, onMounted } from 'vue'
import GitHubIcon from './GitHubIcon.vue'

// Repository whose stars are displayed in the nav bar.
const repo = 'rapira-rs/rapira'

const stars = ref<number | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    const response = await fetch(`https://api.github.com/repos/${repo}`)
    const data = await response.json()
    stars.value = data.stargazers_count
  } catch (error) {
    console.error('Failed to fetch GitHub stars:', error)
  } finally {
    loading.value = false
  }
})

const formatStars = (count: number | null) => {
  if (!count) return '0'
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'k'
  }
  return count.toString()
}
</script>

<template>
  <a
    :href="`https://github.com/${repo}`"
    target="_blank"
    rel="noopener noreferrer"
    class="github-stars-button"
  >
    <GitHubIcon />
    <span v-if="!loading && stars !== null" class="github-count">
      {{ formatStars(stars) }}
      <span class="github-text">⭐</span>
    </span>
    <span v-else-if="loading" class="github-count loading">...</span>
  </a>
</template>

<style scoped>
.github-stars-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  margin-left: 12px;
  font-size: var(--rapira-fs-nav-small);
  font-weight: var(--rapira-fw-ui);
  line-height: 20px;
  color: var(--vp-c-text-1);
  background-color: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  text-decoration: none;
  transition: all 0.2s ease;
}

.github-stars-button:hover {
  background-color: var(--vp-c-bg-elv);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.github-text {
  flex-shrink: 0;
}

.github-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: var(--rapira-fw-ui);
  line-height: 18px;
  color: var(--vp-c-text-2);
  background-color: var(--vp-c-default-soft);
  border-radius: 10px;
}

.github-count.loading {
  color: var(--vp-c-text-3);
}

/* Responsive: hide text on small screens */
@media (max-width: 768px) {
  .github-text {
    display: none;
  }
  .github-count {
    display: none;
  }

  .github-stars-button {
    padding: 4px 8px;
  }
}
</style>
