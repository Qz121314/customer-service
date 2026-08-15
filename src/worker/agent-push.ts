import {
  readVapidConfig,
  sendDataLessPush,
  type VapidRow,
} from './visitor-push';

type AgentPushBindings = {
  DB: D1Database;
};

type SubscriptionRow = {
  endpoint: string;
};

export async function sendAgentPushForConversation(
  env: AgentPushBindings,
  conversationId: string,
): Promise<void> {
  const conversation = await env.DB.prepare(
    `SELECT assigned_agent
     FROM conversations
     WHERE id = ?1
       AND assigned_agent IS NOT NULL
       AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
     LIMIT 1`,
  )
    .bind(conversationId)
    .first<{ assigned_agent: string | null }>();
  if (!conversation?.assigned_agent) return;

  const config = await readVapidConfig(env.DB);
  if (!config) return;

  const now = Date.now();
  await env.DB.prepare(
    `DELETE FROM agent_push_subscriptions
     WHERE expiration_time IS NOT NULL AND expiration_time <= ?1`,
  )
    .bind(now)
    .run();

  const subscriptions = await env.DB.prepare(
    `SELECT endpoint
     FROM agent_push_subscriptions
     WHERE agent_id = ?1`,
  )
    .bind(conversation.assigned_agent)
    .all<SubscriptionRow>();
  if (!subscriptions.results?.length) return;

  await Promise.all(
    subscriptions.results.map((subscription) =>
      deliverAgentPush(env, subscription.endpoint, config),
    ),
  );
}

async function deliverAgentPush(
  env: AgentPushBindings,
  endpoint: string,
  config: VapidRow,
): Promise<void> {
  try {
    const response = await sendDataLessPush(endpoint, config);
    if (response.status === 404 || response.status === 410) {
      await env.DB.prepare(
        'DELETE FROM agent_push_subscriptions WHERE endpoint = ?1',
      )
        .bind(endpoint)
        .run();
      return;
    }
    if (!response.ok) {
      console.warn('Agent push delivery failed.', response.status);
    }
  } catch (error) {
    console.warn('Agent push delivery failed.', error);
  }
}
