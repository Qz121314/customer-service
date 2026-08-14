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

type OrphanVisitorRow = {
  id: string;
  site_id: string;
  external_id: string | null;
};

const DELETE_BATCH_SIZE = 100;
const MAX_DELETE_PASSES = 10;

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
): Promise<{ conversations: number; mediaObjects: number; visitors: number }> {
  const nowIso = now.toISOString();
  let conversations = 0;
  let mediaObjects = 0;

  for (let pass = 0; pass < MAX_DELETE_PASSES; pass += 1) {
    const expired = await env.DB.prepare(
      `SELECT id
       FROM conversations
       WHERE datetime(COALESCE(expires_at, datetime(created_at, '+1 day'))) <= datetime(?1)
       ORDER BY COALESCE(expires_at, datetime(created_at, '+1 day')) ASC, id ASC
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

    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM media_items WHERE conversation_id IN (${placeholders})`,
      ).bind(...ids),
      env.DB.prepare(
        `DELETE FROM messages WHERE conversation_id IN (${placeholders})`,
      ).bind(...ids),
      env.DB.prepare(
        `DELETE FROM conversations WHERE id IN (${placeholders})`,
      ).bind(...ids),
    ]);

    conversations += ids.length;
    mediaObjects += keys.length;
  }

  const visitors = await purgeOrphanVisitors(env.DB, nowIso);
  return { conversations, mediaObjects, visitors };
}

async function purgeOrphanVisitors(
  db: D1Database,
  nowIso: string,
): Promise<number> {
  let removed = 0;
  for (let pass = 0; pass < MAX_DELETE_PASSES; pass += 1) {
    const result = await db
      .prepare(
        `SELECT v.id, v.site_id, v.external_id
         FROM visitors v
         WHERE datetime(COALESCE(v.expires_at, v.created_at)) <= datetime(?1)
           AND NOT EXISTS (SELECT 1 FROM conversations c WHERE c.visitor_id = v.id)
         ORDER BY COALESCE(v.expires_at, v.created_at) ASC, v.id ASC
         LIMIT ?2`,
      )
      .bind(nowIso, DELETE_BATCH_SIZE)
      .all<OrphanVisitorRow>();
    const rows = result.results ?? [];
    if (rows.length === 0) break;

    const statements: D1PreparedStatement[] = [];
    for (const visitor of rows) {
      if (visitor.external_id) {
        statements.push(
          db
            .prepare(
              'DELETE FROM visitor_push_subscriptions WHERE site_id = ?1 AND visitor_external_id = ?2',
            )
            .bind(visitor.site_id, visitor.external_id),
        );
      }
      statements.push(
        db.prepare('DELETE FROM visitors WHERE id = ?1').bind(visitor.id),
      );
    }
    if (statements.length > 0) await db.batch(statements);
    removed += rows.length;
  }
  return removed;
}
