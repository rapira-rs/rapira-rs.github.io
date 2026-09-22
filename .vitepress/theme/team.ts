import type { DefaultTheme } from 'vitepress'

// The maintainer cards on the sponsor pages. They are shared by every locale and
// stay in English; avatars are served by GitHub, so they follow the profiles.
export const members: DefaultTheme.TeamMember[] = [
  {
    avatar: 'https://github.com/rustatian.png',
    name: 'Valery Piashchynski',
    title: 'Server and plugins, Rust',
    links: [
      { icon: 'github', link: 'https://github.com/rustatian' },
      { icon: 'x', link: 'https://x.com/rustatian' },
    ],
    sponsor: 'https://github.com/sponsors/rapira-rs',
    actionText: 'Sponsor on GitHub',
  },
  {
    avatar: 'https://github.com/roxblnfk.png',
    name: 'Aleksei Gagarin',
    title: 'Contracts and SDK, PHP',
    links: [
      { icon: 'github', link: 'https://github.com/roxblnfk' },
      { icon: 'x', link: 'https://x.com/roxblnfk' },
      { icon: 'mastodon', link: 'https://phpc.social/@roxblnfk' },
    ],
    sponsor: 'https://boosty.to/roxblnfk',
    actionText: 'Sponsor on Boosty',
  },
]
