import { Hono } from 'hono';
import { cors } from 'hono/cors';

type ClientBindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  MANAGEMENT_TOKEN?: string;
};

type ClientEnv = { Bindings: ClientBindings };
type ConversationStatus = 'open' | 'pending' | 'closed';
type SenderType = 'visitor' | 'agent' | 'system';

type SiteRow = {
  id: string;
  name: string;
};

type VisitorRow = {
  id: string;
  site_id: string;
  external_id: string;
  expires_at: string | null;
};

type ConversationRow = {
  id: string;
  site_id: string;
  visitor_id: string;
  status: ConversationStatus;
  assigned_agent: string | null;
  subject: string | null;
  group_id: string | null;
  product_id: string | null;
  section_id: string | null;
  product_title: string | null;
  product_cover_url: string | null;
  product_href: string | null;
  expires_at: string | null;
  visitor_unread_count: number;
  last_message_at: string;
  created_at: string;
  last_message: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id: string | null;
  body: string;
  client_message_id: string | null;
  read_by_visitor_at: string | null;
  created_at: string;
};

type ProductInput = {
  id?: string;
  sectionId?: string;
  title?: string;
  href?: string;
  coverUrl?: string | null;
};

const CLIENT_MESSAGE_LIMIT = 4000;
const VISITOR_LIFETIME_HOURS = 24;
const CONVERSATION_LIMIT = 10;

export const clientApi = new Hono<ClientEnv>();

clientApi.use(
  '/client/v1/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 86400,
  }),
);

