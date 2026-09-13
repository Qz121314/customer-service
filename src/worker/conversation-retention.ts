export const CONVERSATION_LIFETIME_HOURS = 24;
export const CONVERSATION_LIFETIME_MS =
  CONVERSATION_LIFETIME_HOURS * 60 * 60 * 1000;

type RetentionBindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
};

type ExpiredConversationRow = {
  id: string;
};

type MediaObjectRow = {
  object_key: string;
};

type StaleMediaRow = MediaObjectRow & {
  id: string;
};

type DeletedVisitorRow = {
  id: string;
};

const DELETE_BATCH_SIZE = 100;
const MAX_CONVERSATION_DELETE_PASSES = 5;
const MAX_ORPHAN_VISITOR_DELETE_PASSES = 2;
const PUSH_SUBSCRIPTION_DELETE_BATCH_SIZE = 1000;
const REPORTING_HISTORY_CLEANUP_UTC_HOUR = 12;
const HOUR_MS = 60 * 60 * 1000;

export const STALE_PENDING_MEDIA_UPDATE_SQL = `UPDATE media_items
     SET status = 'failed', updated_at = ?1
     WHERE status = 'pending'
       AND updated_at <= ?2`;

export const STALE_FAILED_MEDIA_SELECT_SQL = `SELECT id, object_key
     FROM media_items
     WHERE status = 'failed'
       AND updated_at <= ?1
     ORDER BY updated_at ASC, id ASC
     LIMIT ?2`;

export const ORPHAN_VISITOR_BATCH_SQL = `SELECT v.id, v.site_id, v.external_id
           FROM visitors v
           WHERE v.expires_at <= ?1
             AND NOT EXISTS (
               SELECT 1
               FROM conversations c
               WHERE c.site_id = v.site_id
                 AND c.visitor_id = v.id
             )
           ORDER BY v.expires_at ASC, v.id ASC
           LIMIT ?2`;

export function conversationExpiresAt(createdAt: string | Date): string {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const timestamp = created.getTime();
  if (!Number.isFinite(timestamp))
    throw new Error('Invalid conversation creation time');
  return new Date(timestamp + CONVERSATION_LIFETIME_MS).toISOString();
}

export async function purgeExpiredConversations(
  env: RetentionBindings,
  now = new Date(),
): Promise<{
  conversations: number;
  mediaObjects: number;
  staleMediaObjects: number;
  visitors: number;
}> {
  const nowIso = now.toISOString();
  let conversations = 0;
  let mediaObjects = 0;

  for (let pass = 0; pass < MAX_CONVERSATION_DELETE_PASSES; pass += 1) {
    const expired = await env.DB.prepare(
      `SELECT id
       FROM conversations
       WHERE expires_at <= ?1
       ORDER BY expires_at ASC, id ASC
       LIMIT ?2`,
    )
      .bind(nowIso, DELETE_BATCH_SIZE)
      .all<ExpiredConversationRow>();
    const ids = (expired.results ?? []).map((row) => row.id);
    if (ids.length === 0) break;

    const placeholders = ids.map((_, index) => `?${index + 1}`).join(', ');
    const media = await env.DB.prepare(
      `SELECT object_key FROM media_items WHERE conversation_id IN (${placeholders})`,
    )
      .bind(...ids)
      .all<MediaObjectRow>();
    const keys = [
      ...new Set(
        (media.results ?? []).map((row) => row.object_key).filter(Boolean),
      ),
    ];
    for (let index = 0; index < keys.length; index += 1000) {
      const chunk = keys.slice(index, index + 1000);
      if (chunk.length > 0) await env.MEDIA.delete(chunk);
    }

    // messages and media_items both reference conversations with ON DELETE
    // CASCADE, so one D1 delete removes the full relational conversation tree.
    await env.DB.prepare(
      `DELETE FROM conversations WHERE id IN (${placeholders})`,
    )
      .bind(...ids)
      .run();

    conversations += ids.length;
    mediaObjects += keys.length;
  }

  const staleMediaObjects =
    now.getUTCMinutes() % 10 === 0 ? await purgeStaleMediaUploads(env, now) : 0;
  const visitors = await purgeOrphanVisitors(env.DB, nowIso);
  if (now.getUTCHours() === 0 && now.getUTCMinutes() === 0) {
    await purgeExpiredPushSubscriptions(env.DB, now.getTime());
    await env.DB.prepare(
      `DELETE FROM conversation_creation_limits
       WHERE rowid IN (
         SELECT rowid
         FROM conversation_creation_limits
         WHERE datetime(expires_at) <= datetime(?1)
         ORDER BY expires_at ASC
         LIMIT 1000
       )`,
    )
      .bind(nowIso)
      .run();
    await env.DB.prepare(
      `DELETE FROM conversation_creation_quota_receipts
       WHERE rowid IN (
         SELECT rowid
         FROM conversation_creation_quota_receipts
         WHERE datetime(expires_at) <= datetime(?1)
         ORDER BY expires_at ASC
         LIMIT 1000
       )`,
    )
      .bind(nowIso)
      .run();
  }
  if (
    now.getUTCHours() === REPORTING_HISTORY_CLEANUP_UTC_HOUR &&
    now.getUTCMinutes() === 0
  ) {
    await purgeReportingHistory(env.DB, nowIso);
  }
  return { conversations, mediaObjects, staleMediaObjects, visitors };
}

