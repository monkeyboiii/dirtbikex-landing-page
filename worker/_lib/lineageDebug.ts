import { esc } from './render';
import type { Lang } from './types';
import type { LineageClaimPreview, LineageEdge, LineageResume } from './lineageLookup';

/**
 * `?debug=true` — the operator's E2E surface for the lineage pages
 * (LINEAGE_PLAN.md §4.4). It answers the three questions a verification run
 * actually asks: which upstream call was made and what did it say, do the
 * counters agree with the rows underneath them, and which vocabulary codes
 * still have no label in this locale.
 *
 * Everything it prints comes from the same anonymous endpoint the page already
 * renders — no key, no privileged read — so it exposes nothing a `curl` of the
 * forum would not. It is still `noindex`, and it emits zero JavaScript: the
 * China asset invariant (tests/no-external-assets.spec.ts) covers this page too.
 */

export interface LineageTrace {
  /** Which route matched — the two spellings of the same résumé. */
  route: string;
  /** The raw path segment, before normalization. */
  param: string;
  /** What `lineagePath()` was handed: `@username` or a rider slug. */
  ref: string;
  upstreamURL: string;
  outcome: string;
  httpStatus: number | null;
  ms: number;
  /** `?lang=` as given, before negotiation. */
  langParam: string | null;
  acceptLanguage: string | null;
  locale: Lang;
  /** False when `locale` has no résumé copy / facet labels and fell back to en. */
  hasCopy: boolean;
  hasLabels: boolean;
  canonical: string;
  forumBase: string;
}

export type DebugPayload =
  | { kind: 'resume'; data: LineageResume }
  | { kind: 'claim'; data: LineageClaimPreview }
  | { kind: 'none' };

const LOCALE_LINKS: Lang[] = ['en', 'zh-CN', 'zh-TW', 'ja', 'ar'];

export function debugPanel(
  trace: LineageTrace,
  payload: DebugPayload,
  labels: Record<string, string>
): string {
  const blocks = [
    request(trace),
    upstream(trace),
    payload.kind === 'resume' ? invariants(payload.data) : '',
    payload.kind === 'resume' ? rider(payload.data) : '',
    payload.kind === 'resume' ? sections(payload.data, labels) : '',
    payload.kind === 'claim' ? edgeTable('reported_by', payload.data.reported_by, labels) : '',
    payload.kind === 'none' ? '' : vocabulary(payload, labels, trace.locale),
    queries(trace, payload),
    knobs(trace),
  ];
  return `<section class="dbg"><h2>debug</h2>
<p class="dbg-note">Operator diagnostics (<code>?debug=true</code>), noindex. Every value below comes from the anonymous plugin endpoint this page already reads.</p>
${blocks.filter(Boolean).join('')}</section>`;
}

// MARK: - Blocks

function request(t: LineageTrace): string {
  return group('request', kv([
    ['route', t.route],
    ['path param', t.param],
    ['normalized ref', t.ref],
    ['canonical', link(t.canonical)],
    ['?lang', t.langParam ?? '(absent)'],
    ['accept-language', t.acceptLanguage ?? '(absent)'],
    ['locale', t.locale],
    ['résumé copy', t.hasCopy ? t.locale : `en (no copy table for ${t.locale})`],
    ['facet labels', t.hasLabels ? t.locale : `en (no label table for ${t.locale})`],
  ]));
}

function upstream(t: LineageTrace): string {
  return group('upstream', kv([
    ['GET', link(t.upstreamURL)],
    ['outcome', t.outcome],
    ['http', t.httpStatus === null ? '(no response)' : String(t.httpStatus)],
    ['elapsed', `${t.ms} ms`],
    ['edge cache', 'cacheTtl 300s — a stale read here is expected for up to 5 min; open the upstream link directly to bypass it'],
  ]));
}

/**
 * The §3.4 contract: a public read counts `reported` as well as `confirmed`
 * edges, and a rider whose name is withheld still occupies a row — so every
 * counter must equal the length of the list rendered under it. A MISMATCH means
 * either the projection filtered something the stats counted or the cache
 * served two different generations.
 */
