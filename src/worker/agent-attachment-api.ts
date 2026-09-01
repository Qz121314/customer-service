import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { requireAgentSession } from './agent-session';
import {
  broadcastClientConversationEvent,
  normalizeVisitorId,
  normalizeVisitorToken,
  resolveVisitor,
} from './client-api';
import {
  MIME_EXTENSIONS,
  normalizeMediaInput,
  type MediaBindings,
} from './media-types';
import {
  listAgentAttachmentPresets,
  listConversationAttachments,
  loadMessageAttachments,
  normalizeAttachmentLabel,
  normalizeLinkValue,
  normalizePhoneValue,
  publicMessageAttachment,
  publicPreset,
  readAttachmentObject,
  type AttachmentKind,
  type AttachmentPresetRow,
  type MessageAttachmentRow,
} from './message-attachments';

type Bindings = MediaBindings;
type Env = { Bindings: Bindings };
type ConversationStatus = 'open' | 'pending' | 'closed';

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: 'agent';
  sender_id: string;
  body: string;
  client_message_id: string | null;
  read_by_visitor_at: string | null;
  read_by_agent_at: string | null;
  created_at: string;
};

type RequestedPresetRow = {
  request_order: number;
  conversation_status: ConversationStatus;
  id: string | null;
  agent_id: string | null;
  kind: AttachmentKind | null;
  label: string | null;
  value: string | null;
  object_key: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  original_name: string | null;
  sort_order: number | null;
  created_at: string | null;
  updated_at: string | null;
};

const MESSAGE_LIMIT = 8000;
const MAX_ATTACHMENTS_PER_MESSAGE = 6;

export const agentAttachmentApi = new Hono<Env>();

agentAttachmentApi.use(
  '/client/v1/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'X-CS-Visitor-Token'],
    allowMethods: ['GET', 'OPTIONS'],
    maxAge: 86400,
  }),
);

agentAttachmentApi.get('/api/agent/attachments/presets', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const presets = await listAgentAttachmentPresets(c.env.DB, agent.id);
  return c.json({ presets: presets.map(publicPreset) });
});

agentAttachmentApi.post('/api/agent/attachments/presets', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const body = await readJson<{
    kind?: 'phone' | 'link';
    label?: string;
    value?: string;
  }>(c.req.raw);
  const label = normalizeAttachmentLabel(body?.label);
  const kind = body?.kind;
  const value =
    kind === 'phone'
      ? normalizePhoneValue(body?.value)
      : kind === 'link'
        ? normalizeLinkValue(body?.value)
        : null;
  if (!label || !value || (kind !== 'phone' && kind !== 'link')) {
    return c.json({ error: 'INVALID_ATTACHMENT_PRESET' }, 400);
  }

  const id = crypto.randomUUID();
  const row = await c.env.DB.prepare(
    `INSERT INTO agent_attachment_presets (
       id, agent_id, kind, label, value, sort_order
     ) VALUES (?1, ?2, ?3, ?4, ?5, 0)
     RETURNING id, agent_id, kind, label, value, object_key, mime_type,
       byte_size, width, height, original_name, sort_order, created_at, updated_at`,
  )
    .bind(id, agent.id, kind, label, value)
    .first<AttachmentPresetRow>();
  if (!row) return c.json({ error: 'ATTACHMENT_PRESET_CREATE_FAILED' }, 500);
  return c.json({ preset: publicPreset(row) }, 201);
});

