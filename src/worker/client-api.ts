import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { conversationExpiresAt } from './conversation-retention';
import { assignConversationAgent, routingBusinessDate } from './routing';
import {
  DEFAULT_NO_AGENT_MESSAGE,
  normalizeNoAgentMessageFormat,
  type NoAgentMessageFormat,
} from './no-agent-message';
import {
  broadcastAssignments,
  type AssignmentVisitorMessage,
} from './assignment-broadcast';
import {
  consumeConversationCreationQuota,
  passesBurstLimit,
  requestSourceHash,
} from './abuse-control';

type ClientBindings = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  CONVERSATION_BURST_LIMITER?: RateLimit;
};

type ClientEnv = { Bindings: ClientBindings };
type ConversationStatus = 'open' | 'pending' | 'closed';
type SenderType = 'visitor' | 'agent' | 'system';

type SiteRow = {
  id: string;
  name: string;
  no_agent_message: string | null;
  no_agent_message_format: NoAgentMessageFormat | null;
};

type VisitorRow = {
  id: string;
  site_id: string;
  external_id: string;
  expires_at: string | null;
  access_token_hash: string | null;
};

type ConversationRow = {
  id: string;
  site_id: string;
  visitor_id: string;
  status: ConversationStatus;
  assigned_agent: string | null;
  agent_name: string | null;
  agent_avatar_version: string | null;
  subject: string | null;
  product_id: string | null;
  section_id: string | null;
  section_name: string | null;
  category_id: string | null;
  category_name: string | null;
  product_title: string | null;
  product_cover_url: string | null;
  product_href: string | null;
  expires_at: string | null;
  visitor_unread_count: number;
  agent_unread_count: number;
  last_message_at: string;
  created_at: string;
  last_message: string | null;
};

export type ConversationEventSnapshot = ConversationRow & {
  external_id: string | null;
  visitor_name: string | null;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_type: SenderType;
  sender_id: string | null;
  body: string;
  client_message_id: string | null;
  read_by_visitor_at: string | null;
  read_by_agent_at: string | null;
  created_at: string;
};

type ReadBoundary = {
  id: string;
  created_at: string;
};

type ProductInput = {
  id?: string;
};

type NormalizedProduct = {
  id: string;
  sectionId: string;
  sectionName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  title: string;
  href: string;
  coverUrl: string | null;
};

const CLIENT_MESSAGE_LIMIT = 4000;
const VISITOR_LIFETIME_HOURS = 24;
const CONVERSATION_REUSE_HOURS = 2;

export const clientApi = new Hono<ClientEnv>();

clientApi.use(
  '/client/v1/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'X-CS-Visitor-Token'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    maxAge: 86400,
  }),
);

