// /join double-opt-in waitlist. Three routes, all wired in worker/index.ts:
//   POST /api/join          { email, locale } → store 'pending' + send confirm email
//   GET  /join/confirm?token → flip 'pending'→'confirmed', 302 → /join?state=confirmed
//   GET|POST /api/unsubscribe?token → 'unsubscribed' (POST = RFC 8058 one-click)
//
// The confirmation email is the FIRST email sent, so it carries the strict
// standard: physical address, clear identification, and List-Unsubscribe
// (one-click HTTPS + mailto) + List-Unsubscribe-Post. Subscribers live in D1
// (`subscribers` table, migrations/0001_subscribers.sql); sender is Resend.

import type { PagesEnv } from './types';
import { rateLimitConsume } from './rateLimit';

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

  let body: { email?: unknown; locale?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!isValidEmail(email)) return json(400, { error: 'invalid_email' });
  const rawLocale = typeof body.locale === 'string' ? body.locale : 'en';
  const locale = LOCALES.includes(rawLocale) ? rawLocale : 'en';

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
