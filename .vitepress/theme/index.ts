import { computed, defineComponent, h } from 'vue'
import type { Theme } from 'vitepress'
import { useRoute } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import GitHubStars from './GitHubStars.vue'
import BlogPosts from './BlogPosts.vue'
import BlogPostHeader from './BlogPostHeader.vue'
import CodeTabs from './CodeTabs.vue'
import RapiraHero from './RapiraHero.vue'
import RapiraSection from './RapiraSection.vue'
import FeatureTags from './FeatureTags.vue'
import { isBlogPath } from '../locales'
import './style.css'

export default {
  extends: DefaultTheme,
  Layout: defineComponent({
    setup() {
      const route = useRoute()
      const isBlog = computed(() => isBlogPath(route.path))

      return () => h(DefaultTheme.Layout, null, {
        'home-hero-before': () => h(RapiraHero),
        'doc-before': () => isBlog.value ? h(BlogPostHeader) : null,
        'nav-bar-content-after': () => h(GitHubStars),
      })
    },
  }),
  enhanceApp({ app }) {
    app.component('BlogPosts', BlogPosts)
    app.component('CodeTabs', CodeTabs)
    app.component('RapiraSection', RapiraSection)
    app.component('FeatureTags', FeatureTags)
  },
} satisfies Theme
