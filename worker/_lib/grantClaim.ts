import type { PagesEnv } from './types';
import { rateLimitConsume } from './rateLimit';

// /s/g/<token> grant claim (PLAN_2 §4.3). Public; claim-token-as-credential.
//
// Rate limit: 5/hour per token + 5/hour per source IP. Compounded — both
// must allow.

const PER_TOKEN_LIMIT = 5;
const PER_IP_LIMIT = 5;
const WINDOW_SECONDS = 3600;

function clientIp(request: Request): string {
  // CF sets CF-Connecting-IP for every edge request.
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

async function checkRate(env: PagesEnv, request: Request, token: string): Promise<Response | null> {
  if (!env.RATELIMIT_KV) {
    console.warn('grantClaim:no_ratelimit_kv');
    return null;
  }
  const ip = clientIp(request);
  const byToken = await rateLimitConsume(env.RATELIMIT_KV, `claim:t:${token}`, PER_TOKEN_LIMIT, WINDOW_SECONDS);
  if (!byToken.allowed) {
    return new Response(JSON.stringify({ error: 'rate_limited', scope: 'token' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(WINDOW_SECONDS) },
    });
  }
  const byIp = await rateLimitConsume(env.RATELIMIT_KV, `claim:ip:${ip}`, PER_IP_LIMIT, WINDOW_SECONDS);
  if (!byIp.allowed) {
    return new Response(JSON.stringify({ error: 'rate_limited', scope: 'ip' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(WINDOW_SECONDS) },
    });
  }
  return null;
}

async function forward(env: PagesEnv, method: string, path: string, body?: string): Promise<Response> {
  if (!env.SPONSOR_API_BASE) {
    return new Response(JSON.stringify({ error: 'unreachable' }), {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
  const init: RequestInit = {
    method,
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
  };
  if (body) init.body = body;
  let upstream: Response;
  try {
    upstream = await fetch(`${env.SPONSOR_API_BASE}${path}`, init);
  } catch (err) {
    console.error('grantClaim:fetch_threw', { err: String(err), path });
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

export async function handleClaimLookup(request: Request, env: PagesEnv, token: string): Promise<Response> {
  if (!token) {
    return new Response(JSON.stringify({ error: 'bad_request' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  // Lookup is read-only; rate-limit it too so a leaked URL can't be probed
  // unbounded.
  const limited = await checkRate(env, request, token);
  if (limited) return limited;
  return forward(env, 'GET', `/s/g/${encodeURIComponent(token)}`);
}

export async function handleClaimCommit(request: Request, env: PagesEnv, token: string): Promise<Response> {
  if (!token) {
    return new Response(JSON.stringify({ error: 'bad_request' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    });
  }
  const limited = await checkRate(env, request, token);
  if (limited) return limited;
  const body = await request.text();
  return forward(env, 'POST', `/s/g/${encodeURIComponent(token)}/claim`, body);
}
