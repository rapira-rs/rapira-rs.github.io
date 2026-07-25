<script setup lang="ts">
import { computed } from 'vue'
import { data as posts } from './posts.data'

const props = defineProps<{
  folder: string
}>()

const filteredPosts = computed(() => {
  return posts.filter((post) => post.url.startsWith(props.folder))
})

// Prefer the derived thumbnail; if it 404s, swap to the full image.
function onImageError(event: Event, fallback: string | undefined) {
  const img = event.target as HTMLImageElement
  if (fallback && img.src !== fallback) {
    img.src = fallback
  }
}
</script>

<template>
  <div class="blog-posts">
    <article v-for="post in filteredPosts" :key="post.url" class="post-card">
      <a :href="post.url" class="post-image-link">
        <img
          v-if="post.thumb || post.image"
          :src="post.thumb || post.image"
          :alt="post.title"
          class="post-image"
          @error="onImageError($event, post.image)"
        />
      </a>
      <div class="post-content">
        <div class="post-title">
          <a :href="post.url">{{ post.title }}</a>
        </div>
        <p class="post-description">{{ post.description }}</p>
        <div class="post-meta">
          <span class="post-date">{{ post.date }}</span>
          <span v-if="post.author" class="post-author">{{ post.author }}</span>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.blog-posts {
  display: flex;
  flex-direction: column;
  gap: 2rem;
  margin-top: 1.5rem;
}

.post-card {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  padding-bottom: 2rem;
  border-bottom: 1px solid var(--vp-c-divider);
}

.post-card:last-child {
  border-bottom: none;
}

.post-image-link {
  flex-shrink: 0;
  display: block;
  width: 200px;
  aspect-ratio: 16 / 10;
  overflow: hidden;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}

.post-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.2s ease;
}

.post-image-link:hover .post-image {
  transform: scale(1.05);
}

.post-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.post-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.3;
}

.post-title a {
  text-decoration: none;
  color: var(--vp-c-text-1);
}

.post-title a:hover {
  color: var(--vp-c-brand-1);
}

.post-description {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 0.95rem;
  line-height: 1.5;
}

.post-meta {
  display: flex;
  gap: 1rem;
  color: var(--vp-c-text-3);
  font-size: 0.85rem;
  margin-top: auto;
}

@media (max-width: 640px) {
  .post-card {
    flex-direction: column;
  }

  .post-image-link {
    width: 100%;
    aspect-ratio: 16 / 9;
  }
}
</style>