agentAttachmentApi.post('/api/agent/attachments/presets/image', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  let form: FormData;
  try {
    form = await c.req.raw.formData();
  } catch {
    return c.json({ error: 'INVALID_ATTACHMENT_IMAGE' }, 400);
  }
  const file = form.get('file');
  if (!(file instanceof File)) {
    return c.json({ error: 'INVALID_ATTACHMENT_IMAGE' }, 400);
  }
  const width = normalizeFormNumber(form.get('width'));
  const height = normalizeFormNumber(form.get('height'));
  const media = normalizeMediaInput({
    mimeType: file.type,
    byteSize: file.size,
    width,
    height,
    originalName: file.name,
  });
  const label = normalizeAttachmentLabel(form.get('label')) ?? '问候图片';
  if (!media) return c.json({ error: 'INVALID_ATTACHMENT_IMAGE' }, 400);

  const id = crypto.randomUUID();
  const objectKey = `agent-assets/${agent.id}/${id}.${MIME_EXTENSIONS[media.mimeType]}`;
  await c.env.MEDIA.put(objectKey, file.stream(), {
    httpMetadata: { contentType: media.mimeType },
  });
  try {
    const row = await c.env.DB.prepare(
      `INSERT INTO agent_attachment_presets (
         id, agent_id, kind, label, value, object_key, mime_type, byte_size,
         width, height, original_name, sort_order
       ) VALUES (?1, ?2, 'image', ?3, NULL, ?4, ?5, ?6, ?7, ?8, ?9, 0)
       RETURNING id, agent_id, kind, label, value, object_key, mime_type,
         byte_size, width, height, original_name, sort_order, created_at, updated_at`,
    )
      .bind(
        id,
        agent.id,
        label,
        objectKey,
        media.mimeType,
        media.byteSize,
        media.width,
        media.height,
        media.originalName,
      )
      .first<AttachmentPresetRow>();
    if (!row) throw new Error('ATTACHMENT_PRESET_CREATE_FAILED');
    return c.json({ preset: publicPreset(row) }, 201);
  } catch (error) {
    await c.env.MEDIA.delete(objectKey).catch(() => undefined);
    throw error;
  }
});

agentAttachmentApi.patch('/api/agent/attachments/presets/:id', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const current = await presetForAgent(c.env.DB, c.req.param('id'), agent.id);
  if (!current) return c.json({ error: 'NOT_FOUND' }, 404);
  const body = await readJson<{ label?: string; value?: string }>(c.req.raw);
  const label = normalizeAttachmentLabel(body?.label ?? current.label);
  const value =
    current.kind === 'phone'
      ? normalizePhoneValue(body?.value ?? current.value)
      : current.kind === 'link'
        ? normalizeLinkValue(body?.value ?? current.value)
        : null;
  if (!label || (current.kind !== 'image' && !value)) {
    return c.json({ error: 'INVALID_ATTACHMENT_PRESET' }, 400);
  }
  const row = await c.env.DB.prepare(
    `UPDATE agent_attachment_presets
     SET label = ?1,
         value = CASE WHEN kind = 'image' THEN NULL ELSE ?2 END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?3 AND agent_id = ?4
     RETURNING id, agent_id, kind, label, value, object_key, mime_type,
       byte_size, width, height, original_name, sort_order, created_at, updated_at`,
  )
    .bind(label, value, current.id, agent.id)
    .first<AttachmentPresetRow>();
  if (!row) return c.json({ error: 'NOT_FOUND' }, 404);
  return c.json({ preset: publicPreset(row) });
});

agentAttachmentApi.delete('/api/agent/attachments/presets/:id', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const result = await c.env.DB.prepare(
    `DELETE FROM agent_attachment_presets WHERE id = ?1 AND agent_id = ?2`,
  )
    .bind(c.req.param('id'), agent.id)
    .run();
  if (!result.meta.changes) return c.json({ error: 'NOT_FOUND' }, 404);
  // Image objects are intentionally retained. A previously sent message may
  // still reference the immutable object key even after the preset is deleted.
  return c.json({ ok: true });
});

agentAttachmentApi.get(
  '/api/agent/attachments/presets/:id/content',
  async (c) => {
    const agent = await requireAgentSession(c);
    if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
    const row = await presetForAgent(c.env.DB, c.req.param('id'), agent.id);
    if (!row || row.kind !== 'image')
      return c.json({ error: 'NOT_FOUND' }, 404);
    return readAttachmentObject(c.env.MEDIA, row);
  },
);

agentAttachmentApi.get(
  '/api/agent/conversations/:id/attachments',
  async (c) => {
    const agent = await requireAgentSession(c);
    if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
    const conversation = await c.env.DB.prepare(
      `SELECT id FROM conversations
     WHERE id = ?1 AND assigned_agent = ?2
       AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
     LIMIT 1`,
    )
      .bind(c.req.param('id'), agent.id)
      .first<{ id: string }>();
    if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);
    return c.json({
      items: await listConversationAttachments(c.env.DB, conversation.id),
    });
  },
);