clientApi.get('/management/v1/groups', async (c) => {
  if (!managementAuthorized(c.env, c.req.header('Authorization'))) {
    return error(c, 401, 'UNAUTHORIZED', 'Management token is invalid.');
  }

  const projectId = normalizeProjectId(c.req.header('X-Project-Id'));
  const site = await findSite(c.env.DB, projectId);
  if (!site) return error(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');

  const result = await c.env.DB.prepare(
    `SELECT id, name, is_enabled
     FROM support_groups
     WHERE site_id = ?1
     ORDER BY name ASC, id ASC`,
  )
    .bind(site.id)
    .all<{ id: string; name: string; is_enabled: number }>();

  return c.json({
    groups: (result.results ?? []).map((group) => ({
      id: group.id,
      name: group.name,
      isEnabled: group.is_enabled === 1,
    })),
  });
});

clientApi.get('/client/v1/conversations', async (c) => {
  const visitorId = normalizeVisitorId(c.req.query('visitorId'));
  if (!visitorId) return error(c, 400, 'INVALID_VISITOR_ID', 'Visitor ID is invalid.');

  const site = await findSite(c.env.DB, normalizeProjectId(c.req.query('projectId')));
  if (!site) return error(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');

  const result = await c.env.DB.prepare(
    `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent, c.subject,
       c.group_id, c.product_id, c.section_id, c.product_title, c.product_cover_url,
       c.product_href, c.expires_at, c.visitor_unread_count, c.last_message_at,
       c.created_at,
       (SELECT body FROM messages m WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     WHERE c.site_id = ?1
       AND v.external_id = ?2
       AND COALESCE(v.expires_at, datetime(v.created_at, '+1 day')) > CURRENT_TIMESTAMP
       AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
     ORDER BY c.last_message_at DESC, c.id DESC
     LIMIT 100`,
  )
    .bind(site.id, visitorId)
    .all<ConversationRow>();

  return c.json({
    conversations: (result.results ?? []).map(conversationSummary),
  });
});

clientApi.get('/client/v1/conversations/:id', async (c) => {
  const identity = await resolveIdentity(c.env.DB, c.req.param('id'), {
    visitorId: c.req.query('visitorId'),
    projectId: c.req.query('projectId'),
  });
  if (!identity.ok) return error(c, identity.status, identity.code, identity.message);

  const before = c.req.query('before')?.trim() || null;
  const limit = clampLimit(c.req.query('limit'));
  return c.json({
    conversation: await conversationDetail(
      c.env.DB,
      identity.conversation,
      limit,
      before,
    ),
  });
});

clientApi.post('/client/v1/conversations', async (c) => {
  const body = await readJson<{
    visitorId?: string;
    projectId?: string | null;
    groupId?: string;
    clientMessageId?: string;
    message?: string;
    product?: ProductInput;
  }>(c.req.raw);

  const visitorId = normalizeVisitorId(body?.visitorId);
  const groupId = normalizeId(body?.groupId, 100);
  const clientMessageId = normalizeId(body?.clientMessageId, 160);
  const message = body?.message?.trim();
  const product = normalizeProduct(body?.product);

  if (!visitorId) return error(c, 400, 'INVALID_VISITOR_ID', 'Visitor ID is invalid.');
  if (!groupId) return error(c, 400, 'INVALID_GROUP_ID', 'Support group is invalid.');
  if (!clientMessageId) {
    return error(c, 400, 'INVALID_CLIENT_MESSAGE_ID', 'Client message ID is invalid.');
  }
  if (!validMessage(message)) return error(c, 400, 'INVALID_MESSAGE', 'Message is invalid.');
  if (!product) return error(c, 400, 'INVALID_PRODUCT', 'Product context is invalid.');

  const site = await findSite(c.env.DB, normalizeProjectId(body?.projectId));
  if (!site) return error(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');

  const group = await c.env.DB.prepare(
    `SELECT id FROM support_groups
     WHERE site_id = ?1 AND id = ?2 AND is_enabled = 1`,
  )
    .bind(site.id, groupId)
    .first<{ id: string }>();
  if (!group) return error(c, 404, 'GROUP_NOT_FOUND', 'Support group was not found.');

  const existing = await c.env.DB.prepare(
    `SELECT m.conversation_id
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     JOIN visitors v ON v.id = c.visitor_id
     WHERE c.site_id = ?1 AND v.external_id = ?2 AND m.client_message_id = ?3
     LIMIT 1`,
  )
    .bind(site.id, visitorId, clientMessageId)
    .first<{ conversation_id: string }>();
  if (existing) {
    const conversation = await ownedConversation(
      c.env.DB,
      existing.conversation_id,
      site.id,
      visitorId,
    );
    if (conversation) {
      return c.json({
        conversation: await conversationDetail(c.env.DB, conversation, 30, null),
      });
    }
  }

  const activeCount = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     WHERE c.site_id = ?1 AND v.external_id = ?2
       AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP`,
  )
    .bind(site.id, visitorId)
    .first<{ count: number }>();
  if (Number(activeCount?.count ?? 0) >= CONVERSATION_LIMIT) {
    return error(c, 409, 'CONVERSATION_LIMIT_REACHED', 'Conversation limit reached.');
  }

  const visitor = await ensureVisitor(c.env.DB, site.id, visitorId);
  const conversationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + VISITOR_LIFETIME_HOURS * 60 * 60 * 1000,
  ).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO conversations (
       id, site_id, visitor_id, status, subject, group_id,
       product_id, section_id, product_title, product_cover_url, product_href,
       expires_at, last_message_at, created_at, updated_at
     ) VALUES (?1, ?2, ?3, 'open', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?12)`,
  )
    .bind(
      conversationId,
      site.id,
      visitor.id,
      product.title.slice(0, 120),
      groupId,
      product.id,
      product.sectionId,
      product.title,
      product.coverUrl,
      product.href,
      expiresAt,
      now,
    )
    .run();

  const createdMessage = await persistClientMessage(c.env.DB, {
    conversationId,
    senderType: 'visitor',
    senderId: visitor.id,
    body: message!,
    clientMessageId,
  });

  await broadcastRoom(c.env, conversationId, {
    type: 'message',
    message: adminMessage(createdMessage),
  });
  await broadcastVisitorEvent(c.env, site.id, visitorId, {
    type: 'message.created',
    conversationId,
  });
  await broadcastRoom(c.env, 'admin:inbox', {
    type: 'conversation.changed',
    conversationId,
  });

  const conversation = await ownedConversation(
    c.env.DB,
    conversationId,
    site.id,
    visitorId,
  );
  if (!conversation) throw new Error('Conversation persistence failed');

  return c.json(
    {
      conversation: await conversationDetail(c.env.DB, conversation, 30, null),
    },
    201,
  );
});

clientApi.post('/client/v1/conversations/:id/messages', async (c) => {
  const body = await readJson<{
    visitorId?: string;
    projectId?: string | null;
    clientMessageId?: string;
    body?: string;
  }>(c.req.raw);
  const visitorId = normalizeVisitorId(body?.visitorId);
  const clientMessageId = normalizeId(body?.clientMessageId, 160);
  const messageBody = body?.body?.trim();
  if (!visitorId) return error(c, 400, 'INVALID_VISITOR_ID', 'Visitor ID is invalid.');
  if (!clientMessageId) {
    return error(c, 400, 'INVALID_CLIENT_MESSAGE_ID', 'Client message ID is invalid.');
  }
  if (!validMessage(messageBody)) return error(c, 400, 'INVALID_MESSAGE', 'Message is invalid.');

  const site = await findSite(c.env.DB, normalizeProjectId(body?.projectId));
  if (!site) return error(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');
  const conversation = await ownedConversation(
    c.env.DB,
    c.req.param('id'),
    site.id,
    visitorId,
  );
  if (!conversation) return error(c, 404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found.');
  if (conversation.status === 'closed') {
    return error(c, 409, 'CONVERSATION_CLOSED', 'Conversation is closed.');
  }

  const existing = await c.env.DB.prepare(
    `SELECT id, conversation_id, sender_type, sender_id, body, client_message_id,
       read_by_visitor_at, created_at
     FROM messages WHERE conversation_id = ?1 AND client_message_id = ?2`,
  )
    .bind(conversation.id, clientMessageId)
    .first<MessageRow>();
  if (existing) return c.json({ message: clientMessage(existing) });

  const message = await persistClientMessage(c.env.DB, {
    conversationId: conversation.id,
    senderType: 'visitor',
    senderId: conversation.visitor_id,
    body: messageBody!,
    clientMessageId,
  });
  await c.env.DB.prepare(
    'UPDATE visitors SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1',
  )
    .bind(conversation.visitor_id)
    .run();

  await broadcastRoom(c.env, conversation.id, {
    type: 'message',
    message: adminMessage(message),
  });
  await broadcastVisitorEvent(c.env, site.id, visitorId, {
    type: 'message.created',
    conversationId: conversation.id,
  });
  await broadcastRoom(c.env, 'admin:inbox', {
    type: 'conversation.changed',
    conversationId: conversation.id,
  });

  return c.json({ message: clientMessage(message) }, 201);
});

clientApi.post('/client/v1/conversations/:id/read', async (c) => {
  const body = await readJson<{
    visitorId?: string;
    projectId?: string | null;
    lastMessageId?: string | null;
  }>(c.req.raw);
  const visitorId = normalizeVisitorId(body?.visitorId);
  if (!visitorId) return error(c, 400, 'INVALID_VISITOR_ID', 'Visitor ID is invalid.');

  const site = await findSite(c.env.DB, normalizeProjectId(body?.projectId));
  if (!site) return error(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');
  const conversation = await ownedConversation(
    c.env.DB,
    c.req.param('id'),
    site.id,
    visitorId,
  );
  if (!conversation) return error(c, 404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found.');

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE conversations
       SET visitor_unread_count = 0, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1`,
    ).bind(conversation.id),
    c.env.DB.prepare(
      `UPDATE messages SET read_by_visitor_at = COALESCE(read_by_visitor_at, CURRENT_TIMESTAMP)
       WHERE conversation_id = ?1 AND sender_type = 'agent'`,
    ).bind(conversation.id),
  ]);

  await broadcastVisitorEvent(c.env, site.id, visitorId, {
    type: 'message.read',
    conversationId: conversation.id,
  });
  return c.json({ ok: true });
});

clientApi.get('/client/v1/realtime', async (c) => {
  const visitorId = normalizeVisitorId(c.req.query('visitorId'));
  if (!visitorId) return error(c, 400, 'INVALID_VISITOR_ID', 'Visitor ID is invalid.');
  const site = await findSite(c.env.DB, normalizeProjectId(c.req.query('projectId')));
  if (!site) return error(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return error(c, 426, 'WEBSOCKET_REQUIRED', 'WebSocket upgrade required.');
  }
  return visitorRoom(c.env, site.id, visitorId).fetch(c.req.raw);
});

export async function broadcastClientConversationEvent(
  env: ClientBindings,
  conversationId: string,
  type: 'message.created' | 'message.read' | 'conversation.assigned' | 'conversation.closed',
): Promise<void> {
  const identity = await env.DB.prepare(
    `SELECT c.site_id, v.external_id
     FROM conversations c JOIN visitors v ON v.id = c.visitor_id
     WHERE c.id = ?1`,
  )
    .bind(conversationId)
    .first<{ site_id: string; external_id: string | null }>();
  if (!identity?.external_id) return;
  await broadcastVisitorEvent(env, identity.site_id, identity.external_id, {
    type,
    conversationId,
  });
  await broadcastRoom(env, 'admin:inbox', {
    type: 'conversation.changed',
    conversationId,
  });
}

function managementAuthorized(env: ClientBindings, authorization?: string): boolean {
  if (!env.MANAGEMENT_TOKEN) return true;
  return authorization === `Bearer ${env.MANAGEMENT_TOKEN}`;
}

function normalizeProjectId(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : 'default';
}

function normalizeVisitorId(value?: string | null): string | null {
  const visitorId = value?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9]{6}$/u.test(visitorId)) return null;
  const letters = [...visitorId].filter((char) => /[A-Z]/u.test(char)).length;
  const digits = [...visitorId].filter((char) => /[0-9]/u.test(char)).length;
  return letters === 3 && digits === 3 ? visitorId : null;
}

function normalizeId(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function normalizeProduct(value?: ProductInput): Required<Omit<ProductInput, 'coverUrl'>> & {
  coverUrl: string | null;
} | null {
  const id = normalizeId(value?.id, 100);
  const sectionId = normalizeId(value?.sectionId, 100);
  const title = normalizeId(value?.title, 300);
  const href = normalizeId(value?.href, 1000);
  const coverUrl = value?.coverUrl === null || value?.coverUrl === undefined
    ? null
    : normalizeId(value.coverUrl, 2000);
  if (!id || !sectionId || !title || !href || (value?.coverUrl && !coverUrl)) return null;
  return { id, sectionId, title, href, coverUrl };
}

function validMessage(value?: string): value is string {
  return Boolean(value && value.length <= CLIENT_MESSAGE_LIMIT);
}

async function findSite(db: D1Database, projectId: string): Promise<SiteRow | null> {
  return db.prepare(
    `SELECT id, name FROM sites
     WHERE (id = ?1 OR public_key = ?1) AND is_enabled = 1
     LIMIT 1`,
  )
    .bind(projectId)
    .first<SiteRow>();
}

async function ensureVisitor(
  db: D1Database,
  siteId: string,
  externalId: string,
): Promise<VisitorRow> {
  const existing = await db.prepare(
    `SELECT id, site_id, external_id, expires_at
     FROM visitors WHERE site_id = ?1 AND external_id = ?2`,
  )
    .bind(siteId, externalId)
    .first<VisitorRow>();

  if (existing && isFuture(existing.expires_at)) {
    await db.prepare('UPDATE visitors SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1')
      .bind(existing.id)
      .run();
    return existing;
  }

  if (existing) {
    await db.prepare('DELETE FROM visitors WHERE id = ?1').bind(existing.id).run();
  }

  const id = crypto.randomUUID();
  const tokenHash = await sha256(`client-v1:${siteId}:${externalId}:${crypto.randomUUID()}`);
  const expiresAt = new Date(
    Date.now() + VISITOR_LIFETIME_HOURS * 60 * 60 * 1000,
  ).toISOString();
  await db.prepare(
    `INSERT INTO visitors (
       id, site_id, token_hash, display_name, external_id, expires_at
     ) VALUES (?1, ?2, ?3, ?4, ?4, ?5)`,
  )
    .bind(id, siteId, tokenHash, externalId, expiresAt)
    .run();

  return { id, site_id: siteId, external_id: externalId, expires_at: expiresAt };
}

async function resolveIdentity(
  db: D1Database,
  conversationId: string,
  input: { visitorId?: string | null; projectId?: string | null },
): Promise<
  | { ok: true; site: SiteRow; visitorId: string; conversation: ConversationRow }
  | { ok: false; status: 400 | 404; code: string; message: string }
> {
  const visitorId = normalizeVisitorId(input.visitorId);
  if (!visitorId) {
    return { ok: false, status: 400, code: 'INVALID_VISITOR_ID', message: 'Visitor ID is invalid.' };
  }
  const site = await findSite(db, normalizeProjectId(input.projectId));
  if (!site) {
    return { ok: false, status: 404, code: 'PROJECT_NOT_FOUND', message: 'Project was not found.' };
  }
  const conversation = await ownedConversation(db, conversationId, site.id, visitorId);
  if (!conversation) {
    return {
      ok: false,
      status: 404,
      code: 'CONVERSATION_NOT_FOUND',
      message: 'Conversation was not found.',
    };
  }
  return { ok: true, site, visitorId, conversation };
}

async function ownedConversation(
  db: D1Database,
  conversationId: string,
  siteId: string,
  visitorId: string,
): Promise<ConversationRow | null> {
  return db.prepare(
    `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent, c.subject,
       c.group_id, c.product_id, c.section_id, c.product_title, c.product_cover_url,
       c.product_href, c.expires_at, c.visitor_unread_count, c.last_message_at,
       c.created_at,
       (SELECT body FROM messages m WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     WHERE c.id = ?1 AND c.site_id = ?2 AND v.external_id = ?3
       AND COALESCE(v.expires_at, datetime(v.created_at, '+1 day')) > CURRENT_TIMESTAMP
       AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
     LIMIT 1`,
  )
    .bind(conversationId, siteId, visitorId)
    .first<ConversationRow>();
}

function conversationSummary(conversation: ConversationRow) {
  return {
    id: conversation.id,
    agentName: null,
    agentAvatarUrl: null,
    productId: conversation.product_id ?? '',
    sectionId: conversation.section_id ?? '',
    productTitle: conversation.product_title ?? conversation.subject ?? '',
    productCoverUrl: conversation.product_cover_url,
    lastMessage: conversation.last_message,
    lastMessageAt: toIso(conversation.last_message_at),
    unreadCount: Number(conversation.visitor_unread_count || 0),
    status: publicStatus(conversation.status),
  };
}

async function conversationDetail(
  db: D1Database,
  conversation: ConversationRow,
  limit: number,
  before: string | null,
) {
  const result = await db.prepare(
    `SELECT id, conversation_id, sender_type, sender_id, body, client_message_id,
       read_by_visitor_at, created_at
     FROM messages
     WHERE conversation_id = ?1
       AND (?2 IS NULL OR created_at < ?2)
     ORDER BY created_at DESC, id DESC
     LIMIT ?3`,
  )
    .bind(conversation.id, before, limit + 1)
    .all<MessageRow>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  return {
    ...conversationSummary(conversation),
    productHref: conversation.product_href,
    createdAt: toIso(conversation.created_at)!,
    expiresAt: toIso(
      conversation.expires_at ?? addHours(conversation.created_at, VISITOR_LIFETIME_HOURS),
    )!,
    messages: page.map(clientMessage),
    nextMessageCursor: hasMore && page.length > 0 ? page[0].created_at : null,
  };
}

async function persistClientMessage(
  db: D1Database,
  input: {
    conversationId: string;
    senderType: SenderType;
    senderId: string;
    body: string;
    clientMessageId: string;
  },
): Promise<MessageRow> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO messages (
         id, conversation_id, sender_type, sender_id, body, client_message_id, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(
      id,
      input.conversationId,
      input.senderType,
      input.senderId,
      input.body,
      input.clientMessageId,
      createdAt,
    ),
    db.prepare(
      `UPDATE conversations
       SET last_message_at = ?1, updated_at = ?1
       WHERE id = ?2`,
    ).bind(createdAt, input.conversationId),
  ]);
  const message = await db.prepare(
    `SELECT id, conversation_id, sender_type, sender_id, body, client_message_id,
       read_by_visitor_at, created_at
     FROM messages WHERE id = ?1`,
  )
    .bind(id)
    .first<MessageRow>();
  if (!message) throw new Error('Message persistence failed');
  return message;
}

function clientMessage(message: MessageRow) {
  return {
    id: message.id,
    direction: message.sender_type === 'agent' ? 'agent' : 'customer',
    body: message.body,
    sentAt: toIso(message.created_at)!,
    delivery: message.read_by_visitor_at ? 'read' : 'sent',
  };
}

function adminMessage(message: MessageRow) {
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_type: message.sender_type,
    sender_id: message.sender_id,
    body: message.body,
    created_at: message.created_at,
  };
}

function publicStatus(status: ConversationStatus): 'waiting' | 'active' | 'closed' {
  if (status === 'closed') return 'closed';
  return status === 'pending' ? 'active' : 'waiting';
}

function clampLimit(raw?: string): number {
  const value = Number.parseInt(raw ?? '30', 10);
  if (!Number.isFinite(value)) return 30;
  return Math.min(50, Math.max(1, value));
}

function visitorRoom(env: ClientBindings, siteId: string, visitorId: string): DurableObjectStub {
  return room(env, `client:${siteId}:${visitorId}`);
}

function room(env: ClientBindings, name: string): DurableObjectStub {
  return env.CONVERSATION_ROOMS.get(env.CONVERSATION_ROOMS.idFromName(name));
}

async function broadcastVisitorEvent(
  env: ClientBindings,
  siteId: string,
  visitorId: string,
  payload: unknown,
): Promise<void> {
  await broadcastRoom(env, `client:${siteId}:${visitorId}`, payload);
}

async function broadcastRoom(
  env: ClientBindings,
  name: string,
  payload: unknown,
): Promise<void> {
  await room(env, name).fetch('https://conversation-room/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T/u.test(value)) return value;
  return `${value.replace(' ', 'T')}Z`;
}

function addHours(value: string, hours: number): string {
  const normalized = toIso(value);
  const date = normalized ? new Date(normalized) : new Date();
  return new Date(date.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function isFuture(value: string | null): boolean {
  const iso = toIso(value);
  return Boolean(iso && Date.parse(iso) > Date.now());
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function error(
  c: Parameters<typeof clientApi.get>[1] extends (context: infer C) => unknown ? C : never,
  status: 400 | 401 | 404 | 409 | 426,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}
