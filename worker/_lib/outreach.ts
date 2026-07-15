// outreach.ts — the PRE-INVITE cold-outreach email: the thin first touch to a track
// operator ("we built DirtBikeX, interested?"), NO code / invite link / QR. Two surfaces:
//   • single TEST send  — POST /api/outreach/test (bearer), one email you type.
//   • BATCH pipeline    — POST /api/outreach/batch enqueues into the D1 send-once ledger
//     (`outreach`), a Cron (or POST /api/outreach/drip) drips it out, /api/outreach/status
//     reports jobs, /api/outreach/u is the tokened one-click unsubscribe.
// Sender is Resend, From joindirtbikex.com (the reputation-isolated identity, same as the
// join confirmation email). See docs/OUTREACH_MODULE.md §"Batch outreach".
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
// deliberately hardcoded — finalize it and add translations here, then redeploy.
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

// ---- sending ---------------------------------------------------------------

interface SendOpts {
  /** Logical recipient (the real operator) — drives the mailto unsubscribe context. */
  to: string;
  trackName: string;
  locale: string;
  /** Actual delivery address; defaults to `to`. Override mode redirects to your inbox. */
  deliverTo?: string;
  /** Subject prefix, e.g. `[TEST→operator@track.com] `. */
  subjectPrefix?: string;
  /** Tokened HTTPS one-click unsubscribe URL (real batch). Omit → mailto unsubscribe. */
  unsubUrl?: string;
  /** Resend Idempotency-Key — stable across retries of one attempt, unique per enqueue. */
  idempotencyKey?: string;
}

async function sendPreInvite(env: PagesEnv, o: SendOpts): Promise<{ ok: boolean; error?: string; transient?: boolean }> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.JOIN_FROM_EMAIL;
  if (!apiKey || !from) return { ok: false, error: 'email misconfigured (RESEND_API_KEY / JOIN_FROM_EMAIL)' };
  const replyTo = env.JOIN_REPLY_TO ?? '';
  const address = env.JOIN_ORG_ADDRESS ?? '';
  const deliverTo = o.deliverTo || o.to;
  const { subject: baseSubject, html: bodyHtml, text: bodyText } = renderPreInvite(o.trackName, o.locale);
  const subject = (o.subjectPrefix ?? '') + baseSubject;

  // CAN-SPAM: honest From, physical address, an unsubscribe. Real batch carries a tokened
  // HTTPS one-click (RFC 8058); the test/override path uses a mailto (RFC 2369) so a click
  // in a test email can't suppress a real operator.
  const unsubMailto = replyTo ? `mailto:${replyTo}?subject=unsubscribe` : '';
  const unsubLink = o.unsubUrl
    ? `<a href="${escapeHtml(o.unsubUrl)}">Unsubscribe</a> and we won't contact you again.`
    : (replyTo ? `<a href="mailto:${escapeHtml(replyTo)}?subject=unsubscribe">Unsubscribe</a> and we won't contact you again.` : '');
  const footerHtml = `<hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
<p style="font-size:12px;color:#888;line-height:1.5;">DirtBikeX${address ? `<br>${escapeHtml(address)}` : ''}<br>You received this one-time note because your track is publicly listed. ${unsubLink}</p>`;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#222;margin:0;padding:24px;">
${bodyHtml}
${footerHtml}
</body></html>`;
  const unsubText = o.unsubUrl ? `\nUnsubscribe: ${o.unsubUrl}` : (replyTo ? `\nNot interested? Reply "unsubscribe" and we won't contact you again.` : '');
  const text = `${bodyText}\n\n—\nDirtBikeX${address ? `\n${address}` : ''}\nYou received this one-time note because your track is publicly listed.${unsubText}`;

  const httpHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (o.idempotencyKey) httpHeaders['Idempotency-Key'] = o.idempotencyKey;

  // Email-level List-Unsubscribe headers. One-click POST only makes sense over HTTPS.
  const mailHeaders: Record<string, string> = {};
  if (o.unsubUrl) {
    mailHeaders['List-Unsubscribe'] = `<${o.unsubUrl}>`;
    mailHeaders['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  } else if (unsubMailto) {
    mailHeaders['List-Unsubscribe'] = `<${unsubMailto}>`;
  }

  let resp: Response;
  try {
    resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: httpHeaders,
      body: JSON.stringify({
        from,
        to: [deliverTo],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(Object.keys(mailHeaders).length ? { headers: mailHeaders } : {}),
      }),
    });
  } catch (err) {
    console.error('outreach:resend_threw', { err: String(err) });
    return { ok: false, error: 'resend request failed', transient: true };
  }
  if (!resp.ok) {
    console.error('outreach:resend_non_2xx', { status: resp.status });
    return { ok: false, error: `resend returned ${resp.status}`, transient: resp.status === 429 || resp.status >= 500 };
  }
  return { ok: true };
}

