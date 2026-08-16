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

type SubjectLimitRow = {
  subject_key: string;
  accepted_count: number;
  expires_at: string;
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

  // SQLite evaluates eligibility and updates both counters in one statement.
  // If either subject is already at its active-window limit, the INSERT SELECT
  // produces no rows, so neither counter is consumed by a rejected creation.
  const consumed = await db
    .prepare(
      `WITH subjects(subject_key, subject_limit) AS (
         SELECT ?2, ?4
         UNION ALL
         SELECT ?3, ?5
       ),
       eligibility AS (
         SELECT
           COUNT(*) AS total_count,
           SUM(
             CASE
               WHEN limits.subject_key IS NULL THEN 1
               WHEN datetime(limits.expires_at) <= datetime(?6) THEN 1
               WHEN limits.accepted_count < subjects.subject_limit THEN 1
               ELSE 0
             END
           ) AS eligible_count
         FROM subjects
         LEFT JOIN conversation_creation_limits limits
           ON limits.site_id = ?1
          AND limits.subject_key = subjects.subject_key
       )
       INSERT INTO conversation_creation_limits (
         site_id, subject_key, accepted_count, window_started_at,
         expires_at, updated_at
       )
       SELECT ?1, subjects.subject_key, 1, ?6, ?7, ?6
       FROM subjects
       WHERE (SELECT total_count = eligible_count FROM eligibility)
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
       RETURNING subject_key`,
    )
    .bind(
      input.siteId,
      visitorKey,
      sourceKey,
      VISITOR_CONVERSATION_LIMIT,
      SOURCE_CONVERSATION_LIMIT,
      nowIso,
      expiresAt,
    )
    .all<{ subject_key: string }>();

  if ((consumed.results ?? []).length === 2) return { allowed: true };

  const limits = await db
    .prepare(
      `SELECT subject_key, accepted_count, expires_at
       FROM conversation_creation_limits
       WHERE site_id = ?1
         AND subject_key IN (?2, ?3)`,
    )
    .bind(input.siteId, visitorKey, sourceKey)
    .all<SubjectLimitRow>();
  const byKey = new Map((limits.results ?? []).map((row) => [row.subject_key, row]));
  const source = byKey.get(sourceKey);
  if (subjectBlocked(source, SOURCE_CONVERSATION_LIMIT, now)) {
    return {
      allowed: false,
      code: 'SOURCE_CONVERSATION_LIMIT_REACHED',
      retryAfterSeconds: retryAfter(source?.expires_at, now),
    };
  }

  const visitor = byKey.get(visitorKey);
  return {
    allowed: false,
    code: 'VISITOR_CONVERSATION_LIMIT_REACHED',
    retryAfterSeconds: retryAfter(visitor?.expires_at, now),
  };
}

function subjectBlocked(
  row: SubjectLimitRow | undefined,
  limit: number,
  now: Date,
): boolean {
  if (!row || Number(row.accepted_count) < limit) return false;
  const expiresAt = new Date(row.expires_at).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
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
