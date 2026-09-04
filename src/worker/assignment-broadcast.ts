import {
  loadMessageAttachments,
  publicMessageAttachment,
} from './message-attachments';
import { loadAgentOverview } from './agent-inbox';
import type { ProductContextSnapshot } from './client-api';

type AssignmentBroadcastEnv = {
  DB: D1Database;
  CONVERSATION_ROOMS: DurableObjectNamespace;
};

type ConversationStatus = 'open' | 'pending' | 'closed';

export type AssignmentVisitorMessage = {
  id: string;
  conversation_id: string;
  sender_type: 'visitor';
  sender_id: string;
  body: string;
  message_kind: 'product_context';
  structured_payload_json: string;
  product_context: ProductContextSnapshot;
  client_message_id: string | null;
  read_by_visitor_at: null;
  read_by_agent_at: null;
  created_at: string;
};

export type AssignmentConversationSnapshot = {
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
  initial_assignment: number;
  greeting_message_id: string | null;
  greeting_message_body: string | null;
  greeting_message_created_at: string | null;
};

/**
 * Broadcast one assignment lifecycle after the database assignment has committed.
 *
 * The traffic/automation receipts decide whether this is the conversation's first
 * effective reception and whether a greeting exists. An optional visitor message
 * is carried through the same lifecycle when a legacy create request starts the
 * conversation with text, preventing duplicate Inbox updates and duplicate tones.
 */
