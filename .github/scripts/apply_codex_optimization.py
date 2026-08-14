from __future__ import annotations

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex match, found {count}: {pattern!r}")
    write(path, updated)


# ---------------------------------------------------------------------------
# 1) WebSocket-first realtime transport and request reduction.
# ---------------------------------------------------------------------------

replace_once(
    "src/worker/client-api.ts",
    """  status: ConversationStatus;\n  assigned_agent: string | null;\n  subject: string | null;""",
    """  status: ConversationStatus;\n  assigned_agent: string | null;\n  agent_name: string | null;\n  subject: string | null;""",
)
replace_once(
    "src/worker/client-api.ts",
    """  expires_at: string | null;\n  visitor_unread_count: number;\n  last_message_at: string;""",
    """  expires_at: string | null;\n  visitor_unread_count: number;\n  agent_unread_count: number;\n  last_message_at: string;""",
)

replace_once(
    "src/worker/client-api.ts",
    """    `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent, c.subject,\n       c.group_id, c.product_id, c.section_id, c.section_name, c.category_id,\n       c.category_name, c.product_title, c.product_cover_url, c.product_href,\n       c.expires_at, c.visitor_unread_count, c.last_message_at, c.created_at,\n       (SELECT body FROM messages m WHERE m.conversation_id = c.id\n         ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message\n     FROM conversations c\n     JOIN visitors v ON v.id = c.visitor_id\n     WHERE c.site_id = ?1""",
    """    `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent,\n       a.name AS agent_name, c.subject, c.group_id, c.product_id, c.section_id,\n       c.section_name, c.category_id, c.category_name, c.product_title,\n       c.product_cover_url, c.product_href, c.expires_at,\n       c.visitor_unread_count, c.agent_unread_count, c.last_message_at,\n       c.created_at,\n       (SELECT body FROM messages m WHERE m.conversation_id = c.id\n         ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message\n     FROM conversations c\n     JOIN visitors v ON v.id = c.visitor_id\n     LEFT JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id\n     WHERE c.site_id = ?1""",
)

replace_once(
    "src/worker/client-api.ts",
    """  await broadcastRoom(c.env, conversationId, {\n    type: 'message',\n    message: adminMessage(createdMessage),\n  });\n  await broadcastVisitorEvent(c.env, site.id, visitorId, {\n    type: 'message.created',\n    conversationId,\n  });\n  await broadcastRoom(c.env, 'admin-inbox', {\n    type: 'conversation.changed',\n    conversationId,\n  });""",
    """  await broadcastRoom(c.env, conversationId, {\n    type: 'message',\n    message: adminMessage(createdMessage),\n  });\n  await broadcastClientConversationEvent(c.env, conversationId, 'message.created', {\n    message: clientMessage(createdMessage),\n  });""",
)

replace_once(
    "src/worker/client-api.ts",
    """  const createdMessage = await persistClientMessage(c.env.DB, {\n    conversationId: conversation.id,\n    senderType: 'visitor',\n    senderId: conversation.visitor_id,\n    body: messageBody!,\n    clientMessageId,\n  });\n  await c.env.DB.prepare(\n    'UPDATE visitors SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1',\n  )\n    .bind(conversation.visitor_id)\n    .run();\n\n  await broadcastRoom(c.env, conversation.id, {\n    type: 'message',\n    message: adminMessage(createdMessage),\n  });\n  await broadcastVisitorEvent(c.env, site.id, visitorId, {\n    type: 'message.created',\n    conversationId: conversation.id,\n  });\n  await broadcastRoom(c.env, 'admin-inbox', {\n    type: 'conversation.changed',\n    conversationId: conversation.id,\n  });""",
    """  const createdMessage = await persistClientMessage(c.env.DB, {\n    conversationId: conversation.id,\n    senderType: 'visitor',\n    senderId: conversation.visitor_id,\n    body: messageBody!,\n    clientMessageId,\n  });\n  await c.env.DB.prepare(\n    'UPDATE visitors SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?1',\n  )\n    .bind(conversation.visitor_id)\n    .run();\n\n  if (!conversation.assigned_agent) {\n    await assignConversationAgent(c.env.DB, conversation.id);\n  }\n  await broadcastRoom(c.env, conversation.id, {\n    type: 'message',\n    message: adminMessage(createdMessage),\n  });\n  await broadcastClientConversationEvent(\n    c.env,\n    conversation.id,\n    'message.created',\n    { message: clientMessage(createdMessage) },\n  );""",
)

replace_once(
    "src/worker/client-api.ts",
    """      broadcastClientConversationEvent(c.env, conversation.id, 'message.read'),""",
    """      broadcastClientConversationEvent(c.env, conversation.id, 'message.read', {\n        reader: 'visitor',\n        lastMessageId: boundary?.id ?? null,\n      }),""",
)

regex_once(
    "src/worker/client-api.ts",
    r"export async function broadcastClientConversationEvent\([\s\S]*?\n}\n\nfunction managementAuthorized",
    """export async function broadcastClientConversationEvent(\n  env: ClientBindings,\n  conversationId: string,\n  type:\n    | 'message.created'\n    | 'message.read'\n    | 'conversation.assigned'\n    | 'conversation.closed',\n  details: {\n    message?: Record<string, unknown>;\n    media?: Record<string, unknown>;\n    reader?: 'agent' | 'visitor';\n    lastMessageId?: string | null;\n  } = {},\n): Promise<void> {\n  const conversation = await env.DB.prepare(\n    `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent,\n       a.name AS agent_name, c.subject, c.group_id, c.product_id, c.section_id,\n       c.section_name, c.category_id, c.category_name, c.product_title,\n       c.product_cover_url, c.product_href, c.expires_at,\n       c.visitor_unread_count, c.agent_unread_count, c.last_message_at,\n       c.created_at, v.external_id, v.display_name AS visitor_name,\n       (SELECT body FROM messages m WHERE m.conversation_id = c.id\n         ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message\n     FROM conversations c\n     JOIN visitors v ON v.id = c.visitor_id\n     LEFT JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id\n     WHERE c.id = ?1\n     LIMIT 1`,\n  )\n    .bind(conversationId)\n    .first<\n      ConversationRow & { external_id: string | null; visitor_name: string | null }\n    >();\n  if (!conversation) return;\n\n  if (conversation.external_id) {\n    await broadcastVisitorEvent(\n      env,\n      conversation.site_id,\n      conversation.external_id,\n      {\n        type,\n        conversationId,\n        conversation: conversationSummary(conversation),\n        ...details,\n      },\n    );\n  }\n\n  const overview = conversation.assigned_agent\n    ? await loadAgentOverview(env.DB, conversation.assigned_agent)\n    : null;\n  await broadcastRoom(env, 'admin-inbox', {\n    type: 'conversation.changed',\n    conversationId,\n    conversation: agentConversationSummary(conversation),\n    overview,\n  });\n}\n\nasync function loadAgentOverview(db: D1Database, agentId: string) {\n  const result = await db\n    .prepare(\n      `SELECT status, COUNT(*) AS count\n       FROM conversations\n       WHERE assigned_agent = ?1\n         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP\n       GROUP BY status`,\n    )\n    .bind(agentId)\n    .all<{ status: ConversationStatus; count: number }>();\n  const counts = { open: 0, pending: 0, closed: 0 };\n  for (const row of result.results ?? []) {\n    counts[row.status] = Number(row.count ?? 0);\n  }\n  return {\n    ...counts,\n    total: counts.open + counts.pending + counts.closed,\n  };\n}\n\nfunction agentConversationSummary(\n  conversation: ConversationRow & { visitor_name?: string | null },\n) {\n  return {\n    id: conversation.id,\n    site_id: conversation.site_id,\n    visitor_id: conversation.visitor_id,\n    status: conversation.status,\n    subject: conversation.subject,\n    group_id: conversation.group_id,\n    product_id: conversation.product_id,\n    product_title: conversation.product_title,\n    product_cover_url: conversation.product_cover_url,\n    product_href: conversation.product_href,\n    assigned_agent: conversation.assigned_agent,\n    agent_unread_count: Number(conversation.agent_unread_count || 0),\n    last_message_at: toIso(conversation.last_message_at),\n    created_at: toIso(conversation.created_at),\n    expires_at: toIso(conversation.expires_at),\n    visitor_name: conversation.visitor_name ?? null,\n    last_message: conversation.last_message,\n  };\n}\n\nfunction managementAuthorized""",
)

