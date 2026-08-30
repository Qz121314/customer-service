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
    idempotencyKey?: string;
    idempotencyExpiresAt?: string;
  },
): Promise<ConversationLimitResult> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + WINDOW_MS).toISOString();
  const visitorKey = `visitor:${input.visitorId}`;
  const sourceKey = `source:${input.sourceHash}`;
  const idempotencyKey = input.idempotencyKey?.trim() ?? '';
  const idempotencyExpiresAt = input.idempotencyExpiresAt?.trim() || expiresAt;
  const idempotencyGuard = idempotencyKey
    ? `AND NOT EXISTS (
         SELECT 1
         FROM conversation_creation_quota_receipts receipt
         WHERE receipt.site_id = ?1
           AND receipt.reuse_key = ?8
           AND datetime(receipt.expires_at) > datetime(?6)
       )`
    : '';

  // SQLite evaluates eligibility and updates both counters in one statement.
  // An active idempotency receipt makes a repeated CTA start a no-op. When a
  // receipt is new, its insert shares the same atomic D1 batch as both counters,
  // so concurrent starts can never consume the quota twice.
  const consumeStatement = db
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
         ${idempotencyGuard}
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
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.siteId,
      visitorKey,
      sourceKey,
      VISITOR_CONVERSATION_LIMIT,
      SOURCE_CONVERSATION_LIMIT,
      nowIso,
      expiresAt,
      ...(idempotencyKey ? [idempotencyKey] : []),
    );

  let consumedChanges = 0;
  if (idempotencyKey) {
    const [consumed] = await db.batch([
      consumeStatement,
      db
        .prepare(
          `INSERT INTO conversation_creation_quota_receipts (
             site_id, reuse_key, expires_at, created_at
           )
           SELECT ?1, ?2, ?3, ?4
           WHERE changes() = 2
           ON CONFLICT(site_id, reuse_key) DO UPDATE SET
             expires_at = excluded.expires_at,
             created_at = excluded.created_at
           WHERE datetime(conversation_creation_quota_receipts.expires_at)
             <= datetime(excluded.created_at)`,
        )
        .bind(input.siteId, idempotencyKey, idempotencyExpiresAt, nowIso),
    ]);
    consumedChanges = Number(consumed.meta?.changes ?? 0);

    if (consumedChanges !== 2) {
      const receipt = await db
        .prepare(
          `SELECT reuse_key
           FROM conversation_creation_quota_receipts
           WHERE site_id = ?1
             AND reuse_key = ?2
             AND datetime(expires_at) > datetime(?3)
           LIMIT 1`,
        )
        .bind(input.siteId, idempotencyKey, nowIso)
        .first<string>('reuse_key');
      if (receipt) return { allowed: true };
    }
  } else {
    const consumed = await consumeStatement.run();
    consumedChanges = Number(consumed.meta?.changes ?? 0);
  }

  if (consumedChanges === 2) return { allowed: true };

  const limits = await db
    .prepare(
      `SELECT subject_key, accepted_count, expires_at
       FROM conversation_creation_limits
       WHERE site_id = ?1
         AND subject_key IN (?2, ?3)`,
    )
    .bind(input.siteId, visitorKey, sourceKey)
    .all<SubjectLimitRow>();
  const byKey = new Map(
    (limits.results ?? []).map((row) => [row.subject_key, row]),
  );
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

/**
 * Roll back a CTA start that could not obtain an eligible agent. The
 * conversation, its handoff rows and the visitor/source creation counters are
 * released in one D1 batch so an unavailable attempt never becomes a waiting
 * conversation and never consumes the 24-hour creation limits.
 */
export async function releaseUnassignedConversationStart(
  db: D1Database,
  input: {
    siteId: string;
    conversationId: string;
    visitorId: string;
    sourceHash: string;
    idempotencyKey: string;
    now?: Date;
  },
): Promise<void> {
  const nowIso = (input.now ?? new Date()).toISOString();
  const visitorKey = `visitor:${input.visitorId}`;
  const sourceKey = `source:${input.sourceHash}`;

  await db.batch([
    db
      .prepare(
        `DELETE FROM conversations
         WHERE id = ?1
           AND site_id = ?2
           AND assigned_agent IS NULL`,
      )
      .bind(input.conversationId, input.siteId),
    db
      .prepare(
        `DELETE FROM conversation_creation_quota_receipts
         WHERE site_id = ?1
           AND reuse_key = ?2`,
      )
      .bind(input.siteId, input.idempotencyKey),
    db
      .prepare(
        `UPDATE conversation_creation_limits
         SET accepted_count = MAX(accepted_count - 1, 0),
             updated_at = ?1
         WHERE changes() = 1
           AND site_id = ?2
           AND subject_key IN (?3, ?4)`,
      )
      .bind(nowIso, input.siteId, visitorKey, sourceKey),
  ]);
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
