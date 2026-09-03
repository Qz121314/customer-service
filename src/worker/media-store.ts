import { broadcastClientConversationEvent } from './client-api';
import { createDownloadSigningContext, presignGet } from './media-signing.ts';
import {
  MIME_EXTENSIONS,
  publicMedia,
  type MediaBindings,
  type MediaRow,
  type MediaSenderType,
  type NormalizedMedia,
} from './media-types';

export async function reserveMedia(
  db: D1Database,
  input: {
    conversationId: string;
    senderType: MediaSenderType;
    senderId: string;
    clientUploadId: string | null;
    media: NormalizedMedia;
  },
): Promise<{ row: MediaRow; reused: boolean }> {
  const id = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const now = new Date().toISOString();
  const objectKey = `chat/${input.conversationId}/${id}.${MIME_EXTENSIONS[input.media.mimeType]}`;
  const senderMediaLimit = input.senderType === 'visitor' ? 10 : 30;
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO media_items (
         id, conversation_id, reserved_message_id, sender_type, sender_id,
         object_key, mime_type, byte_size, width, height, original_name,
         client_upload_id, status, is_initial, reserved_created_at, created_at,
         updated_at
       )
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
         'pending', 0, ?13, ?13, ?13
       WHERE (
         SELECT COUNT(*) < ?14
           AND COALESCE(
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),
             0
           ) < 3
         FROM media_items
         WHERE conversation_id = ?2 AND sender_type = ?4
           AND status IN ('pending', 'ready')
       )`,
    )
    .bind(
      id,
      input.conversationId,
      messageId,
      input.senderType,
      input.senderId,
      objectKey,
      input.media.mimeType,
      input.media.byteSize,
      input.media.width,
      input.media.height,
      input.media.originalName,
      input.clientUploadId,
      now,
      senderMediaLimit,
    )
    .run();
  if (inserted.meta.changes) {
    const row: MediaRow = {
      id,
      conversation_id: input.conversationId,
      message_id: null,
      reserved_message_id: messageId,
      sender_type: input.senderType,
      sender_id: input.senderId,
      object_key: objectKey,
      mime_type: input.media.mimeType,
      byte_size: input.media.byteSize,
      width: input.media.width,
      height: input.media.height,
      original_name: input.media.originalName,
      client_upload_id: input.clientUploadId,
      status: 'pending',
      is_initial: 0,
      reserved_created_at: now,
    };
    return { row, reused: false };
  }

  const existing = input.clientUploadId
    ? await findMediaByClientUploadId(db, {
        ...input,
        clientUploadId: input.clientUploadId,
      })
    : null;
  if (!existing || !sameMedia(existing, input.media)) {
    if (!input.clientUploadId) throw new MediaReservationLimitError();
    const active = await db
      .prepare(
        `SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
         FROM media_items
         WHERE conversation_id = ?1 AND sender_type = ?2
           AND status IN ('pending', 'ready')`,
      )
      .bind(input.conversationId, input.senderType)
      .first<{ total: number; pending: number | null }>();
    if (
      Number(active?.pending ?? 0) >= 3 ||
      Number(active?.total ?? 0) >= senderMediaLimit
    ) {
      throw new MediaReservationLimitError();
    }
    throw new MediaUploadIdConflictError();
  }
  if (existing.status === 'failed') {
    await db
      .prepare(
        `UPDATE media_items
         SET status = 'pending', updated_at = ?1
         WHERE id = ?2 AND status = 'failed'`,
      )
      .bind(now, existing.id)
      .run();
    existing.status = 'pending';
  }
  return { row: existing, reused: true };
}

export class MediaUploadIdConflictError extends Error {
  constructor() {
    super('MEDIA_UPLOAD_ID_CONFLICT');
    this.name = 'MediaUploadIdConflictError';
  }
}

export class MediaReservationLimitError extends Error {
  constructor() {
    super('MEDIA_RESERVATION_LIMIT_REACHED');
    this.name = 'MediaReservationLimitError';
  }
}

export async function findMedia(
  db: D1Database,
  id: string,
): Promise<MediaRow | null> {
  return db
    .prepare(
      `SELECT mi.id, mi.conversation_id, mi.message_id, mi.reserved_message_id, mi.sender_type,
         mi.sender_id, mi.object_key, mi.mime_type, mi.byte_size, mi.width, mi.height, mi.original_name,
         mi.client_upload_id, mi.status, mi.is_initial, mi.reserved_created_at,
         c.expires_at AS conversation_expires_at
       FROM media_items mi
       JOIN conversations c ON c.id = mi.conversation_id
       WHERE mi.id = ?1 LIMIT 1`,
    )
    .bind(id)
    .first<MediaRow>();
}

async function findMediaByClientUploadId(
  db: D1Database,
  input: {
    conversationId: string;
    senderType: MediaSenderType;
    senderId: string;
    clientUploadId: string;
  },
): Promise<MediaRow | null> {
  return db
    .prepare(
      `SELECT mi.id, mi.conversation_id, mi.message_id, mi.reserved_message_id, mi.sender_type,
         mi.sender_id, mi.object_key, mi.mime_type, mi.byte_size, mi.width, mi.height, mi.original_name,
         mi.client_upload_id, mi.status, mi.is_initial, mi.reserved_created_at,
         c.expires_at AS conversation_expires_at
       FROM media_items mi
       JOIN conversations c ON c.id = mi.conversation_id
       WHERE mi.conversation_id = ?1 AND mi.sender_type = ?2 AND mi.sender_id = ?3
         AND mi.client_upload_id = ?4
       LIMIT 1`,
    )
    .bind(
      input.conversationId,
      input.senderType,
      input.senderId,
      input.clientUploadId,
    )
    .first<MediaRow>();
}

function sameMedia(existing: MediaRow, media: NormalizedMedia): boolean {
  return (
    existing.mime_type === media.mimeType &&
    existing.byte_size === media.byteSize &&
    existing.width === media.width &&
    existing.height === media.height &&
    existing.original_name === media.originalName
  );
}

export async function storeProxyUpload(
  bucket: R2Bucket,
  media: MediaRow,
  request: Request,
): Promise<{ ok: true } | { ok: false; status: 400 | 409; code: string }> {
  if (media.status !== 'pending')
    return { ok: false, status: 409, code: 'MEDIA_NOT_PENDING' };
  const contentType = request.headers
    .get('Content-Type')
    ?.split(';')[0]
    ?.trim();
  if (contentType !== media.mime_type)
    return { ok: false, status: 400, code: 'INVALID_MEDIA_TYPE' };
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length && length !== media.byte_size)
    return { ok: false, status: 400, code: 'INVALID_MEDIA_SIZE' };
  if (!request.body) return { ok: false, status: 400, code: 'INVALID_MEDIA' };
  await bucket.put(media.object_key, request.body, {
    httpMetadata: { contentType: media.mime_type },
  });
  return { ok: true };
}

export async function completeMedia(
  env: MediaBindings,
  media: MediaRow,
  context: { conversationStatus?: 'open' | 'pending' | 'closed' } = {},
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 404 | 409; code: string }
> {
  if (media.status === 'ready' && media.message_id) {
    return completedMedia(env, media);
  }
  if (media.status !== 'pending')
    return { ok: false, status: 409, code: 'MEDIA_NOT_PENDING' };

  const object = await env.MEDIA.head(media.object_key);
  if (!object) return { ok: false, status: 404, code: 'MEDIA_UPLOAD_MISSING' };
  const actualType = object.httpMetadata?.contentType?.split(';')[0]?.trim();
  if (object.size !== media.byte_size || actualType !== media.mime_type) {
    await env.MEDIA.delete(media.object_key);
    await env.DB.prepare(
      `UPDATE media_items SET status = 'failed', updated_at = ?1 WHERE id = ?2`,
    )
      .bind(new Date().toISOString(), media.id)
      .run();
    return { ok: false, status: 400, code: 'MEDIA_UPLOAD_INVALID' };
  }

  const messageId = media.reserved_message_id;
  const createdAt = media.reserved_created_at;
  const statements = [
    env.DB.prepare(
      `INSERT OR IGNORE INTO messages (
         id, conversation_id, sender_type, sender_id, body, kind, created_at
       )
       SELECT ?1, ?2, ?3, ?4, '', 'image', ?5
       WHERE EXISTS (
         SELECT 1 FROM media_items WHERE id = ?6 AND status = 'pending'
       )
         AND EXISTS (
           SELECT 1
           FROM conversations
           WHERE id = ?2 AND assigned_agent IS NOT NULL
       )`,
    ).bind(
      messageId,
      media.conversation_id,
      media.sender_type,
      media.sender_id,
      createdAt,
      media.id,
    ),
  ];

  if (media.sender_type === 'agent') {
    statements.push(
      env.DB.prepare(
        `UPDATE conversations
         SET status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
             visitor_unread_count = visitor_unread_count + 1,
             agent_unread_count = 0,
             last_message_at = ?1, last_message_preview = '', updated_at = ?1
         WHERE id = ?2
           AND assigned_agent IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM media_items WHERE id = ?3 AND status = 'pending'
           )`,
      ).bind(createdAt, media.conversation_id, media.id),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `UPDATE conversations
         SET agent_unread_count = agent_unread_count + 1,
             last_message_at = ?1, last_message_preview = '', updated_at = ?1
         WHERE id = ?2
           AND assigned_agent IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM media_items WHERE id = ?3 AND status = 'pending'
           )`,
      ).bind(createdAt, media.conversation_id, media.id),
    );
  }
  statements.push(
    env.DB.prepare(
      `UPDATE media_items
       SET message_id = ?1, status = 'ready', updated_at = ?2
       WHERE id = ?3 AND status = 'pending'
         AND EXISTS (
           SELECT 1 FROM messages WHERE id = ?1
         )`,
    ).bind(messageId, new Date().toISOString(), media.id),
  );
  const results = await env.DB.batch(statements);
  const readyResult = results.at(-1);
  if (!readyResult?.meta.changes) {
    const current = await findMedia(env.DB, media.id);
    if (current?.status === 'ready' && current.message_id) {
      return completedMedia(env, current);
    }
    return { ok: false, status: 409, code: 'MEDIA_NOT_PENDING' };
  }

  const signedUrl = await mediaDownloadUrl(env, media);
  await Promise.allSettled([
    broadcastRoom(env, media.conversation_id, {
      type: 'message',
      message: {
        id: messageId,
        conversation_id: media.conversation_id,
        sender_type: media.sender_type,
        sender_id: media.sender_id,
        body: '',
        kind: 'image',
        created_at: createdAt,
      },
      media: {
        messageId,
        ...publicMedia(
          { ...media, message_id: messageId, status: 'ready' },
          signedUrl,
        ),
      },
    }),
    broadcastClientConversationEvent(
      env,
      media.conversation_id,
      'message.created',
      {
        message: {
          id: messageId,
          direction: media.sender_type === 'agent' ? 'agent' : 'customer',
          body: '',
          sentAt: createdAt,
          delivery: 'sent',
          attachments: [],
        },
        media: {
          messageId,
          ...publicMedia(
            { ...media, message_id: messageId, status: 'ready' },
            signedUrl,
          ),
        },
      },
      {
        includeOverview:
          media.sender_type === 'agent' &&
          context.conversationStatus === 'open',
      },
    ),
  ]);

  return {
    ok: true,
    value: {
      ok: true,
      conversationId: media.conversation_id,
      messageId,
      createdAt,
      duplicate: false,
      media: publicMedia(
        { ...media, message_id: messageId, status: 'ready' },
        signedUrl,
      ),
    },
  };
}

async function completedMedia(
  env: MediaBindings,
  media: MediaRow,
): Promise<{
  ok: true;
  value: Record<string, unknown>;
}> {
  const signedUrl = await mediaDownloadUrl(env, media);
  return {
    ok: true,
    value: {
      ok: true,
      conversationId: media.conversation_id,
      messageId: media.message_id,
      createdAt: media.reserved_created_at,
      duplicate: true,
      media: publicMedia(media, signedUrl),
    },
  };
}

export async function mediaDownloadUrl(
  env: MediaBindings,
  media: MediaRow,
): Promise<string | null> {
  const context = await createDownloadSigningContext(
    env,
    media.conversation_expires_at ?? null,
  );
  return context ? presignGet(context, media.object_key) : null;
}

export async function readMediaObject(bucket: R2Bucket, media: MediaRow) {
  if (media.status !== 'ready')
    return new Response('Not found', { status: 404 });
  const object = await bucket.get(media.object_key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  headers.set('Content-Type', media.mime_type);
  headers.set('Content-Length', String(object.size));
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}

async function broadcastRoom(
  env: Pick<MediaBindings, 'CONVERSATION_ROOMS'>,
  id: string,
  payload: unknown,
) {
  const room = env.CONVERSATION_ROOMS.get(
    env.CONVERSATION_ROOMS.idFromName(id),
  );
  await room.fetch('https://conversation-room/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