replace_once(
    "src/worker/client-api.ts",
    """    `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent, c.subject,\n       c.group_id, c.product_id, c.section_id, c.section_name, c.category_id,\n       c.category_name, c.product_title, c.product_cover_url, c.product_href,\n       c.expires_at, c.visitor_unread_count, c.last_message_at, c.created_at,\n       (SELECT body FROM messages m WHERE m.conversation_id = c.id\n         ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message\n     FROM conversations c\n     JOIN visitors v ON v.id = c.visitor_id\n     WHERE c.id = ?1 AND c.site_id = ?2 AND v.external_id = ?3""",
    """    `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent,\n       a.name AS agent_name, c.subject, c.group_id, c.product_id, c.section_id,\n       c.section_name, c.category_id, c.category_name, c.product_title,\n       c.product_cover_url, c.product_href, c.expires_at,\n       c.visitor_unread_count, c.agent_unread_count, c.last_message_at,\n       c.created_at,\n       (SELECT body FROM messages m WHERE m.conversation_id = c.id\n         ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS last_message\n     FROM conversations c\n     JOIN visitors v ON v.id = c.visitor_id\n     LEFT JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id\n     WHERE c.id = ?1 AND c.site_id = ?2 AND v.external_id = ?3""",
)
replace_once(
    "src/worker/client-api.ts",
    """    agentName: null,""",
    """    agentName: conversation.agent_name,""",
)
replace_once(
    "src/worker/client-api.ts",
    """    delivery,\n  };\n}""",
    """    delivery,\n    attachments: [],\n  };\n}""",
)

# Remove the duplicate post-route assignment middleware. client-api now returns
# the assigned agent in its own response and broadcasts one enriched event.
replace_once(
    "src/worker/entry.ts",
    """import legacyApp, { ConversationRoom } from './index';\nimport { clientApi, broadcastClientConversationEvent } from './client-api';\nimport { integrationApi } from './integration-api';\nimport { assignConversationAgent } from './routing';""",
    """import legacyApp, { ConversationRoom } from './index';\nimport { clientApi } from './client-api';\nimport { integrationApi } from './integration-api';""",
)
regex_once(
    "src/worker/entry.ts",
    r"type CreatedConversationPayload = \{[\s\S]*?\n};\n\n",
    "",
)
replace_once(
    "src/worker/entry.ts",
    """const AGENT_TEXT_MESSAGE_PATH =\n  /^\\/api\\/agent\\/conversations\\/([^/]+)\\/messages$/u;""",
    """const AGENT_TEXT_MESSAGE_PATH =\n  /^\\/api\\/agent\\/conversations\\/([^/]+)\\/messages$/u;""",
)
regex_once(
    "src/worker/entry.ts",
    r"// Storefront creates conversations directly on this service\.[\s\S]*?\n// Agent replies are persisted by the existing APIs first\.",
    """// Storefront conversations are created, routed, and broadcast inside clientApi.\n// Keeping the whole transaction there avoids a second assignment/read pass.\n\n// Agent replies are persisted by the existing APIs first.""",
)
regex_once(
    "src/worker/entry.ts",
    r"\nasync function broadcastAgentInbox\([\s\S]*?\n}\n\nexport default",
    "\nexport default",
)

# Agent API: include realtime read/message payloads, use authenticated WebSocket
# pings for presence, and wake waiting conversations when capacity is released.
replace_once(
    "src/worker/agent-api.ts",
    """      broadcastClientConversationEvent(c.env, id, 'message.read'),""",
    """      broadcastClientConversationEvent(c.env, id, 'message.read', {\n        reader: 'agent',\n        lastMessageId: boundary?.id ?? null,\n      }),""",
)
replace_once(
    "src/worker/agent-api.ts",
    """  await broadcastConversationRoom(c.env, id, { type: 'message', message });\n  await broadcastClientConversationEvent(c.env, id, 'message.created');\n  return c.json({ message }, 201);""",
    """  await broadcastConversationRoom(c.env, id, { type: 'message', message });\n  await broadcastClientConversationEvent(c.env, id, 'message.created', {\n    message: message ? clientRealtimeMessage(message) : undefined,\n  });\n  return c.json({ message }, 201);""",
)
replace_once(
    "src/worker/agent-api.ts",
    """  await broadcastClientConversationEvent(\n    c.env,\n    id,\n    body.status === 'closed' ? 'conversation.closed' : 'conversation.assigned',\n  );\n  return c.json({ ok: true });""",
    """  await broadcastClientConversationEvent(\n    c.env,\n    id,\n    body.status === 'closed' ? 'conversation.closed' : 'conversation.assigned',\n  );\n  if (body.status === 'closed') {\n    await assignWaitingConversations(c.env, agent.id);\n  }\n  return c.json({ ok: true });""",
)
replace_once(
    "src/worker/agent-api.ts",
    """agentApi.get('/api/agent/realtime/inbox', async (c) => {\n  const agent = await authenticateAgent(c);\n  if (!agent) return unauthorized(c);\n  return room(c.env, 'admin-inbox').fetch(c.req.raw);\n});""",
    """agentApi.get('/api/agent/realtime/inbox', async (c) => {\n  const agent = await authenticateAgent(c);\n  if (!agent) return unauthorized(c);\n  return room(c.env, 'admin-inbox').fetch(\n    authenticatedRealtimeRequest(c.req.raw, agent.id),\n  );\n});""",
)
replace_once(
    "src/worker/agent-api.ts",
    """  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);\n  return room(c.env, c.req.param('id')).fetch(c.req.raw);\n});""",
    """  if (!conversation) return c.json({ error: 'NOT_FOUND' }, 404);\n  return room(c.env, c.req.param('id')).fetch(\n    authenticatedRealtimeRequest(c.req.raw, agent.id),\n  );\n});""",
)