agentAttachmentApi.post(
  '/api/agent/conversations/:id/attachments',
  async (c) => {
    const agent = await requireAgentSession(c);
    if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
    const body = await readJson<{
      body?: string;
      presetIds?: string[];
      clientMessageId?: string;
    }>(c.req.raw);
    const text = body?.body?.trim() ?? '';
    const clientMessageId = normalizeMessageId(body?.clientMessageId);
    const presetIds = normalizePresetIds(body?.presetIds);
    if (
      text.length > MESSAGE_LIMIT ||
      !clientMessageId ||
      presetIds.length < 1 ||
      presetIds.length > MAX_ATTACHMENTS_PER_MESSAGE
    ) {
      return c.json({ error: 'INVALID_MESSAGE_ATTACHMENTS' }, 400);
    }

    const requested = await loadRequestedPresets(
      c.env.DB,
      c.req.param('id'),
      agent.id,
      presetIds,
    );
    if (!requested.length) return c.json({ error: 'NOT_FOUND' }, 404);
    const conversationStatus = requested[0].conversation_status;
    if (requested.some((row) => !row.id || !row.kind || !row.label)) {
      return c.json({ error: 'INVALID_ATTACHMENT_PRESET' }, 400);
    }

    const duplicate = await findAgentMessageByClientId(
      c.env.DB,
      c.req.param('id'),
      agent.id,
      clientMessageId,
    );
    if (duplicate) {
      return c.json({
        message: duplicate,
        attachments: (await loadMessageAttachments(c.env.DB, duplicate.id)).map(
          publicMessageAttachment,
        ),
        duplicate: true,
      });
    }
    if (conversationStatus === 'closed') {
      return c.json({ error: 'CONVERSATION_CLOSED' }, 409);
    }

    const messageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const inserted = await c.env.DB.prepare(
      `INSERT OR IGNORE INTO messages (
       id, conversation_id, sender_type, sender_id, body, kind,
       client_message_id, created_at
     ) VALUES (?1, ?2, 'agent', ?3, ?4, 'text', ?5, ?6)`,
    )
      .bind(messageId, c.req.param('id'), agent.id, text, clientMessageId, now)
      .run();
    if (!inserted.meta.changes) {
      const existing = await findAgentMessageByClientId(
        c.env.DB,
        c.req.param('id'),
        agent.id,
        clientMessageId,
      );
      if (!existing) return c.json({ error: 'MESSAGE_ID_CONFLICT' }, 409);
      return c.json({
        message: existing,
        attachments: (await loadMessageAttachments(c.env.DB, existing.id)).map(
          publicMessageAttachment,
        ),
        duplicate: true,
      });
    }

    const snapshots = requested.map((row, index) => ({
      id: crypto.randomUUID(),
      messageId,
      kind: row.kind as AttachmentKind,
      label: row.label as string,
      value: row.value,
      objectKey: row.object_key,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      originalName: row.original_name,
      sortOrder: index,
    }));
    const preview = text || snapshots[0]?.label || 'Attachment';
    const statements = snapshots.map((snapshot) =>
      c.env.DB.prepare(
        `INSERT INTO message_attachments (
         id, message_id, kind, label, value, object_key, mime_type, byte_size,
         width, height, original_name, sort_order, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`,
      ).bind(
        snapshot.id,
        snapshot.messageId,
        snapshot.kind,
        snapshot.label,
        snapshot.value,
        snapshot.objectKey,
        snapshot.mimeType,
        snapshot.byteSize,
        snapshot.width,
        snapshot.height,
        snapshot.originalName,
        snapshot.sortOrder,
        now,
      ),
    );
    statements.push(
      c.env.DB.prepare(
        `UPDATE conversations
       SET status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
           visitor_unread_count = visitor_unread_count + 1,
           agent_unread_count = 0,
           last_message_at = ?1,
           last_message_preview = ?2,
           updated_at = ?1
       WHERE id = ?3 AND assigned_agent = ?4
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP`,
      ).bind(now, preview, c.req.param('id'), agent.id),
    );
    await c.env.DB.batch(statements);

    const message: MessageRow = {
      id: messageId,
      conversation_id: c.req.param('id'),
      sender_type: 'agent',
      sender_id: agent.id,
      body: text,
      client_message_id: clientMessageId,
      read_by_visitor_at: null,
      read_by_agent_at: null,
      created_at: now,
    };
    const publicAttachments = snapshots.map((snapshot) => ({
      id: snapshot.id,
      kind: snapshot.kind,
      label: snapshot.label,
      value: snapshot.value,
      ...(snapshot.kind === 'image'
        ? {
            mimeType: snapshot.mimeType,
            byteSize: snapshot.byteSize,
            width: snapshot.width,
            height: snapshot.height,
            originalName: snapshot.originalName,
            source: 'snapshot' as const,
          }
        : {}),
    }));
    await Promise.allSettled([
      broadcastRoom(c.env, c.req.param('id'), {
        type: 'message',
        message,
        attachments: publicAttachments,
      }),
      broadcastClientConversationEvent(
        c.env,
        c.req.param('id'),
        'message.created',
        {
          message: clientRealtimeMessage(message, publicAttachments),
        },
        { includeOverview: conversationStatus === 'open' },
      ),
    ]);
    return c.json({ message, attachments: publicAttachments }, 201);
  },
);

