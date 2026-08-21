import { esc } from './render';
import { BRAND_CARD, brandCardURL } from './brand';
import { weChatImageHints } from './render';
import { DEBUG_CSS } from './lineageDebug';
import type { Lang } from './types';
import type { LineageClaimPreview, LineageEdge, LineageResume } from './lineageLookup';

/**
 * The rider résumé: a document, not a card. LINEAGE_INIT § "Apprenticeship
 * timeline" argues the story beats the tree on a phone, and LINEAGE_PLAN L19
 * makes this the first surface — so it is server-rendered with zero client JS,
 * no external assets, and readable by anyone the link reaches.
 */

interface Copy {
  learnedFrom: string;
  taught: string;
  built: string;
  timeline: string;
  ridingSince: (year: number) => string;
  knownFor: string;
  stats: {
    mentors: string;
    students: string;
    downstream: string;
    generations: string;
    tracks: string;
  };
  provenance: Record<string, string>;
  unclaimed: string;
  empty: string;
  notFound: string;
  notFoundBody: string;
  openApp: string;
  openForum: string;
  /** Shown on a real rider who simply has no lineage yet. */
  emptyOwnHint: string;
  emptyCta: string;
  /** Shown when the username resolves to nobody. */
  notFoundJoin: string;
  notFoundExplore: string;
  claimTitle: (name: string) => string;
  claimBody: string;
  claimCta: string;
  startedRiding: string;
}

const COPY: Partial<Record<Lang, Copy>> = {
  en: {
    learnedFrom: 'Learned from',
    taught: 'Taught',
    built: 'Built and contributed to',
    timeline: 'How it happened',
    ridingSince: (y) => `Riding since ${y}`,
    knownFor: 'Known for',
    stats: {
      mentors: 'mentors',
      students: 'students',
      downstream: 'riders downstream',
      generations: 'generations',
      tracks: 'tracks',
    },
    provenance: {
      reported: 'reported',
      confirmed: 'confirmed by both',
      documented: 'documented',
    },
    unclaimed: 'Unclaimed rider',
    empty: 'Nothing recorded here yet.',
    notFound: 'No lineage here',
    notFoundBody: 'This rider is not in the lineage, or the page has been removed.',
    openApp: 'Get DirtBikeX',
    openForum: 'Open profile',
    emptyOwnHint: 'Lineage is built from both sides. Record who taught you, or who you taught — they get a notification and confirm it.',
    emptyCta: 'Connect with riders',
    notFoundJoin: 'Join DirtBikeX',
    notFoundExplore: 'Explore the map',
    claimTitle: (name) => `Is this you, ${name}?`,
    claimBody: 'Someone recorded you in their riding lineage. Claim your place to confirm or correct it.',
    claimCta: 'Claim your place',
    startedRiding: 'Started riding',
  },
  'zh-CN': {
    learnedFrom: '师承',
    taught: '教过',
    built: '参与修建',
    timeline: '一路走来',
    ridingSince: (y) => `${y} 年开始骑车`,
    knownFor: '擅长',
    stats: {
      mentors: '位师承',
      students: '位徒弟',
      downstream: '位下游车手',
      generations: '代传承',
      tracks: '个场地',
    },
    provenance: {
      reported: '单方记录',
      confirmed: '双方确认',
      documented: '有据可查',
    },
    unclaimed: '待认领车手',
    empty: '这里还没有记录。',
    notFound: '暂无传承记录',
    notFoundBody: '这位车手不在传承图谱中,或页面已被移除。',
    openApp: '下载 DirtBikeX',
    openForum: '查看主页',
    emptyOwnHint: '传承由双方共同确认。记录是谁教了你,或你教过谁,对方会收到通知并确认。',
    emptyCta: '联系其他车手',
    notFoundJoin: '加入 DirtBikeX',
    notFoundExplore: '看看地图',
    claimTitle: (name) => `这是你吗,${name}?`,
    claimBody: '有人把你记录进了他的骑行传承。认领后即可确认或更正。',
    claimCta: '认领我的位置',
    startedRiding: '开始骑车',
  },
};

/**
 * Facet labels, mirroring the plugin's `client.{en,zh_CN}.yml`. Duplicated on
 * purpose: this page is read by people who never sign in, so it cannot reach
 * the forum's i18n. Adding a code means editing both.
 */