regex_once(
    "src/worker/agent-api.ts",
    r"async function assignWaitingConversations\([\s\S]*?\n}\n\nasync function sha256",
    """async function assignWaitingConversations(\n  env: Bindings,\n  agentId: string,\n): Promise<void> {\n  const waiting = await env.DB.prepare(\n    `SELECT DISTINCT c.id\n     FROM conversations c\n     WHERE c.assigned_agent IS NULL\n       AND c.status IN ('open', 'pending')\n       AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       AND (\n         EXISTS (\n           SELECT 1\n           FROM agent_routing_scopes ars\n           WHERE ars.site_id = c.site_id\n             AND ars.agent_id = ?1\n             AND ars.is_enabled = 1\n             AND (\n               (ars.scope_type = 'product' AND ars.product_id = c.product_id)\n               OR (ars.scope_type = 'section' AND ars.section_id = c.section_id)\n               OR (\n                 ars.scope_type = 'category'\n                 AND ars.section_id = c.section_id\n                 AND ars.category_id = c.category_id\n               )\n             )\n         )\n         OR (\n           NOT EXISTS (\n             SELECT 1\n             FROM agent_routing_scopes configured\n             WHERE configured.site_id = c.site_id\n               AND configured.is_enabled = 1\n               AND (\n                 (configured.scope_type = 'product' AND configured.product_id = c.product_id)\n                 OR (configured.scope_type = 'section' AND configured.section_id = c.section_id)\n                 OR (\n                   configured.scope_type = 'category'\n                   AND configured.section_id = c.section_id\n                   AND configured.category_id = c.category_id\n                 )\n               )\n           )\n           AND EXISTS (\n             SELECT 1\n             FROM group_agents ga\n             JOIN support_groups sg\n               ON sg.site_id = ga.site_id AND sg.id = ga.group_id\n             WHERE ga.site_id = c.site_id\n               AND ga.group_id = c.group_id\n               AND ga.agent_id = ?1\n               AND ga.is_enabled = 1\n               AND sg.is_enabled = 1\n           )\n         )\n       )\n     ORDER BY c.last_message_at ASC\n     LIMIT 20`,\n  )\n    .bind(agentId)\n    .all<{ id: string }>();\n\n  for (const conversation of waiting.results ?? []) {\n    const assignment = await assignConversationAgent(env.DB, conversation.id);\n    if (!assignment) continue;\n    await broadcastClientConversationEvent(\n      env,\n      conversation.id,\n      'conversation.assigned',\n    );\n  }\n}\n\nasync function sha256""",
)

replace_once(
    "src/worker/agent-api.ts",
    """function normalizeMessageId(value?: string | null): string | null {\n  const trimmed = value?.trim() ?? '';\n  return trimmed && trimmed.length <= 200 ? trimmed : null;\n}\n\nfunction room(env: Bindings, id: string): DurableObjectStub {""",
    """function normalizeMessageId(value?: string | null): string | null {\n  const trimmed = value?.trim() ?? '';\n  return trimmed && trimmed.length <= 200 ? trimmed : null;\n}\n\nfunction clientRealtimeMessage(message: MessageRow) {\n  const sentAt = /^\\d{4}-\\d{2}-\\d{2}T/u.test(message.created_at)\n    ? message.created_at\n    : `${message.created_at.replace(' ', 'T')}Z`;\n  return {\n    id: message.id,\n    direction: message.sender_type === 'agent' ? 'agent' : 'customer',\n    body: message.body,\n    sentAt,\n    delivery:\n      message.sender_type === 'agent' && message.read_by_visitor_at\n        ? 'read'\n        : message.sender_type === 'visitor' && message.read_by_agent_at\n          ? 'read'\n          : 'sent',\n    attachments: [],\n  };\n}\n\nfunction authenticatedRealtimeRequest(request: Request, agentId: string): Request {\n  const url = new URL(request.url);\n  url.searchParams.set('agentId', agentId);\n  return new Request(url, request);\n}\n\nfunction room(env: Bindings, id: string): DurableObjectStub {""",
)

# Durable Object WebSocket pings now own agent presence freshness, avoiding a
# periodic HTTP heartbeat request from every open agent workspace.
replace_once(
    "src/worker/index.ts",
    """    const pair = new WebSocketPair();\n    const [client, server] = Object.values(pair);\n    this.ctx.acceptWebSocket(server);\n    server.serializeAttachment({ connectedAt: Date.now() });\n    server.send(\n      JSON.stringify({ type: 'ready', time: new Date().toISOString() }),\n    );\n    return new Response(null, { status: 101, webSocket: client });\n  }\n\n  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {\n    if (message === 'ping') {\n      socket.send(\n        JSON.stringify({ type: 'pong', time: new Date().toISOString() }),\n      );\n    }\n  }""",
    """    const pair = new WebSocketPair();\n    const [client, server] = Object.values(pair);\n    const agentId = url.searchParams.get('agentId')?.trim() || null;\n    this.ctx.acceptWebSocket(server);\n    server.serializeAttachment({ connectedAt: Date.now(), agentId });\n    if (agentId) await this.touchAgent(agentId);\n    server.send(\n      JSON.stringify({ type: 'ready', time: new Date().toISOString() }),\n    );\n    return new Response(null, { status: 101, webSocket: client });\n  }\n\n  async webSocketMessage(\n    socket: WebSocket,\n    message: string | ArrayBuffer,\n  ): Promise<void> {\n    if (message !== 'ping') return;\n    const attachment = socket.deserializeAttachment() as\n      | { agentId?: string | null }\n      | null;\n    if (attachment?.agentId) await this.touchAgent(attachment.agentId);\n    socket.send(\n      JSON.stringify({ type: 'pong', time: new Date().toISOString() }),\n    );\n  }\n\n  private async touchAgent(agentId: string): Promise<void> {\n    await this.env.DB.prepare(\n      `UPDATE agents\n       SET status = 'online', last_seen_at = CURRENT_TIMESTAMP,\n           updated_at = CURRENT_TIMESTAMP\n       WHERE id = ?1 AND is_enabled = 1`,\n    )\n      .bind(agentId)\n      .run();\n  }""",
)

