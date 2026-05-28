import type { KVNamespace } from './types';
import type { Country } from './phone';
import { rateLimitConsume } from './rateLimit';

// Five-bucket quota stack for /api/logto/sms. Composes the existing KV
// sliding-window helper across phone / IP / country / provider / global.
//
// Eventual-consistency caveat (inherited from rateLimitConsume): KV replicas
// can lag across CF colos, so a determined attacker may slip ~1-2 sends past
// a cap before the increment propagates. Acceptable for OTP — provider-side
// cost caps are the real backstop.
//
// Cost note: every bucket check is one KV read + one write per allowed send.
// Six checks here → 6 reads + up to 6 writes. KV pricing makes this negligible
// at OTP volume (~$0.50 / million ops).
//
// Caps from docs/sms-gateway.md. To tune, edit SMS_QUOTAS below.

export type Provider = 'aliyun' | 'aws';

export const PROVIDER_FOR: Record<Country, Provider> = {
  CN: 'aliyun',
  US: 'aws',
};

const DAY = 86_400;

export const SMS_QUOTAS = {
  perPhoneMinute: { limit: 1, window: 60 },
  perPhoneDay: { limit: 5, window: DAY },
  perIp10min: { limit: 3, window: 600 },
  perIpDay: { limit: 20, window: DAY },
  perCountryDay: { CN: 300, US: 100 } as Record<Country, number>,
  perProviderDay: { aliyun: 300, aws: 100 } as Record<Provider, number>,
  globalDay: { limit: 400, window: DAY },
} as const;

export type QuotaScope =
  | 'phone_minute' | 'phone_day'
  | 'ip_10min' | 'ip_day'
  | 'country_day' | 'provider_day'
  | 'global_day';

export interface QuotaCheck {
  /** Day bucket key suffix — UTC date, so all colos roll over together. */
  dayKey: string;
}

/** UTC `YYYYMMDD` — daily windows share this suffix so colo clocks agree. */
function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

export interface QuotaDeniedResult {
  allowed: false;
  scope: QuotaScope;
}
export interface QuotaAllowedResult {
  allowed: true;
}
export type QuotaResult = QuotaDeniedResult | QuotaAllowedResult;

/**
 * Run all six checks in order (fast/cheap first). On first denial, returns
 * `{allowed:false, scope}` — earlier buckets have already been incremented,
 * which slightly accelerates global cap exhaustion under sustained attack.
 * That over-counting is bounded and self-healing within the window.
 */
export async function checkSmsQuota(
  kv: KVNamespace,
  args: { phoneE164: string; ip: string; country: Country; provider: Provider },
  globalCapOverride?: number,
): Promise<QuotaResult> {
  const day = utcDayKey();
  const checks: Array<{ scope: QuotaScope; key: string; limit: number; window: number }> = [
    { scope: 'phone_minute', key: `sms:phone:m:${args.phoneE164}`, ...SMS_QUOTAS.perPhoneMinute },
    { scope: 'ip_10min', key: `sms:ip:10m:${args.ip}`, ...SMS_QUOTAS.perIp10min },
    { scope: 'phone_day', key: `sms:phone:d:${day}:${args.phoneE164}`, ...SMS_QUOTAS.perPhoneDay },
    { scope: 'ip_day', key: `sms:ip:d:${day}:${args.ip}`, ...SMS_QUOTAS.perIpDay },
    { scope: 'country_day', key: `sms:cc:d:${day}:${args.country}`, limit: SMS_QUOTAS.perCountryDay[args.country], window: DAY },
    { scope: 'provider_day', key: `sms:prov:d:${day}:${args.provider}`, limit: SMS_QUOTAS.perProviderDay[args.provider], window: DAY },
    { scope: 'global_day', key: `sms:global:d:${day}`, limit: globalCapOverride ?? SMS_QUOTAS.globalDay.limit, window: DAY },
  ];

  for (const c of checks) {
    const r = await rateLimitConsume(kv, c.key, c.limit, c.window);
    if (!r.allowed) return { allowed: false, scope: c.scope };
  }
  return { allowed: true };
}