clientApi.get('/client/v1/conversations', async (c) => {
  const visitorId = normalizeVisitorId(c.req.query('visitorId'));
  const visitorToken = normalizeVisitorToken(
    c.req.query('visitorToken') ?? c.req.header('X-CS-Visitor-Token'),
  );
  if (!visitorId && !visitorToken)
    return error(c, 400, 'INVALID_VISITOR_ID', 'Visitor ID is invalid.');

  const site = await findSite(
    c.env.DB,
    normalizeProjectId(c.req.query('projectId')),
  );
  if (!site)
    return error(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');

  const visitor = await resolveVisitor(c.env.DB, site.id, {
    externalId: visitorId,
    accessToken: visitorToken,
  });
  if (!visitor) {
    if (!visitorToken) return c.json({ conversations: [] });
    return error(
      c,
      401,
      'INVALID_VISITOR_TOKEN',
      'Visitor access token is invalid.',
    );
  }

  const result = await c.env.DB.prepare(
    `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent,
       a.name AS agent_name, a.avatar_version AS agent_avatar_version, c.subject,
       c.product_id, c.section_id, c.section_name, c.category_id,
       c.category_name, c.product_title, c.product_cover_url, c.product_href,
       c.expires_at, c.visitor_unread_count, c.agent_unread_count,
       c.last_message_at, c.created_at, c.last_message_preview AS last_message
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     LEFT JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id
     WHERE c.site_id = ?1
       AND v.id = ?2
       AND c.expires_at > CURRENT_TIMESTAMP
       AND c.assigned_agent IS NOT NULL
     ORDER BY c.last_message_at DESC, c.id DESC
     LIMIT 100`,
  )
    .bind(site.id, visitor.id)
    .all<ConversationRow>();

  return c.json({
    conversations: (result.results ?? []).map(conversationSummary),
  });
});

clientApi.get('/client/v1/conversations/:id', async (c) => {
  const identity = await resolveIdentity(c.env.DB, c.req.param('id'), {
    visitorId: c.req.query('visitorId'),
    visitorToken:
      c.req.query('visitorToken') ?? c.req.header('X-CS-Visitor-Token'),
    projectId: c.req.query('projectId'),
  });
  if (!identity.ok)
    return error(c, identity.status, identity.code, identity.message);

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

clientApi.get('/client/v1/conversations/:id/realtime', async (c) => {
  const identity = await resolveIdentity(c.env.DB, c.req.param('id'), {
    visitorId: c.req.query('visitorId'),
    visitorToken:
      c.req.query('visitorToken') ?? c.req.header('X-CS-Visitor-Token'),
    projectId: c.req.query('projectId'),
  });
  if (!identity.ok)
    return error(c, identity.status, identity.code, identity.message);
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return error(c, 426, 'WEBSOCKET_REQUIRED', 'WebSocket upgrade required.');
  }

  const requestUrl = new URL(c.req.url);
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-CS-Participant-Role', 'visitor');
  headers.set('X-CS-Participant-ID', identity.conversation.visitor_id);
  return room(c.env, identity.conversation.id).fetch(
    new Request(requestUrl, { ...c.req.raw, headers }),
  );
});

clientApi.post('/client/v1/conversations', async (c) => {
  const body = await readJson<{
    visitorId?: string;
    visitorToken?: string;
    projectId?: string | null;
    sourceHandoffId?: string;
    clientMessageId?: string;
    message?: string;
    product?: ProductInput;
  }>(c.req.raw);

  const visitorId = normalizeVisitorId(body?.visitorId);
  const visitorToken = normalizeVisitorToken(
    body?.visitorToken ?? c.req.header('X-CS-Visitor-Token'),
  );
  const sourceHandoffId = normalizeHandoffId(body?.sourceHandoffId);
  const productInput = normalizeProduct(body?.product);
  const messageFieldPresent = body?.message !== undefined;
  const clientMessageFieldPresent = body?.clientMessageId !== undefined;
  const initialMessage =
    typeof body?.message === 'string' ? body.message.trim() : null;
  const clientMessageId = normalizeId(body?.clientMessageId, 160);
  const hasInitialMessage = Boolean(initialMessage);

  if (!visitorId)
    return error(c, 400, 'INVALID_VISITOR_ID', 'Visitor ID is invalid.');
  if (!sourceHandoffId) {
    return error(
      c,
      400,
      'INVALID_SOURCE_HANDOFF_ID',
      'Source handoff ID is required and must be a UUID v4.',
    );
  }
  if (messageFieldPresent || clientMessageFieldPresent) {
    if (!hasInitialMessage || !validMessage(initialMessage ?? undefined)) {
      return error(c, 400, 'INVALID_MESSAGE', 'Message is invalid.');
    }
    if (!clientMessageId) {
      return error(
        c,
        400,
        'INVALID_CLIENT_MESSAGE_ID',
        'Client message ID is invalid.',
      );
    }
  }
  if (!productInput)
    return error(c, 400, 'INVALID_PRODUCT', 'Product context is invalid.');

  const site = await findSite(c.env.DB, normalizeProjectId(body?.projectId));
  if (!site)
    return error(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');

  const product = await findEnabledProduct(c.env.DB, site.id, productInput.id);
  if (!product) {
    return error(c, 404, 'PRODUCT_NOT_FOUND', 'Product was not found.');
  }

  const visitorResult = await ensureVisitor(
    c.env.DB,
    site.id,
    visitorId,
    visitorToken,
  );
  if (!visitorResult) {
    return error(
      c,
      401,
      'INVALID_VISITOR_TOKEN',
      'Visitor access token is invalid.',
    );
  }
  const visitor = visitorResult.visitor;
  const issuedVisitorToken = visitorResult.accessToken;
  const reuseKey = await conversationReuseKey(
    site.id,
    visitor.external_id,
    product.id,
  );

  // A source handoff still has permanent retry idempotency. A separate reuse
  // match coalesces fresh CTA starts for the same visitor + product for two
  // hours, even though each click intentionally has a different handoff ID.
  const replay = await c.env.DB.prepare(
    `WITH message_match AS (
       SELECT m.conversation_id
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.site_id = ?1
         AND v.external_id = ?2
         AND m.client_message_id = ?3
       LIMIT 1
     ),
     handoff_match AS (
       SELECT h.conversation_id, v.external_id
       FROM conversation_source_handoffs h
       JOIN conversations c ON c.id = h.conversation_id
       JOIN visitors v ON v.id = c.visitor_id
       WHERE h.site_id = ?1 AND h.source_handoff_id = ?4
       UNION ALL
       SELECT c.id AS conversation_id, v.external_id
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.site_id = ?1
         AND c.source_handoff_id = ?4
         AND NOT EXISTS (
           SELECT 1
           FROM conversation_source_handoffs h
           WHERE h.site_id = ?1 AND h.source_handoff_id = ?4
         )
       LIMIT 1
     ),
     reuse_match AS (
       SELECT
         c.id AS conversation_id,
         c.status,
         c.assigned_agent,
         c.last_message_at,
         c.expires_at
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.site_id = ?1
         AND v.external_id = ?2
         AND c.product_id = ?5
       ORDER BY
         CASE
           WHEN c.status IN ('open', 'pending')
             AND c.expires_at > CURRENT_TIMESTAMP
             AND c.last_message_at > datetime('now', '-2 hours')
             THEN 0
           WHEN c.expires_at > CURRENT_TIMESTAMP
             AND c.last_message_at > datetime('now', '-2 hours')
             THEN 1
           ELSE 2
         END,
         c.last_message_at DESC,
         c.id DESC
       LIMIT 1
     )
     SELECT
       (SELECT conversation_id FROM message_match) AS message_conversation_id,
       (SELECT conversation_id FROM handoff_match) AS handoff_conversation_id,
       (SELECT external_id FROM handoff_match) AS handoff_external_id,
       (SELECT conversation_id FROM reuse_match) AS reuse_conversation_id,
       (SELECT status FROM reuse_match) AS reuse_status,
       (SELECT assigned_agent FROM reuse_match) AS reuse_assigned_agent,
       (SELECT last_message_at FROM reuse_match) AS reuse_last_message_at,
       (SELECT expires_at FROM reuse_match) AS reuse_expires_at`,
  )
    .bind(site.id, visitorId, clientMessageId, sourceHandoffId, product.id)
    .first<{
      message_conversation_id: string | null;
      handoff_conversation_id: string | null;
      handoff_external_id: string | null;
      reuse_conversation_id: string | null;
      reuse_status: ConversationStatus | null;
      reuse_assigned_agent: string | null;
      reuse_last_message_at: string | null;
      reuse_expires_at: string | null;
    }>();

  if (replay?.message_conversation_id) {
    const conversation = await ownedConversation(
      c.env.DB,
      replay.message_conversation_id,
      site.id,
      visitor.external_id,
    );
    if (conversation) {
      if (!(await reusableConversationIsAvailable(c.env.DB, conversation))) {
        return noAgentResponse(c, site);
      }
      return c.json({
        conversation: await conversationDetail(
          c.env.DB,
          conversation,
          30,
          null,
        ),
      });
    }
  }

  if (replay?.handoff_conversation_id) {
    if (replay.handoff_external_id !== visitorId) {
      return error(
        c,
        409,
        'SOURCE_HANDOFF_ALREADY_USED',
        'Source handoff ID was already used.',
      );
    }
    const conversation = await ownedConversation(
      c.env.DB,
      replay.handoff_conversation_id,
      site.id,
      visitor.external_id,
    );
    if (conversation) {
      if (!(await reusableConversationIsAvailable(c.env.DB, conversation))) {
        return noAgentResponse(c, site);
      }
      return c.json({
        conversation: await conversationDetail(
          c.env.DB,
          conversation,
          30,
          null,
        ),
      });
    }
  }

  const reuseIsFresh =
    replay?.reuse_last_message_at &&
    replay.reuse_expires_at &&
    isAfterReuseBoundary(replay.reuse_last_message_at) &&
    new Date(toIso(replay.reuse_expires_at) ?? '').getTime() > Date.now();
  const reuseIsActive =
    reuseIsFresh &&
    Boolean(replay?.reuse_assigned_agent) &&
    (replay?.reuse_status === 'open' || replay?.reuse_status === 'pending');
  const affinityAgentId =
    reuseIsFresh && !reuseIsActive
      ? (replay?.reuse_assigned_agent ?? null)
      : null;
  const affinityExpiresAt =
    affinityAgentId && replay?.reuse_last_message_at
      ? addHours(replay.reuse_last_message_at, CONVERSATION_REUSE_HOURS)
      : null;

  if (reuseIsActive && replay?.reuse_conversation_id) {
    let conversation = await ownedConversation(
      c.env.DB,
      replay.reuse_conversation_id,
      site.id,
      visitorId,
    );
    if (conversation) {
      const handoffOwner = await rememberSourceHandoff(
        c.env.DB,
        site.id,
        sourceHandoffId,
        conversation.id,
        visitorId,
      );
      if (handoffOwner.externalId !== visitorId) {
        return error(
          c,
          409,
          'SOURCE_HANDOFF_ALREADY_USED',
          'Source handoff ID was already used.',
        );
      }
      if (handoffOwner.conversationId !== conversation.id) {
        conversation = await ownedConversation(
          c.env.DB,
          handoffOwner.conversationId,
          site.id,
          visitorId,
        );
      }
      if (conversation) {
        if (!(await reusableConversationIsAvailable(c.env.DB, conversation))) {
          return noAgentResponse(c, site);
        }
        conversation = await continueConversationStart(c.env, {
          conversation,
          siteId: site.id,
          visitorId,
          initialMessage,
          clientMessageId,
          assignmentPolicy: 'preserve',
        });
        return c.json({
          conversation: await conversationDetail(
            c.env.DB,
            conversation,
            30,
            null,
          ),
        });
      }
    }
  }

  const startClaimKey = replay?.reuse_conversation_id
    ? await nextConversationReuseKey(reuseKey, replay.reuse_conversation_id)
    : reuseKey;

  const sourceHash = await requestSourceHash(c.req.raw, visitorId);
  if (
    !(await passesBurstLimit(
      c.env.CONVERSATION_BURST_LIMITER,
      `conversation:${site.id}:${sourceHash}`,
    ))
  ) {
    c.header('Retry-After', '60');
    return error(
      c,
      429,
      'CONVERSATION_RATE_LIMITED',
      'Please wait before starting another conversation.',
    );
  }
  const quotaNow = new Date();
  const creationQuota = await consumeConversationCreationQuota(c.env.DB, {
    siteId: site.id,
    visitorId,
    sourceHash,
    now: quotaNow,
    idempotencyKey: startClaimKey,
    idempotencyExpiresAt: new Date(
      quotaNow.getTime() + CONVERSATION_REUSE_HOURS * 60 * 60 * 1000,
    ).toISOString(),
  });
  if (!creationQuota.allowed) {
    c.header('Retry-After', String(creationQuota.retryAfterSeconds));
    return error(c, 429, creationQuota.code, 'Conversation limit reached.');
  }

  const conversationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const businessDate = routingBusinessDate(new Date(now));
  const expiresAt = conversationExpiresAt(now);

  const inserted = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO conversations (
       id, site_id, visitor_id, status, subject,
       product_id, section_id, section_name, category_id, category_name,
       product_title, product_cover_url, product_href,
       source_handoff_id, start_reuse_key,
       cta_affinity_agent_id, cta_affinity_expires_at,
       started_business_date, expires_at,
       last_message_at, created_at, updated_at
     ) VALUES (
       ?1, ?2, ?3, 'open', ?4,
       ?5, ?6, ?7, ?8, ?9,
       ?10, ?11, ?12,
       ?13, ?14,
       ?15, ?16,
       ?17, ?18,
       ?19, ?19, ?19
     )`,
  )
    .bind(
      conversationId,
      site.id,
      visitor.id,
      product.title.slice(0, 120),
      product.id,
      product.sectionId,
      product.sectionName,
      product.categoryId,
      product.categoryName,
      product.title,
      product.coverUrl,
      product.href,
      sourceHandoffId,
      startClaimKey,
      affinityAgentId,
      affinityExpiresAt,
      businessDate,
      expiresAt,
      now,
    )
    .run();

  if (Number(inserted.meta?.changes ?? 0) !== 1) {
    let conversation = await ownedConversationByReuseKey(
      c.env.DB,
      site.id,
      visitor.external_id,
      startClaimKey,
    );
    if (!conversation) {
      const handoffOwner = await sourceHandoffOwner(
        c.env.DB,
        site.id,
        sourceHandoffId,
      );
      if (handoffOwner?.externalId !== visitorId) {
        return error(
          c,
          409,
          'SOURCE_HANDOFF_ALREADY_USED',
          'Source handoff ID was already used.',
        );
      }
      if (handoffOwner) {
        conversation = await ownedConversation(
          c.env.DB,
          handoffOwner.conversationId,
          site.id,
          visitorId,
        );
      }
    }
    if (!conversation) throw new Error('Conversation start claim failed');

    const handoffOwner = await rememberSourceHandoff(
      c.env.DB,
      site.id,
      sourceHandoffId,
      conversation.id,
      visitorId,
    );
    if (handoffOwner.externalId !== visitorId) {
      return error(
        c,
        409,
        'SOURCE_HANDOFF_ALREADY_USED',
        'Source handoff ID was already used.',
      );
    }
    if (handoffOwner.conversationId !== conversation.id) {
      conversation = await ownedConversation(
        c.env.DB,
        handoffOwner.conversationId,
        site.id,
        visitorId,
      );
    }
    if (!conversation) throw new Error('Conversation replay failed');

    conversation = await continueConversationStart(c.env, {
      conversation,
      siteId: site.id,
      visitorId,
      initialMessage,
      clientMessageId,
      assignmentPolicy: 'complete-new-claim',
    });
    if (!(await reusableConversationIsAvailable(c.env.DB, conversation))) {
      await discardUnassignedConversation(c.env.DB, {
        siteId: site.id,
        conversationId: conversation.id,
        reuseKey: startClaimKey,
        sourceHandoffId,
      });
      return noAgentResponse(c, site);
    }
    return c.json({
      conversation: await conversationDetail(c.env.DB, conversation, 30, null),
    });
  }

  const handoffOwner = await rememberSourceHandoff(
    c.env.DB,
    site.id,
    sourceHandoffId,
    conversationId,
    visitorId,
  );
  if (
    handoffOwner.externalId !== visitorId ||
    handoffOwner.conversationId !== conversationId
  ) {
    await discardUnassignedConversation(c.env.DB, {
      siteId: site.id,
      conversationId,
      reuseKey: startClaimKey,
      sourceHandoffId,
    });
    return error(
      c,
      409,
      'SOURCE_HANDOFF_ALREADY_USED',
      'Source handoff ID was already used.',
    );
  }

  let createdMessage: MessageRow | null = null;
  if (hasInitialMessage && clientMessageId && initialMessage) {
    const persisted = await persistClientMessage(c.env.DB, {
      conversationId,
      senderType: 'visitor',
      senderId: visitor.id,
      body: initialMessage,
      clientMessageId,
    });
    createdMessage = persisted.message;
  }

  const assignment = await assignConversationAgent(c.env.DB, conversationId);
  let conversation: ConversationRow | null = null;

  if (!assignment) {
    await discardUnassignedConversation(c.env.DB, {
      siteId: site.id,
      conversationId,
      reuseKey: startClaimKey,
      sourceHandoffId,
    });
    return noAgentResponse(c, site);
  }

  if (assignment?.newlyAssigned && assignment.assignedAt) {
    const snapshots = await broadcastAssignments(
      c.env,
      assignment.id,
      [conversationId],
      assignment.assignedAt,
      createdMessage ? [assignmentVisitorMessage(createdMessage)] : [],
    );
    conversation = snapshots.find((item) => item.id === conversationId) ?? null;
  } else if (createdMessage) {
    await broadcastRoomSafely(c.env, conversationId, {
      type: 'message',
      message: adminMessage(createdMessage),
    });
    conversation = await broadcastClientConversationEvent(
      c.env,
      conversationId,
      'message.created',
      { message: clientMessage(createdMessage) },
    );
  } else {
    conversation = await ownedConversation(
      c.env.DB,
      conversationId,
      site.id,
      visitorId,
    );
  }

  if (!conversation) throw new Error('Conversation persistence failed');
  return c.json(
    {
      ...(issuedVisitorToken ? { visitorToken: issuedVisitorToken } : {}),
      conversation: await conversationDetail(c.env.DB, conversation, 30, null),
    },
    201,
  );
});

clientApi.post('/client/v1/conversations/:id/messages', async (c) => {
  const body = await readJson<{
    visitorId?: string;
    visitorToken?: string;
    projectId?: string | null;
    clientMessageId?: string;
    body?: string;
  }>(c.req.raw);
  const visitorId = normalizeVisitorId(body?.visitorId);
  const visitorToken = normalizeVisitorToken(
    body?.visitorToken ?? c.req.header('X-CS-Visitor-Token'),
  );
  const clientMessageId = normalizeId(body?.clientMessageId, 160);
  const messageBody = body?.body?.trim();
  if (!visitorId && !visitorToken)
    return error(c, 400, 'INVALID_VISITOR_ID', 'Visitor ID is invalid.');
  if (!clientMessageId) {
    return error(
      c,
      400,
      'INVALID_CLIENT_MESSAGE_ID',
      'Client message ID is invalid.',
    );
  }
  if (!validMessage(messageBody))
    return error(c, 400, 'INVALID_MESSAGE', 'Message is invalid.');

  const site = await findSite(c.env.DB, normalizeProjectId(body?.projectId));
  if (!site)
    return error(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');
  const visitor = await resolveVisitor(c.env.DB, site.id, {
    externalId: visitorId,
    accessToken: visitorToken,
  });
  if (!visitor) {
    return error(
      c,
      401,
      'INVALID_VISITOR_TOKEN',
      'Visitor access token is invalid.',
    );
  }
  const conversation = await ownedConversationForMessageWrite(
    c.env.DB,
    c.req.param('id'),
    site.id,
    visitor.external_id,
  );
  if (!conversation)
    return error(
      c,
      404,
      'CONVERSATION_NOT_FOUND',
      'Conversation was not found.',
    );
  if (conversation.status === 'closed') {
    return error(c, 409, 'CONVERSATION_CLOSED', 'Conversation is closed.');
  }

  const persistedMessage = await persistClientMessage(c.env.DB, {
    conversationId: conversation.id,
    senderType: 'visitor',
    senderId: conversation.visitor_id,
    body: messageBody!,
    clientMessageId,
  });
  if (persistedMessage.duplicate) {
    return c.json({ message: clientMessage(persistedMessage.message) });
  }
  const createdMessage = persistedMessage.message;

  await broadcastRoomSafely(c.env, conversation.id, {
    type: 'message',
    message: adminMessage(createdMessage),
  });
  await broadcastClientConversationEvent(
    c.env,
    conversation.id,
    'message.created',
    { message: clientMessage(createdMessage) },
  );

  return c.json({ message: clientMessage(createdMessage) }, 201);
});

clientApi.post('/client/v1/conversations/:id/read', async (c) => {
  const body = await readJson<{
    visitorId?: string;
    visitorToken?: string;
    projectId?: string | null;
    lastMessageId?: string | null;
  }>(c.req.raw);
  const visitorId = normalizeVisitorId(body?.visitorId);
  const visitorToken = normalizeVisitorToken(
    body?.visitorToken ?? c.req.header('X-CS-Visitor-Token'),
  );
  if (!visitorId && !visitorToken)
    return error(c, 400, 'INVALID_VISITOR_ID', 'Visitor ID is invalid.');
  const site = await findSite(c.env.DB, normalizeProjectId(body?.projectId));
  if (!site)
    return error(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');
  const visitor = await resolveVisitor(c.env.DB, site.id, {
    externalId: visitorId,
    accessToken: visitorToken,
  });
  if (!visitor) {
    return error(
      c,
      401,
      'INVALID_VISITOR_TOKEN',
      'Visitor access token is invalid.',
    );
  }
  const conversation = await ownedAssignedConversation(
    c.env.DB,
    c.req.param('id'),
    site.id,
    visitor.external_id,
  );
  if (!conversation)
    return error(
      c,
      404,
      'CONVERSATION_NOT_FOUND',
      'Conversation was not found.',
    );

  const requestedLastMessageId = normalizeId(body?.lastMessageId, 200);
  const boundary = await c.env.DB.prepare(
    `SELECT id, created_at
     FROM messages
     WHERE conversation_id = ?1 AND sender_type = 'agent'
     ORDER BY CASE WHEN id = ?2 THEN 0 ELSE 1 END,
       created_at DESC, id DESC
     LIMIT 1`,
  )
    .bind(conversation.id, requestedLastMessageId)
    .first<ReadBoundary>();

  const readResult = boundary
    ? await c.env.DB.prepare(
        `UPDATE conversations
         SET visitor_read_through_at = ?2,
             visitor_read_through_id = ?3,
             visitor_read_at = CURRENT_TIMESTAMP,
             visitor_unread_count = (
               SELECT COUNT(*)
               FROM messages
               WHERE conversation_id = ?1
                 AND sender_type = 'agent'
                 AND read_by_visitor_at IS NULL
                 AND (
                   created_at > ?2
                   OR (created_at = ?2 AND id > ?3)
                 )
             ),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?1
           AND (
             visitor_read_through_at IS NULL
             OR visitor_read_through_at < ?2
             OR (
               visitor_read_through_at = ?2
               AND visitor_read_through_id < ?3
             )
           )`,
      )
        .bind(conversation.id, boundary.created_at, boundary.id)
        .run()
    : null;

  if (readResult?.meta.changes) {
    await Promise.all([
      broadcastRoomSafely(c.env, conversation.id, {
        type: 'message.read',
        reader: 'visitor',
        lastMessageId: boundary?.id ?? null,
      }),
      broadcastClientConversationEvent(c.env, conversation.id, 'message.read', {
        reader: 'visitor',
        lastMessageId: boundary?.id ?? null,
      }),
    ]);
  }
  return c.json({ ok: true });
});

clientApi.get('/client/v1/realtime', async (c) => {
  const visitorId = normalizeVisitorId(c.req.query('visitorId'));
  const visitorToken = normalizeVisitorToken(
    c.req.query('visitorToken') ?? c.req.header('X-CS-Visitor-Token'),
  );
  if (!visitorId && !visitorToken)
    return error(c, 400, 'INVALID_VISITOR_ID', 'Visitor ID is invalid.');
  const site = await findSite(
    c.env.DB,
    normalizeProjectId(c.req.query('projectId')),
  );
  if (!site)
    return error(c, 404, 'PROJECT_NOT_FOUND', 'Project was not found.');
  const visitor = await resolveVisitor(c.env.DB, site.id, {
    externalId: visitorId,
    accessToken: visitorToken,
  });
  if (!visitor && visitorToken) {
    return error(
      c,
      401,
      'INVALID_VISITOR_TOKEN',
      'Visitor access token is invalid.',
    );
  }
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return error(c, 426, 'WEBSOCKET_REQUIRED', 'WebSocket upgrade required.');
  }
  return visitorRoom(c.env, site.id, visitor?.external_id ?? visitorId!).fetch(
    c.req.raw,
  );
});

export async function broadcastClientConversationEvent(
  env: ClientBindings,
  conversationId: string,
  type:
    | 'message.created'
    | 'message.read'
    | 'conversation.assigned'
    | 'conversation.closed',
  details: {
    message?: Record<string, unknown>;
    media?: Record<string, unknown>;
    reader?: 'agent' | 'visitor';
    lastMessageId?: string | null;
  } = {},
  options: {
    includeOverview?: boolean;
    previousAgentId?: string | null;
    conversationSnapshot?: ConversationEventSnapshot;
  } = {},
): Promise<ConversationRow | null> {
  const conversation =
    options.conversationSnapshot ??
    (await env.DB.prepare(
      `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent,
         a.name AS agent_name, a.avatar_version AS agent_avatar_version, c.subject,
         c.product_id, c.section_id, c.section_name, c.category_id,
         c.category_name, c.product_title, c.product_cover_url, c.product_href,
         c.expires_at, c.visitor_unread_count, c.agent_unread_count,
         c.last_message_at, c.created_at, c.last_message_preview AS last_message,
         v.external_id, v.display_name AS visitor_name
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       LEFT JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id
       WHERE c.id = ?1
       LIMIT 1`,
    )
      .bind(conversationId)
      .first<ConversationEventSnapshot>());
  if (!conversation) return null;

  if (conversation.external_id) {
    await broadcastVisitorEventSafely(
      env,
      conversation.site_id,
      conversation.external_id,
      {
        type,
        conversationId,
        conversation: conversationSummary(conversation),
        ...details,
      },
    );
  }

  const previousAgentId =
    options.previousAgentId &&
    options.previousAgentId !== conversation.assigned_agent
      ? options.previousAgentId
      : null;
  const includeOverview =
    options.includeOverview ??
    (type === 'conversation.assigned' || type === 'conversation.closed');
  const [overview, previousOverview] = await Promise.all([
    conversation.assigned_agent && includeOverview
      ? loadAgentOverview(env.DB, conversation.assigned_agent)
      : Promise.resolve(null),
    previousAgentId
      ? loadAgentOverview(env.DB, previousAgentId)
      : Promise.resolve(null),
  ]);
  const inboxUpdates: Promise<void>[] = [];
  if (conversation.assigned_agent) {
    inboxUpdates.push(
      broadcastRoomSafely(env, agentInboxRoom(conversation.assigned_agent), {
        type: 'conversation.changed',
        conversationId,
        conversation: agentConversationSummary(conversation),
        ...(overview ? { overview } : {}),
      }),
    );
  }
  if (previousAgentId) {
    inboxUpdates.push(
      broadcastRoomSafely(env, agentInboxRoom(previousAgentId), {
        type: 'conversation.changed',
        conversationId,
        conversation: agentConversationSummary(conversation),
        ...(previousOverview ? { overview: previousOverview } : {}),
      }),
    );
  }
  await Promise.all(inboxUpdates);
  return conversation;
}

async function loadAgentOverview(db: D1Database, agentId: string) {
  const result = await db
    .prepare(
      `SELECT c.status, COUNT(c.id) AS count,
         a.traffic_quota_enabled, a.traffic_quota_total,
         a.traffic_quota_used
       FROM agents a
       LEFT JOIN conversations c
         ON c.assigned_agent = a.id
        AND c.expires_at > CURRENT_TIMESTAMP
       WHERE a.id = ?1
       GROUP BY c.status, a.traffic_quota_enabled,
         a.traffic_quota_total, a.traffic_quota_used`,
    )
    .bind(agentId)
    .all<{
      status: ConversationStatus | null;
      count: number;
      traffic_quota_enabled: number;
      traffic_quota_total: number;
      traffic_quota_used: number;
    }>();
  const counts = { open: 0, pending: 0, closed: 0 };
  for (const row of result.results ?? []) {
    if (row.status) counts[row.status] = Number(row.count ?? 0);
  }
  const quota = result.results?.[0];
  return {
    ...counts,
    total: counts.open + counts.pending + counts.closed,
    trafficQuotaEnabled: quota?.traffic_quota_enabled === 1,
    trafficQuotaTotal: Number(quota?.traffic_quota_total ?? 0),
    trafficQuotaUsed: Number(quota?.traffic_quota_used ?? 0),
    trafficQuotaRemaining: Math.max(
      0,
      Number(quota?.traffic_quota_total ?? 0) -
        Number(quota?.traffic_quota_used ?? 0),
    ),
  };
}

function agentConversationSummary(
  conversation: ConversationRow & { visitor_name?: string | null },
) {
  return {
    id: conversation.id,
    site_id: conversation.site_id,
    visitor_id: conversation.visitor_id,
    status: conversation.status,
    subject: conversation.subject,
    product_id: conversation.product_id,
    section_id: conversation.section_id,
    section_name: conversation.section_name,
    category_id: conversation.category_id,
    category_name: conversation.category_name,
    product_title: conversation.product_title,
    product_cover_url: conversation.product_cover_url,
    product_href: conversation.product_href,
    assigned_agent: conversation.assigned_agent,
    agent_unread_count: Number(conversation.agent_unread_count || 0),
    last_message_at: toIso(conversation.last_message_at),
    created_at: toIso(conversation.created_at),
    expires_at: toIso(conversation.expires_at),
    visitor_name: conversation.visitor_name ?? null,
    last_message: conversation.last_message,
  };
}

function normalizeProjectId(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= 200 ? trimmed : 'default';
}

export function normalizeVisitorId(value?: string | null): string | null {
  const visitorId = value?.trim().toUpperCase() ?? '';
  if (!/^[A-Z0-9]{6}$/u.test(visitorId)) return null;
  const letters = [...visitorId].filter((char) => /[A-Z]/u.test(char)).length;
  const digits = [...visitorId].filter((char) => /[0-9]/u.test(char)).length;
  return letters === 3 && digits === 3 ? visitorId : null;
}

export function normalizeVisitorToken(value?: string | null): string | null {
  const token = value?.trim() ?? '';
  return token.length >= 32 && token.length <= 200 ? token : null;
}

function randomVisitorToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`;
}

function normalizeId(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function normalizeHandoffId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
    normalized,
  )
    ? normalized
    : null;
}

function normalizeProduct(value?: ProductInput): NormalizedProduct | null {
  const id = normalizeId(value?.id, 100);
  return id
    ? {
        id,
        sectionId: '',
        sectionName: null,
        categoryId: null,
        categoryName: null,
        title: '',
        href: '',
        coverUrl: null,
      }
    : null;
}

function validMessage(value?: string): value is string {
  return Boolean(value && value.length <= CLIENT_MESSAGE_LIMIT);
}

async function findSite(
  db: D1Database,
  projectId: string,
): Promise<SiteRow | null> {
  return db
    .prepare(
      `SELECT id, name, no_agent_message, no_agent_message_format
     FROM sites
     WHERE (id = ?1 OR public_key = ?1) AND is_enabled = 1
     LIMIT 1`,
    )
    .bind(projectId)
    .first<SiteRow>();
}

async function findEnabledProduct(
  db: D1Database,
  siteId: string,
  productId: string,
): Promise<NormalizedProduct | null> {
  const row = await db
    .prepare(
      `SELECT id, title, href, cover_url,
         section_id, section_name, category_id, category_name, is_enabled
       FROM product_catalog
       WHERE site_id = ?1 AND id = ?2 AND is_enabled = 1
       LIMIT 1`,
    )
    .bind(siteId, productId)
    .first<{
      id: string;
      title: string;
      href: string | null;
      cover_url: string | null;
      section_id: string | null;
      section_name: string | null;
      category_id: string | null;
      category_name: string | null;
      is_enabled: number;
    }>();
  if (!row || row.is_enabled !== 1 || !row.section_id || !row.title) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    href: row.href ?? '',
    coverUrl: row.cover_url,
    sectionId: row.section_id,
    sectionName: row.section_name,
    categoryId: row.category_id,
    categoryName: row.category_name,
  };
}

async function discardUnassignedConversation(
  db: D1Database,
  input: {
    siteId: string;
    conversationId: string;
    reuseKey: string;
    sourceHandoffId: string;
  },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `DELETE FROM conversation_traffic_receipts
         WHERE conversation_id = ?1 AND site_id = ?2
           AND EXISTS (
             SELECT 1
             FROM conversations
             WHERE id = ?1 AND site_id = ?2 AND assigned_agent IS NULL
           )`,
      )
      .bind(input.conversationId, input.siteId),
    db
      .prepare(
        `DELETE FROM conversation_creation_quota_receipts
         WHERE site_id = ?1 AND reuse_key = ?2
           AND EXISTS (
             SELECT 1
             FROM conversations
             WHERE id = ?3 AND site_id = ?1 AND assigned_agent IS NULL
           )`,
      )
      .bind(input.siteId, input.reuseKey, input.conversationId),
    db
      .prepare(
        `DELETE FROM conversation_source_handoffs
         WHERE site_id = ?1 AND source_handoff_id = ?2
           AND conversation_id = ?3
           AND EXISTS (
             SELECT 1
             FROM conversations
             WHERE id = ?3 AND site_id = ?1 AND assigned_agent IS NULL
           )`,
      )
      .bind(input.siteId, input.sourceHandoffId, input.conversationId),
    db
      .prepare(
        `DELETE FROM conversations
         WHERE id = ?1 AND site_id = ?2 AND assigned_agent IS NULL`,
      )
      .bind(input.conversationId, input.siteId),
  ]);
}