# Media realtime events carry enough data to update both chat clients locally.
replace_once(
    "src/worker/media-store.ts",
    """    broadcastRoom(env, media.conversation_id, {\n      type: 'message',\n      message: {\n        id: messageId,\n        conversation_id: media.conversation_id,\n        sender_type: media.sender_type,\n        sender_id: media.sender_id,\n        body: '',\n        kind: 'image',\n        created_at: createdAt,\n      },\n    }),\n    broadcastClientConversationEvent(\n      env,\n      media.conversation_id,\n      'message.created',\n    ),\n    broadcastRoom(env, 'admin-inbox', {\n      type: 'conversation.changed',\n      conversationId: media.conversation_id,\n    }),""",
    """    broadcastRoom(env, media.conversation_id, {\n      type: 'message',\n      message: {\n        id: messageId,\n        conversation_id: media.conversation_id,\n        sender_type: media.sender_type,\n        sender_id: media.sender_id,\n        body: '',\n        kind: 'image',\n        created_at: createdAt,\n      },\n      media: {\n        messageId,\n        ...publicMedia({ ...media, message_id: messageId, status: 'ready' }),\n      },\n    }),\n    broadcastClientConversationEvent(\n      env,\n      media.conversation_id,\n      'message.created',\n      {\n        message: {\n          id: messageId,\n          direction: media.sender_type === 'agent' ? 'agent' : 'customer',\n          body: '',\n          sentAt: createdAt,\n          delivery: 'sent',\n          attachments: [],\n        },\n        media: {\n          messageId,\n          ...publicMedia({ ...media, message_id: messageId, status: 'ready' }),\n        },\n      },\n    ),""",
)
replace_once(
    "src/worker/media-store.ts",
    """        await Promise.all([\n          broadcastClientConversationEvent(\n            env,\n            media.conversation_id,\n            'conversation.assigned',\n          ),\n          broadcastRoom(env, 'admin-inbox', {\n            type: 'conversation.changed',\n            conversationId: media.conversation_id,\n          }),\n        ]);""",
    """        await broadcastClientConversationEvent(\n          env,\n          media.conversation_id,\n          'conversation.assigned',\n        );""",
)
replace_once(
    "src/worker/media-store.ts",
    """      messageId,\n      media: publicMedia({ ...media, message_id: messageId, status: 'ready' }),""",
    """      messageId,\n      createdAt,\n      media: publicMedia({ ...media, message_id: messageId, status: 'ready' }),""",
)

# Dashboard API: one WS keepalive socket sends ping frames; no periodic HTTP beat.
replace_once(
    "src/dashboard/api.ts",
    """export function openAgentInboxSocket(): WebSocket {\n  return openSocket('/api/agent/realtime/inbox');\n}\n\nexport function openConversationSocket(id: string): WebSocket {\n  return openSocket(`/api/agent/realtime/${encodeURIComponent(id)}`);\n}""",
    """export function openAgentInboxSocket(): WebSocket {\n  return openSocket('/api/agent/realtime/inbox', true);\n}\n\nexport function openConversationSocket(id: string): WebSocket {\n  return openSocket(`/api/agent/realtime/${encodeURIComponent(id)}`);\n}""",
)
replace_once(
    "src/dashboard/api.ts",
    """function openSocket(path: string): WebSocket {\n  const url = new URL(path, window.location.origin);\n  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';\n  return new WebSocket(url);\n}""",
    """function openSocket(path: string, keepAlive = false): WebSocket {\n  const url = new URL(path, window.location.origin);\n  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';\n  const socket = new WebSocket(url);\n  if (!keepAlive) return socket;\n\n  let timer: number | null = null;\n  const stop = () => {\n    if (timer !== null) window.clearInterval(timer);\n    timer = null;\n  };\n  const ping = () => {\n    if (socket.readyState !== WebSocket.OPEN) return;\n    try {\n      socket.send('ping');\n    } catch {\n      socket.close();\n    }\n  };\n  socket.addEventListener('open', () => {\n    ping();\n    stop();\n    timer = window.setInterval(ping, 60_000);\n  });\n  socket.addEventListener('close', stop);\n  return socket;\n}""",
)

# Agent media sender returns the completion payload so UI can update locally.
replace_once(
    "src/dashboard/agent-media.ts",
    """export async function sendAgentImage(\n  conversationId: string,\n  file: File,\n  onProgress?: (progress: number) => void,\n): Promise<void> {""",
    """export async function sendAgentImage(\n  conversationId: string,\n  file: File,\n  onProgress?: (progress: number) => void,\n): Promise<{ messageId: string; createdAt: string; media: AgentMediaItem }> {""",
)
replace_once(
    "src/dashboard/agent-media.ts",
    """    await request(\n      `/api/agent/media/${encodeURIComponent(init.media.id)}/complete`,\n      {\n        method: 'POST',\n        body: '{}',\n      },\n    );\n  } finally {""",
    """    const complete = await request<{\n      messageId: string;\n      createdAt: string;\n      media: Omit<AgentMediaItem, 'messageId' | 'url'>;\n    }>(`/api/agent/media/${encodeURIComponent(init.media.id)}/complete`, {\n      method: 'POST',\n      body: '{}',\n    });\n    return {\n      messageId: complete.messageId,\n      createdAt: complete.createdAt,\n      media: {\n        ...complete.media,\n        messageId: complete.messageId,\n        url: `/api/agent/media/${encodeURIComponent(complete.media.id)}/content`,\n      },\n    };\n  } finally {""",
)

# Dashboard realtime event types/helpers.
replace_once(
    "src/dashboard/App.tsx",
    """  Message,\n  adminLogin,""",
    """  Message,\n  Overview,\n  adminLogin,""",
)
replace_once(
    "src/dashboard/App.tsx",
    """  getProductCatalog,\n  heartbeat,\n  markConversationRead,""",
    """  getProductCatalog,\n  markConversationRead,""",
)
replace_once(
    "src/dashboard/App.tsx",
    """const CHAT_TIME_ZONE = 'America/Los_Angeles';\n\nexport function App()""",
    """const CHAT_TIME_ZONE = 'America/Los_Angeles';\n\ntype InboxRealtimeEvent = {\n  type?: string;\n  conversation?: Conversation;\n  overview?: Overview | null;\n};\n\ntype ThreadRealtimeEvent = {\n  type?: string;\n  message?: Message;\n  media?: Omit<AgentMediaItem, 'url'>;\n  reader?: 'agent' | 'visitor';\n  lastMessageId?: string | null;\n  status?: Conversation['status'];\n};\n\nfunction parseRealtimeEvent<T>(event: MessageEvent): T | null {\n  try {\n    return JSON.parse(String(event.data)) as T;\n  } catch {\n    return null;\n  }\n}\n\nfunction sortedConversationList(items: Conversation[]): Conversation[] {\n  return [...items].sort((left, right) => {\n    const leftTime = Date.parse(left.last_message_at || left.created_at);\n    const rightTime = Date.parse(right.last_message_at || right.created_at);\n    return rightTime - leftTime;\n  });\n}\n\nexport function App()""",
)

# Remove the 30-second HTTP heartbeat loop. Visibility/online events remain a
# recovery boundary and the inbox WebSocket ping updates last_seen server-side.
regex_once(
    "src/dashboard/App.tsx",
    r"  useEffect\(\(\) => \{\n    const beat = \(\) => void heartbeat\(\)\.catch\(\(\) => undefined\);[\s\S]*?\n  \}, \[\n    acknowledgeConversation,\n    lastVisibleVisitorMessageId,\n    refresh,\n    selectedId,\n  \]\);",
    """  useEffect(() => {\n    const recover = () => {\n      if (document.visibilityState !== 'visible') return;\n      void refresh().catch(() => undefined);\n      if (selectedId) {\n        void acknowledgeConversation(\n          selectedId,\n          lastVisibleVisitorMessageId,\n        ).catch(() => undefined);\n      }\n    };\n\n    document.addEventListener('visibilitychange', recover);\n    window.addEventListener('online', recover);\n    return () => {\n      document.removeEventListener('visibilitychange', recover);\n      window.removeEventListener('online', recover);\n    };\n  }, [\n    acknowledgeConversation,\n    lastVisibleVisitorMessageId,\n    refresh,\n    selectedId,\n  ]);""",
)