agentAttachmentApi.get('/api/agent/attachments/:id/content', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const row = await c.env.DB.prepare(
    `SELECT attachment.id, attachment.message_id, attachment.kind,
       attachment.label, attachment.value, attachment.object_key,
       attachment.mime_type, attachment.byte_size, attachment.width,
       attachment.height, attachment.original_name, attachment.sort_order,
       attachment.created_at
     FROM message_attachments attachment
     JOIN messages message ON message.id = attachment.message_id
     JOIN conversations conversation ON conversation.id = message.conversation_id
     WHERE attachment.id = ?1
       AND conversation.assigned_agent = ?2
       AND COALESCE(conversation.expires_at, datetime(conversation.created_at, '+1 day')) > CURRENT_TIMESTAMP
     LIMIT 1`,
  )
    .bind(c.req.param('id'), agent.id)
    .first<MessageAttachmentRow>();
  if (!row || row.kind !== 'image') return c.json({ error: 'NOT_FOUND' }, 404);
  return readAttachmentObject(c.env.MEDIA, row);
});

agentAttachmentApi.get(
  '/client/v1/conversations/:id/attachments',
  async (c) => {
    const access = await authorizeVisitorConversation(c, c.req.param('id'));
    if (!access.ok) return clientError(c, access.status, access.code);
    return c.json({
      items: await listConversationAttachments(c.env.DB, access.conversationId),
    });
  },
);

agentAttachmentApi.get('/client/v1/attachments/:id/content', async (c) => {
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
  const row = await c.env.DB.prepare(
    `SELECT attachment.id, attachment.message_id, attachment.kind,
       attachment.label, attachment.value, attachment.object_key,
       attachment.mime_type, attachment.byte_size, attachment.width,
       attachment.height, attachment.original_name, attachment.sort_order,
       attachment.created_at
     FROM message_attachments attachment
     JOIN messages message ON message.id = attachment.message_id
     JOIN conversations conversation ON conversation.id = message.conversation_id
     JOIN visitors v ON v.id = conversation.visitor_id
     JOIN sites site ON site.id = conversation.site_id
     WHERE attachment.id = ?1
       AND (site.id = ?2 OR site.public_key = ?2)
       AND site.is_enabled = 1
       AND v.external_id = ?3
       AND conversation.assigned_agent IS NOT NULL
       AND COALESCE(conversation.expires_at, datetime(conversation.created_at, '+1 day')) > CURRENT_TIMESTAMP
     LIMIT 1`,
  )
    .bind(c.req.param('id'), projectId, visitor.external_id)
    .first<MessageAttachmentRow>();
  if (!row || row.kind !== 'image')
    return clientError(c, 404, 'ATTACHMENT_NOT_FOUND');
  return readAttachmentObject(c.env.MEDIA, row);
});

async function presetForAgent(
  db: D1Database,
  id: string,
  agentId: string,
): Promise<AttachmentPresetRow | null> {
  return db
    .prepare(
      `SELECT id, agent_id, kind, label, value, object_key, mime_type,
         byte_size, width, height, original_name, sort_order, created_at, updated_at
       FROM agent_attachment_presets
       WHERE id = ?1 AND agent_id = ?2
       LIMIT 1`,
    )
    .bind(id, agentId)
    .first<AttachmentPresetRow>();
}

