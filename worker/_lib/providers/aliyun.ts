// Aliyun SMS sender — SendSms via RPC-style signature v1 (HMAC-SHA1).
//
// Docs: https://help.aliyun.com/zh/sms/developer-reference/api-dysmsapi-2017-05-25-sendsms
//       https://help.aliyun.com/zh/sdk/product-overview/v3-request-structure-and-signature
//
// Why v1 (not v3): v1 signs the canonicalized query string with HMAC-SHA1 and
// works for a single hand-built request. v3 (ACS3-HMAC-SHA256) adds a
// canonical-headers step that buys nothing for one endpoint. ~40 lines this way.
//
// Endpoint is region-agnostic (`dysmsapi.aliyuncs.com`) — `ALIYUN_REGION`
// (typically `cn-hangzhou`) goes into the RegionId param, not the host.

import type { PagesEnv } from '../types';

export interface SendResult {
  ok: boolean;
  /** Provider-side request ID, for log correlation. */
  requestId?: string;
  /** Non-success code, or the literal string "OK". */
  code?: string;
  /** Human-readable error from Aliyun (Chinese), kept for log diagnostics. */
  message?: string;
  /** HTTP status from Aliyun. */
  status?: number;
}

/**
 * Percent-encoding per Aliyun's spec: RFC 3986 strict, plus `!'()*` escaped.
 * `encodeURIComponent` doesn't escape those by default.
 */
function aliyunEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const bytes = new Uint8Array(sig);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sendAliyunSms(
  env: PagesEnv,
  args: { to: string; code: string },
): Promise<SendResult> {
  const ak = env.ALIYUN_ACCESS_KEY_ID;
  const sk = env.ALIYUN_ACCESS_KEY_SECRET;
  const signName = env.ALIYUN_SMS_SIGN_NAME;
  const templateCode = env.ALIYUN_SMS_TEMPLATE_CODE;
  const region = env.ALIYUN_REGION ?? 'cn-hangzhou';
  if (!ak || !sk || !signName || !templateCode) {
    return { ok: false, code: 'ConfigMissing', message: 'aliyun env not configured' };
  }

  const params: Record<string, string> = {
    AccessKeyId: ak,
    Action: 'SendSms',
    Format: 'JSON',
    PhoneNumbers: args.to,
    RegionId: region,
    SignName: signName,
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: nonce(),
    SignatureVersion: '1.0',
    TemplateCode: templateCode,
    TemplateParam: JSON.stringify({ code: args.code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2017-05-25',
  };

  const sortedKeys = Object.keys(params).sort();
  const canonical = sortedKeys
    .map((k) => `${aliyunEncode(k)}=${aliyunEncode(params[k]!)}`)
    .join('&');
  const stringToSign = `POST&${aliyunEncode('/')}&${aliyunEncode(canonical)}`;
  const signature = await hmacSha1Base64(sk + '&', stringToSign);

  const body = `${canonical}&Signature=${aliyunEncode(signature)}`;
  let resp: Response;
  try {
    resp = await fetch('https://dysmsapi.aliyuncs.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    return { ok: false, code: 'NetworkError', message: String(err) };
  }

  const text = await resp.text();
  let parsed: { Code?: string; Message?: string; RequestId?: string } = {};
  try { parsed = JSON.parse(text); } catch { /* keep empty */ }

  const ok = resp.ok && parsed.Code === 'OK';
  return {
    ok,
    requestId: parsed.RequestId,
    code: parsed.Code,
    message: parsed.Message,
    status: resp.status,
  };
}