function invariants(r: LineageResume): string {
  const s = r.stats;
  const dated = r.timeline.length;
  const expectedTimeline =
    r.sections.learned_from.length +
    r.sections.taught.length +
    r.sections.contributed_to.length +
    (r.rider.riding_since_year ? 1 : 0);

  const rows = [
    check('stats.mentors', s.mentors, 'sections.learned_from', r.sections.learned_from.length),
    check('stats.students', s.students, 'sections.taught', r.sections.taught.length),
    check('stats.tracks', s.tracks, 'sections.contributed_to', r.sections.contributed_to.length),
    compare('timeline = all sections + riding_since', dated === expectedTimeline, `${dated} vs ${expectedTimeline}`),
    compare('stats.downstream ≥ stats.students', s.downstream >= s.students, `${s.downstream} ≥ ${s.students}`),
    compare('stats.generations ≥ 1 when taught', s.students === 0 || s.generations >= 1, `${s.generations} / ${s.students}`),
  ].join('');

  return group('invariants', `<table class="dbg-t"><tr><th>check</th><th>left</th><th>right</th><th></th></tr>${rows}</table>`);
}

function check(leftName: string, left: number, rightName: string, right: number): string {
  const ok = left === right;
  return `<tr><td>${esc(leftName)} = ${esc(rightName)}.length</td><td>${left}</td><td>${right}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? 'OK' : 'MISMATCH'}</td></tr>`;
}

function compare(name: string, ok: boolean, detail: string): string {
  return `<tr><td>${esc(name)}</td><td colspan="2">${esc(detail)}</td><td class="${ok ? 'ok' : 'bad'}">${ok ? 'OK' : 'MISMATCH'}</td></tr>`;
}

function rider(r: LineageResume): string {
  const d = r.rider as LineageResume['rider'] & { map_visible?: unknown };
  return group('rider', kv([
    ['slug', d.slug ?? '— (no rider node yet)'],
    ['claimed', String(d.claimed)],
    ['placeholder', String(d.placeholder)],
    ['username', d.username ?? '—'],
    ['name', d.name ?? '—'],
    ['name_local', d.name_local ?? '—'],
    ['region', d.region ?? '—'],
    ['country_code', d.country_code ?? '—'],
    ['riding_since_year', d.riding_since_year === null ? '—' : String(d.riding_since_year)],
    ['known_for', (d.known_for || []).join(', ') || '—'],
    ['state', d.state],
    ['map_visible', d.map_visible === undefined ? '—' : String(d.map_visible)],
    ['avatar_template', d.avatar_template ?? '—'],
  ]));
}

function sections(r: LineageResume, labels: Record<string, string>): string {
  return [
    edgeTable('learned_from', r.sections.learned_from, labels),
    edgeTable('taught', r.sections.taught, labels),
    edgeTable('contributed_to', r.sections.contributed_to, labels),
  ].join('');
}

/**
 * Raw codes next to rendered labels on purpose: an unlabelled facet is
 * invisible on the page itself (it falls back to the code) but obvious here.
 */
function edgeTable(title: string, edges: LineageEdge[], labels: Record<string, string>): string {
  if (!edges.length) return group(title, '<p class="dbg-note">empty</p>');
  const rows = edges
    .map((e) => {
      const counterpart = e.track
        ? `track:${e.track.slug}`
        : e.rider
          ? `${e.rider.username ? '@' + e.rider.username : e.rider.slug}${e.rider.placeholder ? ' (placeholder)' : ''}`
          : '—';
      const facets = (e.facets || []).map((c) => `${c}${labels[c] ? '' : ' ⚠'}`).join(' ');
      const years = e.start_year ? `${e.start_year}${e.end_year ? '–' + e.end_year : ''} (${e.year_precision})` : '—';
      const hon = e.honorific ?? (e.honorific_proposed ? `${e.honorific_proposed} (proposed)` : '—');
      return `<tr><td>${e.id}</td><td>${esc(e.provenance)}</td><td>${e.documented ? 'yes' : 'no'}</td><td>${esc(counterpart)}</td><td>${esc(facets || '—')}</td><td>${esc(years)}</td><td>${esc(hon)}</td><td>${e.evidence_url ? link(e.evidence_url, '◇') : '—'}</td></tr>`;
    })
    .join('');
  return group(
    `${title} (${edges.length})`,
    `<table class="dbg-t"><tr><th>id</th><th>provenance</th><th>doc</th><th>counterpart</th><th>facets</th><th>years</th><th>honorific</th><th>ev</th></tr>${rows}</table>`
  );
}

function vocabulary(payload: DebugPayload, labels: Record<string, string>, locale: Lang): string {
  const edges: LineageEdge[] =
    payload.kind === 'resume'
      ? [...payload.data.sections.learned_from, ...payload.data.sections.taught, ...payload.data.sections.contributed_to]
      : payload.kind === 'claim'
        ? payload.data.reported_by
        : [];
  const codes = new Set<string>();
  for (const e of edges) for (const c of e.facets || []) codes.add(c);
  if (payload.kind === 'resume') for (const c of payload.data.rider.known_for || []) codes.add(c);

  const missing = [...codes].filter((c) => !labels[c]).sort();
  const body = missing.length
    ? `<p class="bad">${missing.length} code(s) render as the raw code in <code>${esc(locale)}</code>: ${esc(missing.join(', '))}</p>`
    : `<p class="ok">all ${codes.size} facet code(s) in this payload have a label in <code>${esc(locale)}</code></p>`;
  return group('vocabulary', body);
}