replace_once(
    "src/dashboard/App.tsx",
    """      socket.addEventListener('message', () => {\n        if (active) void refresh().catch(() => undefined);\n      });""",
    """      socket.addEventListener('message', (event) => {\n        if (!active) return;\n        const payload = parseRealtimeEvent<InboxRealtimeEvent>(event);\n        if (!payload || payload.type === 'ready' || payload.type === 'pong') return;\n        if (payload.type !== 'conversation.changed' || !payload.conversation) {\n          void refresh().catch(() => undefined);\n          return;\n        }\n\n        const next = payload.conversation;\n        const belongsToAgent = next.assigned_agent === identity.id;\n        setConversations((current) => {\n          const withoutCurrent = current.filter((item) => item.id !== next.id);\n          if (!belongsToAgent) return withoutCurrent;\n          if (filter !== 'all' && next.status !== filter) return withoutCurrent;\n          return sortedConversationList([next, ...withoutCurrent]);\n        });\n        if (belongsToAgent && payload.overview) setOverview(payload.overview);\n      });""",
)
replace_once(
    "src/dashboard/App.tsx",
    """  }, [refresh]);\n\n  useEffect(() => {\n    if (!selectedId) {""",
    """  }, [filter, identity.id, refresh]);\n\n  useEffect(() => {\n    if (!selectedId) {""",
)

# Replace thread WS refetch-on-every-frame with delta application + REST only as
# recovery for unknown/legacy frames.
replace_once(
    "src/dashboard/App.tsx",
    """      socket.addEventListener('message', () => {\n        if (active) void load();\n      });""",
    """      socket.addEventListener('message', (event) => {\n        if (!active) return;\n        const payload = parseRealtimeEvent<ThreadRealtimeEvent>(event);\n        if (!payload || payload.type === 'ready' || payload.type === 'pong') return;\n\n        if (payload.type === 'message' && payload.message) {\n          const incoming = payload.message;\n          setDetail((current) => {\n            if (!current || current.conversation.id !== selectedId) return current;\n            const exists = current.messages.some((item) => item.id === incoming.id);\n            return {\n              ...current,\n              conversation: {\n                ...current.conversation,\n                last_message: incoming.body,\n                last_message_at: incoming.created_at,\n              },\n              messages: exists\n                ? current.messages.map((item) =>\n                    item.id === incoming.id ? incoming : item,\n                  )\n                : [...current.messages, incoming],\n            };\n          });\n          if (payload.media?.id && payload.media.messageId) {\n            const media: AgentMediaItem = {\n              ...payload.media,\n              url: `/api/agent/media/${encodeURIComponent(payload.media.id)}/content`,\n            };\n            setMediaItems((current) =>\n              current.some((item) => item.id === media.id)\n                ? current.map((item) => (item.id === media.id ? media : item))\n                : [...current, media],\n            );\n          }\n          if (\n            incoming.sender_type === 'visitor' &&\n            document.visibilityState === 'visible'\n          ) {\n            void acknowledgeConversation(selectedId, incoming.id).catch(\n              () => undefined,\n            );\n          }\n          return;\n        }\n\n        if (payload.type === 'message.read') {\n          const readAt = new Date().toISOString();\n          setDetail((current) => {\n            if (!current || current.conversation.id !== selectedId) return current;\n            return {\n              ...current,\n              messages: current.messages.map((item) => {\n                if (payload.reader === 'visitor' && item.sender_type === 'agent') {\n                  return { ...item, read_by_visitor_at: item.read_by_visitor_at ?? readAt };\n                }\n                if (payload.reader === 'agent' && item.sender_type === 'visitor') {\n                  return { ...item, read_by_agent_at: item.read_by_agent_at ?? readAt };\n                }\n                return item;\n              }),\n            };\n          });\n          return;\n        }\n\n        if (payload.type === 'conversation.status' && payload.status) {\n          setDetail((current) =>\n            current && current.conversation.id === selectedId\n              ? {\n                  ...current,\n                  conversation: { ...current.conversation, status: payload.status! },\n                }\n              : current,\n          );\n          setConversations((current) =>\n            current.map((item) =>\n              item.id === selectedId ? { ...item, status: payload.status! } : item,\n            ),\n          );\n          return;\n        }\n\n        void load();\n      });""",
)

replace_once(
    "src/dashboard/App.tsx",
    """    try {\n      await sendMessage(selectedId, text);\n      setDetail(await getConversation(selectedId));\n    } catch (reason) {""",
    """    try {\n      const sent = await sendMessage(selectedId, text);\n      setDetail((current) => {\n        if (!current || current.conversation.id !== selectedId) return current;\n        const exists = current.messages.some((item) => item.id === sent.id);\n        return {\n          ...current,\n          conversation: {\n            ...current.conversation,\n            last_message: sent.body,\n            last_message_at: sent.created_at,\n          },\n          messages: exists ? current.messages : [...current.messages, sent],\n        };\n      });\n    } catch (reason) {""",
)

replace_once(
    "src/dashboard/App.tsx",
    """    try {\n      await sendAgentImage(selectedId, file, setMediaProgress);\n      const [nextDetail, nextMedia] = await Promise.all([\n        getConversation(selectedId),\n        getAgentMedia(selectedId),\n      ]);\n      setDetail(nextDetail);\n      setMediaItems(nextMedia);\n      setMediaPendingFile(null);""",
    """    try {\n      const sent = await sendAgentImage(selectedId, file, setMediaProgress);\n      const message: Message = {\n        id: sent.messageId,\n        conversation_id: selectedId,\n        sender_type: 'agent',\n        sender_id: identity.id,\n        body: '',\n        read_by_visitor_at: null,\n        read_by_agent_at: null,\n        created_at: sent.createdAt,\n      };\n      setDetail((current) => {\n        if (!current || current.conversation.id !== selectedId) return current;\n        const exists = current.messages.some((item) => item.id === message.id);\n        return {\n          ...current,\n          conversation: {\n            ...current.conversation,\n            last_message: '',\n            last_message_at: sent.createdAt,\n          },\n          messages: exists ? current.messages : [...current.messages, message],\n        };\n      });\n      setMediaItems((current) =>\n        current.some((item) => item.id === sent.media.id)\n          ? current.map((item) => (item.id === sent.media.id ? sent.media : item))\n          : [...current, sent.media],\n      );\n      setMediaPendingFile(null);""",
)

replace_once(
    "src/dashboard/App.tsx",
    """  async function changeStatus(status: Conversation['status']) {\n    if (!selectedId) return;\n    try {\n      await setConversationStatus(selectedId, status);\n      setDetail(await getConversation(selectedId));\n      await refresh();\n    } catch (reason) {""",
    """  async function changeStatus(status: Conversation['status']) {\n    if (!selectedId) return;\n    const previousStatus = detail?.conversation.status as\n      | Conversation['status']\n      | undefined;\n    try {\n      await setConversationStatus(selectedId, status);\n      setDetail((current) =>\n        current && current.conversation.id === selectedId\n          ? {\n              ...current,\n              conversation: { ...current.conversation, status },\n            }\n          : current,\n      );\n      setConversations((current) => {\n        const updated = current.map((item) =>\n          item.id === selectedId ? { ...item, status } : item,\n        );\n        return filter !== 'all' && status !== filter\n          ? updated.filter((item) => item.id !== selectedId)\n          : updated;\n      });\n      if (previousStatus && previousStatus !== status) {\n        setOverview((current) => ({\n          ...current,\n          [previousStatus]: Math.max(0, current[previousStatus] - 1),\n          [status]: current[status] + 1,\n        }));\n      }\n    } catch (reason) {""",
)