function noAgentResponse(c: Context<ClientEnv>, site: SiteRow) {
  const message = site.no_agent_message?.trim() || DEFAULT_NO_AGENT_MESSAGE;
  const format =
    normalizeNoAgentMessageFormat(site.no_agent_message_format) ?? 'plain';
  return c.json(
    {
      error: {
        code: 'NO_AGENT_AVAILABLE',
        message,
        format,
      },
    },
    503,
  );
}

async function ensureVisitor(
  db: D1Database,
  siteId: string,
  externalId: string,
  accessToken: string | null = null,
): Promise<{ visitor: VisitorRow; accessToken: string | null } | null> {
  const existing = await db
    .prepare(
      `SELECT id, site_id, external_id, expires_at, access_token_hash
       FROM visitors
       WHERE site_id = ?1 AND external_id = ?2
       LIMIT 1`,
    )
    .bind(siteId, externalId)
    .first<VisitorRow>();
  if (existing) {
    let tokenHash = existing.access_token_hash;
    let issuedToken = accessToken;
    if (accessToken) {
      tokenHash = await sha256(accessToken);
      if (
        existing.access_token_hash &&
        existing.access_token_hash !== tokenHash
      ) {
        return null;
      }
    } else if (!existing.access_token_hash) {
      issuedToken = randomVisitorToken();
      tokenHash = await sha256(issuedToken);
    }
    if (!existing.access_token_hash && tokenHash) {
      await db
        .prepare(
          `UPDATE visitors
           SET access_token_hash = ?1
           WHERE id = ?2 AND access_token_hash IS NULL`,
        )
        .bind(tokenHash, existing.id)
        .run();
    }
    await db
      .prepare(
        `UPDATE visitors
         SET last_seen_at = CURRENT_TIMESTAMP, expires_at = ?1
         WHERE id = ?2`,
      )
      .bind(conversationExpiresAt(new Date()), existing.id)
      .run();
    return {
      visitor: { ...existing, access_token_hash: tokenHash },
      accessToken: issuedToken,
    };
  }

  const id = crypto.randomUUID();
  const issuedToken = accessToken ?? randomVisitorToken();
  const tokenHash = await sha256(issuedToken);
  const expiresAt = conversationExpiresAt(new Date());
  const result = await db
    .prepare(
      `INSERT INTO visitors (
       id, site_id, token_hash, access_token_hash,
       display_name, external_id, expires_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)
     ON CONFLICT(site_id, external_id) DO NOTHING
     RETURNING id, site_id, external_id, expires_at, access_token_hash`,
    )
    .bind(id, siteId, tokenHash, tokenHash, externalId, expiresAt)
    .all<VisitorRow>();

  const visitor = result.results?.[0];
  if (visitor) return { visitor, accessToken: issuedToken };
  return ensureVisitor(db, siteId, externalId, accessToken);
}

