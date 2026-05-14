import type {
  GroupSummary,
  InviteRow,
  PagesEnv,
  TopicReference,
} from './types';

/**
 * Calls the Discourse Data Explorer query that returns the recipient-facing
 * invite shape, reshapes the column-oriented response into an `InviteRow`.
 *
 * `email` is intentionally never selected by the SQL — closes the leak vector
 * at the source. Do not add it.
 *
 * Treats both `expired = true` and exhausted-redemptions as terminal `expired`
 * (same UX cell — the invite cannot be claimed).
 */
export type LookupResult =
  | { status: 'valid'; invite: InviteRow }
  | { status: 'expired' }
  | { status: 'not_found' }
  | { status: 'unreachable' };

export async function lookupInvite(env: PagesEnv, key: string): Promise<LookupResult> {
  if (!env.FORUM_BASE || !env.FORUM_INVITE_QUERY_ID || !env.FORUM_API_KEY) {
    console.error('lookupInvite:missing_env', {
      has_base: !!env.FORUM_BASE,
      has_query_id: !!env.FORUM_INVITE_QUERY_ID,
      has_api_key: !!env.FORUM_API_KEY,
    });
    return { status: 'unreachable' };
  }

  const url = `${env.FORUM_BASE}/admin/plugins/explorer/queries/${env.FORUM_INVITE_QUERY_ID}/run.json`;
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Api-Key': env.FORUM_API_KEY,
        'Api-Username': env.FORUM_API_USERNAME ?? 'system',
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: `params=${encodeURIComponent(JSON.stringify({ invite_key: key }))}`,
      // 5min edge cache, matches the previous fetchInvite path.
      ...({ cf: { cacheTtl: 300, cacheEverything: true } } as RequestInit),
    });
  } catch (err) {
    console.error('lookupInvite:fetch_threw', { err: String(err), url });
    return { status: 'unreachable' };
  }

  if (resp.status !== 200) {
    console.error('lookupInvite:non_200', { status: resp.status, url });
    return { status: 'unreachable' };
  }

  let body: { success?: boolean; columns?: string[]; rows?: unknown[][] };
  try {
    body = (await resp.json()) as typeof body;
  } catch (err) {
    console.error('lookupInvite:json_parse_failed', { err: String(err), url });
    return { status: 'unreachable' };
  }

  if (!body.success || !Array.isArray(body.columns) || !Array.isArray(body.rows)) {
    console.error('lookupInvite:bad_shape', {
      success: body.success,
      has_cols: Array.isArray(body.columns),
      has_rows: Array.isArray(body.rows),
    });
    return { status: 'unreachable' };
  }
  if (body.rows.length === 0) return { status: 'not_found' };

  const columns = body.columns;
  const row = body.rows[0];
  const get = <T,>(col: string): T => row[columns.indexOf(col)] as T;

  const forumHost = new URL(env.FORUM_BASE).host;
  const username = get<string>('inviter_username');
  const invite: InviteRow = {
    id: get<number>('id'),
    invite_key: get<string>('invite_key'),
    description: get<string | null>('description'),
    max_redemptions_allowed: get<number | null>('max_redemptions_allowed'),
    redemption_count: get<number | null>('redemption_count') ?? 0,
    created_at: get<string>('created_at'),
    updated_at: get<string>('updated_at'),
    expires_at: get<string | null>('expires_at'),
    expired: Boolean(get<boolean | null>('expired')),
    groups: normalizeJsonbArray<GroupSummary>(get('groups')),
    topics: normalizeJsonbArray<TopicReference>(get('topics')),
    invited_by: {
      username,
      name: get<string | null>('inviter_name'),
      title: get<string | null>('inviter_title'),
      avatar_template: buildAvatarTemplate(
        forumHost,
        username,
        get<number | null>('inviter_uploaded_avatar_id'),
      ),
    },
  };

  if (invite.expired) return { status: 'expired' };
  if (
    invite.max_redemptions_allowed != null &&
    invite.redemption_count >= invite.max_redemptions_allowed
  ) {
    return { status: 'expired' };
  }
  return { status: 'valid', invite };
}

function buildAvatarTemplate(
  forumHost: string,
  username: string,
  uploadId: number | null,
): string | null {
  if (uploadId == null) return null;
  return `/user_avatar/${forumHost}/${username.toLowerCase()}/{size}/${uploadId}_2.png`;
}

/**
 * `jsonb_agg(...)` cells arrive as already-parsed JS arrays from Data Explorer.
 * Fall back to JSON.parse for safety in case a future plugin update changes
 * the serialization.
 */
function normalizeJsonbArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