// ---- auth + helpers --------------------------------------------------------

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

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function normalizeEmail(raw: string): string | null {
  const e = (raw ?? '').trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

/** "1" on the prod worker only — the structural gate for real sends. */
function allowReal(env: PagesEnv): boolean {
  return env.OUTREACH_ALLOW_REAL === '1';
}

async function isSuppressed(env: PagesEnv, email: string): Promise<boolean> {
  const row = await env.SUBSCRIBERS_DB!.prepare('SELECT 1 AS x FROM suppressions WHERE email = ?').bind(email).first();
  return !!row;
}

// ---- POST /api/outreach/test — bearer-authed single test send --------------

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
  if (!EMAIL_RE.test(to)) return json({ error: 'invalid recipient email' }, 400);
  const result = await sendPreInvite(env, { to, trackName, locale });
  if (!result.ok) return json({ error: result.error ?? 'send failed' }, 502);
  return json({ ok: true, sent_to: to });
}

// ---- batch pipeline --------------------------------------------------------

type Mode = 'real' | 'dry_run' | 'override';
interface OutreachRow {
  email: string;
  mode: Mode;
  track_name: string;
  track_region: string | null;
  locale: string;
  job_id: string | null;
  override_to: string | null;
  unsub_token: string;
  attempts: number;
}