async function resolveIdentity(
  db: D1Database,
  conversationId: string,
  input: {
    visitorId?: string | null;
    visitorToken?: string | null;
    projectId?: string | null;
  },
): Promise<
  | {
      ok: true;
      site: SiteRow;
      visitorId: string;
      conversation: ConversationRow;
    }
  | { ok: false; status: 400 | 401 | 404; code: string; message: string }
> {
  const visitorId = normalizeVisitorId(input.visitorId);
  const accessToken = normalizeVisitorToken(input.visitorToken);
  if (!visitorId && !accessToken) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_VISITOR_ID',
      message: 'Visitor ID is invalid.',
    };
  }
  const site = await findSite(db, normalizeProjectId(input.projectId));
  if (!site) {
    return {
      ok: false,
      status: 404,
      code: 'PROJECT_NOT_FOUND',
      message: 'Project was not found.',
    };
  }
  const visitor = await resolveVisitor(db, site.id, {
    externalId: visitorId,
    accessToken,
  });
  if (!visitor) {
    return {
      ok: false,
      status: accessToken ? 401 : 404,
      code: accessToken ? 'INVALID_VISITOR_TOKEN' : 'CONVERSATION_NOT_FOUND',
      message: accessToken
        ? 'Visitor access token is invalid.'
        : 'Conversation was not found.',
    };
  }
  const conversation = await ownedAssignedConversation(
    db,
    conversationId,
    site.id,
    visitor.external_id,
  );
  if (!conversation) {
    return {
      ok: false,
      status: 404,
      code: 'CONVERSATION_NOT_FOUND',
      message: 'Conversation was not found.',
    };
  }
  return { ok: true, site, visitorId: visitor.external_id, conversation };
}

