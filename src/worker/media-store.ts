import { broadcastClientConversationEvent } from './client-api';
import { assignConversationAgent } from './routing';
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
    media: NormalizedMedia;
  },
): Promise<MediaRow> {
  const id = crypto.randomUUID();
  const messageId = crypto.randomUUID();
  const now = new Date().toISOString();
  const objectKey = `chat/${input.conversationId}/${id}.${MIME_EXTENSIONS[input.media.mimeType]}`;
  await db
    .prepare(
      `INSERT INTO media_items (
         id, conversation_id, reserved_message_id, sender_type, sender_id,
         object_key, mime_type, byte_size, width, height, original_name,
         status, is_initial, reserved_created_at, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
         'pending', 0, ?12, ?12, ?12)`,
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
      now,
    )
    .run();
  const row = await findMedia(db, id);
  if (!row) throw new Error('Media reservation failed');
  return row;
}

export async function findMedia(
  db: D1Database,
  id: string,
): Promise<MediaRow | null> {
  return db
    .prepare(
      `SELECT id, conversation_id, message_id, reserved_message_id, sender_type,
         sender_id, object_key, mime_type, byte_size, width, height, original_name,
         status, is_initial, reserved_created_at
       FROM media_items WHERE id = ?1 LIMIT 1`,
    )
    .bind(id)
    .first<MediaRow>();
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
): Promise<
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; status: 400 | 404 | 409; code: string }
> {
  if (media.status === 'ready' && media.message_id) {
    return {
      ok: true,
      value: {
        ok: true,
        conversationId: media.conversation_id,
        messageId: media.message_id,
        media: publicMedia(media),
      },
    };
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
      `INSERT INTO messages (
         id, conversation_id, sender_type, sender_id, body, kind, created_at
       ) VALUES (?1, ?2, ?3, ?4, '', 'image', ?5)`,
    ).bind(
      messageId,
      media.conversation_id,
      media.sender_type,
      media.sender_id,
      createdAt,
    ),
    env.DB.prepare(
      `UPDATE media_items
       SET message_id = ?1, status = 'ready', updated_at = ?2
       WHERE id = ?3 AND status = 'pending'`,
    ).bind(messageId, new Date().toISOString(), media.id),
  ];

  if (media.sender_type === 'agent') {
    statements.push(
      env.DB.prepare(
        `UPDATE conversations
         SET status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
             visitor_unread_count = visitor_unread_count + 1,
             last_message_at = ?1, updated_at = ?1
         WHERE id = ?2`,
      ).bind(createdAt, media.conversation_id),
    );
  } else {
    statements.push(
      env.DB.prepare(
        `UPDATE conversations SET last_message_at = ?1, updated_at = ?1 WHERE id = ?2`,
      ).bind(createdAt, media.conversation_id),
    );
  }
  await env.DB.batch(statements);

  await Promise.all([
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
    }),
    broadcastClientConversationEvent(
      env,
      media.conversation_id,
      'message.created',
    ),
    broadcastRoom(env, 'admin-inbox', {
      type: 'conversation.changed',
      conversationId: media.conversation_id,
    }),
  ]);

  if (media.sender_type === 'visitor') {
    const conversation = await env.DB.prepare(
      'SELECT assigned_agent FROM conversations WHERE id = ?1',
    )
      .bind(media.conversation_id)
      .first<{ assigned_agent: string | null }>();
    if (!conversation?.assigned_agent) {
      const assignment = await assignConversationAgent(
        env.DB,
        media.conversation_id,
      );
      if (assignment) {
        await Promise.all([
          broadcastClientConversationEvent(
            env,
            media.conversation_id,
            'conversation.assigned',
          ),
          broadcastRoom(env, 'admin-inbox', {
            type: 'conversation.changed',
            conversationId: media.conversation_id,
          }),
        ]);
      }
    }
  }

  return {
    ok: true,
    value: {
      ok: true,
      conversationId: media.conversation_id,
      messageId,
      media: publicMedia({ ...media, message_id: messageId, status: 'ready' }),
    },
  };
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
