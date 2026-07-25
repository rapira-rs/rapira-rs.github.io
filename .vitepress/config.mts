import { defineConfig, HeadConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { generateRss, rssPlugin } from './rss'
import { isBlogPath, siteUrl as baseUrl } from './locales'
import { faqPlugin } from './faq'
import { infoBlockPlugin } from './info-block'

export default withMermaid(defineConfig({
  title: 'Rapira',
  description: 'Rapira documentation',

  mermaid: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    htmlLabels: false,
  },

  lastUpdated: true,
  cleanUrls: true,

  markdown: {
    config: (md) => {
      md.use(faqPlugin)
      md.use(infoBlockPlugin)
    },
  },

  srcExclude: ['CLAUDE.md', 'README.md'],
  ignoreDeadLinks: [/feed\.xml$/],

  vite: {
    plugins: [rssPlugin()],
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/rapira-fav.svg' }],
  ],

  buildEnd: async (config) => {
    await generateRss(config)
  },

  locales: {
    root: {
      label: 'English',
      lang: 'en',
      head: [
        ['link', { rel: 'alternate', type: 'application/rss+xml', title: 'Rapira Blog', href: '/feed.xml' }],
      ],
      themeConfig: {
        nav: [
          { text: 'Docs', link: '/docs/' },
          { text: 'Blog', link: '/blog/' },
        ],
        editLink: {
          pattern: 'https://github.com/rapira-rs/rapira-rs.github.io/edit/main/:path',
          text: 'Edit this page',
        },
        sidebar: {
          '/docs/': [
            {
              text: 'Introduction',
              items: [
                { text: 'Getting Started', link: '/docs/' },
              ],
            },
            {
              text: 'Contributing',
              items: [
                { text: 'Contributing to the docs', link: '/docs/contributing' },
              ],
            },
          ],
        },
      },
    },
    ru: {
      label: 'Русский',
      lang: 'ru',
      link: '/ru/',
      title: 'Rapira',
      description: 'Документация Rapira',
      head: [
        ['link', { rel: 'alternate', type: 'application/rss+xml', title: 'Блог Rapira', href: '/ru/feed.xml' }],
      ],
      themeConfig: {
        nav: [
          { text: 'Документация', link: '/ru/docs/' },
          { text: 'Блог', link: '/ru/blog/' },
        ],
        editLink: {
          pattern: 'https://github.com/rapira-rs/rapira-rs.github.io/edit/main/:path',
          text: 'Редактировать эту страницу',
        },
        sidebar: {
          '/ru/docs/': [
            {
              text: 'Введение',
              items: [
                { text: 'Начало работы', link: '/ru/docs/' },
              ],
            },
            {
              text: 'Участие',
              items: [
                { text: 'Помощь с документацией', link: '/ru/docs/contributing' },
              ],
            },
          ],
        },
        outline: {
          label: 'На этой странице',
        },
        docFooter: {
          prev: 'Назад',
          next: 'Вперёд',
        },
        lastUpdated: {
          text: 'Обновлено',
        },
        returnToTopLabel: 'Наверх',
        sidebarMenuLabel: 'Меню',
        darkModeSwitchLabel: 'Тема',
        langMenuLabel: 'Сменить язык',
      },
    },
    es: {
      label: 'Español',
      lang: 'es',
      link: '/es/',
      title: 'Rapira',
      description: 'Documentación de Rapira',
      head: [
        ['link', { rel: 'alternate', type: 'application/rss+xml', title: 'Blog de Rapira', href: '/es/feed.xml' }],
      ],
      themeConfig: {
        nav: [
          { text: 'Documentación', link: '/es/docs/' },
          { text: 'Blog', link: '/es/blog/' },
        ],
        editLink: {
          pattern: 'https://github.com/rapira-rs/rapira-rs.github.io/edit/main/:path',
          text: 'Editar esta página',
        },
        sidebar: {
          '/es/docs/': [
            {
              text: 'Introducción',
              items: [
                { text: 'Primeros pasos', link: '/es/docs/' },
              ],
            },
            {
              text: 'Contribuir',
              items: [
                { text: 'Contribuir a la documentación', link: '/es/docs/contributing' },
              ],
            },
          ],
        },
        outline: {
          label: 'En esta página',
        },
        docFooter: {
          prev: 'Anterior',
          next: 'Siguiente',
        },
        lastUpdated: {
          text: 'Actualizado',
        },
        returnToTopLabel: 'Volver arriba',
        sidebarMenuLabel: 'Menú',
        darkModeSwitchLabel: 'Apariencia',
        langMenuLabel: 'Cambiar idioma',
      },
    },
    zh: {
      label: '简体中文',
      lang: 'zh',
      link: '/zh/',
      title: 'Rapira',
      description: 'Rapira 文档',
      head: [
        ['link', { rel: 'alternate', type: 'application/rss+xml', title: 'Rapira 博客', href: '/zh/feed.xml' }],
      ],
      themeConfig: {
        nav: [
          { text: '文档', link: '/zh/docs/' },
          { text: '博客', link: '/zh/blog/' },
        ],
        editLink: {
          pattern: 'https://github.com/rapira-rs/rapira-rs.github.io/edit/main/:path',
          text: '编辑此页面',
        },
        sidebar: {
          '/zh/docs/': [
            {
              text: '简介',
              items: [
                { text: '快速开始', link: '/zh/docs/' },
              ],
            },
            {
              text: '参与贡献',
              items: [
                { text: '参与文档贡献', link: '/zh/docs/contributing' },
              ],
            },
          ],
        },
        outline: {
          label: '本页目录',
        },
        docFooter: {
          prev: '上一页',
          next: '下一页',
        },
        lastUpdated: {
          text: '最后更新于',
        },
        returnToTopLabel: '返回顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '外观',
        langMenuLabel: '切换语言',
      },
    },
    pl: {
      label: 'Polski',
      lang: 'pl',
      link: '/pl/',
      title: 'Rapira',
      description: 'Dokumentacja Rapiry',
      head: [
        ['link', { rel: 'alternate', type: 'application/rss+xml', title: 'Blog Rapiry', href: '/pl/feed.xml' }],
      ],
      themeConfig: {
        nav: [
          { text: 'Dokumentacja', link: '/pl/docs/' },
          { text: 'Blog', link: '/pl/blog/' },
        ],
        editLink: {
          pattern: 'https://github.com/rapira-rs/rapira-rs.github.io/edit/main/:path',
          text: 'Edytuj tę stronę',
        },
        sidebar: {
          '/pl/docs/': [
            {
              text: 'Wprowadzenie',
              items: [
                { text: 'Pierwsze kroki', link: '/pl/docs/' },
              ],
            },
            {
              text: 'Współtworzenie',
              items: [
                { text: 'Współtworzenie dokumentacji', link: '/pl/docs/contributing' },
              ],
            },
          ],
        },
        outline: {
          label: 'Na tej stronie',
        },
        docFooter: {
          prev: 'Poprzednia',
          next: 'Następna',
        },
        lastUpdated: {
          text: 'Zaktualizowano',
        },
        returnToTopLabel: 'Powrót na górę',
        sidebarMenuLabel: 'Menu',
        darkModeSwitchLabel: 'Wygląd',
        langMenuLabel: 'Zmień język',
      },
    },
  },

  themeConfig: {
    // The wordmark replaces the site title in the nav bar; each locale inherits it.
    logo: {
      light: '/rapira-bg-light.svg',
      dark: '/rapira-bg-dark.svg',
      alt: 'Rapira',
    },
    siteTitle: false,

    search: {
      provider: 'local',
    },
  },

  transformPageData(pageData) {
    // Disable lastUpdated and editLink for blog posts
    const pagePath = '/' + pageData.relativePath.replace(/\.md$/, '')
    if (isBlogPath(pagePath) || isBlogPath(pagePath + '/')) {
      pageData.frontmatter.lastUpdated = false
      pageData.frontmatter.editLink = false
    }
  },

  transformHead({ pageData, siteData }) {
    const head: HeadConfig[] = []

    const title = pageData.frontmatter.title || siteData.title
    const description = pageData.frontmatter.description || siteData.description
    const image = pageData.frontmatter.image
    const pageUrl = baseUrl + '/' + pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '')

    head.push(['meta', { property: 'og:type', content: 'website' }])
    head.push(['meta', { property: 'og:url', content: pageUrl }])

    if (title) {
      head.push(['meta', { property: 'og:title', content: title }])
      head.push(['meta', { name: 'twitter:title', content: title }])
    }

    if (description) {
      head.push(['meta', { property: 'og:description', content: description }])
      head.push(['meta', { name: 'twitter:description', content: description }])
    }

    if (image) {
      head.push(['meta', { property: 'og:image', content: baseUrl + image }])
      head.push(['meta', { name: 'twitter:image', content: baseUrl + image }])
      head.push(['meta', { name: 'twitter:card', content: 'summary_large_image' }])
    }

    return head
  },
}))