export async function resolveVisitor(
  db: D1Database,
  siteId: string,
  input: { externalId: string | null; accessToken: string | null },
): Promise<VisitorRow | null> {
  if (input.accessToken) {
    const tokenHash = await sha256(input.accessToken);
    const visitor = await db
      .prepare(
        `SELECT id, site_id, external_id, expires_at, access_token_hash
         FROM visitors
         WHERE site_id = ?1
           AND access_token_hash = ?2
           AND (?3 IS NULL OR external_id = ?3)
         LIMIT 1`,
      )
      .bind(siteId, tokenHash, input.externalId)
      .first<VisitorRow>();
    return visitor ?? null;
  }
  if (!input.externalId) return null;
  return db
    .prepare(
      `SELECT id, site_id, external_id, expires_at, access_token_hash
       FROM visitors
       WHERE site_id = ?1 AND external_id = ?2
       LIMIT 1`,
    )
    .bind(siteId, input.externalId)
    .first<VisitorRow>();
}

async function ownedConversationForMessageWrite(
  db: D1Database,
  conversationId: string,
  siteId: string,
  visitorId: string,
): Promise<Pick<
  ConversationRow,
  'id' | 'visitor_id' | 'status' | 'assigned_agent'
> | null> {
  return db
    .prepare(
      `SELECT c.id, c.visitor_id, c.status, c.assigned_agent
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       WHERE c.id = ?1 AND c.site_id = ?2 AND v.external_id = ?3
         AND c.expires_at > CURRENT_TIMESTAMP
         AND c.assigned_agent IS NOT NULL
       LIMIT 1`,
    )
    .bind(conversationId, siteId, visitorId)
    .first<
      Pick<ConversationRow, 'id' | 'visitor_id' | 'status' | 'assigned_agent'>
    >();
}