async function loadRequestedPresets(
  db: D1Database,
  conversationId: string,
  agentId: string,
  presetIds: string[],
): Promise<RequestedPresetRow[]> {
  const result = await db
    .prepare(
      `WITH requested AS (
         SELECT CAST(key AS INTEGER) AS request_order, CAST(value AS TEXT) AS preset_id
         FROM json_each(?3)
       )
       SELECT requested.request_order,
         conversation.status AS conversation_status,
         preset.id, preset.agent_id, preset.kind, preset.label, preset.value,
         preset.object_key, preset.mime_type, preset.byte_size, preset.width,
         preset.height, preset.original_name, preset.sort_order,
         preset.created_at, preset.updated_at
       FROM conversations conversation
       CROSS JOIN requested
       LEFT JOIN agent_attachment_presets preset
         ON preset.id = requested.preset_id AND preset.agent_id = ?2
       WHERE conversation.id = ?1
         AND conversation.assigned_agent = ?2
         AND COALESCE(conversation.expires_at, datetime(conversation.created_at, '+1 day')) > CURRENT_TIMESTAMP
       ORDER BY requested.request_order ASC`,
    )
    .bind(conversationId, agentId, JSON.stringify(presetIds))
    .all<RequestedPresetRow>();
  return result.results ?? [];
}

async function findAgentMessageByClientId(
  db: D1Database,
  conversationId: string,
  agentId: string,
  clientMessageId: string,
): Promise<MessageRow | null> {
  return db
    .prepare(
      `SELECT id, conversation_id, sender_type, sender_id, body,
         client_message_id, read_by_visitor_at, read_by_agent_at, created_at
       FROM messages
       WHERE conversation_id = ?1
         AND client_message_id = ?2
         AND sender_type = 'agent'
         AND sender_id = ?3
       LIMIT 1`,
    )
    .bind(conversationId, clientMessageId, agentId)
    .first<MessageRow>();
}

async function authorizeVisitorConversation(
  c: Context<Env>,
  conversationId: string,
): Promise<
  | { ok: true; conversationId: string }
  | { ok: false; status: 400 | 401 | 404; code: string }
> {
  const visitorId = normalizeVisitorId(c.req.query('visitorId'));
  const visitorToken = normalizeVisitorToken(
    c.req.query('visitorToken') ?? c.req.header('X-CS-Visitor-Token'),
  );
  if (!visitorId && !visitorToken)
    return { ok: false, status: 400, code: 'INVALID_VISITOR_ID' };
  const projectId = normalizeProjectId(c.req.query('projectId'));
  const site = await findSite(c.env.DB, projectId);
  if (!site) return { ok: false, status: 404, code: 'PROJECT_NOT_FOUND' };
  const visitor = await resolveVisitor(c.env.DB, site.id, {
    externalId: visitorId,
    accessToken: visitorToken,
  });
  if (!visitor)
    return { ok: false, status: 401, code: 'INVALID_VISITOR_TOKEN' };
  const conversation = await c.env.DB.prepare(
    `SELECT conversation.id
     FROM conversations conversation
     JOIN visitors v ON v.id = conversation.visitor_id
     JOIN sites site ON site.id = conversation.site_id
     WHERE conversation.id = ?1
       AND (site.id = ?2 OR site.public_key = ?2)
       AND site.is_enabled = 1
       AND v.external_id = ?3
       AND conversation.assigned_agent IS NOT NULL
       AND COALESCE(conversation.expires_at, datetime(conversation.created_at, '+1 day')) > CURRENT_TIMESTAMP
     LIMIT 1`,
  )
    .bind(conversationId, projectId, visitor.external_id)
    .first<{ id: string }>();
  return conversation
    ? { ok: true, conversationId: conversation.id }
    : { ok: false, status: 404, code: 'CONVERSATION_NOT_FOUND' };
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

function normalizePresetIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item && item.length <= 200);
  return [...new Set(ids)];
}

function normalizeMessageId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id && id.length <= 200 ? id : null;
}

function normalizeProjectId(value?: string | null): string {
  const project = value?.trim();
  return project && project.length <= 200 ? project : 'default';
}

function normalizeFormNumber(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function clientRealtimeMessage(message: MessageRow, attachments: unknown[]) {
  return {
    id: message.id,
    direction: 'agent' as const,
    body: message.body,
    sentAt: message.created_at,
    delivery: message.read_by_visitor_at
      ? ('read' as const)
      : ('sent' as const),
    attachments,
  };
}

function broadcastRoom(
  env: Pick<Bindings, 'CONVERSATION_ROOMS'>,
  conversationId: string,
  payload: unknown,
) {
  const room = env.CONVERSATION_ROOMS.get(
    env.CONVERSATION_ROOMS.idFromName(conversationId),
  );
  return room.fetch('https://conversation-room/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function clientError(c: Context<Env>, status: 400 | 401 | 404, code: string) {
  return c.json({ error: { code, message: code } }, status);
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
