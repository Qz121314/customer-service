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
  try {
    await db
      .prepare(
        `INSERT INTO conversation_creation_quota_gate (
           site_id, visitor_key, source_key, window_started_at, expires_at
         ) VALUES (?1, ?2, ?3, ?4, ?5)`,
      )
      .bind(input.siteId, visitorKey, sourceKey, nowIso, expiresAt)
      .run();
    return { allowed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.includes('VISITOR_CONVERSATION_LIMIT_REACHED')
      ? 'VISITOR_CONVERSATION_LIMIT_REACHED'
      : message.includes('SOURCE_CONVERSATION_LIMIT_REACHED')
        ? 'SOURCE_CONVERSATION_LIMIT_REACHED'
        : null;
    if (!code) throw error;
    const subjectKey =
      code === 'VISITOR_CONVERSATION_LIMIT_REACHED' ? visitorKey : sourceKey;
    const row = await db
      .prepare(
        `SELECT expires_at
         FROM conversation_creation_limits
         WHERE site_id = ?1 AND subject_key = ?2
         LIMIT 1`,
      )
      .bind(input.siteId, subjectKey)
      .first<{ expires_at: string }>();
    return {
      allowed: false,
      code,
      retryAfterSeconds: retryAfter(row?.expires_at, now),
    };
  }
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
