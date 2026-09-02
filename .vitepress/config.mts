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
    fontFamily: "'IBM Plex Sans', ui-sans-serif, system-ui, sans-serif",
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

  srcExclude: ['AGENTS.md', 'CLAUDE.md', 'README.md'],
  ignoreDeadLinks: [/feed\.xml$/],

  vite: {
    plugins: [rssPlugin()],
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/rapira-fav.svg' }],
    ['script', { async: '', src: 'https://www.googletagmanager.com/gtag/js?id=G-Q7Z14B1SZ9' }],
    ['script', {}, `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-Q7Z14B1SZ9');`],
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
          { text: 'Docs', link: '/docs/intro/' },
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
                { text: 'What is Rapira?', link: '/docs/intro/' },
                { text: 'Installation', link: '/docs/intro/installation' },
                { text: 'Quickstart', link: '/docs/intro/quickstart' },
                { text: 'Build from source', link: '/docs/intro/build-from-source' },
              ],
            },
            {
              text: 'Writing your app',
              items: [
                { text: 'Execution modes', link: '/docs/execution-modes' },
                { text: 'Classic mode', link: '/docs/classic' },
                { text: 'Worker mode', link: '/docs/worker' },
                { text: 'HTTP requests and responses', link: '/docs/http' },
              ],
            },
            {
              text: 'Running the server',
              items: [
                { text: 'Command line', link: '/docs/cli' },
                { text: 'Configuration', link: '/docs/configuration' },
                { text: 'Static files', link: '/docs/static-files' },
                { text: 'Process model', link: '/docs/process-model' },
                { text: 'Logging', link: '/docs/logging' },
                { text: 'Running in production', link: '/docs/deployment' },
              ],
            },
            {
              text: 'Framework integration',
              items: [
                { text: 'Overview', link: '/docs/frameworks/' },
                { text: 'Symfony', link: '/docs/frameworks/symfony' },
                { text: 'Laravel', link: '/docs/frameworks/laravel' },
                { text: 'Yii3', link: '/docs/frameworks/yii3' },
              ],
            },
            {
              text: 'Contributing',
              items: [
                { text: 'Contributing to the docs', link: '/docs/contributing' },
                { text: 'Contributing to Rapira', link: 'https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md' },
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
          { text: 'Документация', link: '/ru/docs/intro/' },
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
                { text: 'Что такое Rapira', link: '/ru/docs/intro/' },
                { text: 'Установка', link: '/ru/docs/intro/installation' },
                { text: 'Быстрый старт', link: '/ru/docs/intro/quickstart' },
                { text: 'Сборка из исходников', link: '/ru/docs/intro/build-from-source' },
              ],
            },
            {
              text: 'Разработка приложения',
              items: [
                { text: 'Режимы выполнения', link: '/ru/docs/execution-modes' },
                { text: 'Режим Classic', link: '/ru/docs/classic' },
                { text: 'Режим Worker', link: '/ru/docs/worker' },
                { text: 'Запросы и ответы HTTP', link: '/ru/docs/http' },
              ],
            },
            {
              text: 'Запуск сервера',
              items: [
                { text: 'Командная строка', link: '/ru/docs/cli' },
                { text: 'Конфигурация', link: '/ru/docs/configuration' },
                { text: 'Статические файлы', link: '/ru/docs/static-files' },
                { text: 'Модель процессов', link: '/ru/docs/process-model' },
                { text: 'Логирование', link: '/ru/docs/logging' },
                { text: 'Запуск в продакшене', link: '/ru/docs/deployment' },
              ],
            },
            {
              text: 'Интеграция с фреймворками',
              items: [
                { text: 'Обзор', link: '/ru/docs/frameworks/' },
                { text: 'Symfony', link: '/ru/docs/frameworks/symfony' },
                { text: 'Laravel', link: '/ru/docs/frameworks/laravel' },
                { text: 'Yii3', link: '/ru/docs/frameworks/yii3' },
              ],
            },
            {
              text: 'Участие',
              items: [
                { text: 'Помощь с документацией', link: '/ru/docs/contributing' },
                { text: 'Участие в разработке', link: 'https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md' },
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
          { text: 'Documentación', link: '/es/docs/intro/' },
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
                { text: '¿Qué es Rapira?', link: '/es/docs/intro/' },
                { text: 'Instalación', link: '/es/docs/intro/installation' },
                { text: 'Inicio rápido', link: '/es/docs/intro/quickstart' },
                { text: 'Compilar desde el código', link: '/es/docs/intro/build-from-source' },
              ],
            },
            {
              text: 'Escribir tu aplicación',
              items: [
                { text: 'Modos de ejecución', link: '/es/docs/execution-modes' },
                { text: 'Modo Classic', link: '/es/docs/classic' },
                { text: 'Modo Worker', link: '/es/docs/worker' },
                { text: 'Peticiones y respuestas HTTP', link: '/es/docs/http' },
              ],
            },
            {
              text: 'Ejecutar el servidor',
              items: [
                { text: 'Línea de comandos', link: '/es/docs/cli' },
                { text: 'Configuración', link: '/es/docs/configuration' },
                { text: 'Archivos estáticos', link: '/es/docs/static-files' },
                { text: 'Modelo de procesos', link: '/es/docs/process-model' },
                { text: 'Registros', link: '/es/docs/logging' },
                { text: 'En producción', link: '/es/docs/deployment' },
              ],
            },
            {
              text: 'Integración con frameworks',
              items: [
                { text: 'Visión general', link: '/es/docs/frameworks/' },
                { text: 'Symfony', link: '/es/docs/frameworks/symfony' },
                { text: 'Laravel', link: '/es/docs/frameworks/laravel' },
                { text: 'Yii3', link: '/es/docs/frameworks/yii3' },
              ],
            },
            {
              text: 'Contribuir',
              items: [
                { text: 'Contribuir a la documentación', link: '/es/docs/contributing' },
                { text: 'Contribuir al proyecto', link: 'https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md' },
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
          { text: '文档', link: '/zh/docs/intro/' },
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
                { text: '什么是 Rapira', link: '/zh/docs/intro/' },
                { text: '安装', link: '/zh/docs/intro/installation' },
                { text: '快速开始', link: '/zh/docs/intro/quickstart' },
                { text: '从源码构建', link: '/zh/docs/intro/build-from-source' },
              ],
            },
            {
              text: '编写应用',
              items: [
                { text: '执行模式', link: '/zh/docs/execution-modes' },
                { text: 'Classic 模式', link: '/zh/docs/classic' },
                { text: 'Worker 模式', link: '/zh/docs/worker' },
                { text: 'HTTP 请求与响应', link: '/zh/docs/http' },
              ],
            },
            {
              text: '运行服务器',
              items: [
                { text: '命令行', link: '/zh/docs/cli' },
                { text: '配置', link: '/zh/docs/configuration' },
                { text: '静态文件', link: '/zh/docs/static-files' },
                { text: '进程模型', link: '/zh/docs/process-model' },
                { text: '日志', link: '/zh/docs/logging' },
                { text: '生产环境部署', link: '/zh/docs/deployment' },
              ],
            },
            {
              text: '框架集成',
              items: [
                { text: '概览', link: '/zh/docs/frameworks/' },
                { text: 'Symfony', link: '/zh/docs/frameworks/symfony' },
                { text: 'Laravel', link: '/zh/docs/frameworks/laravel' },
                { text: 'Yii3', link: '/zh/docs/frameworks/yii3' },
              ],
            },
            {
              text: '参与贡献',
              items: [
                { text: '参与文档贡献', link: '/zh/docs/contributing' },
                { text: '参与开发', link: 'https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md' },
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
          { text: 'Dokumentacja', link: '/pl/docs/intro/' },
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
                { text: 'Czym jest Rapira', link: '/pl/docs/intro/' },
                { text: 'Instalacja', link: '/pl/docs/intro/installation' },
                { text: 'Szybki start', link: '/pl/docs/intro/quickstart' },
                { text: 'Budowanie ze źródeł', link: '/pl/docs/intro/build-from-source' },
              ],
            },
            {
              text: 'Tworzenie aplikacji',
              items: [
                { text: 'Tryby wykonania', link: '/pl/docs/execution-modes' },
                { text: 'Tryb Classic', link: '/pl/docs/classic' },
                { text: 'Tryb Worker', link: '/pl/docs/worker' },
                { text: 'Żądania i odpowiedzi HTTP', link: '/pl/docs/http' },
              ],
            },
            {
              text: 'Uruchamianie serwera',
              items: [
                { text: 'Wiersz poleceń', link: '/pl/docs/cli' },
                { text: 'Konfiguracja', link: '/pl/docs/configuration' },
                { text: 'Pliki statyczne', link: '/pl/docs/static-files' },
                { text: 'Model procesów', link: '/pl/docs/process-model' },
                { text: 'Logi', link: '/pl/docs/logging' },
                { text: 'Wdrożenie produkcyjne', link: '/pl/docs/deployment' },
              ],
            },
            {
              text: 'Integracja z frameworkami',
              items: [
                { text: 'Przegląd', link: '/pl/docs/frameworks/' },
                { text: 'Symfony', link: '/pl/docs/frameworks/symfony' },
                { text: 'Laravel', link: '/pl/docs/frameworks/laravel' },
                { text: 'Yii3', link: '/pl/docs/frameworks/yii3' },
              ],
            },
            {
              text: 'Współtworzenie',
              items: [
                { text: 'Współtworzenie dokumentacji', link: '/pl/docs/contributing' },
                { text: 'Rozwój Rapiry', link: 'https://github.com/rapira-rs/rapira/blob/main/CONTRIBUTING.md' },
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
    // The wordmark replaces the navigation title for each locale.
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
    // Disable `lastUpdated` and `editLink` for blog posts.
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
