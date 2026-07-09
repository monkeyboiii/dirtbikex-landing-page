#!/usr/bin/env node
// admin.mjs — friendly wrapper over `wrangler` for the /join + special-invite data.
// Reuses your wrangler login (no extra token). All writes hit the remote D1/R2.
// See docs/JOIN_MODULE.md "Admin (admin.mjs)".
//
//   node scripts/admin.mjs mint --kind holeshot_crew --campaign alice --count 5 [--expires-days 21]
//   node scripts/admin.mjs codes [--kind K] [--campaign C]   # lists codes + their /join?c= links
//   node scripts/admin.mjs sql "SELECT * FROM invite_codes"   # read-only D1 query
//   node scripts/admin.mjs subs [--list]
//   node scripts/admin.mjs kinds
//   node scripts/admin.mjs kinds set --kind plain --url "https://…/s/i/<key>?lang=auto" --label "DirtBikeX"
//   node scripts/admin.mjs upload-template ./templates   # walks ./templates/<kind>/<locale>.png → R2
//   (append --env preview to target the preview Worker env + its own D1 database.)

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'dbx-subscribers';
const BUCKET = 'dbx-qr';
const KINDS = ['holeshot_crew', 'track_stewards', 'plain'];
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32 (no I/L/O/U)

// ── arg parsing ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = argv[0];
const positional = [];
const opts = {};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--')) {
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) opts[key] = true;
    else { opts[key] = next; i++; }
  } else positional.push(a);
}
const ENV_ARGS = opts.env ? ['--env', String(opts.env)] : [];

function die(msg) { console.error(msg); process.exit(1); }
function sqlStr(s) { return `'${String(s).replace(/'/g, "''")}'`; }

// ── wrangler ───────────────────────────────────────────────────────────────
function d1(sql) {
  const out = execFileSync(
    'npx', ['-y', 'wrangler@4', 'd1', 'execute', DB, ...ENV_ARGS, '--remote', '--json', '--command', sql],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
  const parsed = JSON.parse(out);
  return Array.isArray(parsed) ? (parsed[0]?.results ?? []) : (parsed.results ?? []);
}

function marketingBase() {
  const raw = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const cfg = JSON.parse(raw);
  const base = opts.env === 'preview' ? cfg.env?.preview?.vars?.MARKETING_BASE : cfg.vars?.MARKETING_BASE;
  return (base ?? 'https://www.dirtbikex.com').replace(/\/$/, '');
}

// ── commands ─────────────────────────────────────────────────────────────────
function mint() {
  const kind = opts.kind;
  if (!KINDS.includes(kind)) die(`--kind must be one of: ${KINDS.join(', ')}`);
  const campaign = opts.campaign ? String(opts.campaign) : null;
  const count = Math.max(1, parseInt(opts.count ?? '1', 10) || 1);
  const days = opts['expires-days'] === undefined ? 21 : parseInt(opts['expires-days'], 10);
  const expires = Number.isFinite(days) && days > 0 ? `datetime('now', '+${days} days')` : 'NULL';

  const codes = Array.from({ length: count }, () =>
    Array.from(crypto.randomBytes(10), (b) => CODE_ALPHABET[b % 32]).join(''));
  const values = codes
    .map((c) => `(${sqlStr(c)}, ${sqlStr(kind)}, ${campaign ? sqlStr(campaign) : 'NULL'}, ${expires})`)
    .join(', ');
  d1(`INSERT INTO invite_codes (code, kind, campaign, expires_at) VALUES ${values}`);

  const base = marketingBase();
  console.log(`Minted ${count} ${kind} code(s)${campaign ? ` for "${campaign}"` : ''}${days > 0 ? `, expiring in ${days} days` : ''}:\n`);
  for (const c of codes) console.log(`  ${base}/join?c=${c}`);
}

function codes() {
  const where = [];
  if (opts.kind) where.push(`kind = ${sqlStr(opts.kind)}`);
  if (opts.campaign) where.push(`campaign = ${sqlStr(opts.campaign)}`);
  const rows = d1(
    `SELECT code, kind, campaign, used_count || '/' || max_uses AS uses, ` +
    `COALESCE(redeemed_email,'') AS redeemed, COALESCE(redeemed_at,'') AS redeemed_at, ` +
    `COALESCE(expires_at,'never') AS expires ` +
    `FROM invite_codes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC`,
  );
  if (!rows.length) {
    const filter = where.length ? ` matching ${where.join(' AND ')}` : '';
    const envArg = ENV_ARGS.length ? ` ${ENV_ARGS.join(' ')}` : '';
    console.log(`No codes${filter}.`);
    console.log(`Mint one:  node scripts/admin.mjs mint --kind <kind> --campaign <name>${envArg}`);
    return;
  }
  const base = marketingBase();
  console.table(rows.map((r) => ({ ...r, link: `${base}/join?c=${r.code}` })));
}

function sql() {
  const query = positional.join(' ').trim();
  if (!query) die('usage: sql "SELECT * FROM invite_codes"');
  if (!/^\s*(select|with|pragma|explain)\b/i.test(query)) {
    die('sql is read-only — start with SELECT / WITH / PRAGMA / EXPLAIN');
  }
  const rows = d1(query);
  if (!rows.length) { console.log('(0 rows)'); return; }
  console.table(rows);
}

function subs() {
  console.table(d1("SELECT status, COUNT(*) AS n FROM subscribers GROUP BY status"));
  if (opts.list) {
    const rows = d1("SELECT email, confirmed_at FROM subscribers WHERE status='confirmed' ORDER BY confirmed_at");
    for (const r of rows) console.log(`  ${r.email}`);
  }
}

function kinds() {
  if (positional[0] === 'set') {
    const kind = opts.kind;
    if (!KINDS.includes(kind)) die(`--kind must be one of: ${KINDS.join(', ')}`);
    const sets = ["updated_at = datetime('now')"];
    if (opts.url !== undefined) sets.push(`invite_url = ${sqlStr(opts.url)}`);
    if (opts.label !== undefined) sets.push(`label = ${sqlStr(opts.label)}`);
    if (sets.length === 1) die('nothing to set — pass --url and/or --label');
    d1(`UPDATE invite_kinds SET ${sets.join(', ')} WHERE kind = ${sqlStr(kind)}`);
    console.log(`updated ${kind}`);
  }
  console.table(d1('SELECT kind, label, invite_url, updated_at FROM invite_kinds ORDER BY kind'));
}

function uploadTemplate() {
  const dir = positional[0];
  if (!dir || !fs.existsSync(dir)) die('usage: upload-template <dir>  (expects <dir>/<kind>/<locale>.png)');
  let n = 0;
  for (const kind of KINDS) {
    const kdir = path.join(dir, kind);
    if (!fs.existsSync(kdir)) continue;
    for (const file of fs.readdirSync(kdir)) {
      if (!file.endsWith('.png')) continue;
      const local = path.join(kdir, file);
      const key = `template/${kind}/${file}`;
      execFileSync('npx', ['-y', 'wrangler@4', 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', local, '--remote'],
        { cwd: ROOT, stdio: 'inherit' });
      console.log(`  ↑ ${key}`);
      n++;
    }
  }
  console.log(`${n} template(s) uploaded to r2://${BUCKET}/template/<kind>/<locale>.png`);
}

const COMMANDS = { mint, codes, sql, subs, kinds, 'upload-template': uploadTemplate };
if (!COMMANDS[cmd]) die(`commands: ${Object.keys(COMMANDS).join(', ')} (append --env preview to target preview)`);
COMMANDS[cmd]();
