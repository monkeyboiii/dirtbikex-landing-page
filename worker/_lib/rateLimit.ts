import type { KVNamespace } from './types';

// Sliding-window-ish rate limiter over KV. KV TTL handles expiry.
// Bucket: key → count, expires at end of window.
//
// Returns { allowed, remaining }. `allowed=false` means caller should reject.
export async function rateLimitConsume(
  kv: KVNamespace,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const raw = await kv.get(key);
  const count = raw ? Number.parseInt(raw, 10) || 0 : 0;
  if (count >= limit) return { allowed: false, remaining: 0 };
  // KV `put` with TTL overrides existing TTL — we lose the original window
  // start. Acceptable for v1: worst case is the window shifts on each hit
  // (still bounded by `limit` over `windowSeconds`).
  await kv.put(key, String(count + 1), { expirationTtl: windowSeconds });
  return { allowed: true, remaining: limit - count - 1 };
}
