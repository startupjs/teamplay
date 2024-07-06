import { defineConfig } from 'rspress/config'

export default defineConfig({
  root: 'docs',
  title: 'TeamPlay',
  description: 'Full-stack signals ORM with multiplayer',
  // icon: '/favicon.ico',
  // logo: {
  //   light: '/logo-light.png',
  //   dark: '/logo-dark.png'
  // },
  route: {
    cleanUrls: true
  },
  themeConfig: {
    enableContentAnimation: true,
    socialLinks: [
      { icon: 'github', mode: 'link', content: 'https://github.com/startupjs/teamplay' }
    ],
    footer: {
      message: '© 2024 StartupJS. All Rights Reserved.'
    },
    hideNavbar: 'auto',
    sidebar: {
      '/': [
        {
          text: 'Guide',
          items: [
            { text: 'Introduction', link: '/guide/index' },
            { text: 'Installation', link: '/guide/installation' },
            { text: 'Usage', link: '/guide/usage' },
            { text: 'React Integration', link: '/guide/react-integration' },
            { text: 'Async Setters', link: '/guide/async-setters' }
          ]
        },
        {
          text: 'Examples',
          items: [
            { text: 'Full-stack', link: '/examples/index' }
          ]
        },
        {
          text: 'API',
          items: [
            { text: '$ (Root Signal)', link: '/api/root-signal' },
            { text: '$() Function', link: '/api/dollar-function' },
            { text: 'sub() Function', link: '/api/sub-function' },
            { text: 'observer() HOC', link: '/api/observer-hoc' },
            { text: 'useSub() Hook', link: '/api/use-sub-hook' },
            { text: 'Signal Methods', link: '/api/signal-methods' },
            { text: 'Query Signals', link: '/api/query-signals' },
            { text: 'Server-side API', link: '/api/server-side' }
          ]
        }
      ]
    },
    nav: [
      { text: 'Docs', link: '/guide/index', activeMatch: '/.+' }
    ]
  }
})