# ---------------------------------------------------------------------------
# 2) Atomic routing selection: choose and assign inside one SQLite write
# statement. Active load is the first ordering key, with last_assigned_at as
# deterministic round-robin tie-breaker.
# ---------------------------------------------------------------------------

write(
    "src/worker/routing.ts",
    """export type AgentAssignment = {\n  id: string;\n  name: string;\n};\n\ntype ConversationRoutingRow = {\n  site_id: string;\n  product_id: string | null;\n  section_id: string | null;\n  category_id: string | null;\n  group_id: string | null;\n  assigned_agent: string | null;\n};\n\n/**\n * Assign one conversation to one currently-eligible agent.\n *\n * The candidate selection and conversation write happen in the same SQLite\n * UPDATE statement, so concurrent requests cannot both pass a stale capacity\n * check before writing. Active load is balanced first; last_assigned_at and id\n * provide deterministic round-robin ordering for equal loads. Legacy groups\n * are considered only when no hierarchical routing scope matches at all.\n */\nexport async function assignConversationAgent(\n  db: D1Database,\n  conversationId: string,\n): Promise<AgentAssignment | null> {\n  const conversation = await db\n    .prepare(\n      `SELECT\n         c.site_id,\n         c.product_id,\n         COALESCE(c.section_id, p.section_id) AS section_id,\n         COALESCE(c.category_id, p.category_id) AS category_id,\n         c.group_id,\n         c.assigned_agent\n       FROM conversations c\n       LEFT JOIN product_catalog p\n         ON p.site_id = c.site_id\n        AND p.id = c.product_id\n       WHERE c.id = ?1\n         AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP\n       LIMIT 1`,\n    )\n    .bind(conversationId)\n    .first<ConversationRoutingRow>();\n\n  if (!conversation) return null;\n  if (conversation.assigned_agent) {\n    return assignedAgent(db, conversationId);\n  }\n\n  const now = new Date().toISOString();\n  const result = await db\n    .prepare(\n      `WITH matching AS (\n         SELECT DISTINCT ars.agent_id\n         FROM agent_routing_scopes ars\n         WHERE ars.site_id = ?1\n           AND ars.is_enabled = 1\n           AND (\n             (?2 <> '' AND ars.scope_type = 'product' AND ars.product_id = ?2)\n             OR (?3 <> '' AND ars.scope_type = 'section' AND ars.section_id = ?3)\n             OR (\n               ?3 <> ''\n               AND ?4 <> ''\n               AND ars.scope_type = 'category'\n               AND ars.section_id = ?3\n               AND ars.category_id = ?4\n             )\n           )\n       ),\n       scoped_candidate AS (\n         SELECT a.id\n         FROM matching m\n         JOIN agents a\n           ON a.id = m.agent_id\n          AND a.site_id = ?1\n         LEFT JOIN (\n           SELECT assigned_agent, COUNT(*) AS active_count\n           FROM conversations\n           WHERE site_id = ?1\n             AND status IN ('open', 'pending')\n             AND assigned_agent IS NOT NULL\n             AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP\n           GROUP BY assigned_agent\n         ) load ON load.assigned_agent = a.id\n         WHERE a.is_enabled = 1\n           AND a.status = 'online'\n           AND a.username IS NOT NULL\n           AND a.password_hash IS NOT NULL\n           AND a.last_seen_at IS NOT NULL\n           AND datetime(a.last_seen_at) >= datetime('now', '-2 minutes')\n           AND (\n             a.max_active_conversations = 0\n             OR COALESCE(load.active_count, 0) < a.max_active_conversations\n           )\n         ORDER BY\n           COALESCE(load.active_count, 0) ASC,\n           COALESCE(a.last_assigned_at, '') ASC,\n           a.id ASC\n         LIMIT 1\n       ),\n       legacy_candidate AS (\n         SELECT a.id\n         FROM group_agents ga\n         JOIN agents a\n           ON a.id = ga.agent_id\n          AND a.site_id = ga.site_id\n         JOIN support_groups sg\n           ON sg.site_id = ga.site_id\n          AND sg.id = ga.group_id\n         LEFT JOIN (\n           SELECT assigned_agent, COUNT(*) AS active_count\n           FROM conversations\n           WHERE site_id = ?1\n             AND status IN ('open', 'pending')\n             AND assigned_agent IS NOT NULL\n             AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP\n           GROUP BY assigned_agent\n         ) load ON load.assigned_agent = a.id\n         WHERE ?5 <> ''\n           AND NOT EXISTS (SELECT 1 FROM matching)\n           AND ga.site_id = ?1\n           AND ga.group_id = ?5\n           AND ga.is_enabled = 1\n           AND sg.is_enabled = 1\n           AND a.is_enabled = 1\n           AND a.status = 'online'\n           AND a.username IS NOT NULL\n           AND a.password_hash IS NOT NULL\n           AND a.last_seen_at IS NOT NULL\n           AND datetime(a.last_seen_at) >= datetime('now', '-2 minutes')\n           AND (\n             a.max_active_conversations = 0\n             OR COALESCE(load.active_count, 0) < a.max_active_conversations\n           )\n         ORDER BY\n           COALESCE(load.active_count, 0) ASC,\n           COALESCE(a.last_assigned_at, '') ASC,\n           a.id ASC\n         LIMIT 1\n       ),\n       candidate AS (\n         SELECT id FROM scoped_candidate\n         UNION ALL\n         SELECT id FROM legacy_candidate\n         LIMIT 1\n       )\n       UPDATE conversations\n       SET assigned_agent = (SELECT id FROM candidate),\n           status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,\n           updated_at = ?7\n       WHERE id = ?6\n         AND assigned_agent IS NULL\n         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP\n         AND EXISTS (SELECT 1 FROM candidate)`,\n    )\n    .bind(\n      conversation.site_id,\n      conversation.product_id ?? '',\n      conversation.section_id ?? '',\n      conversation.category_id ?? '',\n      conversation.group_id ?? '',\n      conversationId,\n      now,\n    )\n    .run();\n\n  const assignment = await assignedAgent(db, conversationId);\n  if (!assignment) return null;\n\n  if (result.meta.changes) {\n    await db\n      .prepare(\n        `UPDATE agents\n         SET last_assigned_at = ?1, updated_at = ?1\n         WHERE id = ?2 AND site_id = ?3`,\n      )\n      .bind(now, assignment.id, conversation.site_id)\n      .run();\n  }\n\n  return assignment;\n}\n\nasync function assignedAgent(\n  db: D1Database,\n  conversationId: string,\n): Promise<AgentAssignment | null> {\n  return db\n    .prepare(\n      `SELECT a.id, a.name\n       FROM conversations c\n       JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id\n       WHERE c.id = ?1\n       LIMIT 1`,\n    )\n    .bind(conversationId)\n    .first<AgentAssignment>();\n}\n""",
)

