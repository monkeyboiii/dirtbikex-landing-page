import type { PagesEnv } from './types';

// Admin proxy — forwards CF Access verified email to sponsorhub as X-Admin-Email.
//
// SECURITY:
//   - CF Access gates the request at the edge. By the time the Worker sees it,
//     `Cf-Access-Authenticated-User-Email` is present and trustworthy.
//   - We DO NOT pass through a client-supplied `X-Admin-Email` header. The
//     forwarded value is whatever CF Access set; if it's missing the request
//     is rejected here (defense in depth — sponsorhub's middleware/admin.ts
//     also rejects on missing header, then again on allowlist mismatch).

export interface AdminProxyResult {
  status: number;
  body: string;
  contentType: string;
}

function rejectMissingCfAccess(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', reason: 'missing_cf_access' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function forwardAdmin(request: Request, env: PagesEnv, upstreamPath: string): Promise<Response> {
  if (!env.SPONSOR_API_BASE) {
    return new Response(JSON.stringify({ error: 'unreachable', reason: 'sponsor_api_unconfigured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const cfEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
  if (!cfEmail) return rejectMissingCfAccess();

  // Strip any client-supplied X-Admin-Email. Browsers can't forge CF headers
  // (CF strips them on inbound), but be explicit here.
  const headers = new Headers();
  headers.set('X-Admin-Email', cfEmail.trim().toLowerCase());
  headers.set('Accept', 'application/json');
  const incomingCT = request.headers.get('Content-Type');
  if (incomingCT) headers.set('Content-Type', incomingCT);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${env.SPONSOR_API_BASE}${upstreamPath}`, init);
  } catch (err) {
    console.error('adminProxy:fetch_threw', { err: String(err), upstreamPath });
    return new Response(JSON.stringify({ error: 'unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Pass status + body through; never cache admin responses.
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store, private',
    },
  });
}
