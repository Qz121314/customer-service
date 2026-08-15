const WINDOW_MS = 24 * 60 * 60 * 1000;

export const VISITOR_CONVERSATION_LIMIT = 10;
export const SOURCE_CONVERSATION_LIMIT = 20;

export type ConversationLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      code:
        | 'VISITOR_CONVERSATION_LIMIT_REACHED'
        | 'SOURCE_CONVERSATION_LIMIT_REACHED';
      retryAfterSeconds: number;
    };

export async function requestSourceHash(
  request: Request,
  visitorFallback: string,
): Promise<string> {
  const forwardedIp = request.headers
    .get('CF-Connecting-IP')
    ?.trim()
    .slice(0, 64);
  const userAgent = request.headers
    .get('User-Agent')
    ?.trim()
    .toLowerCase()
    .slice(0, 256);
  const source = forwardedIp || `visitor:${visitorFallback}`;
  return sha256(`${source}\n${userAgent || 'unknown-agent'}`);
}

export async function passesBurstLimit(
  limiter: RateLimit | undefined,
  key: string,
): Promise<boolean> {
  if (!limiter) return true;
  const result = await limiter.limit({ key });
  return result.success;
}

export async function consumeConversationCreationQuota(
  db: D1Database,
  input: {
    siteId: string;
    visitorId: string;
    sourceHash: string;
    now?: Date;
  },
): Promise<ConversationLimitResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + WINDOW_MS).toISOString();
  const visitorKey = `visitor:${input.visitorId}`;
  const sourceKey = `source:${input.sourceHash}`;
  const source = await consumeSubject(
    db,
    input.siteId,
    sourceKey,
    SOURCE_CONVERSATION_LIMIT,
    nowIso,
    expiresAt,
  );
  if (!source) {
    return {
      allowed: false,
      code: 'SOURCE_CONVERSATION_LIMIT_REACHED',
      retryAfterSeconds: await subjectRetryAfter(
        db,
        input.siteId,
        sourceKey,
        now,
      ),
    };
  }
  const visitor = await consumeSubject(
    db,
    input.siteId,
    visitorKey,
    VISITOR_CONVERSATION_LIMIT,
    nowIso,
    expiresAt,
  );
  if (!visitor) {
    return {
      allowed: false,
      code: 'VISITOR_CONVERSATION_LIMIT_REACHED',
      retryAfterSeconds: await subjectRetryAfter(
        db,
        input.siteId,
        visitorKey,
        now,
      ),
    };
  }
  return { allowed: true };
}

async function consumeSubject(
  db: D1Database,
  siteId: string,
  subjectKey: string,
  limit: number,
  nowIso: string,
  expiresAt: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `INSERT INTO conversation_creation_limits (
         site_id, subject_key, accepted_count, window_started_at,
         expires_at, updated_at
       ) VALUES (?1, ?2, 1, ?3, ?4, ?3)
       ON CONFLICT(site_id, subject_key) DO UPDATE SET
         accepted_count = CASE
           WHEN datetime(expires_at) <= datetime(excluded.window_started_at) THEN 1
           ELSE accepted_count + 1
         END,
         window_started_at = CASE
           WHEN datetime(expires_at) <= datetime(excluded.window_started_at)
             THEN excluded.window_started_at
           ELSE window_started_at
         END,
         expires_at = CASE
           WHEN datetime(expires_at) <= datetime(excluded.window_started_at)
             THEN excluded.expires_at
           ELSE expires_at
         END,
         updated_at = excluded.updated_at
       WHERE datetime(expires_at) <= datetime(excluded.window_started_at)
          OR accepted_count < ?5
       RETURNING accepted_count`,
    )
    .bind(siteId, subjectKey, nowIso, expiresAt, limit)
    .first<{ accepted_count: number }>();
  return row !== null;
}

async function subjectRetryAfter(
  db: D1Database,
  siteId: string,
  subjectKey: string,
  now: Date,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT expires_at
       FROM conversation_creation_limits
       WHERE site_id = ?1 AND subject_key = ?2
       LIMIT 1`,
    )
    .bind(siteId, subjectKey)
    .first<{ expires_at: string }>();
  return retryAfter(row?.expires_at, now);
}

function retryAfter(expiresAt: string | undefined, now: Date): number {
  const timestamp = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  if (!Number.isFinite(timestamp) || timestamp <= now.getTime()) return 1;
  return Math.max(1, Math.ceil((timestamp - now.getTime()) / 1000));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
