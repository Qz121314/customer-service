import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { requireAgentSession } from './agent-session';
import { createUploadTarget } from './media-signing';
import {
  completeMedia,
  MediaReservationLimitError,
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
import {
  listConversationAttachments,
  type ConversationAttachmentPage,
} from './message-attachments';
import { passesBurstLimit, requestSourceHash } from './abuse-control';
import {
  normalizeVisitorId,
  normalizeVisitorToken,
  resolveVisitor,
} from './client-api';

type Env = { Bindings: MediaBindings };

type AuthorizedAgentMediaRow = MediaRow & {
  conversation_status: 'open' | 'pending' | 'closed';
};

export const mediaApi = new Hono<Env>();

mediaApi.use(
  '/client/v1/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'X-CS-Visitor-Token'],
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    maxAge: 86400,
  }),
);

mediaApi.post('/client/v1/conversations/:id/media/init', async (c) => {
  const body = await readJson<{
    visitorId?: string;
    visitorToken?: string;
    projectId?: string;
    mimeType?: string;
    byteSize?: number;
    width?: number | null;
    height?: number | null;
    originalName?: string | null;
    clientUploadId?: string;
  }>(c.req.raw);
  const visitorId = normalizeVisitorId(body?.visitorId);
  const visitorToken = normalizeVisitorToken(
    body?.visitorToken ?? c.req.header('X-CS-Visitor-Token'),
  );
  if (!visitorId && !visitorToken)
    return clientError(c, 400, 'INVALID_VISITOR_ID');
  const media = normalizeMediaInput(body);
  if (!media) return clientError(c, 400, 'INVALID_MEDIA');
  const clientUploadId = normalizeText(body?.clientUploadId, 160);
  if (body?.clientUploadId !== undefined && !clientUploadId) {
    return clientError(c, 400, 'INVALID_MEDIA_UPLOAD_ID');
  }
  const projectId = normalizeProjectId(body?.projectId);
  const site = await findSite(c.env.DB, projectId);
  if (!site) return clientError(c, 404, 'PROJECT_NOT_FOUND');
  const visitor = await resolveVisitor(c.env.DB, site.id, {
    externalId: visitorId,
    accessToken: visitorToken,
  });
  if (!visitor) return clientError(c, 401, 'INVALID_VISITOR_TOKEN');
  const sourceHash = await requestSourceHash(c.req.raw, visitor.external_id);
  if (
    !(await passesBurstLimit(
      c.env.MEDIA_BURST_LIMITER,
      `visitor-media:${sourceHash}:${c.req.param('id')}`,
    ))
  ) {
    c.header('Retry-After', '60');
    return clientError(c, 429, 'MEDIA_RATE_LIMITED');
  }
  const conversation = await ownedVisitorConversation(
    c.env.DB,
    c.req.param('id'),
    projectId,
    visitor.external_id,
  );
  if (!conversation) {
    return clientError(c, 404, 'CONVERSATION_NOT_FOUND');
  }
  if (conversation.status === 'closed')
    return clientError(c, 409, 'CONVERSATION_CLOSED');
  const reservation = await reserve(c, {
    conversationId: conversation.id,
    senderType: 'visitor',
    senderId: conversation.visitor_id,
    clientUploadId,
    media,
  });
  if (!reservation.ok && reservation.code === 'MEDIA_UPLOAD_ID_CONFLICT') {
    return clientError(c, 409, 'MEDIA_UPLOAD_ID_CONFLICT');
  }
  if (!reservation.ok)
    return clientError(c, 429, 'MEDIA_RESERVATION_LIMIT_REACHED');
  const { row, reused } = reservation.value;
  const proxy = new URL(`/client/v1/media/${row.id}/content`, c.req.url);
  proxy.searchParams.set('visitorId', visitor.external_id);
  if (visitorToken) proxy.searchParams.set('visitorToken', visitorToken);
  proxy.searchParams.set('projectId', projectId);
  return c.json(
    await mediaReservationResponse(c.env, row, proxy.toString()),
    reused ? 200 : 201,
  );
});

