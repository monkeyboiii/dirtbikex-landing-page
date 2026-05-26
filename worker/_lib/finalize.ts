import type { PagesEnv } from './types';
import { rateLimitConsume } from './rateLimit';

// /sponsors/finalize?token=<> — IAP-path desktop magic-link upload.
// Token-as-credential, single-use, 7-day TTL minted by sponsorhub on /bookings.
//
// Two Worker endpoints back the page:
//   POST /sponsors/finalize/api/presign?token=<>
//     → forwards to sponsorhub /uploads/sponsor-image with X-Finalize-Token
//   POST /sponsors/finalize/api/complete?token=<>
//     → forwards to sponsorhub /uploads/sponsor-image/complete with X-Finalize-Token
//
// Rate limit per token: 10/hour (PLAN_2 §4.2). KV namespace bound as RATELIMIT_KV.

const LIMIT_PER_HOUR = 10;
const WINDOW_SECONDS = 3600;

function rejectMissingToken(): Response {
  return new Response(JSON.stringify({ error: 'bad_request', reason: 'missing_token' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function checkRate(env: PagesEnv, token: string): Promise<Response | null> {
  if (!env.RATELIMIT_KV) {
    // No KV bound — allow (dev / first-deploy posture). Production deploy
    // must bind RATELIMIT_KV per wrangler.jsonc.
    console.warn('finalize:no_ratelimit_kv');
    return null;
  }
  const r = await rateLimitConsume(env.RATELIMIT_KV, `finalize:${token}`, LIMIT_PER_HOUR, WINDOW_SECONDS);
  if (!r.allowed) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(WINDOW_SECONDS) },
    });
  }
  return null;
}

async function forwardWithToken(env: PagesEnv, request: Request, token: string, path: string): Promise<Response> {
  if (!env.SPONSOR_API_BASE) {
    return new Response(JSON.stringify({ error: 'unreachable' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
  const body = await request.text();
  let upstream: Response;
  try {
    upstream = await fetch(`${env.SPONSOR_API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'X-Finalize-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body,
    });
  } catch (err) {
    console.error('finalize:fetch_threw', { err: String(err), path });
    return new Response(JSON.stringify({ error: 'unreachable' }), {
      status: 502, headers: { 'Content-Type': 'application/json' },
    });
  }
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

export async function handleFinalizePresign(request: Request, env: PagesEnv, token: string): Promise<Response> {
  if (!token) return rejectMissingToken();
  const limited = await checkRate(env, token);
  if (limited) return limited;
  return forwardWithToken(env, request, token, '/uploads/sponsor-image');
}

export async function handleFinalizeComplete(request: Request, env: PagesEnv, token: string): Promise<Response> {
  if (!token) return rejectMissingToken();
  const limited = await checkRate(env, token);
  if (limited) return limited;
  return forwardWithToken(env, request, token, '/uploads/sponsor-image/complete');
}