const FACET_LABELS: Partial<Record<Lang, Record<string, string>>> = {
  en: {
    'mx.fundamentals': 'Fundamentals', 'mx.cornering': 'Cornering', 'mx.jumping': 'Jumping',
    'mx.whoops': 'Whoops', 'mx.starts': 'Starts', 'mx.body_position': 'Body position',
    'enduro.fundamentals': 'Enduro basics', 'enduro.hard_enduro': 'Hard enduro',
    'enduro.navigation': 'Navigation', 'enduro.hill_climbs': 'Hill climbs',
    'trials.fundamentals': 'Trials basics',
    'wrench.maintenance': 'Maintenance', 'wrench.two_stroke': '2-stroke',
    'wrench.four_stroke': '4-stroke', 'wrench.carburetors': 'Carburettors',
    'wrench.suspension': 'Suspension',
    'race.racecraft': 'Racecraft', 'race.fitness': 'Fitness', 'race.mindset': 'Mindset',
    'coach.coaching': 'Coaching', 'trail.knowledge': 'Trail knowledge',
    'build.design': 'Track design', 'build.earthwork': 'Earthwork', 'build.permits': 'Permits',
    'build.funding': 'Funding', 'build.maintenance': 'Upkeep', 'build.general': 'General help',
    other: 'Other',
  },
  'zh-CN': {
    'mx.fundamentals': '越野基础', 'mx.cornering': '过弯', 'mx.jumping': '起跳',
    'mx.whoops': '搓板路', 'mx.starts': '起步', 'mx.body_position': '身体姿态',
    'enduro.fundamentals': '耐力基础', 'enduro.hard_enduro': '硬耐力',
    'enduro.navigation': '领航', 'enduro.hill_climbs': '爬坡',
    'trials.fundamentals': '攀爬基础',
    'wrench.maintenance': '日常保养', 'wrench.two_stroke': '二冲程',
    'wrench.four_stroke': '四冲程', 'wrench.carburetors': '化油器',
    'wrench.suspension': '避震调校',
    'race.racecraft': '比赛技巧', 'race.fitness': '体能', 'race.mindset': '心理',
    'coach.coaching': '带教', 'trail.knowledge': '线路知识',
    'build.design': '赛道设计', 'build.earthwork': '土方施工', 'build.permits': '手续审批',
    'build.funding': '资金', 'build.maintenance': '维护', 'build.general': '综合协助',
    other: '其他',
  },
};

export function getFacetLabels(locale: Lang): Record<string, string> {
  return FACET_LABELS[locale] ?? (FACET_LABELS.en as Record<string, string>);
}

function getCopy(locale: Lang): Copy {
  return COPY[locale] ?? (COPY.en as Copy);
}

/** Whether this locale has its own tables, or silently renders the `en` ones. */
export function hasCopy(locale: Lang): boolean {
  return COPY[locale] !== undefined;
}

export function hasFacetLabels(locale: Lang): boolean {
  return FACET_LABELS[locale] !== undefined;
}

function isRTL(locale: Lang): boolean {
  return locale === 'ar' || locale === 'fa-IR';
}

const CSS = `
:root{--ink:#14110f;--muted:#6b625c;--line:#e6e0da;--bg:#faf7f4;--accent:#d64000}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
main{max-width:44rem;margin:0 auto;padding:2rem 1.25rem 4rem}
a{color:inherit}
.head{display:flex;gap:1rem;align-items:center;margin-bottom:.75rem}
.avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--line);flex:none}
.avatar-letter{display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:700;color:#fff;background:var(--accent)}
h1{font-size:1.6rem;margin:0;line-height:1.2}
.sub{color:var(--muted);font-size:.95rem;margin:.15rem 0 0}
.stats{display:flex;flex-wrap:wrap;gap:.35rem .9rem;margin:1rem 0 1.5rem;padding:.85rem 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:.95rem}
.stats b{font-size:1.15rem}
.chips{display:flex;flex-wrap:wrap;gap:.35rem;margin:.5rem 0 0}
.chip{font-size:.8rem;padding:.15rem .5rem;border:1px solid var(--line);border-radius:999px;color:var(--muted)}
h2{font-size:1rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:2rem 0 .5rem}
.row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:baseline;padding:.6rem 0;border-bottom:1px solid var(--line)}
.who{font-weight:600}
.glyph{color:var(--muted);width:1em;flex:none}
.detail{color:var(--muted);font-size:.9rem}
.timeline{list-style:none;margin:0;padding:0;border-left:2px solid var(--line)}
.timeline li{position:relative;padding:.4rem 0 .9rem 1rem}
.timeline li::before{content:"";position:absolute;left:-5px;top:.85rem;width:8px;height:8px;border-radius:50%;background:var(--accent)}
.year{font-variant-numeric:tabular-nums;font-weight:700;margin-right:.4rem}
.ctas{display:flex;flex-wrap:wrap;gap:.6rem;margin-top:2rem}
.btn{display:inline-block;padding:.6rem 1.1rem;border-radius:8px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
.btn.secondary{background:transparent;color:var(--ink);border:1px solid var(--line)}
.empty{color:var(--muted)}
@media (prefers-color-scheme:dark){
:root{--ink:#f2eee9;--muted:#a49a92;--line:#312b26;--bg:#141110}
.btn.secondary{color:var(--ink)}
}
`;