async function ownedConversation(
  db: D1Database,
  conversationId: string,
  siteId: string,
  visitorId: string,
): Promise<ConversationRow | null> {
  return db
    .prepare(
      `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent,
       a.name AS agent_name, a.avatar_version AS agent_avatar_version, c.subject,
       c.product_id, c.section_id, c.section_name, c.category_id,
       c.category_name, c.product_title, c.product_cover_url, c.product_href,
       c.expires_at, c.visitor_unread_count, c.agent_unread_count,
       c.last_message_at, c.created_at, c.last_message_preview AS last_message
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     LEFT JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id
     WHERE c.id = ?1 AND c.site_id = ?2 AND v.external_id = ?3
       AND c.expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    )
    .bind(conversationId, siteId, visitorId)
    .first<ConversationRow>();
}

async function ownedAssignedConversation(
  db: D1Database,
  conversationId: string,
  siteId: string,
  visitorId: string,
): Promise<ConversationRow | null> {
  const conversation = await ownedConversation(
    db,
    conversationId,
    siteId,
    visitorId,
  );
  return conversation?.assigned_agent ? conversation : null;
}

async function reusableConversationIsAvailable(
  db: D1Database,
  conversation: ConversationRow,
): Promise<boolean> {
  if (conversation.status === 'closed') return true;
  if (!conversation.assigned_agent) return false;
  const agent = await db
    .prepare(
      `SELECT 1 AS available
       FROM agents
       WHERE id = ?1
         AND site_id = ?2
         AND is_enabled = 1
         AND status = 'online'
       LIMIT 1`,
    )
    .bind(conversation.assigned_agent, conversation.site_id)
    .first<{ available: number }>();
  return agent?.available === 1;
}

function isAfterReuseBoundary(value: string): boolean {
  const timestamp = new Date(toIso(value) ?? '').getTime();
  return (
    Number.isFinite(timestamp) &&
    timestamp > Date.now() - CONVERSATION_REUSE_HOURS * 60 * 60 * 1000
  );
}

async function conversationReuseKey(
  siteId: string,
  visitorId: string,
  productId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      `cta-reuse-v1\n${siteId}\n${visitorId}\n${productId}`,
    ),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function nextConversationReuseKey(
  reuseKey: string,
  previousConversationId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      `cta-reuse-next-v1\n${reuseKey}\n${previousConversationId}`,
    ),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

type SourceHandoffOwner = {
  conversationId: string;
  externalId: string;
};

async function sourceHandoffOwner(
  db: D1Database,
  siteId: string,
  sourceHandoffId: string,
): Promise<SourceHandoffOwner | null> {
  return db
    .prepare(
      `SELECT conversationId, externalId
       FROM (
         SELECT h.conversation_id AS conversationId,
           v.external_id AS externalId,
           0 AS priority
         FROM conversation_source_handoffs h
         JOIN conversations c ON c.id = h.conversation_id
         JOIN visitors v ON v.id = c.visitor_id
         WHERE h.site_id = ?1 AND h.source_handoff_id = ?2
         UNION ALL
         SELECT c.id AS conversationId,
           v.external_id AS externalId,
           1 AS priority
         FROM conversations c
         JOIN visitors v ON v.id = c.visitor_id
         WHERE c.site_id = ?1 AND c.source_handoff_id = ?2
       )
       ORDER BY priority ASC
       LIMIT 1`,
    )
    .bind(siteId, sourceHandoffId)
    .first<SourceHandoffOwner>();
}

async function rememberSourceHandoff(
  db: D1Database,
  siteId: string,
  sourceHandoffId: string,
  conversationId: string,
  externalId: string,
): Promise<SourceHandoffOwner> {
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO conversation_source_handoffs (
         site_id, source_handoff_id, conversation_id
       ) VALUES (?1, ?2, ?3)
       RETURNING conversation_id AS conversationId`,
    )
    .bind(siteId, sourceHandoffId, conversationId)
    .first<{ conversationId: string }>();

  if (inserted?.conversationId === conversationId) {
    return { conversationId, externalId };
  }

  const owner = await sourceHandoffOwner(db, siteId, sourceHandoffId);
  if (!owner) throw new Error('Source handoff persistence failed');
  return owner;
}

