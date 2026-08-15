import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { requireAgentSession } from './agent-session';
import { createUploadTarget } from './media-signing';
import {
  completeMedia,
  MediaUploadIdConflictError,
  readMediaObject,
  reserveMedia,
  storeProxyUpload,
} from './media-store';
import {
  normalizeMediaInput,
  normalizeText,
  publicMedia,
  type MediaBindings,
  type MediaRow,
} from './media-types';

type Env = { Bindings: MediaBindings };

type ReadyMediaRow = MediaRow & { message_id: string };

export const mediaApi = new Hono<Env>();

mediaApi.use(
  '/client/v1/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    maxAge: 86400,
  }),
);

mediaApi.post('/client/v1/conversations/:id/media/init', async (c) => {
  const body = await readJson<{
    visitorId?: string;
    projectId?: string;
    mimeType?: string;
    byteSize?: number;
    width?: number | null;
    height?: number | null;
    originalName?: string | null;
    clientUploadId?: string;
  }>(c.req.raw);
  const visitorId = normalizeVisitorId(body?.visitorId);
  if (!visitorId) return clientError(c, 400, 'INVALID_VISITOR_ID');
  const site = await findSite(c.env.DB, normalizeProjectId(body?.projectId));
  if (!site) return clientError(c, 404, 'PROJECT_NOT_FOUND');
  const conversation = await ownedVisitorConversation(
    c.env.DB,
    c.req.param('id'),
    site.id,
    visitorId,
  );
  if (!conversation) return clientError(c, 404, 'CONVERSATION_NOT_FOUND');
  if (conversation.status === 'closed')
    return clientError(c, 409, 'CONVERSATION_CLOSED');
  const media = normalizeMediaInput(body);
  if (!media) return clientError(c, 400, 'INVALID_MEDIA');
  const clientUploadId = normalizeText(body?.clientUploadId, 160);
  if (body?.clientUploadId !== undefined && !clientUploadId) {
    return clientError(c, 400, 'INVALID_MEDIA_UPLOAD_ID');
  }

  const reservation = await reserve(c, {
    conversationId: conversation.id,
    senderType: 'visitor',
    senderId: conversation.visitor_id,
    clientUploadId,
    media,
  });
  if (!reservation.ok) {
    return clientError(c, 409, 'MEDIA_UPLOAD_ID_CONFLICT');
  }
  const { row, reused } = reservation.value;
  const proxy = new URL(`/client/v1/media/${row.id}/content`, c.req.url);
  proxy.searchParams.set('visitorId', visitorId);
  proxy.searchParams.set('projectId', normalizeProjectId(body?.projectId));
  return c.json(
    await mediaReservationResponse(c.env, row, proxy.toString()),
    reused ? 200 : 201,
  );
});

mediaApi.get('/client/v1/conversations/:id/media', async (c) => {
  const visitorId = normalizeVisitorId(c.req.query('visitorId'));
  if (!visitorId) return clientError(c, 400, 'INVALID_VISITOR_ID');
  const site = await findSite(
    c.env.DB,
    normalizeProjectId(c.req.query('projectId')),
  );
  if (!site) return clientError(c, 404, 'PROJECT_NOT_FOUND');
  const conversation = await ownedVisitorConversation(
    c.env.DB,
    c.req.param('id'),
    site.id,
    visitorId,
  );
  if (!conversation) return clientError(c, 404, 'CONVERSATION_NOT_FOUND');
  return c.json({
    items: await listConversationMedia(c.env.DB, conversation.id),
  });
});

mediaApi.put('/client/v1/media/:id/content', async (c) => {
  const media = await authorizedVisitorMedia(c, false);
  if (!media.ok) return clientError(c, media.status, media.code);
  const result = await storeProxyUpload(c.env.MEDIA, media.value, c.req.raw);
  if (!result.ok) return clientError(c, result.status, result.code);
  return c.json({ ok: true });
});

mediaApi.post('/client/v1/media/:id/complete', async (c) => {
  const body = await readJson<{ visitorId?: string; projectId?: string }>(
    c.req.raw,
  );
  const media = await authorizedVisitorMedia(c, false, body ?? undefined);
  if (!media.ok) return clientError(c, media.status, media.code);
  const result = await completeMedia(c.env, media.value);
  if (!result.ok) return clientError(c, result.status, result.code);
  return c.json(result.value);
});

mediaApi.get('/client/v1/media/:id/content', async (c) => {
  const media = await authorizedVisitorMedia(c, true);
  if (!media.ok) return clientError(c, media.status, media.code);
  return readMediaObject(c.env.MEDIA, media.value);
});