async function purgeExpiredPushSubscriptions(
  db: D1Database,
  nowMs: number,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM visitor_push_subscriptions
       WHERE endpoint IN (
         SELECT endpoint
         FROM visitor_push_subscriptions
         WHERE expiration_time IS NOT NULL AND expiration_time <= ?1
         ORDER BY expiration_time ASC, endpoint ASC
         LIMIT ?2
       )`,
    )
    .bind(nowMs, PUSH_SUBSCRIPTION_DELETE_BATCH_SIZE)
    .run();
  await db
    .prepare(
      `DELETE FROM agent_push_subscriptions
       WHERE endpoint IN (
         SELECT endpoint
         FROM agent_push_subscriptions
         WHERE expiration_time IS NOT NULL AND expiration_time <= ?1
         ORDER BY expiration_time ASC, endpoint ASC
         LIMIT ?2
       )`,
    )
    .bind(nowMs, PUSH_SUBSCRIPTION_DELETE_BATCH_SIZE)
    .run();
}

async function purgeStaleMediaUploads(
  env: RetentionBindings,
  now: Date,
): Promise<number> {
  const nowIso = now.toISOString();
  const pendingCutoffIso = new Date(now.getTime() - 2 * HOUR_MS).toISOString();
  const failedCutoffIso = new Date(now.getTime() - HOUR_MS).toISOString();

  // First quarantine abandoned uploads. A separate pass deletes them only
  // after a one-hour grace period, so a slow in-flight PUT cannot escape R2
  // cleanup even if it started before the reservation was quarantined.
  await env.DB.prepare(STALE_PENDING_MEDIA_UPDATE_SQL)
    .bind(nowIso, pendingCutoffIso)
    .run();

  const result = await env.DB.prepare(STALE_FAILED_MEDIA_SELECT_SQL)
    .bind(failedCutoffIso, DELETE_BATCH_SIZE)
    .all<StaleMediaRow>();
  const rows = result.results ?? [];
  if (rows.length === 0) return 0;

  const keys = [...new Set(rows.map((row) => row.object_key).filter(Boolean))];
  for (let index = 0; index < keys.length; index += 1000) {
    const chunk = keys.slice(index, index + 1000);
    if (chunk.length > 0) await env.MEDIA.delete(chunk);
  }

  const ids = rows.map((row) => row.id);
  const placeholders = ids.map((_, index) => `?${index + 2}`).join(', ');
  await env.DB.prepare(
    `DELETE FROM media_items
     WHERE status = 'failed'
       AND updated_at <= ?1
       AND id IN (${placeholders})`,
  )
    .bind(failedCutoffIso, ...ids)
    .run();
  return keys.length;
}

async function purgeOrphanVisitors(
  db: D1Database,
  nowIso: string,
): Promise<number> {
  let removed = 0;
  for (let pass = 0; pass < MAX_ORPHAN_VISITOR_DELETE_PASSES; pass += 1) {
    // Push subscriptions are keyed by the public visitor identity rather than a
    // visitor FK, so remove them for the same bounded orphan batch first.
    await db
      .prepare(
        `WITH orphan_batch AS (
           ${ORPHAN_VISITOR_BATCH_SQL}
         )
         DELETE FROM visitor_push_subscriptions
         WHERE EXISTS (
           SELECT 1
           FROM orphan_batch orphan
           WHERE orphan.external_id IS NOT NULL
             AND orphan.site_id = visitor_push_subscriptions.site_id
             AND orphan.external_id = visitor_push_subscriptions.visitor_external_id
         )`,
      )
      .bind(nowIso, DELETE_BATCH_SIZE)
      .run();

    const result = await db
      .prepare(
        `WITH orphan_batch AS (
           ${ORPHAN_VISITOR_BATCH_SQL}
         )
         DELETE FROM visitors
         WHERE id IN (SELECT id FROM orphan_batch)
         RETURNING id`,
      )
      .bind(nowIso, DELETE_BATCH_SIZE)
      .all<DeletedVisitorRow>();
    const count = result.results?.length ?? 0;
    removed += count;
    if (count < DELETE_BATCH_SIZE) break;
  }
  return removed;
}

async function purgeReportingHistory(
  db: D1Database,
  nowIso: string,
): Promise<void> {
  // 12:00 UTC is 04:00/05:00 in Los Angeles, so UTC and reporting-local dates
  // are already aligned. Keep the current reporting day plus the prior 89.
  // Archive only receipts that actually consumed paid quota. The four
  // statements run in one D1 batch so a failed cleanup can never count an old
  // receipt in the archive while also leaving that same receipt to be counted
  // again on the next daily pass.
  await db.batch([
    db
      .prepare(
        `UPDATE agents
         SET traffic_quota_archived_used = traffic_quota_archived_used + (
           SELECT COUNT(*)
           FROM agent_traffic_receipts receipt
           WHERE receipt.site_id = agents.site_id
             AND receipt.agent_id = agents.id
             AND receipt.quota_consumed = 1
             AND receipt.business_date < date(?1, '-89 days')
         ),
             updated_at = CURRENT_TIMESTAMP
         WHERE site_id = 'default'
           AND EXISTS (
             SELECT 1
             FROM agent_traffic_receipts receipt
             WHERE receipt.site_id = agents.site_id
               AND receipt.agent_id = agents.id
               AND receipt.quota_consumed = 1
               AND receipt.business_date < date(?1, '-89 days')
           )`,
      )
      .bind(nowIso),
    db
      .prepare(
        `DELETE FROM agent_daily_stats
         WHERE site_id = 'default'
           AND business_date < date(?1, '-89 days')`,
      )
      .bind(nowIso),
    db
      .prepare(
        `DELETE FROM agent_traffic_receipts
         WHERE site_id = 'default'
           AND business_date < date(?1, '-89 days')`,
      )
      .bind(nowIso),
    db
      .prepare(
        `DELETE FROM conversation_traffic_receipts
         WHERE site_id = 'default'
           AND business_date < date(?1, '-89 days')`,
      )
      .bind(nowIso),
  ]);
}