replace_once(
    "test/product-agent-routing.test.mjs",
    """function addAgent(database, { id, status = 'online', lastAssignedAt = null }) {\n  database\n    .prepare(\n      `INSERT INTO agents (\n         id, site_id, name, username, password_hash, status, is_enabled,\n         max_active_conversations, last_seen_at, last_assigned_at\n       ) VALUES (?, 'default', ?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, ?)`,\n    )\n    .run(id, id, id, `hash-${id}`, status, lastAssignedAt);\n}""",
    """function addAgent(\n  database,\n  {\n    id,\n    status = 'online',\n    lastAssignedAt = null,\n    maxActiveConversations = 0,\n  },\n) {\n  database\n    .prepare(\n      `INSERT INTO agents (\n         id, site_id, name, username, password_hash, status, is_enabled,\n         max_active_conversations, last_seen_at, last_assigned_at\n       ) VALUES (?, 'default', ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, ?)`,\n    )\n    .run(\n      id,\n      id,\n      id,\n      `hash-${id}`,\n      status,\n      maxActiveConversations,\n      lastAssignedAt,\n    );\n}""",
)

with (ROOT / "test/product-agent-routing.test.mjs").open("a", encoding="utf-8") as handle:
    handle.write(
        """\n\ntest('concurrent assignments respect capacity and spread work across eligible agents', async () => {\n  const database = createDatabase();\n  addAgent(database, { id: 'agent-a', maxActiveConversations: 1 });\n  addAgent(database, { id: 'agent-b', maxActiveConversations: 1 });\n  addScope(database, 'agent-a', { type: 'section', sectionId: 'west' });\n  addScope(database, 'agent-b', { type: 'section', sectionId: 'west' });\n  addConversation(database, 'conversation-1', 'product-a');\n  addConversation(database, 'conversation-2', 'product-b');\n\n  const db = d1(database);\n  const [first, second] = await Promise.all([\n    assignConversationAgent(db, 'conversation-1'),\n    assignConversationAgent(db, 'conversation-2'),\n  ]);\n\n  assert.deepEqual(\n    new Set([first?.id, second?.id]),\n    new Set(['agent-a', 'agent-b']),\n  );\n  assert.equal(\n    database\n      .prepare(\n        `SELECT COUNT(*) AS count\n         FROM conversations\n         WHERE assigned_agent = 'agent-a'`,\n      )\n      .get().count,\n    1,\n  );\n  assert.equal(\n    database\n      .prepare(\n        `SELECT COUNT(*) AS count\n         FROM conversations\n         WHERE assigned_agent = 'agent-b'`,\n      )\n      .get().count,\n    1,\n  );\n  database.close();\n});\n"""
    )

# ---------------------------------------------------------------------------
# 3) Slim admin bootstrap: server returns routing rules, not duplicated expanded
# product-id arrays. The browser expands rules from the single shared product list.
# ---------------------------------------------------------------------------

replace_once(
    "src/worker/admin-config-api.ts",
    """type ScopeExpansionRow = ScopeRow & {\n  resolved_product_id: string | null;\n};\n\n""",
    "",
)
regex_once(
    "src/worker/admin-config-api.ts",
    r"async function loadAgents\(db: D1Database\) \{[\s\S]*?\n}\n\nasync function loadProducts",
    """async function loadAgents(db: D1Database) {\n  const [agentsResult, assignmentsResult] = await Promise.all([\n    db\n      .prepare(\n        `SELECT id, name, username, status, is_enabled, max_active_conversations,\n           last_login_at, last_seen_at, password_hash, password_salt, password_iterations\n         FROM agents\n         WHERE id <> 'admin'\n         ORDER BY is_enabled DESC, name ASC, id ASC`,\n      )\n      .all<AgentRow>(),\n    db\n      .prepare(\n        `SELECT agent_id, scope_type, section_id, category_id, product_id\n         FROM agent_routing_scopes\n         WHERE site_id = 'default'\n           AND is_enabled = 1\n         ORDER BY agent_id ASC, scope_type ASC, section_id ASC,\n           category_id ASC, product_id ASC`,\n      )\n      .all<ScopeRow>(),\n  ]);\n\n  const rowsByAgent = new Map<string, ScopeRow[]>();\n  for (const row of assignmentsResult.results ?? []) {\n    const current = rowsByAgent.get(row.agent_id) ?? [];\n    current.push(row);\n    rowsByAgent.set(row.agent_id, current);\n  }\n\n  return (agentsResult.results ?? []).map((agent) => {\n    const routingScope = scopeFromRows(rowsByAgent.get(agent.id) ?? []);\n    return {\n      id: agent.id,\n      name: agent.name,\n      username: agent.username,\n      status: agent.status,\n      isEnabled: agent.is_enabled === 1,\n      maxActiveConversations: agent.max_active_conversations,\n      lastLoginAt: agent.last_login_at,\n      lastSeenAt: agent.last_seen_at,\n      hasPassword: Boolean(agent.password_hash && agent.password_salt),\n      productIds: routingScope.type === 'product' ? routingScope.productIds : [],\n      routingScope,\n    };\n  });\n}\n\nasync function loadProducts""",
)

replace_once(
    "src/dashboard/api.ts",
    """export async function getAgents(): Promise<AgentAccount[]> {\n  const response = await getAdminBootstrap();\n  return response.agents.map((agent) => ({\n    ...agent,\n    productIds: attachProductSelectionScope(\n      agent.productIds,\n      normalizeRoutingScope(agent.routingScope, agent.productIds),\n    ),\n  }));\n}""",
    """export async function getAgents(): Promise<AgentAccount[]> {\n  const response = await getAdminBootstrap();\n  return response.agents.map((agent) => {\n    const scope = normalizeRoutingScope(agent.routingScope, agent.productIds);\n    return {\n      ...agent,\n      productIds: attachProductSelectionScope(\n        expandRoutingScopeProductIds(scope, response.products),\n        scope,\n      ),\n    };\n  });\n}""",
)
replace_once(
    "src/dashboard/api.ts",
    """function scopeForRequest(productIds: string[]): AgentRoutingScope {""",
    """function expandRoutingScopeProductIds(\n  scope: AgentRoutingScope,\n  products: ProductCatalogItem[],\n): string[] {\n  if (scope.type === 'none') return [];\n  if (scope.type === 'product') return [...scope.productIds];\n  if (scope.type === 'section') {\n    return products\n      .filter((product) => product.isEnabled && product.sectionId === scope.sectionId)\n      .map((product) => product.id);\n  }\n  const categoryIds = new Set(scope.categoryIds);\n  return products\n    .filter(\n      (product) =>\n        product.isEnabled &&\n        product.sectionId === scope.sectionId &&\n        Boolean(product.categoryId) &&\n        categoryIds.has(product.categoryId as string),\n    )\n    .map((product) => product.id);\n}\n\nfunction scopeForRequest(productIds: string[]): AgentRoutingScope {""",
)

