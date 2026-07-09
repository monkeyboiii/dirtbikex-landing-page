// /join double-opt-in waitlist. Three routes, all wired in worker/index.ts:
//   POST /api/join          { email, locale } → store 'pending' + send confirm email
//   GET  /join/confirm?token → flip 'pending'→'confirmed', 302 → /join?state=confirmed
//   GET|POST /api/unsubscribe?token → 'unsubscribed' (POST = RFC 8058 one-click)
//
// The confirmation email is the FIRST email sent, so it carries the strict
// standard: physical address, clear identification, and List-Unsubscribe
// (one-click HTTPS + mailto) + List-Unsubscribe-Post. Subscribers live in D1
// (`subscribers` table, migrations/0001_subscribers.sql); sender is Resend.
//
// Special influencer invites layer on top (migrations/0002_special_invites.sql):
//   POST /api/join with { code }  → claim a single-use invite_code (race-safe via
//     UPDATE…RETURNING), mint the Discourse invite, then send the invite email:
//     composited invite card + invite link + confirm CTA. A confirmed subscriber
//     still gets the card; never downgraded.
//   GET  /api/join/code?c=<code>  → precheck (valid/kind/label) for the page.
// See docs/JOIN_MODULE.md "Special invites".

import type { PagesEnv } from './types';
import { mintInvite } from './forumInvite';
import { composeCard } from './qrCard';
import { rateLimitConsume } from './rateLimit';

const GROUP_VAR: Record<string, 'FORUM_GROUP_TRACK_STEWARDS' | 'FORUM_GROUP_HOLESHOT_CREW' | undefined> = {
  track_stewards: 'FORUM_GROUP_TRACK_STEWARDS',
  holeshot_crew: 'FORUM_GROUP_HOLESHOT_CREW',
};

const LOCALES = [
  'en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'it', 'fr', 'es', 'ar',
  'da', 'el', 'fa-IR', 'fi', 'id', 'nl', 'pt', 'tr-TR', 'th', 'vi', 'sv',
];