function queries(t: LineageTrace, payload: DebugPayload): string {
  const f = t.forumBase;
  const items: string[] = [link(t.upstreamURL, 'this page&rsquo;s payload')];

  if (payload.kind === 'resume') {
    const r = payload.data.rider;
    if (r.slug) {
      items.push(link(`${f}/dirtbikex/lineage/riders/${enc(r.slug)}.json`, 'rider by slug'));
      items.push(link(`${f}/dirtbikex/lineage/riders/${enc(r.slug)}/stats.json`, 'rider stats (uncached CTE)'));
    }
    if (r.username) {
      items.push(link(`${f}/dirtbikex/lineage/u/${enc(r.username)}.json`, 'rider by username'));
      items.push(link(`${f}/dirtbikex/lineage/u/${enc(r.username)}/stats.json`, 'username stats'));
      items.push(link(`${f}/u/${enc(r.username)}.json`, 'user serializer (dbx_lineage_counts — the number iOS shows)'));
    }
    for (const e of payload.data.sections.contributed_to) {
      if (e.track) items.push(link(`${f}/dirtbikex/lineage/tracks/${enc(e.track.slug)}.json`, `track contributors — ${e.track.slug}`));
    }
    items.push(link(`/api/lineage/rider.json?r=${enc(t.ref)}`, 'worker proxy (what the app/map read)'));
  }
  items.push(link(`${f}/dirtbikex/lineage/riders/geo.json`, 'riders map layer (gated)'));
  items.push(link('/api/lineage/riders.json', 'worker proxy — map pins'));

  return group('related queries', `<ul class="dbg-l">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`);
}

/** Same page, different knob — so a verification pass is clicking, not retyping. */
function knobs(t: LineageTrace): string {
  const base = t.route.startsWith('/s/') ? `/lineage/${t.ref}` : `/s/lineage/${t.ref.replace(/^@/, '')}`;
  const locales = LOCALE_LINKS.map((l) => link(`?debug=true&lang=${l}`, l)).join(' · ');
  return group('knobs', `<ul class="dbg-l">
<li>locale: ${locales}</li>
<li>${link(`${base}?debug=true`, 'the other route for this rider')} — both render the same projection</li>
<li>${link('?debug=true&lang=auto', 'lang=auto')} — negotiate from Accept-Language, as an iOS share link does</li>
<li>drop <code>?debug=true</code> to see exactly what a visitor sees</li>
</ul>`);
}

// MARK: - Bits

function group(title: string, body: string): string {
  return `<details class="dbg-g" open><summary>${esc(title)}</summary>${body}</details>`;
}

function kv(pairs: [string, string][]): string {
  return `<table class="dbg-t">${pairs
    .map(([k, v]) => `<tr><td class="dbg-k">${esc(k)}</td><td>${v.startsWith('<a ') ? v : esc(v)}</td></tr>`)
    .join('')}</table>`;
}

function link(href: string, text?: string): string {
  return `<a href="${esc(href)}" rel="nofollow noopener">${text ?? esc(href)}</a>`;
}

function enc(v: string): string {
  return encodeURIComponent(v);
}

export const DEBUG_CSS = `
.dbg{margin-top:3rem;padding-top:1.5rem;border-top:2px dashed var(--line);font-size:.85rem}
.dbg h2{margin-top:0}
.dbg-note{color:var(--muted);margin:.2rem 0 1rem}
.dbg-g{border:1px solid var(--line);border-radius:6px;padding:.5rem .75rem;margin:0 0 .6rem}
.dbg-g>summary{cursor:pointer;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-size:.75rem}
.dbg-t{width:100%;border-collapse:collapse;margin:.6rem 0 .2rem;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem}
.dbg-t th{text-align:left;color:var(--muted);font-weight:600;border-bottom:1px solid var(--line);padding:.25rem .4rem}
.dbg-t td{padding:.25rem .4rem;border-bottom:1px solid var(--line);vertical-align:top;word-break:break-word}
.dbg-k{color:var(--muted);width:11rem}
.dbg-l{margin:.6rem 0 .2rem;padding-left:1.1rem}
.dbg-l li{margin:.15rem 0;word-break:break-word}
.dbg .ok{color:#1a7f37}
.dbg .bad{color:var(--accent);font-weight:600}
`;
