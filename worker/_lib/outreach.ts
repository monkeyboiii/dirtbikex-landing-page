// outreach.ts — the PRE-INVITE cold-outreach email: the thin first touch to a
// track operator ("we built DirtBikeX, interested?"), with NO code / invite link /
// QR. It's the top of the funnel; only if they reply do we mint an invite (the
// existing /api/join Deliver flow). Sender is Resend, From joindirtbikex.com — the
// reputation-isolated identity, same as the join confirmation email.
//
// REAL batch outreach runs only from PROD (its D1 is the single send-once ledger).
// This module currently exposes only the TEST send: POST /api/outreach/test
// (bearer-authed, called by the staging CRM) fires ONE pre-invite to an address you
// type, so you can preview deliverability + rendering without touching real
// operators. The batch queue + D1 send-once + Cron drip + automated suppression are
// the production follow-up. See dirtbikex-contacts CONTACT_MODULE + JOIN_MODULE.
import type { PagesEnv } from './types';

// personalization is TRACK NAME only (no owner greeting, by design)
export interface PreInvitePayload {
  to: string;
  trackName: string;
  locale: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

// One localized block per language. `en` is the base and the fallback; a non-English
// send stacks the local block ABOVE the English one in a single email (send-once
// forbids two emails to one address). TODO(copy): the wording is a placeholder and
// deliberately hardcoded — finalize it and add translations here, then redeploy
// (accepted friction; promote to a runtime store only if copy iteration bottlenecks).
interface Block { subject: string; lead: string; body: string; cta: string }

const EN: Block = {
  subject: 'A community app for {track}',
  lead: 'Hi {track} team,',
  body:
    "We're building DirtBikeX — a community app for dirt-bike and motocross tracks and the riders who visit them. "
    + "We'd love to set {track} up with a free operator profile so riders can find you, follow updates, and plan ride days.",
  cta: "If that sounds useful, just reply to this email and we'll take it from there — no cost, no commitment.",
};

// Local-language blocks. Empty for now → English-only until translations land.
const LOCALES: Record<string, Block> = {};

function fill(s: string, track: string): string {
  return s.replace(/\{track\}/g, track);
}

function blockHtml(b: Block, track: string): string {
  const t = escapeHtml(track);
  return `<p>${fill(escapeHtml(b.lead), t)}</p>
<p>${fill(escapeHtml(b.body), t)}</p>
<p>${fill(escapeHtml(b.cta), t)}</p>`;
}

function blockText(b: Block, track: string): string {
  return `${fill(b.lead, track)}\n\n${fill(b.body, track)}\n\n${fill(b.cta, track)}`;
}

export function renderPreInvite(trackName: string, locale: string): { subject: string; html: string; text: string } {
  const local = locale && locale !== 'en' ? LOCALES[locale] : undefined;
  const subject = fill((local ?? EN).subject, trackName);
  const htmlBlocks = local ? `${blockHtml(local, trackName)}\n<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">\n${blockHtml(EN, trackName)}` : blockHtml(EN, trackName);
  const textBlocks = local ? `${blockText(local, trackName)}\n\n—\n\n${blockText(EN, trackName)}` : blockText(EN, trackName);
  return { subject, html: htmlBlocks, text: textBlocks };
}

async function sendPreInvite(env: PagesEnv, p: PreInvitePayload): Promise<{ ok: boolean; error?: string }> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.JOIN_FROM_EMAIL;
  if (!apiKey || !from) return { ok: false, error: 'email misconfigured (RESEND_API_KEY / JOIN_FROM_EMAIL)' };
  const replyTo = env.JOIN_REPLY_TO ?? '';
  const address = env.JOIN_ORG_ADDRESS ?? '';
  const { subject, html: bodyHtml, text: bodyText } = renderPreInvite(p.trackName, p.locale);

  // CAN-SPAM: honest From, physical address, and an unsubscribe. Cold outreach has
  // no subscriber token, so unsub is mailto-based (a valid List-Unsubscribe channel);
  // the automated D1-suppression unsub is the production batch follow-up.
  const unsubMailto = replyTo ? `mailto:${replyTo}?subject=unsubscribe` : '';
  const footerHtml = `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
<p style="font-size:12px;color:#888;line-height:1.5;">DirtBikeX${address ? `<br>${escapeHtml(address)}` : ''}<br>You received this one-time note because your track is publicly listed. ${replyTo ? `Not interested? <a href="mailto:${escapeHtml(replyTo)}?subject=unsubscribe">Unsubscribe</a> and we won't contact you again.` : ''}</p>`;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;margin:0;padding:24px;">
${bodyHtml}
${footerHtml}
</body></html>`;
  const text = `${bodyText}\n\n—\nDirtBikeX${address ? `\n${address}` : ''}\nYou received this one-time note because your track is publicly listed.${replyTo ? `\nNot interested? Reply "unsubscribe" and we won't contact you again.` : ''}`;

  let resp: Response;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [p.to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(unsubMailto
          ? { headers: { 'List-Unsubscribe': `<${unsubMailto}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }
          : {}),
      }),
    });
  } catch (err) {
    console.error('outreach:resend_threw', { err: String(err) });
    return { ok: false, error: 'resend request failed' };
  }
  if (!resp.ok) {
    console.error('outreach:resend_non_2xx', { status: resp.status });
    return { ok: false, error: `resend returned ${resp.status}` };
  }
  return { ok: true };
}

function checkAuth(request: Request, env: PagesEnv): boolean {
  const expected = env.OUTREACH_SECRET;
  if (!expected) return false;
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const got = header.slice('Bearer '.length).trim();
  if (got.length !== expected.length) return false;  // constant-time compare
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// POST /api/outreach/test — bearer-authed single test send (called by the staging CRM).
export async function handleOutreachTest(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  let body: { to?: string; trackName?: string; locale?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const to = (body.to ?? '').trim();
  const trackName = (body.trackName ?? '').trim() || 'your track';
  const locale = (body.locale ?? 'en').trim() || 'en';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: 'invalid recipient email' }, 400);
  const result = await sendPreInvite(env, { to, trackName, locale });
  if (!result.ok) return json({ error: result.error ?? 'send failed' }, 502);
  return json({ ok: true, sent_to: to });
}