function json(status: number, body: Record<string, unknown>, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': 'no-store' } });
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

function isValidEmail(s: string): boolean {
  return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Sanitize a stored locale before it goes into a redirect path (defense-in-depth). */
function localePrefix(loc: string): string {
  return LOCALES.includes(loc) && loc !== 'en' ? `/${loc}` : '';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function handleJoinSubmit(request: Request, env: PagesEnv): Promise<Response> {
  if (!env.SUBSCRIBERS_DB) {
    console.error('join:no_db');
    return json(503, { error: 'service_misconfigured' });
  }

  let body: { email?: unknown; locale?: unknown; code?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) return json(400, { error: 'invalid_email' });
  const rawLocale = typeof body.locale === 'string' ? body.locale : 'en';
  const locale = LOCALES.includes(rawLocale) ? rawLocale : 'en';
  const code = typeof body.code === 'string' ? body.code.trim() : '';

  // Abuse caps. Warn-and-allow if KV is unbound — a sign-up shouldn't hard-fail
  // on a missing-binding config gap (unlike the auth SMS gateway, which fails closed).
  if (env.RATELIMIT_KV) {
    const byIp = await rateLimitConsume(env.RATELIMIT_KV, `join:ip:${clientIp(request)}:1h`, 10, 3600);
    const byEmail = await rateLimitConsume(env.RATELIMIT_KV, `join:email:${email}:1d`, 3, 86400);
    if (!byIp.allowed || !byEmail.allowed) {
      return json(429, { error: 'rate_limited' }, { 'Retry-After': '60' });
    }
  } else {
    console.warn('join:no_ratelimit_kv');
  }

  // Special influencer invite: a ?c=<code> redemption takes a different path
  // (claim the code, send card + invite link). A confirmed subscriber still gets it.
  if (code) return redeemInvite(env, email, locale, code);

  const existing = await env.SUBSCRIBERS_DB
    .prepare('SELECT status, token FROM subscribers WHERE email = ?')
    .bind(email)
    .first<{ status: string; token: string }>();

  // Already opted in — idempotent, never re-send.
  if (existing?.status === 'confirmed') return json(200, { ok: true, status: 'confirmed' });

  const token = crypto.randomUUID();
  if (existing) {
    await env.SUBSCRIBERS_DB
      .prepare("UPDATE subscribers SET status='pending', token=?, locale=?, created_at=datetime('now'), unsubscribed_at=NULL WHERE email=?")
      .bind(token, locale, email)
      .run();
  } else {
    await env.SUBSCRIBERS_DB
      .prepare("INSERT INTO subscribers (email, status, token, locale, source) VALUES (?, 'pending', ?, ?, 'join')")
      .bind(email, token, locale)
      .run();
  }

  if (!(await sendConfirmationEmail(env, email, token))) {
    console.error('join:email_send_failed', { email });
    return json(502, { error: 'send_failed' });
  }
  return json(200, { ok: true, status: 'pending' });
}

export async function handleJoinConfirm(request: Request, env: PagesEnv): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  if (!env.SUBSCRIBERS_DB || !token) return redirect('/join?state=expired');

  const row = await env.SUBSCRIBERS_DB
    .prepare('SELECT status, locale FROM subscribers WHERE token = ?')
    .bind(token)
    .first<{ status: string; locale: string }>();
  if (!row) return redirect('/join?state=expired');

  const prefix = localePrefix(row.locale);
  if (row.status === 'unsubscribed') return redirect(`${prefix}/join?state=expired`);
  if (row.status !== 'confirmed') {
    await env.SUBSCRIBERS_DB
      .prepare("UPDATE subscribers SET status='confirmed', confirmed_at=datetime('now') WHERE token=?")
      .bind(token)
      .run();
  }
  return redirect(`${prefix}/join?state=confirmed`);
}

export async function handleUnsubscribe(request: Request, env: PagesEnv): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const oneClick = request.method === 'POST'; // RFC 8058 List-Unsubscribe-Post

  if (env.SUBSCRIBERS_DB && token) {
    const row = await env.SUBSCRIBERS_DB
      .prepare('SELECT locale FROM subscribers WHERE token = ?')
      .bind(token)
      .first<{ locale: string }>();
    if (row) {
      await env.SUBSCRIBERS_DB
        .prepare("UPDATE subscribers SET status='unsubscribed', unsubscribed_at=datetime('now') WHERE token=?")
        .bind(token)
        .run();
      return oneClick
        ? new Response('Unsubscribed', { status: 200, headers: { 'Cache-Control': 'no-store' } })
        : redirect(`${localePrefix(row.locale)}/join?state=unsubscribed`);
    }
  }
  // Unknown token / no DB — succeed idempotently (don't leak which tokens exist).
  return oneClick
    ? new Response('OK', { status: 200, headers: { 'Cache-Control': 'no-store' } })
    : redirect('/join?state=unsubscribed');
}

// ── Special influencer invites ───────────────────────────────────────────────

/** GET /api/join/code?c= — precheck for the page: is the code live, and which kind? */
export async function handleCodePrecheck(request: Request, env: PagesEnv): Promise<Response> {
  const code = new URL(request.url).searchParams.get('c') ?? '';
  if (!env.SUBSCRIBERS_DB || !code) return json(200, { valid: false });
  const row = await env.SUBSCRIBERS_DB
    .prepare(
      'SELECT k.kind AS kind, k.label AS label FROM invite_codes c ' +
      'JOIN invite_kinds k ON k.kind = c.kind ' +
      "WHERE c.code = ? AND c.used_count < c.max_uses AND (c.expires_at IS NULL OR c.expires_at > datetime('now'))",
    )
    .bind(code)
    .first<{ kind: string; label: string }>();
  return json(200, row ? { valid: true, kind: row.kind, label: row.label } : { valid: false });
}

/** Claim + deliver an invite. The claim is race-safe (UPDATE…RETURNING); on a
 *  send failure the claim is released so a code is never burned without an email. */
async function redeemInvite(env: PagesEnv, email: string, locale: string, code: string): Promise<Response> {
  const claim = await env.SUBSCRIBERS_DB!
    .prepare(
      "UPDATE invite_codes SET used_count = used_count + 1, redeemed_email = ?, redeemed_at = datetime('now') " +
      "WHERE code = ? AND used_count < max_uses AND (expires_at IS NULL OR expires_at > datetime('now')) " +
      'RETURNING kind',
    )
    .bind(email, code)
    .first<{ kind: string }>();
  if (!claim) return json(409, { error: 'code_invalid' });
  const kind = claim.kind;

  // Reuse an existing subscriber's token; never downgrade a confirmed/unsubscribed row.
  const existing = await env.SUBSCRIBERS_DB!
    .prepare('SELECT token FROM subscribers WHERE email = ?')
    .bind(email)
    .first<{ token: string }>();
  const token = existing?.token ?? crypto.randomUUID();
  if (!existing) {
    await env.SUBSCRIBERS_DB!
      .prepare("INSERT INTO subscribers (email, status, token, locale, source) VALUES (?, 'pending', ?, ?, ?)")
      .bind(email, token, locale, `invite:${kind}`)
      .run();
  }

  const cfg = await getKindConfig(env, kind);
  const groupVar = GROUP_VAR[kind];
  let inviteUrl = cfg.inviteUrl;
  if (groupVar) {
    const groupId = env[groupVar];
    if (!groupId) {
      await releaseCode(env, code);
      console.error('join:group_unconfigured', { kind, var: groupVar });
      return json(503, { error: 'service_misconfigured' });
    }
    const minted = await mintInvite(env, email, groupId, cfg.label, code);
    if (!minted.ok) {
      await releaseCode(env, code);
      console.error('join:mint_failed', { kind, reason: minted.reason });
      return json(502, { error: 'mint_failed' });
    }
    inviteUrl = `${(env.MARKETING_BASE ?? '').replace(/\/$/, '')}/s/i/${minted.inviteKey}?lang=auto`;
  }

  const card = await fetchCardBase64(env, kind, locale, inviteUrl);
  if (!(await sendInviteEmail(env, email, token, kind, { label: cfg.label, inviteUrl }, card))) {
    await releaseCode(env, code);
    console.error('join:invite_send_failed', { kind });
    return json(502, { error: 'send_failed' });
  }
  return json(200, { ok: true, status: 'pending', invite: true });
}

async function getKindConfig(env: PagesEnv, kind: string): Promise<{ label: string; inviteUrl: string }> {
  const row = await env.SUBSCRIBERS_DB!
    .prepare('SELECT label, invite_url FROM invite_kinds WHERE kind = ?')
    .bind(kind)
    .first<{ label: string; invite_url: string }>();
  return { label: row?.label ?? 'DirtBikeX', inviteUrl: row?.invite_url ?? '' };
}

async function releaseCode(env: PagesEnv, code: string): Promise<void> {
  await env.SUBSCRIBERS_DB!
    .prepare('UPDATE invite_codes SET used_count = used_count - 1, redeemed_email = NULL, redeemed_at = NULL WHERE code = ?')
    .bind(code)
    .run();
}

/** Locale-matched blank card from R2 with `url` composited in, falling back to en. */
async function fetchCardBase64(
  env: PagesEnv, kind: string, locale: string, url: string,
): Promise<string | null> {
  if (!env.QR_BUCKET || !url) return null;
  const keys = locale && locale !== 'en'
    ? [`template/${kind}/${locale}.png`, `template/${kind}/en.png`]
    : [`template/${kind}/en.png`];
  for (const key of keys) {
    const obj = await env.QR_BUCKET.get(key);
    if (!obj) continue;
    try {
      return bytesToBase64(composeCard(await obj.arrayBuffer(), url));
    } catch (err) {
      console.error('join:card_compose_failed', { key, err: String(err) });
      return null;
    }
  }
  return null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function sendInviteEmail(
  env: PagesEnv, email: string, token: string, kind: string,
  cfg: { label: string; inviteUrl: string }, cardBase64: string | null,
): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.JOIN_FROM_EMAIL;
  const base = (env.MARKETING_BASE ?? '').replace(/\/$/, '');
  if (!apiKey || !from || !base) {
    console.error('join:email_misconfigured', { hasKey: !!apiKey, hasFrom: !!from, hasBase: !!base });
    return false;
  }
  const replyTo = env.JOIN_REPLY_TO ?? '';
  const address = env.JOIN_ORG_ADDRESS ?? '';
  const confirmUrl = `${base}/join/confirm?token=${encodeURIComponent(token)}`;
  const unsubUrl = `${base}/api/unsubscribe?token=${encodeURIComponent(token)}`;
  const listUnsub = replyTo ? `<${unsubUrl}>, <mailto:${replyTo}?subject=unsubscribe>` : `<${unsubUrl}>`;
  const label = escapeHtml(cfg.label);

  const inviteBtn = cfg.inviteUrl
    ? `<p style="margin:24px 0;"><a href="${cfg.inviteUrl}" style="background:#ed6b00;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block;">Open your invite</a></p>
<p style="font-size:13px;color:#666;">Or paste this link:<br><a href="${cfg.inviteUrl}">${escapeHtml(cfg.inviteUrl)}</a></p>`
    : '';
  const cardLine = cardBase64 ? '<p>Your personal invite card is attached — scan the QR to join.</p>' : '';

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;margin:0;padding:24px;">
<p>Here's your <strong>${label}</strong> invite to <strong>DirtBikeX</strong> — the dirt-bike community app, live on the App Store.</p>
${cardLine}
${inviteBtn}
<p style="font-size:13px;color:#666;">Want early-supporter perks and new-feature first looks too? <a href="${confirmUrl}">Confirm your email</a>.</p>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
<p style="font-size:12px;color:#888;line-height:1.5;">DirtBikeX${address ? `<br>${escapeHtml(address)}` : ''}<br>You received this because you requested an invite at our sign-up. <a href="${unsubUrl}">Unsubscribe</a>${replyTo ? ` · <a href="mailto:${replyTo}">Contact us</a>` : ''}.</p>
</body></html>`;

  const text = `Here's your ${cfg.label} invite to DirtBikeX — the dirt-bike community app, live on the App Store.
${cfg.inviteUrl ? `\nOpen your invite: ${cfg.inviteUrl}\n` : ''}${cardBase64 ? 'Your personal invite card is attached — scan the QR to join.\n' : ''}
Want perks and first looks too? Confirm your email: ${confirmUrl}

—
DirtBikeX${address ? `\n${address}` : ''}
You received this because you requested an invite at our sign-up.
Unsubscribe: ${unsubUrl}`;

  let resp: Response;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Your DirtBikeX invite is inside',
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(cardBase64 ? { attachments: [{ filename: `dirtbikex-${kind}.png`, content: cardBase64 }] } : {}),
        headers: {
          'List-Unsubscribe': listUnsub,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
  } catch (err) {
    console.error('join:invite_resend_threw', { err: String(err) });
    return false;
  }
  if (!resp.ok) {
    console.error('join:invite_resend_non_2xx', { status: resp.status });
    return false;
  }
  return true;
}

async function sendConfirmationEmail(env: PagesEnv, email: string, token: string): Promise<boolean> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.JOIN_FROM_EMAIL;
  const base = (env.MARKETING_BASE ?? '').replace(/\/$/, '');
  if (!apiKey || !from || !base) {
    console.error('join:email_misconfigured', { hasKey: !!apiKey, hasFrom: !!from, hasBase: !!base });
    return false;
  }
  const replyTo = env.JOIN_REPLY_TO ?? '';
  const address = env.JOIN_ORG_ADDRESS ?? '';
  const confirmUrl = `${base}/join/confirm?token=${encodeURIComponent(token)}`;
  const unsubUrl = `${base}/api/unsubscribe?token=${encodeURIComponent(token)}`;

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;margin:0;padding:24px;">
<p>Thanks for joining the <strong>DirtBikeX</strong> list — the dirt-bike community app, live on the App Store.</p>
<p>Confirm this address to get early-supporter perks, new-feature first looks, and the occasional ride-day drop. One tap and you're in:</p>
<p style="margin:24px 0;"><a href="${confirmUrl}" style="background:#ed6b00;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block;">Confirm my subscription</a></p>
<p style="font-size:13px;color:#666;">Or paste this link into your browser:<br><a href="${confirmUrl}">${confirmUrl}</a></p>
<p style="font-size:13px;color:#666;">If you didn't request this, just ignore this email — you won't be added.</p>
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
<p style="font-size:12px;color:#888;line-height:1.5;">DirtBikeX${address ? `<br>${escapeHtml(address)}` : ''}<br>You received this because this email was entered at our launch sign-up. <a href="${unsubUrl}">Unsubscribe</a>${replyTo ? ` · <a href="mailto:${replyTo}">Contact us</a>` : ''}.</p>
</body></html>`;

  const text = `Thanks for joining the DirtBikeX list — the dirt-bike community app, live on the App Store.

Confirm this address to get perks, new-feature first looks, and the occasional drop:
${confirmUrl}

If you didn't request this, just ignore this email — you won't be added.

—
DirtBikeX${address ? `\n${address}` : ''}
You received this because this email was entered at our launch sign-up.
Unsubscribe: ${unsubUrl}`;

  const listUnsub = replyTo ? `<${unsubUrl}>, <mailto:${replyTo}?subject=unsubscribe>` : `<${unsubUrl}>`;

  let resp: Response;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [email],
        subject: 'Confirm your spot on the DirtBikeX list',
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        headers: {
          'List-Unsubscribe': listUnsub,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
  } catch (err) {
    console.error('join:resend_threw', { err: String(err) });
    return false;
  }
  if (!resp.ok) {
    console.error('join:resend_non_2xx', { status: resp.status });
    return false;
  }
  return true;
}