function shell(opts: {
  locale: Lang;
  title: string;
  description: string;
  url: string;
  ogImage: string | null;
  body: string;
  /** The one URL this résumé should be indexed under — `/s/l/…` and `/lineage/…` are the same document. */
  canonical?: string | null;
  noindex?: boolean;
  extraCSS?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="${opts.locale}" dir="${isRTL(opts.locale) ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<title>${esc(opts.title)} · DirtBikeX</title>
${opts.canonical ? `<link rel="canonical" href="${esc(opts.canonical)}">\n` : ''}${opts.noindex ? '<meta name="robots" content="noindex">\n' : ''}<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(opts.url)}">
<meta property="og:type" content="profile">
<meta property="og:image" content="${esc(opts.ogImage ?? brandCardURL(opts.url))}">
${opts.ogImage ? '' : `<meta property="og:image:width" content="${BRAND_CARD.width}">
<meta property="og:image:height" content="${BRAND_CARD.height}">`}
<meta name="twitter:card" content="summary">
${weChatImageHints(opts.ogImage ?? brandCardURL(opts.url))}
<style>${CSS}${opts.extraCSS ?? ''}</style>
</head>
<body><main>${opts.body}</main></body>
</html>`;
}

function displayName(rider: { placeholder: boolean; name: string | null; name_local: string | null }, copy: Copy): string {
  if (rider.placeholder) return copy.unclaimed;
  return rider.name_local?.trim() || rider.name?.trim() || copy.unclaimed;
}

function avatar(
  rider: { avatar_template: string | null; placeholder: boolean; name: string | null; name_local: string | null },
  forumBase: string,
  copy: Copy
): string {
  const name = displayName(rider, copy);
  if (rider.avatar_template) {
    const src = rider.avatar_template.replace('{size}', '128');
    const url = src.startsWith('http') ? src : `${forumBase}${src}`;
    return `<img class="avatar" src="${esc(url)}" alt="${esc(name)}" loading="lazy">`;
  }
  const letter = esc([...name][0] ?? '·');
  return `<div class="avatar avatar-letter">${letter}</div>`;
}

function glyph(edge: LineageEdge): string {
  if (edge.provenance === 'confirmed') return '✓';
  if (edge.documented) return '◇';
  return '○';
}

function years(edge: LineageEdge): string {
  if (!edge.start_year) return '';
  const approx = edge.year_precision === 'approx' ? '~' : '';
  return edge.end_year ? `${approx}${edge.start_year}–${edge.end_year}` : `${approx}${edge.start_year}`;
}

function facetText(edge: LineageEdge, labels: Record<string, string>): string {
  return (edge.facets || []).map((code) => labels[code] ?? code).join(' · ');
}

function edgeRow(edge: LineageEdge, opts: { copy: Copy; labels: Record<string, string>; forumBase: string }): string {
  const { copy, labels } = opts;
  const who = edge.track
    ? esc(edge.track.name_local?.trim() || edge.track.name)
    : edge.rider
      ? esc(displayName(edge.rider, copy))
      : esc(copy.unclaimed);
  const link =
    edge.rider && !edge.rider.placeholder
      ? `<a class="who" href="/lineage/${esc(edge.rider.username ? '@' + edge.rider.username : (edge.rider.slug ?? ''))}">${who}</a>`
      : `<span class="who">${who}</span>`;
  const detail = [facetText(edge, labels), years(edge), copy.provenance[edge.provenance] ?? edge.provenance]
    .filter(Boolean)
    .join(' · ');
  const evidence = edge.evidence_url
    ? ` <a class="detail" href="${esc(edge.evidence_url)}" rel="nofollow noopener">◇</a>`
    : '';
  return `<div class="row"><span class="glyph" title="${esc(edge.provenance)}">${glyph(edge)}</span>${link}<span class="detail">${esc(detail)}</span>${evidence}</div>`;
}

function section(title: string, edges: LineageEdge[], opts: { copy: Copy; labels: Record<string, string>; forumBase: string }): string {
  if (!edges.length) return '';
  return `<h2>${esc(title)}</h2>${edges.map((e) => edgeRow(e, opts)).join('')}`;
}

function timeline(resume: LineageResume, opts: { copy: Copy; labels: Record<string, string> }): string {
  const { copy, labels } = opts;
  const items = resume.timeline
    .map((entry) => {
      const year = entry.year ? `<span class="year">${entry.year}</span>` : '';
      if (entry.kind === 'riding_since') {
        return `<li>${year}${esc(copy.startedRiding)}</li>`;
      }
      const edge = entry.entry;
      if (!edge) return '';
      const who = edge.track
        ? esc(edge.track.name_local?.trim() || edge.track.name)
        : edge.rider
          ? esc(displayName(edge.rider, copy))
          : esc(copy.unclaimed);
      const verb =
        entry.kind === 'learned_from' ? copy.learnedFrom : entry.kind === 'taught' ? copy.taught : copy.built;
      const facets = facetText(edge, labels);
      return `<li>${year}${esc(verb)} <strong>${who}</strong>${facets ? ` <span class="detail">${esc(facets)}</span>` : ''}</li>`;
    })
    .filter(Boolean)
    .join('');
  if (!items) return '';
  return `<h2>${esc(copy.timeline)}</h2><ul class="timeline">${items}</ul>`;
}

/**
 * A real rider with nothing recorded yet. This is the page the whole feature is
 * trying to reach, so it asks for the next step rather than apologising: the
 * forum is where lineage is written (the worker has no visitor session), so the
 * CTA points at the add form there.
 */
function emptyState(resume: LineageResume, copy: Copy, forumBase: string): string {
  const cta =
    forumBase && resume.rider.username
      ? `<div class="ctas"><a class="btn" href="${esc(forumBase)}/lineage/add">${esc(copy.emptyCta)}</a></div>`
      : '';
  return `<p class="empty">${esc(copy.empty)}</p><p class="empty">${esc(copy.emptyOwnHint)}</p>${cta}`;
}

export function renderResume(
  resume: LineageResume,
  opts: {
    locale: Lang;
    url: string;
    forumBase: string;
    appStoreURL: string;
    facetLabels: Record<string, string>;
    /** `/s/l/<username>` and `/lineage/<ref>` are the same document. */
    canonical?: string | null;
    /** Pre-rendered `?debug=true` panel; its presence also makes the page noindex. */
    debug?: string | null;
  }
): Response {
  const copy = getCopy(opts.locale);
  const labels = opts.facetLabels;
  const rider = resume.rider;
  const name = displayName(rider, copy);

  const subParts = [
    rider.riding_since_year ? copy.ridingSince(rider.riding_since_year) : null,
    rider.region,
  ].filter(Boolean);

  const s = resume.stats;
  const stat = (n: number, label: string) => `<span><b>${n}</b> ${esc(label)}</span>`;
  const populated = [
    s.students ? stat(s.students, copy.stats.students) : '',
    s.downstream ? stat(s.downstream, copy.stats.downstream) : '',
    s.generations ? stat(s.generations, copy.stats.generations) : '',
    s.mentors ? stat(s.mentors, copy.stats.mentors) : '',
    s.tracks ? stat(s.tracks, copy.stats.tracks) : '',
  ].filter(Boolean);
  // A rider with nothing recorded still gets a strip. Zeros are a truthful state
  // and they frame the call to action underneath; an absent strip reads as a page
  // that failed to load.
  const statItems = populated.length
    ? populated
    : [stat(0, copy.stats.mentors), stat(0, copy.stats.students)];

  const knownFor = (rider.known_for || []).map((code) => `<span class="chip">${esc(labels[code] ?? code)}</span>`).join('');

  const sections = [
    section(copy.learnedFrom, resume.sections.learned_from, { copy, labels, forumBase: opts.forumBase }),
    section(copy.taught, resume.sections.taught, { copy, labels, forumBase: opts.forumBase }),
    section(copy.built, resume.sections.contributed_to, { copy, labels, forumBase: opts.forumBase }),
  ].join('');

  const ctas = [
    `<a class="btn" href="${esc(opts.appStoreURL)}">${esc(copy.openApp)}</a>`,
    rider.username && opts.forumBase
      ? `<a class="btn secondary" href="${esc(opts.forumBase)}/u/${esc(rider.username)}">${esc(copy.openForum)}</a>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  const body = `
<div class="head">${avatar(rider, opts.forumBase, copy)}<div><h1>${esc(name)}</h1>${
    subParts.length ? `<p class="sub">${esc(subParts.join(' · '))}</p>` : ''
  }</div></div>
${knownFor ? `<div class="chips">${knownFor}</div>` : ''}
${statItems.length ? `<div class="stats">${statItems.join('')}</div>` : ''}
${sections || emptyState(resume, copy, opts.forumBase)}
${timeline(resume, { copy, labels })}
<div class="ctas">${ctas}</div>${opts.debug ?? ''}`;

  const description = statItems.length
    ? `${name} · ${s.students} ${copy.stats.students} · ${s.downstream} ${copy.stats.downstream}`
    : name;

  return new Response(
    shell({
      locale: opts.locale,
      title: name,
      description,
      url: opts.url,
      ogImage:
        rider.avatar_template && opts.forumBase
          ? (rider.avatar_template.startsWith('http')
              ? rider.avatar_template.replace('{size}', '288')
              : `${opts.forumBase}${rider.avatar_template.replace('{size}', '288')}`)
          : null,
      body,
      canonical: opts.canonical ?? opts.url,
      noindex: !!opts.debug,
      extraCSS: opts.debug ? DEBUG_CSS : '',
    }),
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export function renderClaim(
  preview: LineageClaimPreview,
  opts: {
    locale: Lang;
    url: string;
    forumBase: string;
    token: string;
    facetLabels: Record<string, string>;
    debug?: string | null;
  }
): Response {
  const copy = getCopy(opts.locale);
  const labels = opts.facetLabels;
  const name = preview.rider.name_local?.trim() || preview.rider.name;
  const rows = preview.reported_by
    .map((edge) => edgeRow(edge, { copy, labels, forumBase: opts.forumBase }))
    .join('');

  const body = `
<h1>${esc(copy.claimTitle(name))}</h1>
<p class="sub">${esc(copy.claimBody)}</p>
${rows}
<div class="ctas">
  <a class="btn" href="${esc(opts.forumBase)}/lineage/claim/${esc(opts.token)}">${esc(copy.claimCta)}</a>
</div>${opts.debug ?? ''}`;

  return new Response(
    shell({
      locale: opts.locale,
      title: copy.claimTitle(name),
      description: copy.claimBody,
      url: opts.url,
      ogImage: null,
      body,
      noindex: true,
      extraCSS: opts.debug ? DEBUG_CSS : '',
    }),
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

export function renderLineageNotFound(locale: Lang, url: string, debug?: string | null): Response {
  const copy = getCopy(locale);
  return new Response(
    shell({
      locale,
      title: copy.notFound,
      description: copy.notFoundBody,
      url,
      ogImage: null,
      // The 404 is the most common thing an E2E pass actually hits, so it
      // carries the panel too — that is where the upstream status lives.
      // It is also a landing page for a stranger who followed someone's link, so
      // it offers a way in rather than only a dead end.
      body:
        `<h1>${esc(copy.notFound)}</h1><p class="sub">${esc(copy.notFoundBody)}</p>` +
        `<div class="ctas">` +
        `<a class="btn" href="/join">${esc(copy.notFoundJoin)}</a>` +
        `<a class="btn secondary" href="/">${esc(copy.notFoundExplore)}</a>` +
        `</div>${debug ?? ''}`,
      noindex: true,
      extraCSS: debug ? DEBUG_CSS : '',
    }),
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}
