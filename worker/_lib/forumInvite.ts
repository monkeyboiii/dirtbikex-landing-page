import type { PagesEnv } from './types';

export type MintResult =
  | { ok: true; inviteKey: string }
  | { ok: false; reason: 'misconfigured' | 'unreachable' | 'rejected' | 'bad_shape' | 'group_not_attached' };

/**
 * Mint an email-locked, group-attached Discourse invite. Emits
 * `console.error('mintInvite:<reason>', …)` on every failure path.
 * See JOIN_MODULE.md "Per-redemption Discourse invites".
 */
export async function mintInvite(
  env: PagesEnv,
  email: string,
  groupId: string,
  label: string,
  code: string,
): Promise<MintResult> {
  if (!env.FORUM_BASE || !env.FORUM_API_KEY) {
    console.error('mintInvite:missing_env', {
      has_base: !!env.FORUM_BASE,
      has_key: !!env.FORUM_API_KEY,
    });
    return { ok: false, reason: 'misconfigured' };
  }

  const headers: Record<string, string> = {
    'Api-Key': env.FORUM_API_KEY,
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (env.FORUM_API_USERNAME) headers['Api-Username'] = env.FORUM_API_USERNAME;

  let resp: Response;
  try {
    resp = await fetch(`${env.FORUM_BASE}/invites.json`, {
      method: 'POST',
      headers,
      body: new URLSearchParams({
        email,
        group_ids: groupId,
        skip_email: 'true',
        custom_message: label,
        description: `code:${code}`,
      }),
    });
  } catch (err) {
    console.error('mintInvite:fetch_threw', { err: String(err) });
    return { ok: false, reason: 'unreachable' };
  }

  if (!resp.ok) {
    console.error('mintInvite:non_2xx', { status: resp.status, body: (await resp.text()).slice(0, 200) });
    return { ok: false, reason: 'rejected' };
  }

  let data: { invite_key?: string; groups?: unknown[] };
  try {
    data = (await resp.json()) as typeof data;
  } catch (err) {
    console.error('mintInvite:json_parse_failed', { err: String(err) });
    return { ok: false, reason: 'bad_shape' };
  }

  if (!data.invite_key) {
    console.error('mintInvite:bad_shape');
    return { ok: false, reason: 'bad_shape' };
  }
  if (!Array.isArray(data.groups) || data.groups.length === 0) {
    console.error('mintInvite:group_not_attached', { group_id: groupId });
    return { ok: false, reason: 'group_not_attached' };
  }
  return { ok: true, inviteKey: data.invite_key };
}