async function ownedConversationByReuseKey(
  db: D1Database,
  siteId: string,
  visitorId: string,
  reuseKey: string,
): Promise<ConversationRow | null> {
  return db
    .prepare(
      `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent,
       a.name AS agent_name, a.avatar_version AS agent_avatar_version, c.subject,
       c.product_id, c.section_id, c.section_name, c.category_id,
       c.category_name, c.product_title, c.product_cover_url, c.product_href,
       c.expires_at, c.visitor_unread_count, c.agent_unread_count,
       c.last_message_at, c.created_at, c.last_message_preview AS last_message
     FROM conversations c
     JOIN visitors v ON v.id = c.visitor_id
     LEFT JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id
     WHERE c.site_id = ?1
       AND v.external_id = ?2
       AND c.start_reuse_key = ?3
       AND c.expires_at > CURRENT_TIMESTAMP
     LIMIT 1`,
    )
    .bind(siteId, visitorId, reuseKey)
    .first<ConversationRow>();
}

async function continueConversationStart(
  env: ClientBindings,
  input: {
    conversation: ConversationRow;
    siteId: string;
    visitorId: string;
    initialMessage: string | null;
    clientMessageId: string | null;
    assignmentPolicy: 'preserve' | 'complete-new-claim';
  },
): Promise<ConversationRow> {
  let conversation = input.conversation;
  let createdMessage: MessageRow | null = null;

  if (input.assignmentPolicy === 'preserve' && !conversation.assigned_agent) {
    return conversation;
  }

  if (input.initialMessage && input.clientMessageId) {
    const persisted = await persistClientMessage(env.DB, {
      conversationId: conversation.id,
      senderType: 'visitor',
      senderId: conversation.visitor_id,
      body: input.initialMessage,
      clientMessageId: input.clientMessageId,
    });
    if (!persisted.duplicate) {
      createdMessage = persisted.message;
    }
  }

  const assignment =
    input.assignmentPolicy === 'complete-new-claim' &&
    !conversation.assigned_agent
      ? await assignConversationAgent(env.DB, conversation.id)
      : null;
  if (assignment?.newlyAssigned && assignment.assignedAt) {
    const snapshots = await broadcastAssignments(
      env,
      assignment.id,
      [conversation.id],
      assignment.assignedAt,
      createdMessage ? [assignmentVisitorMessage(createdMessage)] : [],
    );
    conversation =
      snapshots.find((item) => item.id === conversation.id) ?? conversation;
  } else if (createdMessage) {
    await broadcastRoomSafely(env, conversation.id, {
      type: 'message',
      message: adminMessage(createdMessage),
    });
    conversation =
      (await broadcastClientConversationEvent(
        env,
        conversation.id,
        'message.created',
        { message: clientMessage(createdMessage) },
      )) ?? conversation;
  }

  if (assignment && !conversation.assigned_agent) {
    conversation =
      (await ownedConversation(
        env.DB,
        conversation.id,
        input.siteId,
        input.visitorId,
      )) ?? conversation;
  }

  return conversation;
}