mediaApi.post('/api/agent/conversations/:id/media/init', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const conversation = await assignedConversation(
    c.env.DB,
    c.req.param('id'),
    agent.id,
  );
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  if (conversation.status === 'closed')
    return c.json({ error: 'CONVERSATION_CLOSED' }, 409);
  const body = await readJson<{
    mimeType?: string;
    byteSize?: number;
    width?: number | null;
    height?: number | null;
    originalName?: string | null;
    clientUploadId?: string;
  }>(c.req.raw);
  const media = normalizeMediaInput(body);
  if (!media) return c.json({ error: 'INVALID_MEDIA' }, 400);
  const clientUploadId = normalizeText(body?.clientUploadId, 160);
  if (body?.clientUploadId !== undefined && !clientUploadId) {
    return c.json({ error: 'INVALID_MEDIA_UPLOAD_ID' }, 400);
  }
  const reservation = await reserve(c, {
    conversationId: conversation.id,
    senderType: 'agent',
    senderId: agent.id,
    clientUploadId,
    media,
  });
  if (!reservation.ok) {
    return c.json({ error: 'MEDIA_UPLOAD_ID_CONFLICT' }, 409);
  }
  const { row, reused } = reservation.value;
  const proxy = new URL(
    `/api/agent/media/${row.id}/content`,
    c.req.url,
  ).toString();
  return c.json(
    await mediaReservationResponse(c.env, row, proxy),
    reused ? 200 : 201,
  );
});

mediaApi.get('/api/agent/conversations/:id/media', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const conversation = await assignedConversation(
    c.env.DB,
    c.req.param('id'),
    agent.id,
  );
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json({
    items: await listConversationMedia(c.env.DB, conversation.id),
  });
});

mediaApi.put('/api/agent/media/:id/content', async (c) => {
  const media = await authorizedAgentMedia(c, false);
  if (!media.ok) return c.json({ error: media.code }, media.status);
  const result = await storeProxyUpload(c.env.MEDIA, media.value, c.req.raw);
  if (!result.ok) return c.json({ error: result.code }, result.status);
  return c.json({ ok: true });
});

mediaApi.post('/api/agent/media/:id/complete', async (c) => {
  const media = await authorizedAgentMedia(c, false);
  if (!media.ok) return c.json({ error: media.code }, media.status);
  const result = await completeMedia(c.env, media.value);
  if (!result.ok) return c.json({ error: result.code }, result.status);
  return c.json(result.value);
});

mediaApi.get('/api/agent/media/:id/content', async (c) => {
  const media = await authorizedAgentMedia(c, true);
  if (!media.ok) return c.json({ error: media.code }, media.status);
  return readMediaObject(c.env.MEDIA, media.value);
});

export async function listConversationMedia(
  db: D1Database,
  conversationId: string,
  after?: { id: string; createdAt: string } | null,
) {
  const result = await db
    .prepare(
      `SELECT mi.id, mi.conversation_id, mi.message_id,
         mi.reserved_message_id, mi.sender_type, mi.sender_id, mi.object_key,
         mi.mime_type, mi.byte_size, mi.width, mi.height, mi.original_name,
         mi.client_upload_id, mi.status, mi.is_initial, mi.reserved_created_at
       FROM media_items mi
       JOIN messages m ON m.id = mi.message_id
       WHERE mi.conversation_id = ?1 AND mi.status = 'ready'
         AND mi.message_id IS NOT NULL
         AND (
           ?2 IS NULL
           OR julianday(m.created_at) > julianday(?2)
           OR (julianday(m.created_at) = julianday(?2) AND m.id > ?3)
         )
       ORDER BY julianday(m.created_at) ASC, m.id ASC`,
    )
    .bind(conversationId, after?.createdAt ?? null, after?.id ?? null)
    .all<ReadyMediaRow>();
  return (result.results ?? []).map((row) => ({
    messageId: row.message_id,
    ...publicMedia(row),
  }));
}

async function authorizedVisitorMedia(
  c: Context<Env>,
  readyOnly: boolean,
  body?: { visitorId?: string; projectId?: string },
): Promise<
  { ok: true; value: MediaRow } | { ok: false; status: 400 | 404; code: string }
