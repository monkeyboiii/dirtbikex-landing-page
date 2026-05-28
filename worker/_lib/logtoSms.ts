// /api/logto/sms — Logto HTTP SMS connector endpoint. See docs/sms-gateway.md.
//
// Contract (Logto → us):
//   POST /api/logto/sms
//   Authorization: Bearer <LOGTO_SMS_TOKEN>
//   Content-Type: application/json
//   Body: { "to": "+8613800138000", "payload": { "code": "123456", "type": "SignIn" } }
//
//   Logto's HTTP SMS connector posts a JSON object whose shape depends on the
//   connector version; we read `to` and `payload.code` and ignore the rest.
//   If a future Logto version changes the keys, only this file needs updating.
//
// Response: 200 OK on provider accept; 400/401/403/429/502 on the failure
// modes Logto's connector understands. Any non-2xx makes Logto fail the OTP.

import type { PagesEnv } from './types';
import { normalizePhone, parseAllowedCountries } from './phone';
import { checkSmsQuota, PROVIDER_FOR } from './smsQuota';
import { sendAliyunSms } from './providers/aliyun';
import { sendAwsSms } from './providers/aws';

interface LogtoSmsPayload {
  to?: unknown;
  payload?: { code?: unknown; type?: unknown };
}

function json(status: number, body: Record<string, unknown>, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? 'unknown';
}

function checkAuth(request: Request, env: PagesEnv): boolean {
  const expected = env.LOGTO_SMS_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ')) return false;
  const got = header.slice('Bearer '.length).trim();
  // Constant-time compare — guards against timing-based token recovery.
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function handleLogtoSms(request: Request, env: PagesEnv): Promise<Response> {
  if (!checkAuth(request, env)) {
    return json(401, { error: 'unauthorized' });
  }

  let body: LogtoSmsPayload;
  try {
    body = (await request.json()) as LogtoSmsPayload;
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  const toRaw = typeof body.to === 'string' ? body.to : '';
  const code = typeof body.payload?.code === 'string' ? body.payload.code : '';
  if (!toRaw || !code) {
    return json(400, { error: 'bad_payload', reason: 'missing to/payload.code' });
  }

  const phone = normalizePhone(toRaw);
  if (!phone) {
    return json(400, { error: 'invalid_phone' });
  }

  const allowed = parseAllowedCountries(env.LOGTO_SMS_ALLOWED_COUNTRIES);
  if (!allowed.has(phone.country)) {
    return json(403, { error: 'country_blocked', country: phone.country });
  }

  const provider = PROVIDER_FOR[phone.country];

  if (!env.RATELIMIT_KV) {
    // No KV bound — fail closed for SMS (different from finalize/claim, which
    // warn-and-allow). Auth flows must not silently bypass abuse caps.
    console.error('logtoSms:no_ratelimit_kv');
    return json(503, { error: 'service_misconfigured' });
  }

  const globalCap = env.LOGTO_SMS_GLOBAL_DAILY_CAP
    ? Number.parseInt(env.LOGTO_SMS_GLOBAL_DAILY_CAP, 10) || undefined
    : undefined;

  const quota = await checkSmsQuota(
    env.RATELIMIT_KV,
    { phoneE164: phone.e164, ip: clientIp(request), country: phone.country, provider },
    globalCap,
  );
  if (!quota.allowed) {
    return json(429, { error: 'rate_limited', scope: quota.scope }, { 'Retry-After': '60' });
  }

  const result = provider === 'aliyun'
    ? await sendAliyunSms(env, { to: phone.e164, code })
    : await sendAwsSms(env, { to: phone.e164, code });

  if (!result.ok) {
    console.error('logtoSms:provider_failed', {
      provider, country: phone.country, code: result.code, status: result.status, requestId: result.requestId,
    });
    return json(502, { error: 'provider_failed', provider, code: result.code });
  }

  console.log('logtoSms:sent', {
    provider, country: phone.country, requestId: result.requestId,
  });
  return json(200, { ok: true });
}