mediaApi.get('/client/v1/conversations/:id/media', async (c) => {
  const visitorId = normalizeVisitorId(c.req.query('visitorId'));
  const visitorToken = normalizeVisitorToken(
    c.req.query('visitorToken') ?? c.req.header('X-CS-Visitor-Token'),
  );
  if (!visitorId && !visitorToken)
    return clientError(c, 400, 'INVALID_VISITOR_ID');
  const projectId = normalizeProjectId(c.req.query('projectId'));
  const site = await findSite(c.env.DB, projectId);
  if (!site) return clientError(c, 404, 'PROJECT_NOT_FOUND');
  const visitor = await resolveVisitor(c.env.DB, site.id, {
    externalId: visitorId,
    accessToken: visitorToken,
  });
  if (!visitor) return clientError(c, 401, 'INVALID_VISITOR_TOKEN');
  const conversation = await ownedVisitorConversation(
    c.env.DB,
    c.req.param('id'),
    projectId,
    visitor.external_id,
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
  const body = await readJson<{
    visitorId?: string;
    visitorToken?: string;
    projectId?: string;
  }>(c.req.raw);
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
  if (
    !(await passesBurstLimit(
      c.env.MEDIA_BURST_LIMITER,
      `agent-media:${agent.id}:${c.req.param('id')}`,
    ))
  ) {
    c.header('Retry-After', '60');
    return c.json({ error: 'MEDIA_RATE_LIMITED' }, 429);
  }
  const conversation = await assignedConversation(
    c.env.DB,
    c.req.param('id'),
    agent.id,
  );
  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
  if (conversation.status === 'closed')
    return c.json({ error: 'CONVERSATION_CLOSED' }, 409);
  const reservation = await reserve(c, {
    conversationId: conversation.id,
    senderType: 'agent',
    senderId: agent.id,
    clientUploadId,
    media,
  });
  if (!reservation.ok && reservation.code === 'MEDIA_UPLOAD_ID_CONFLICT') {
    return c.json({ error: 'MEDIA_UPLOAD_ID_CONFLICT' }, 409);
  }
  if (!reservation.ok)
    return c.json({ error: 'MEDIA_RESERVATION_LIMIT_REACHED' }, 429);
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
  const result = await completeMedia(c.env, media.value, {
    conversationStatus: media.value.conversation_status,
  });
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
  page?: ConversationAttachmentPage,
) {
  return listConversationAttachments(db, conversationId, page);
}

async function authorizedVisitorMedia(
  c: Context<Env>,
  readyOnly: boolean,
  body?: {
    visitorId?: string;
    visitorToken?: string;
    projectId?: string;
  },
): Promise<
  | { ok: true; value: MediaRow }
  | { ok: false; status: 400 | 401 | 404; code: string }
> {
  const visitorId = normalizeVisitorId(
    body?.visitorId ?? c.req.query('visitorId'),
  );
  const visitorToken = normalizeVisitorToken(
    body?.visitorToken ??
      c.req.query('visitorToken') ??
      c.req.header('X-CS-Visitor-Token'),
  );
  if (!visitorId && !visitorToken)
    return { ok: false, status: 400, code: 'INVALID_VISITOR_ID' };
  const projectId = normalizeProjectId(
    body?.projectId ?? c.req.query('projectId'),
  );
  const site = await findSite(c.env.DB, projectId);
  if (!site) return { ok: false, status: 404, code: 'PROJECT_NOT_FOUND' };
  const visitor = await resolveVisitor(c.env.DB, site.id, {
    externalId: visitorId,
    accessToken: visitorToken,
  });
  if (!visitor)
    return { ok: false, status: 401, code: 'INVALID_VISITOR_TOKEN' };
  const media = await c.env.DB.prepare(
    `SELECT mi.id, mi.conversation_id, mi.message_id, mi.reserved_message_id,
         mi.sender_type, mi.sender_id, mi.object_key, mi.mime_type, mi.byte_size,
         mi.width, mi.height, mi.original_name, mi.client_upload_id,
         mi.status, mi.is_initial, mi.reserved_created_at
       FROM media_items mi
       JOIN conversations c ON c.id = mi.conversation_id
       JOIN visitors v ON v.id = c.visitor_id
       JOIN sites s ON s.id = c.site_id
       WHERE mi.id = ?1
         AND (s.id = ?2 OR s.public_key = ?2) AND s.is_enabled = 1
         AND v.external_id = ?3
         AND c.assigned_agent IS NOT NULL
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
       LIMIT 1`,
  )
    .bind(c.req.param('id'), projectId, visitor.external_id)
    .first<MediaRow>();
  if (!media) {
    return { ok: false, status: 404, code: 'MEDIA_NOT_FOUND' };
  }
  if (readyOnly && media.status !== 'ready')
    return { ok: false, status: 404, code: 'MEDIA_NOT_FOUND' };
  return { ok: true, value: media };
}

async function authorizedAgentMedia(
  c: Context<Env>,
  readyOnly: boolean,
): Promise<
  | { ok: true; value: AuthorizedAgentMediaRow }
  | { ok: false; status: 401 | 404; code: string }
> {
  const agent = await requireAgentSession(c);
  if (!agent) return { ok: false, status: 401, code: 'UNAUTHORIZED' };
  const media = await c.env.DB.prepare(
    `SELECT mi.id, mi.conversation_id, mi.message_id, mi.reserved_message_id,
         mi.sender_type, mi.sender_id, mi.object_key, mi.mime_type, mi.byte_size,
         mi.width, mi.height, mi.original_name, mi.client_upload_id,
         mi.status, mi.is_initial, mi.reserved_created_at,
         c.status AS conversation_status
       FROM media_items mi
       JOIN conversations c ON c.id = mi.conversation_id
       WHERE mi.id = ?1 AND c.assigned_agent = ?2
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
       LIMIT 1`,
  )
    .bind(c.req.param('id'), agent.id)
    .first<AuthorizedAgentMediaRow>();
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
  projectId: string,
  visitorId: string,
) {
  return db
    .prepare(
      `SELECT c.id, c.visitor_id, c.status
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       JOIN sites s ON s.id = c.site_id
       WHERE c.id = ?1
         AND (s.id = ?2 OR s.public_key = ?2) AND s.is_enabled = 1
         AND v.external_id = ?3
         AND c.assigned_agent IS NOT NULL
         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
       LIMIT 1`,
    )
    .bind(id, projectId, visitorId)
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

function normalizeProjectId(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : 'default';
}

function clientError(
  c: Context<Env>,
  status: 400 | 401 | 404 | 409 | 429,
  code: string,
) {
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
  | { ok: true; value: Awaited<ReturnType<typeof reserveMedia>> }
  | {
      ok: false;
      code: 'MEDIA_UPLOAD_ID_CONFLICT' | 'MEDIA_RESERVATION_LIMIT_REACHED';
    }
> {
  try {
    return { ok: true, value: await reserveMedia(c.env.DB, input) };
  } catch (error) {
    if (error instanceof MediaUploadIdConflictError) {
      return { ok: false, code: 'MEDIA_UPLOAD_ID_CONFLICT' };
    }
    if (error instanceof MediaReservationLimitError) {
      return { ok: false, code: 'MEDIA_RESERVATION_LIMIT_REACHED' };
    }
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