> {
  const visitorId = normalizeVisitorId(
    body?.visitorId ?? c.req.query('visitorId'),
  );
  if (!visitorId) return { ok: false, status: 400, code: 'INVALID_VISITOR_ID' };
  const site = await findSite(
    c.env.DB,
    normalizeProjectId(body?.projectId ?? c.req.query('projectId')),
  );
  if (!site) return { ok: false, status: 404, code: 'PROJECT_NOT_FOUND' };
  const media = await c.env.DB.prepare(
    `SELECT mi.id, mi.conversation_id, mi.message_id, mi.reserved_message_id,
         mi.sender_type, mi.sender_id, mi.object_key, mi.mime_type, mi.byte_size,
         mi.width, mi.height, mi.original_name, mi.client_upload_id,
         mi.status, mi.is_initial,
         mi.reserved_created_at
       FROM media_items mi
       JOIN conversations c ON c.id = mi.conversation_id
       JOIN visitors v ON v.id = c.visitor_id
       WHERE mi.id = ?1 AND c.site_id = ?2 AND v.external_id = ?3
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
       LIMIT 1`,
  )
    .bind(c.req.param('id'), site.id, visitorId)
    .first<MediaRow>();
  if (!media || (readyOnly && media.status !== 'ready'))
    return { ok: false, status: 404, code: 'MEDIA_NOT_FOUND' };
  return { ok: true, value: media };
}

async function authorizedAgentMedia(
  c: Context<Env>,
  readyOnly: boolean,
): Promise<
  { ok: true; value: MediaRow } | { ok: false; status: 401 | 404; code: string }
> {
  const agent = await requireAgentSession(c);
  if (!agent) return { ok: false, status: 401, code: 'UNAUTHORIZED' };
  const media = await c.env.DB.prepare(
    `SELECT mi.id, mi.conversation_id, mi.message_id, mi.reserved_message_id,
         mi.sender_type, mi.sender_id, mi.object_key, mi.mime_type, mi.byte_size,
         mi.width, mi.height, mi.original_name, mi.client_upload_id,
         mi.status, mi.is_initial,
         mi.reserved_created_at
       FROM media_items mi
       JOIN conversations c ON c.id = mi.conversation_id
       WHERE mi.id = ?1 AND c.assigned_agent = ?2
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
       LIMIT 1`,
  )
    .bind(c.req.param('id'), agent.id)
    .first<MediaRow>();
  if (!media || (readyOnly && media.status !== 'ready'))
    return { ok: false, status: 404, code: 'NOT_FOUND' };
  return { ok: true, value: media };
}

async function findSite(db: D1Database, projectId: string) {
  return db
    .prepare(
      `SELECT id FROM sites
       WHERE (id = ?1 OR public_key = ?1) AND is_enabled = 1 LIMIT 1`,
    )
    .bind(projectId)
    .first<{ id: string }>();
}

async function ownedVisitorConversation(
  db: D1Database,
  id: string,
  siteId: string,
  visitorId: string,
) {
  return db
    .prepare(
      `SELECT c.id, c.visitor_id, c.status
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.id = ?1 AND c.site_id = ?2 AND v.external_id = ?3
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
    .bind(id, siteId, visitorId)
    .first<{
      id: string;
      visitor_id: string;
      status: 'open' | 'pending' | 'closed';
    }>();
}

async function assignedConversation(
  db: D1Database,
  id: string,
  agentId: string,
) {
  return db
    .prepare(
      `SELECT id, status FROM conversations
       WHERE id = ?1 AND assigned_agent = ?2
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP`,
    )
    .bind(id, agentId)
    .first<{ id: string; status: 'open' | 'pending' | 'closed' }>();
}

function normalizeVisitorId(value?: string | null): string | null {
  const visitorId = value?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9]{6}$/u.test(visitorId)) return null;
  const letters = [...visitorId].filter((char) => /[A-Z]/u.test(char)).length;
  const digits = [...visitorId].filter((char) => /[0-9]/u.test(char)).length;
  return letters === 3 && digits === 3 ? visitorId : null;
}

function normalizeProjectId(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : 'default';
}

function clientError(c: Context<Env>, status: 400 | 404 | 409, code: string) {
  return c.json({ error: { code, message: code } }, status);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

type ReservationInput = Parameters<typeof reserveMedia>[1];

async function reserve(
  c: Context<Env>,
  input: ReservationInput,
): Promise<
  { ok: true; value: Awaited<ReturnType<typeof reserveMedia>> } | { ok: false }
> {
  try {
    return { ok: true, value: await reserveMedia(c.env.DB, input) };
  } catch (error) {
    if (error instanceof MediaUploadIdConflictError) return { ok: false };
    throw error;
  }
}

async function mediaReservationResponse(
  env: MediaBindings,
  row: MediaRow,
  proxyUrl: string,
) {
  if (row.status === 'ready' && row.message_id) {
    return {
      conversationId: row.conversation_id,
      media: publicMedia(row),
      completed: {
        messageId: row.message_id,
        createdAt: row.reserved_created_at,
      },
    };
  }
  return {
    conversationId: row.conversation_id,
    media: publicMedia(row),
    upload: await createUploadTarget(
      env,
      proxyUrl,
      row.object_key,
      row.mime_type,
    ),
  };
}