function conversationSummary(conversation: ConversationRow) {
  return {
    id: conversation.id,
    agentName: conversation.agent_name,
    agentAvatarUrl:
      conversation.assigned_agent && conversation.agent_avatar_version
        ? `/client/v1/avatars/${encodeURIComponent(conversation.assigned_agent)}?v=${encodeURIComponent(conversation.agent_avatar_version)}`
        : null,
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
  const result = await db
    .prepare(
      `SELECT m.id, m.conversation_id, m.sender_type, m.sender_id, m.body,
       m.client_message_id,
       COALESCE(
         m.read_by_visitor_at,
         CASE
           WHEN m.sender_type = 'agent'
             AND c.visitor_read_through_at IS NOT NULL
             AND (
               m.created_at < c.visitor_read_through_at
               OR (
                 m.created_at = c.visitor_read_through_at
                 AND m.id <= c.visitor_read_through_id
               )
             )
             THEN c.visitor_read_at
         END
       ) AS read_by_visitor_at,
       COALESCE(
         m.read_by_agent_at,
         CASE
           WHEN m.sender_type = 'visitor'
             AND c.agent_read_through_at IS NOT NULL
             AND (
               m.created_at < c.agent_read_through_at
               OR (
                 m.created_at = c.agent_read_through_at
                 AND m.id <= c.agent_read_through_id
               )
             )
             THEN c.agent_read_at
         END
       ) AS read_by_agent_at,
       m.created_at
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.conversation_id = ?1
       AND (?2 IS NULL OR m.created_at < ?2)
     ORDER BY m.created_at DESC, m.id DESC
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
      conversation.expires_at ??
        addHours(conversation.created_at, VISITOR_LIFETIME_HOURS),
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
): Promise<{ message: MessageRow; duplicate: boolean }> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO messages (
         id, conversation_id, sender_type, sender_id, body, client_message_id, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
      .bind(
        id,
        input.conversationId,
        input.senderType,
        input.senderId,
        input.body,
        input.clientMessageId,
        createdAt,
      ),
    db
      .prepare(
        `UPDATE conversations
       SET agent_unread_count = agent_unread_count + 1,
           last_message_at = ?1, last_message_preview = ?2, updated_at = ?1
       WHERE id = ?3
         AND EXISTS (SELECT 1 FROM messages WHERE id = ?4)`,
      )
      .bind(createdAt, input.body, input.conversationId, id),
  ]);

  if (!inserted?.meta.changes) {
    const existing = await db
      .prepare(
        `SELECT id, conversation_id, sender_type, sender_id, body, client_message_id,
         read_by_visitor_at, read_by_agent_at, created_at
       FROM messages
       WHERE conversation_id = ?1 AND client_message_id = ?2
       LIMIT 1`,
      )
      .bind(input.conversationId, input.clientMessageId)
      .first<MessageRow>();
    if (!existing) throw new Error('Message persistence conflict');
    return { message: existing, duplicate: true };
  }

  const message: MessageRow = {
    id,
    conversation_id: input.conversationId,
    sender_type: input.senderType,
    sender_id: input.senderId,
    body: input.body,
    client_message_id: input.clientMessageId,
    read_by_visitor_at: null,
    read_by_agent_at: null,
    created_at: createdAt,
  };
  return { message, duplicate: false };
}

function assignmentVisitorMessage(
  message: MessageRow,
): AssignmentVisitorMessage {
  if (message.sender_type !== 'visitor' || !message.sender_id) {
    throw new Error('Assignment visitor message invariant failed');
  }
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_type: 'visitor',
    sender_id: message.sender_id,
    body: message.body,
    client_message_id: message.client_message_id,
    read_by_visitor_at: null,
    read_by_agent_at: null,
    created_at: message.created_at,
  };
}

function clientMessage(message: MessageRow) {
  const delivery =
    message.sender_type === 'visitor'
      ? message.read_by_agent_at
        ? 'read'
        : 'sent'
      : message.read_by_visitor_at
        ? 'read'
        : 'sent';
  return {
    id: message.id,
    direction: message.sender_type === 'agent' ? 'agent' : 'customer',
    body: message.body,
    sentAt: toIso(message.created_at)!,
    delivery,
    attachments: [],
  };
}

function adminMessage(message: MessageRow) {
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_type: message.sender_type,
    sender_id: message.sender_id,
    body: message.body,
    read_by_visitor_at: message.read_by_visitor_at,
    read_by_agent_at: message.read_by_agent_at,
    created_at: message.created_at,
  };
}

function publicStatus(status: ConversationStatus): 'active' | 'closed' {
  if (status === 'closed') return 'closed';
  return 'active';
}

function clampLimit(raw?: string): number {
  const value = Number.parseInt(raw ?? '30', 10);
  if (!Number.isFinite(value)) return 30;
  return Math.min(50, Math.max(1, value));
}

function visitorRoom(
  env: ClientBindings,
  siteId: string,
  visitorId: string,
): DurableObjectStub {
  return room(env, `client:${siteId}:${visitorId}`);
}

function room(env: ClientBindings, name: string): DurableObjectStub {
  return env.CONVERSATION_ROOMS.get(env.CONVERSATION_ROOMS.idFromName(name));
}

function agentInboxRoom(agentId: string): string {
  return `agent-inbox:${agentId}`;
}

async function broadcastVisitorEvent(
  env: ClientBindings,
  siteId: string,
  visitorId: string,
  payload: unknown,
): Promise<void> {
  await broadcastRoom(env, `client:${siteId}:${visitorId}`, payload);
}

async function broadcastVisitorEventSafely(
  env: ClientBindings,
  siteId: string,
  visitorId: string,
  payload: unknown,
): Promise<void> {
  try {
    await broadcastVisitorEvent(env, siteId, visitorId, payload);
  } catch (error) {
    console.warn('visitor conversation broadcast failed', error);
  }
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

async function broadcastRoomSafely(
  env: ClientBindings,
  name: string,
  payload: unknown,
): Promise<void> {
  try {
    await broadcastRoom(env, name, payload);
  } catch (error) {
    console.warn('conversation room broadcast failed', error);
  }
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function error(
  c: Context<ClientEnv>,
  status: 400 | 401 | 404 | 409 | 426 | 429 | 503,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}