# Stabilize picker memo dependencies while preserving scope metadata.
replace_once(
    "src/dashboard/ProductAssignmentPicker.tsx",
    """  const scope =\n    getProductSelectionScope(selectedIds) ??\n    (selectedIds.length\n      ? ({ type: 'product', productIds: selectedIds } as const)\n      : ({ type: 'none' } as const));""",
    """  const scope = useMemo<AgentRoutingScope>(\n    () =>\n      getProductSelectionScope(selectedIds) ??\n      (selectedIds.length\n        ? { type: 'product', productIds: selectedIds }\n        : { type: 'none' }),\n    [selectedIds],\n  );""",
)

# ---------------------------------------------------------------------------
# 4) Contract tests: realtime payloads and production WS ping/pong recovery.
# ---------------------------------------------------------------------------

write(
    "test/realtime-payload.test.mjs",
    """import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { DatabaseSync } from 'node:sqlite';\nimport { broadcastClientConversationEvent } from '../src/worker/client-api.ts';\n\nfunction d1(database) {\n  return {\n    prepare(sql) {\n      let bindings = [];\n      return {\n        bind(...values) {\n          bindings = values;\n          return this;\n        },\n        async first() {\n          return database.prepare(sql).get(...bindings) ?? null;\n        },\n        async all() {\n          return { results: database.prepare(sql).all(...bindings) };\n        },\n      };\n    },\n  };\n}\n\nfunction createEnv() {\n  const database = new DatabaseSync(':memory:');\n  database.exec(`\n    CREATE TABLE visitors (\n      id TEXT PRIMARY KEY,\n      external_id TEXT,\n      display_name TEXT\n    );\n    CREATE TABLE agents (\n      id TEXT PRIMARY KEY,\n      site_id TEXT NOT NULL,\n      name TEXT NOT NULL\n    );\n    CREATE TABLE conversations (\n      id TEXT PRIMARY KEY,\n      site_id TEXT NOT NULL,\n      visitor_id TEXT NOT NULL,\n      status TEXT NOT NULL,\n      assigned_agent TEXT,\n      subject TEXT,\n      group_id TEXT,\n      product_id TEXT,\n      section_id TEXT,\n      section_name TEXT,\n      category_id TEXT,\n      category_name TEXT,\n      product_title TEXT,\n      product_cover_url TEXT,\n      product_href TEXT,\n      expires_at TEXT,\n      visitor_unread_count INTEGER NOT NULL DEFAULT 0,\n      agent_unread_count INTEGER NOT NULL DEFAULT 0,\n      last_message_at TEXT NOT NULL,\n      created_at TEXT NOT NULL\n    );\n    CREATE TABLE messages (\n      id TEXT PRIMARY KEY,\n      conversation_id TEXT NOT NULL,\n      body TEXT NOT NULL,\n      created_at TEXT NOT NULL\n    );\n\n    INSERT INTO visitors VALUES ('visitor-1', 'ABC123', 'Visitor');\n    INSERT INTO agents VALUES ('agent-1', 'default', 'Amy');\n    INSERT INTO conversations VALUES (\n      'conversation-1', 'default', 'visitor-1', 'pending', 'agent-1',\n      'Product A', NULL, 'product-a', 'west', 'West', 'massage', 'Massage',\n      'Product A', NULL, '/products/a', '2099-01-01T00:00:00.000Z',\n      1, 2, '2026-08-14T20:00:00.000Z', '2026-08-14T19:00:00.000Z'\n    );\n    INSERT INTO messages VALUES (\n      'message-1', 'conversation-1', 'hello', '2026-08-14T20:00:00.000Z'\n    );\n  `);\n\n  const broadcasts = new Map();\n  const rooms = {\n    idFromName(name) {\n      return name;\n    },\n    get(name) {\n      return {\n        async fetch(_url, init) {\n          const payload = JSON.parse(String(init?.body ?? '{}'));\n          const current = broadcasts.get(name) ?? [];\n          current.push(payload);\n          broadcasts.set(name, current);\n          return new Response(null, { status: 204 });\n        },\n      };\n    },\n  };\n\n  return { database, broadcasts, env: { DB: d1(database), CONVERSATION_ROOMS: rooms } };\n}\n\ntest('client realtime event carries conversation delta and agent inbox snapshot', async () => {\n  const { database, broadcasts, env } = createEnv();\n  await broadcastClientConversationEvent(\n    env,\n    'conversation-1',\n    'message.created',\n    {\n      message: {\n        id: 'message-1',\n        direction: 'customer',\n        body: 'hello',\n        sentAt: '2026-08-14T20:00:00.000Z',\n        delivery: 'sent',\n        attachments: [],\n      },\n    },\n  );\n\n  const visitorEvent = broadcasts.get('client:default:ABC123')?.at(-1);\n  assert.equal(visitorEvent?.type, 'message.created');\n  assert.equal(visitorEvent?.conversation?.id, 'conversation-1');\n  assert.equal(visitorEvent?.conversation?.agentName, 'Amy');\n  assert.equal(visitorEvent?.message?.id, 'message-1');\n\n  const inboxEvent = broadcasts.get('admin-inbox')?.at(-1);\n  assert.equal(inboxEvent?.type, 'conversation.changed');\n  assert.equal(inboxEvent?.conversation?.assigned_agent, 'agent-1');\n  assert.equal(inboxEvent?.conversation?.agent_unread_count, 2);\n  assert.equal(inboxEvent?.overview?.pending, 1);\n  assert.equal(inboxEvent?.overview?.total, 1);\n\n  database.close();\n});\n""",
)

regex_once(
    "scripts/smoke-production.mjs",
    r"async function assertClientWebSocket\(\) \{[\s\S]*?\n}\n\nconst health =",
    """async function assertClientWebSocket() {\n  const url = new URL(endpoint('/client/v1/realtime'));\n  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';\n  url.searchParams.set('visitorId', 'SMK123');\n\n  await new Promise((resolve, reject) => {\n    const socket = new WebSocket(url);\n    let settled = false;\n    let ready = false;\n    const finish = (callback) => {\n      if (settled) return;\n      settled = true;\n      clearTimeout(timeout);\n      socket.close();\n      callback();\n    };\n    const timeout = setTimeout(\n      () =>\n        finish(() =>\n          reject(\n            new Error(\n              'Client WebSocket did not complete ready/pong within 10 seconds.',\n            ),\n          ),\n        ),\n      10_000,\n    );\n\n    socket.addEventListener('message', (event) => {\n      try {\n        const value = JSON.parse(String(event.data));\n        if (value?.type === 'ready' && !ready) {\n          ready = true;\n          socket.send('ping');\n          return;\n        }\n        if (ready && value?.type === 'pong') finish(resolve);\n      } catch {\n        // Ignore non-JSON frames and keep waiting for the protocol events.\n      }\n    });\n    socket.addEventListener('error', () =>\n      finish(() => reject(new Error('Client WebSocket connection failed.'))),\n    );\n  });\n\n  console.log('CLIENT_WEBSOCKET=ready');\n}\n\nconst health =""",
)

print("Optimization patch applied.")
