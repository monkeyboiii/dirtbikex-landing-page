export const languages = {
  en: 'English',
  zh: '中文',
} as const;

export const defaultLang = 'en';

export const ui = {
  en: {
    'meta.title': 'DirtBikeX — Community for dirt bike riders',
    'meta.description':
      'Tracks, builds, gear, ride reports. Share it all with riders who actually ride.',

    'nav.features': 'Features',
    'nav.faq': 'FAQ',
    'nav.forum': 'Join Forum',
    'nav.toggleTheme': 'Toggle theme',

    'hero.eyebrow': 'Built by riders, for riders',
    'hero.title': 'The community for dirt bike riders.',
    'hero.subtitle':
      'Trails, builds, gear, ride reports — share it all with people who actually ride.',
    'hero.cta.primary': 'Join the forum',
    'hero.cta.secondary': 'See features',

    'features.title': 'What you get',
    'features.subtitle': 'A focused community space, not another social feed.',
    'features.f1.title': 'Active discussion forum',
    'features.f1.body':
      'Threaded conversations on rides, repairs, gear, and trail reports. Searchable, owned by us, no algorithm.',
    'features.f2.title': 'Builds & maintenance logs',
    'features.f2.body':
      'Document your bike: mods, services, what broke and how you fixed it. Other riders learn from your wrenching.',
    'features.f3.title': 'Trails & ride reports',
    'features.f3.body':
      'Share where you ride. Conditions, GPX, photos, the corner that almost got you. Local knowledge stays local.',
    'features.f4.title': 'Multilingual by default',
    'features.f4.body':
      'English and Chinese on the same forum. Riders in different regions, one community.',

    'faq.title': 'Common questions',
    'faq.q1.q': 'Is the forum free to join?',
    'faq.q1.a':
      'Yes. Free to read, free to post. We may add optional supporter perks later — never paywall the conversation.',
    'faq.q2.q': 'Who runs DirtBikeX?',
    'faq.q2.a':
      'A small group of riders self-hosting a Discourse instance. No VC, no ads, no data resale.',
    'faq.q3.q': 'Can I post in Chinese / English?',
    'faq.q3.a':
      'Both. Tag your post with a language hint and other riders will follow up in kind.',
    'faq.q4.q': 'How do I report bad behavior?',
    'faq.q4.a':
      'Use the flag button on any post. Mods triage within 24 hours.',

    'footer.tagline': 'Ride. Wrench. Share.',
    'footer.legal.privacy': 'Privacy',
    'footer.legal.terms': 'Terms',
    'footer.copyright': '© {year} DirtBikeX. All rights reserved.',

    'legal.lastUpdated': 'Last updated',
    'legal.backHome': '← Back home',
  },
  zh: {
    'meta.title': 'DirtBikeX — 越野摩托车手社区',
    'meta.description': '路线、改装、装备、骑行记录。和真正在骑车的人一起分享。',

    'nav.features': '功能',
    'nav.faq': '常见问题',
    'nav.forum': '加入论坛',
    'nav.toggleTheme': '切换主题',

    'hero.eyebrow': '由车手为车手打造',
    'hero.title': '越野摩托车手的社区。',
    'hero.subtitle':
      '路线、改装、装备、骑行记录——和真正在骑车的人一起分享。',
    'hero.cta.primary': '加入论坛',
    'hero.cta.secondary': '查看功能',

    'features.title': '你将获得',
    'features.subtitle': '一个专注的社区空间,而不是又一个社交信息流。',
    'features.f1.title': '活跃的讨论论坛',
    'features.f1.body':
      '关于骑行、维修、装备、路线的讨论帖。可搜索,我们自己所有,没有算法。',
    'features.f2.title': '改装与维护日志',
    'features.f2.body':
      '记录你的车:改装、保养、坏在哪里、怎么修好的。其他车手从你的扳手记录里学习。',
    'features.f3.title': '路线与骑行报告',
    'features.f3.body':
      '分享你骑行的地方。路况、GPX 轨迹、照片、那个差点把你掀翻的弯。本地经验留在本地。',
    'features.f4.title': '原生多语言',
    'features.f4.body':
      '中文和英文在同一个论坛。不同地区的车手,同一个社区。',

    'faq.title': '常见问题',
    'faq.q1.q': '加入论坛免费吗?',
    'faq.q1.a':
      '免费。免费阅读,免费发帖。我们之后可能会加一些可选的支持者权益——但绝不会对正常讨论收费。',
    'faq.q2.q': 'DirtBikeX 是谁在运营?',
    'faq.q2.a':
      '一小群车手自己运行一个 Discourse 实例。没有风投,没有广告,不卖数据。',
    'faq.q3.q': '我可以用中文/英文发帖吗?',
    'faq.q3.a':
      '都可以。在帖子上标注一个语言标签,其他车手会用对应语言回复。',
    'faq.q4.q': '怎么举报不良行为?',
    'faq.q4.a': '用任意帖子下方的举报按钮。版主会在 24 小时内处理。',

    'footer.tagline': '骑车。修车。分享。',
    'footer.legal.privacy': '隐私',
    'footer.legal.terms': '条款',
    'footer.copyright': '© {year} DirtBikeX. 保留所有权利。',

    'legal.lastUpdated': '最近更新',
    'legal.backHome': '← 返回首页',
  },
} as const;

export type Lang = keyof typeof ui;
export type UIKey = keyof (typeof ui)['en'];