export async function broadcastAssignments(
  env: AssignmentBroadcastEnv,
  agentId: string,
  conversationIds: string[],
  assignmentAt: string,
  visitorMessages: AssignmentVisitorMessage[] = [],
): Promise<AssignmentConversationSnapshot[]> {
  const ids = [...new Set(conversationIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const [conversations, overview] = await Promise.all([
    env.DB.prepare(
      `SELECT c.id, c.site_id, c.visitor_id, c.status, c.assigned_agent,
         a.name AS agent_name, a.avatar_version AS agent_avatar_version,
         c.subject, c.group_id, c.product_id, c.section_id,
         c.section_name, c.category_id, c.category_name, c.product_title,
         c.product_cover_url, c.product_href, c.expires_at,
         c.visitor_unread_count, c.agent_unread_count, c.last_message_at,
         c.created_at, v.external_id, v.display_name AS visitor_name,
         c.last_message_preview AS last_message,
         CASE
           WHEN automation.resolved_at = ?2
            AND automation.agent_id = c.assigned_agent
           THEN 1 ELSE 0
         END AS initial_assignment,
         greeting.id AS greeting_message_id,
         greeting.body AS greeting_message_body,
         greeting.created_at AS greeting_message_created_at
       FROM conversations c
       JOIN visitors v ON v.id = c.visitor_id
       LEFT JOIN agents a ON a.id = c.assigned_agent AND a.site_id = c.site_id
       LEFT JOIN conversation_automation_receipts automation
         ON automation.conversation_id = c.id
        AND automation.automation_key = 'initial_greeting'
       LEFT JOIN messages greeting ON greeting.id = automation.message_id
       WHERE c.id IN (
         SELECT CAST(value AS TEXT) FROM json_each(?1)
       )
       ORDER BY c.last_message_at ASC, c.id ASC`,
    )
      .bind(JSON.stringify(ids), assignmentAt)
      .all<AssignmentConversationSnapshot>(),
    loadAgentOverview(env.DB, agentId),
  ]);

  const snapshots = conversations.results ?? [];
  const visitorMessagesByConversation = new Map(
    visitorMessages.map((message) => [message.conversation_id, message]),
  );
  const deliveries = await Promise.allSettled(
    snapshots.map((conversation) =>
      broadcastAssignment(
        env,
        agentId,
        conversation,
        overview,
        visitorMessagesByConversation.get(conversation.id) ?? null,
      ),
    ),
  );
  for (const delivery of deliveries) {
    if (delivery.status === 'rejected') {
      console.warn('conversation assignment broadcast failed', delivery.reason);
    }
  }
  return snapshots;
}

async function broadcastAssignment(
  env: AssignmentBroadcastEnv,
  agentId: string,
  conversation: AssignmentConversationSnapshot,
  overview: Record<string, unknown>,
  visitorMessage: AssignmentVisitorMessage | null,
): Promise<void> {
  const initialAssignment = conversation.initial_assignment === 1;

  if (visitorMessage) {
    const visitorMessageUpdates: Promise<void>[] = [
      broadcastRoom(env, conversation.id, {
        type: 'message',
        message: conversationRoomMessage(visitorMessage),
      }),
    ];
    if (conversation.external_id) {
      visitorMessageUpdates.push(
        broadcastRoom(
          env,
          `client:${conversation.site_id}:${conversation.external_id}`,
          {
            type: 'message.created',
            conversationId: conversation.id,
            conversation: visitorConversationSummary(conversation),
            message: clientRealtimeMessage(visitorMessage, []),
          },
        ),
      );
    }
    await Promise.all(visitorMessageUpdates);
  }

  const assignmentUpdates: Promise<void>[] = [
    broadcastRoom(env, `agent-inbox:${agentId}`, {
      type: 'conversation.changed',
      cause: initialAssignment ? 'initial_assignment' : 'assignment',
      conversationId: conversation.id,
      conversation: agentConversationSummary(conversation),
      overview,
      ...(visitorMessage
        ? {
            reminder: {
              type: 'NEW_CONVERSATION',
              messageId: visitorMessage.id,
            },
          }
        : {}),
    }),
  ];
  if (conversation.external_id) {
    assignmentUpdates.push(
      broadcastRoom(
        env,
        `client:${conversation.site_id}:${conversation.external_id}`,
        {
          type: 'conversation.assigned',
          conversationId: conversation.id,
          conversation: visitorConversationSummary(conversation),
        },
      ),
    );
  }
  await Promise.all(assignmentUpdates);

  const greeting = greetingMessage(conversation);
  if (!initialAssignment || !greeting) return;
  const attachments = (await loadMessageAttachments(env.DB, greeting.id)).map(
    publicMessageAttachment,
  );

  const greetingUpdates: Promise<void>[] = [
    broadcastRoom(env, conversation.id, {
      type: 'message',
      message: conversationRoomMessage(greeting),
      attachments,
    }),
  ];
  if (conversation.external_id) {
    greetingUpdates.push(
      broadcastRoom(
        env,
        `client:${conversation.site_id}:${conversation.external_id}`,
        {
          type: 'message.created',
          conversationId: conversation.id,
          conversation: visitorConversationSummary(conversation),
          message: clientRealtimeMessage(greeting, attachments),
          attachments,
        },
      ),
    );
  }
  await Promise.all(greetingUpdates);
}

function visitorConversationSummary(
  conversation: AssignmentConversationSnapshot,
) {
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

function agentConversationSummary(
  conversation: AssignmentConversationSnapshot,
) {
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

type GreetingMessage = {
  id: string;
  conversation_id: string;
  sender_type: 'agent';
  sender_id: string;
  body: string;
  message_kind: 'text';
  structured_payload_json: null;
  client_message_id: 'auto-greeting:v2';
  read_by_visitor_at: null;
  read_by_agent_at: null;
  created_at: string;
};

type AssignmentMessage = GreetingMessage | AssignmentVisitorMessage;

function greetingMessage(
  conversation: AssignmentConversationSnapshot,
): GreetingMessage | null {
  if (
    !conversation.assigned_agent ||
    !conversation.greeting_message_id ||
    conversation.greeting_message_body === null ||
    !conversation.greeting_message_created_at
  ) {
    return null;
  }
  return {
    id: conversation.greeting_message_id,
    conversation_id: conversation.id,
    sender_type: 'agent',
    sender_id: conversation.assigned_agent,
    body: conversation.greeting_message_body,
    message_kind: 'text',
    structured_payload_json: null,
    client_message_id: 'auto-greeting:v2',
    read_by_visitor_at: null,
    read_by_agent_at: null,
    created_at: conversation.greeting_message_created_at,
  };
}

function conversationRoomMessage(message: AssignmentMessage) {
  return {
    id: message.id,
    conversation_id: message.conversation_id,
    sender_type: message.sender_type,
    sender_id: message.sender_id,
    body: message.body,
    message_kind: message.message_kind,
    structured_payload_json: message.structured_payload_json,
    product_context:
      message.message_kind === 'product_context'
        ? message.product_context
        : null,
    read_by_visitor_at: message.read_by_visitor_at,
    read_by_agent_at: message.read_by_agent_at,
    created_at: message.created_at,
  };
}

function clientRealtimeMessage(
  message: AssignmentMessage,
  attachments: unknown[],
) {
  return {
    id: message.id,
    direction: message.sender_type === 'agent' ? 'agent' : 'customer',
    body: message.body,
    kind: message.message_kind,
    productContext:
      message.message_kind === 'product_context'
        ? message.product_context
        : null,
    sentAt: toIso(message.created_at),
    delivery: 'sent',
    attachments,
  };
}

function publicStatus(status: ConversationStatus): 'active' | 'closed' {
  if (status === 'closed') return 'closed';
  return 'active';
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T/u.test(value)) return value;
  return `${value.replace(' ', 'T')}Z`;
}

async function broadcastRoom(
  env: AssignmentBroadcastEnv,
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