// POST /api/outreach/batch — enqueue a filtered batch (send-once) and return per-email
// disposition. `real` is prod-only; test modes (dry_run/override) are staging-only.
export async function handleBatch(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.SUBSCRIBERS_DB) return json({ error: 'outreach db not bound' }, 503);
  let body: { mode?: string; override_to?: string; recipients?: unknown; start_delay_min?: unknown; interval_min?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const mode: Mode = body.mode === 'override' ? 'override' : body.mode === 'dry_run' ? 'dry_run' : 'real';
  const overrideTo = normalizeEmail(body.override_to ?? '');
  const recipients = Array.isArray(body.recipients) ? (body.recipients as Array<Record<string, unknown>>) : [];
  // Per-batch pacing: first send after `start_delay_min`, then one every `interval_min`.
  // Stamped into each row's send_after; the drip only claims rows whose send_after has passed.
  const startDelayMin = Math.max(0, Math.min(1440, Number(body.start_delay_min) || 0));  // cap 24h
  const intervalMin = Math.max(0, Math.min(240, Number(body.interval_min) || 0));         // cap 4h/step
  const scheduled = startDelayMin > 0 || intervalMin > 0;
  const sendAfterAt = (slot: number): string | null =>
    scheduled ? new Date(Date.now() + (startDelayMin + slot * intervalMin) * 60000).toISOString().replace('T', ' ').slice(0, 19) : null;

  // Structural env gate: real → prod only; test modes → staging only.
  if (mode === 'real' && !allowReal(env)) return json({ error: 'real sends are prod-only on this worker' }, 403);
  if (mode !== 'real' && allowReal(env)) return json({ error: 'test modes run on staging, not the prod worker' }, 403);
  if (mode === 'override' && !overrideTo) return json({ error: 'override mode requires a valid override_to email' }, 400);
  if (!recipients.length) return json({ error: 'no recipients' }, 400);
  if (recipients.length > 1000) return json({ error: 'batch too large (max 1000 per job)' }, 400);

  const jobId = crypto.randomUUID();
  const dispositions: Record<string, string> = {};
  let enqueued = 0, already = 0, suppressed = 0, rejected = 0, duplicate = 0;

  // Normalize + dedup by email up front — bounds the DB work and stops duplicate
  // office-emails from double-counting the job.
  const byEmail = new Map<string, { email: string; trackName: string; region: string | null; locale: string }>();
  for (const r of recipients) {
    const email = normalizeEmail(String(r?.email ?? ''));
    if (!email) { if (r?.email) dispositions[String(r.email)] = 'rejected'; rejected++; continue; }
    if (byEmail.has(email)) { duplicate++; continue; }
    byEmail.set(email, {
      email,
      trackName: (String(r?.trackName ?? '').trim()) || 'your track',
      region: r?.trackRegion ? String(r.trackRegion) : null,
      locale: (String(r?.locale ?? 'en').trim()) || 'en',
    });
  }

  // ONE bulk suppression check instead of a query per recipient (subrequest budget).
  const emails = [...byEmail.keys()];
  const suppressedSet = new Set<string>();
  if (emails.length) {
    const rows = (await env.SUBSCRIBERS_DB.prepare(
      `SELECT email FROM suppressions WHERE email IN (${emails.map(() => '?').join(',')})`
    ).bind(...emails).all<{ email: string }>()).results;
    for (const s of rows) suppressedSet.add(s.email);
  }

  let slot = 0;
  for (const rec of byEmail.values()) {
    if (suppressedSet.has(rec.email)) { dispositions[rec.email] = 'suppressed'; suppressed++; continue; }
    const unsub = crypto.randomUUID();
    const sendAfter = sendAfterAt(slot); slot++;
    if (mode === 'real') {
      // send-once: a conflict means the address was already ledgered (never re-mail).
      const row = await env.SUBSCRIBERS_DB.prepare(
        `INSERT INTO outreach (email,status,mode,track_name,track_region,locale,job_id,override_to,unsub_token,send_after)
         VALUES (?, 'queued', 'real', ?, ?, ?, ?, NULL, ?, ?)
         ON CONFLICT(email) DO NOTHING RETURNING email`
      ).bind(rec.email, rec.trackName, rec.region, rec.locale, jobId, unsub, sendAfter).first();
      if (row) { dispositions[rec.email] = 'enqueued'; enqueued++; }
      else { dispositions[rec.email] = 'already'; already++; }
    } else {
      // test mode: upsert re-queue so you can re-run the same batch freely. On staging the
      // ledger holds only test rows, so this never clobbers a real send-once record.
      await env.SUBSCRIBERS_DB.prepare(
        `INSERT INTO outreach (email,status,mode,track_name,track_region,locale,job_id,override_to,unsub_token,send_after)
         VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET
           status='queued', mode=excluded.mode, track_name=excluded.track_name,
           track_region=excluded.track_region, locale=excluded.locale, job_id=excluded.job_id,
           override_to=excluded.override_to, unsub_token=excluded.unsub_token, send_after=excluded.send_after,
           claimed_at=NULL, sent_at=NULL, attempts=0, last_error=NULL`
      ).bind(rec.email, mode, rec.trackName, rec.region, rec.locale, jobId, mode === 'override' ? overrideTo : null, unsub, sendAfter).run();
      dispositions[rec.email] = 'enqueued'; enqueued++;
    }
  }

  await env.SUBSCRIBERS_DB.prepare(
    `INSERT INTO outreach_jobs (id,mode,override_to,requested,enqueued,already,suppressed,rejected)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(jobId, mode, mode === 'override' ? overrideTo : null, recipients.length, enqueued, already, suppressed, rejected).run();

  return json({ ok: true, job_id: jobId, mode, counts: { requested: recipients.length, enqueued, already, suppressed, rejected, duplicate }, dispositions });
}

// GET /api/outreach/preview?trackName=&locale= — the Outreach tab's live preview.
export async function handlePreview(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  const trackName = (url.searchParams.get('trackName') || 'your track').trim() || 'your track';
  const locale = (url.searchParams.get('locale') || 'en').trim() || 'en';
  return json({ ok: true, ...renderPreInvite(trackName, locale) });
}

// GET /api/outreach/status[?job_id=][&since=] — Send-jobs panel + `contacted` reconcile.
export async function handleStatus(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  if (!env.SUBSCRIBERS_DB) return json({ error: 'outreach db not bound' }, 503);
  const url = new URL(request.url);
  const jobId = url.searchParams.get('job_id');
  if (jobId) {
    const job = await env.SUBSCRIBERS_DB.prepare('SELECT * FROM outreach_jobs WHERE id=?').bind(jobId).first();
    const rows = (await env.SUBSCRIBERS_DB.prepare(
      'SELECT email,status,mode,sent_at,last_error FROM outreach WHERE job_id=? ORDER BY email'
    ).bind(jobId).all()).results;
    const prog = (await env.SUBSCRIBERS_DB.prepare(
      'SELECT status, count(*) AS n FROM outreach WHERE job_id=? GROUP BY status'
    ).bind(jobId).all<{ status: string; n: number }>()).results;
    return json({ ok: true, job, rows, progress: Object.fromEntries(prog.map((p) => [p.status, p.n])) });
  }
  const jobs = (await env.SUBSCRIBERS_DB.prepare('SELECT * FROM outreach_jobs ORDER BY created_at DESC LIMIT 25').all()).results as Array<Record<string, unknown>>;
  // Attach live per-job progress from the ledger (sent / queued / …) so the CRM can show
  // whether a job's emails actually went out, not just that they were enqueued.
  const prog = (await env.SUBSCRIBERS_DB.prepare(
    'SELECT job_id, status, count(*) AS n FROM outreach GROUP BY job_id, status'
  ).all<{ job_id: string; status: string; n: number }>()).results;
  const byJob: Record<string, Record<string, number>> = {};
  for (const p of prog) { (byJob[p.job_id] ??= {})[p.status] = p.n; }
  // per-job ETA: how many are still pending + the last scheduled send_after (for a countdown).
  const etaRows = (await env.SUBSCRIBERS_DB.prepare(
    "SELECT job_id, count(*) AS pending, max(send_after) AS eta FROM outreach WHERE status IN ('queued','claimed') GROUP BY job_id"
  ).all<{ job_id: string; pending: number; eta: string | null }>()).results;
  const etaByJob: Record<string, { pending: number; eta: string | null }> = {};
  for (const e of etaRows) etaByJob[e.job_id] = { pending: e.pending, eta: e.eta };
  for (const j of jobs) {
    j.progress = byJob[String(j.id)] ?? {};
    j.eta = etaByJob[String(j.id)] ?? { pending: 0, eta: null };
  }
  // `?since=` returns real sends after that timestamp — the CRM polls this to reconcile `contacted`.
  const since = url.searchParams.get('since');
  const sent = since
    ? (await env.SUBSCRIBERS_DB.prepare(
        "SELECT email, sent_at FROM outreach WHERE mode='real' AND status='sent' AND sent_at > ? ORDER BY sent_at"
      ).bind(since).all<{ email: string; sent_at: string }>()).results
    : [];
  return json({ ok: true, jobs, sent });
}

// GET|POST /api/outreach/u?token= — tokened unsubscribe. GET must NOT mutate: corporate
// link scanners / prefetchers (SafeLinks, Proofpoint, Gmail proxy) fire an unsolicited GET
// on every email link at delivery, which would silently suppress real operators. So GET
// renders a confirm form that POSTs; only POST (incl. RFC-8058 one-click) writes.
export async function handleUnsub(request: Request, env: PagesEnv): Promise<Response> {
  const html = (body: string, status: number) =>
    new Response(`<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;color:#222;">${body}</body></html>`,
      { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (!env.SUBSCRIBERS_DB) return html('<p>Unavailable.</p>', 503);
  const url = new URL(request.url);
  const token = (url.searchParams.get('token') ?? '').trim();
  if (!token) return html('<p>Missing token.</p>', 400);
  const row = await env.SUBSCRIBERS_DB.prepare('SELECT email FROM outreach WHERE unsub_token=?').bind(token).first<{ email: string }>();
  if (!row) return html('<p>This unsubscribe link is not valid.</p>', 404);

  if (request.method !== 'POST') {
    // Non-mutating: a human sees a button to confirm; a scanner's GET does nothing.
    const t = escapeHtml(token);
    return html(
      `<h2>Unsubscribe from DirtBikeX</h2><p>Click below to stop receiving emails at <strong>${escapeHtml(row.email)}</strong>.</p>`
      + `<form method="post" action="/api/outreach/u?token=${encodeURIComponent(t)}"><button type="submit" style="padding:.6rem 1.2rem;font-size:1rem;">Unsubscribe</button></form>`, 200);
  }
  await env.SUBSCRIBERS_DB.prepare(
    "INSERT INTO suppressions (email,reason,source) VALUES (?, 'unsub', 'one_click') ON CONFLICT(email) DO NOTHING"
  ).bind(row.email).run();
  await env.SUBSCRIBERS_DB.prepare(
    "UPDATE outreach SET status='suppressed' WHERE email=? AND status IN ('queued','claimed')"
  ).bind(row.email).run();
  return html("<h2>Unsubscribed</h2><p>You won't receive further emails from DirtBikeX. Sorry for the interruption.</p>", 200);
}

// ---- drip ------------------------------------------------------------------

const CLAIM_LIMIT = 20;     // rows per tick
const CLAIM_TTL_MIN = 10;   // reaper re-queues claims older than this (a crashed mid-send)
const MAX_ATTEMPTS = 5;
const DEFAULT_DAILY_CAP = 200;

interface DripResult { claimed: number; sent: number; dryrun: number; suppressed: number; failed: number; requeued: number; }

// One drip tick: reap stale claims → claim K queued → per row: suppression re-check, then
// send (real/override) or log (dry_run) with a Resend Idempotency-Key, mark terminal.
// Called by the Cron (scheduled) and by POST /api/outreach/drip. `dry` forces log-only.
export async function runDrip(env: PagesEnv, opts: { dry?: boolean } = {}): Promise<DripResult> {
  const out: DripResult = { claimed: 0, sent: 0, dryrun: 0, suppressed: 0, failed: 0, requeued: 0 };
  const db = env.SUBSCRIBERS_DB;
  if (!db) return out;
  // Pre-flight: never CLAIM rows we can't send. A missing key would otherwise drop each
  // claimed real row to failed_permanent, and send-once blocks re-enqueue → permanent loss.
  if (!env.RESEND_API_KEY || !env.JOIN_FROM_EMAIL) { console.error('outreach:drip_misconfigured'); return out; }

  // reaper: rows stuck in 'claimed' past the TTL get re-queued (does NOT consume an attempt).
  await db.prepare("UPDATE outreach SET status='queued', claimed_at=NULL WHERE status='claimed' AND claimed_at < datetime('now', ?)")
    .bind(`-${CLAIM_TTL_MIN} minutes`).run();

  const dailyCap = parseInt(env.OUTREACH_DAILY_CAP ?? '', 10) || DEFAULT_DAILY_CAP;
  const sentToday = (await db.prepare(
    "SELECT count(*) AS n FROM outreach WHERE mode='real' AND status='sent' AND sent_at >= datetime('now','start of day')"
  ).first<{ n: number }>())?.n ?? 0;
  let realBudget = Math.max(0, dailyCap - sentToday);

  // claim via the subquery form (bare UPDATE…LIMIT isn't guaranteed in D1's SQLite build).
  // NB: attempts is NOT incremented here — only on a real transient failure (below). A
  // cap-deferral or reaper re-queue must not consume the retry budget.
  const claimed = (await db.prepare(
    `UPDATE outreach SET status='claimed', claimed_at=datetime('now')
     WHERE rowid IN (SELECT rowid FROM outreach WHERE status='queued'
                     AND (send_after IS NULL OR send_after <= datetime('now'))
                     ORDER BY send_after, created_at LIMIT ?)
     RETURNING email, mode, track_name, track_region, locale, job_id, override_to, unsub_token, attempts`
  ).bind(CLAIM_LIMIT).all<OutreachRow>()).results;
  out.claimed = claimed.length;

  for (const row of claimed) {
    if (await isSuppressed(env, row.email)) {
      await db.prepare("UPDATE outreach SET status='suppressed' WHERE email=?").bind(row.email).run();
      out.suppressed++;
      continue;
    }
    // Defense-in-depth: a real row must never send from a non-prod worker (belt to the
    // enqueue gate + the separate prod/preview D1s). Requeue without sending.
    if (row.mode === 'real' && !allowReal(env)) {
      await db.prepare("UPDATE outreach SET status='queued', claimed_at=NULL WHERE email=?").bind(row.email).run();
      out.requeued++;
      continue;
    }
    // dry_run rows always log; opts.dry additionally logs test (override) rows. A real row
    // is NEVER treated as dry (that would mark it terminal without sending → permanent loss).
    const isDry = row.mode === 'dry_run' || (opts.dry && row.mode !== 'real');
    if (isDry) {
      console.log('outreach:drip_dryrun', { to: row.email, mode: row.mode, locale: row.locale });
      await db.prepare("UPDATE outreach SET status='sent_dryrun', sent_at=datetime('now'), last_error=NULL WHERE email=?").bind(row.email).run();
      out.dryrun++;
      continue;
    }
    if (row.mode === 'real' && realBudget <= 0) {
      // daily cap exhausted: requeue WITHOUT consuming an attempt.
      await db.prepare("UPDATE outreach SET status='queued', claimed_at=NULL WHERE email=?").bind(row.email).run();
      out.requeued++;
      continue;
    }

    const isOverride = row.mode === 'override';
    const deliverTo = isOverride ? (row.override_to || row.email) : row.email;
    // real → tokened HTTPS one-click; override/dry_run → mailto (so a test click can't
    // suppress a real operator whose token this row carries).
    const unsubUrl = row.mode === 'real' && env.MARKETING_BASE
      ? `${env.MARKETING_BASE}/api/outreach/u?token=${encodeURIComponent(row.unsub_token)}`
      : undefined;
    const subjectPrefix = isOverride ? `[TEST→${row.email}] ` : undefined;

    const res = await sendPreInvite(env, {
      to: row.email, trackName: row.track_name, locale: row.locale,
      deliverTo, subjectPrefix, unsubUrl, idempotencyKey: `${row.job_id ?? 'nojob'}:${row.email}`,
    });
    if (res.ok) {
      await db.prepare("UPDATE outreach SET status='sent', sent_at=datetime('now'), last_error=NULL WHERE email=?").bind(row.email).run();
      if (row.mode === 'real') realBudget--;
      out.sent++;
    } else if (res.transient && row.attempts < MAX_ATTEMPTS) {
      // consume ONE retry attempt here (the only place attempts rises).
      await db.prepare("UPDATE outreach SET status='queued', claimed_at=NULL, attempts=attempts+1, last_error=? WHERE email=?").bind(res.error ?? 'transient', row.email).run();
      out.requeued++;
    } else {
      await db.prepare("UPDATE outreach SET status='failed_permanent', last_error=? WHERE email=?").bind(res.error ?? 'failed', row.email).run();
      out.failed++;
    }
  }
  return out;
}

// POST /api/outreach/drip[?dry=1] — run one drip tick on demand (bearer).
export async function handleDrip(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) return json({ error: 'unauthorized' }, 401);
  const dry = new URL(request.url).searchParams.get('dry') === '1';
  // Refuse forced-dry on the prod worker: it holds only real rows, and marking them
  // sent_dryrun would consume them terminally (send-once → never sent).
  if (dry && allowReal(env)) return json({ error: 'dry-run drip is staging-only' }, 403);
  const result = await runDrip(env, { dry });
  return json({ ok: true, dry, ...result });
}
