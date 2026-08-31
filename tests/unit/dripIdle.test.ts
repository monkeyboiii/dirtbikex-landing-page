import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runDrip } from '../../worker/_lib/outreach.ts';

/**
 * The idle-drip guard.
 *
 * The cron runs every minute. With an empty queue it used to full-scan every row ever sent
 * to compute "sent today" — an answer that is always 0 while nothing is queued. Measured on
 * prod 2026-08-31: 1.82M of ~1.84M D1 rows read per day, accomplishing nothing.
 *
 * These tests pin the two things that make the guard safe rather than merely cheap:
 * the scan really is skipped when idle, and a non-empty queue is still processed exactly
 * as before. A guard that strands a real queue is worse than the waste it removes.
 */

/** Records every SQL string the drip prepares, and answers from a scripted table. */
function fakeDB(rows: { pending?: boolean }) {
  const seen: string[] = [];
  const db = {
    prepare(sql: string) {
      seen.push(sql.replace(/\s+/g, ' ').trim());
      const stmt: any = {
        bind: () => stmt,
        run: async () => ({ success: true }),
        first: async () => (sql.includes("status IN ('queued','claimed') LIMIT 1")
          ? (rows.pending ? { 1: 1 } : null)
          : { n: 0 }),
        // The claim returns nothing, so the tick ends right after it. That is enough to
        // prove the claim was reached without standing up a fake Resend.
        all: async () => ({ results: [] }),
      };
      return stmt;
    },
  };
  return { db, seen };
}

const baseEnv = (db: any, extra: Record<string, string> = {}) => ({
  SUBSCRIBERS_DB: db,
  RESEND_API_KEY: 'test',
  JOIN_FROM_EMAIL: 'test@example.com',
  ...extra,
}) as any;

const SENT_TODAY = "sent_at >= datetime('now','start of day')";
const REAPER = "UPDATE outreach SET status='queued', claimed_at=NULL WHERE status='claimed'";

test('empty queue: no sent_today scan, no reaper write, and it says why it is quiet', async () => {
  const { db, seen } = fakeDB({ pending: false });
  const out = await runDrip(baseEnv(db));
  assert.equal(out.idle, 'empty');
  assert.ok(!seen.some((q) => q.includes(SENT_TODAY)), 'the full scan must not run');
  assert.ok(!seen.some((q) => q.startsWith(REAPER)), 'no write per idle tick');
  assert.equal(seen.filter((q) => q.includes('FROM outreach')).length, 1, 'exactly one probe');
});

test('non-empty queue: the drip proceeds exactly as before — THE regression that matters', async () => {
  const { db, seen } = fakeDB({ pending: true });
  const out = await runDrip(baseEnv(db));
  assert.equal(out.idle, undefined, 'a working tick is not idle');
  assert.ok(seen.some((q) => q.startsWith(REAPER)), 'reaper still runs');
  assert.ok(seen.some((q) => q.includes(SENT_TODAY)), 'sent_today still computed');
  assert.ok(seen.some((q) => q.includes("SET status='claimed'")), 'rows are still claimed');
});

test('off-switch stops it dead, and is distinguishable from an empty queue', async () => {
  for (const raw of ['0', 'false', 'off', 'no', 'OFF']) {
    const { db, seen } = fakeDB({ pending: true });
    const out = await runDrip(baseEnv(db, { OUTREACH_DRIP_ENABLED: raw }));
    assert.equal(out.idle, 'disabled', `"${raw}" must disable`);
    assert.equal(seen.length, 0, `"${raw}" must issue no query at all`);
  }
});

test('the switch is opt-OUT: absent, empty, or any other value leaves it running', async () => {
  for (const extra of [{}, { OUTREACH_DRIP_ENABLED: '' }, { OUTREACH_DRIP_ENABLED: '1' },
                       { OUTREACH_DRIP_ENABLED: 'yes' }, { OUTREACH_DRIP_ENABLED: 'typo' }]) {
    const { db, seen } = fakeDB({ pending: true });
    const out = await runDrip(baseEnv(db, extra as any));
    assert.notEqual(out.idle, 'disabled', `${JSON.stringify(extra)} must NOT disable`);
    assert.ok(seen.length > 0);
  }
});

test('a misconfigured drip still reports misconfigured, not idle', async () => {
  const { db } = fakeDB({ pending: false });
  const out = await runDrip({ SUBSCRIBERS_DB: db, JOIN_FROM_EMAIL: 'x@y.z' } as any);
  assert.equal(out.idle, undefined, 'the pre-flight must win — losing that warning hides a real fault');
});
