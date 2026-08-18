type AssignmentEventEnv = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

type ConversationStatus = 'open' | 'pending' | 'closed';

type AssignmentConversationRow = {
  id: string;
  site_id: string;
  visitor_id: string;
  status: ConversationStatus;
  assigned_agent: string | null;
  agent_name: string | null;
  agent_avatar_version: string | null;
  subject: string | null;
  group_id: string | null;
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
  external_id: string | null;
  visitor_name: string | null;
  greeting_message_id: string | null;
  greeting_body: string | null;
  greeting_read_by_visitor_at: string | null;
  greeting_created_at: string | null;
};

export async function broadcastAssignmentEvents(
  env: AssignmentEventEnv,
  agentId: string,
  conversationIds: string[],
): Promise<void> {
  if (conversationIds.length === 0) return;

  const [conversations, overview] = await Promise.all([
    env.DB.prepare(
      `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent,
         a.name AS agent_name, a.avatar_version AS agent_avatar_version,
         c.subject, c.group_id, c.product_id, c.section_id,
         c.section_name, c.category_id, c.category_name, c.product_title,
         c.product_cover_url, c.product_href, c.expires_at,
         c.visitor_unread_count, c.agent_unread_count, c.last_message_at,
         c.created_at, c.last_message_preview AS last_message,
         v.external_id, v.display_name AS visitor_name,
         greeting.id AS greeting_message_id,
         greeting.body AS greeting_body,
         greeting.read_by_visitor_at AS greeting_read_by_visitor_at,
         greeting.created_at AS greeting_created_at
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       LEFT JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id
       LEFT JOIN messages greeting
         ON greeting.conversation_id = c.id
        AND greeting.automation_key = 'initial_greeting'
       WHERE c.id IN (
         SELECT CAST(value AS TEXT) FROM json_each(?1)
       )
       ORDER BY c.last_message_at ASC, c.id ASC`,
    )
      .bind(JSON.stringify(conversationIds))
      .all<AssignmentConversationRow>(),
    loadAgentOverview(env.DB, agentId),
  ]);

  const tasks: Promise<void>[] = [];
  for (const conversation of conversations.results ?? []) {
    if (conversation.external_id) {
      const greeting = initialGreetingMessage(conversation);
      tasks.push(
        broadcastRoom(
          env,
          `client:${conversation.site_id}:${conversation.external_id}`,
          {
            type: 'conversation.assigned',
            conversationId: conversation.id,
            conversation: visitorConversationSummary(conversation),
            ...(greeting ? { message: greeting } : {}),
          },
        ),
      );
    }

    tasks.push(
      broadcastRoom(env, `agent-inbox:${agentId}`, {
        type: 'conversation.changed',
        conversationId: conversation.id,
        conversation: agentConversationSummary(conversation),
        overview,
      }),
    );
  }

  await Promise.all(tasks);
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
        AND COALESCE(c.expires_at, datetime(c.created_at, '+1 day')) > CURRENT_TIMESTAMP
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

function visitorConversationSummary(conversation: AssignmentConversationRow) {
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

function initialGreetingMessage(conversation: AssignmentConversationRow) {
  if (
    !conversation.greeting_message_id ||
    !conversation.greeting_body ||
    !conversation.greeting_created_at
  ) {
    return null;
  }
  return {
    id: conversation.greeting_message_id,
    direction: 'agent' as const,
    body: conversation.greeting_body,
    sentAt: toIso(conversation.greeting_created_at),
    delivery: conversation.greeting_read_by_visitor_at
      ? ('read' as const)
      : ('sent' as const),
    attachments: [],
  };
}

function agentConversationSummary(conversation: AssignmentConversationRow) {
  return {
    id: conversation.id,
    site_id: conversation.site_id,
    visitor_id: conversation.visitor_id,
    status: conversation.status,
    subject: conversation.subject,
    group_id: conversation.group_id,
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

function publicStatus(
  status: ConversationStatus,
): 'waiting' | 'active' | 'closed' {
  if (status === 'closed') return 'closed';
  return status === 'pending' ? 'active' : 'waiting';
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T/u.test(value)) return value;
  return `${value.replace(' ', 'T')}Z`;
}

async function broadcastRoom(
  env: AssignmentEventEnv,
  name: string,
  payload: unknown,
): Promise<void> {
  const room = env.CONVERSATION_ROOMS.get(
    env.CONVERSATION_ROOMS.idFromName(name),
  );
  await room.fetch('https://conversation-room/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
