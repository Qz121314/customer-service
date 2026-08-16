import { sendDataLessPush, type VapidRow } from './visitor-push';

type AgentPushBindings = {
  DB: D1Database;
};

type AgentPushRow = VapidRow & {
  endpoint: string;
};

export async function sendAgentPushForConversation(
  env: AgentPushBindings,
  conversationId: string,
): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `DELETE FROM agent_push_subscriptions
     WHERE expiration_time IS NOT NULL AND expiration_time <= ?1`,
  )
    .bind(now)
    .run();

  const subscriptions = await env.DB.prepare(
    `SELECT
       subscription.endpoint,
       vapid.public_key,
       vapid.private_jwk,
       vapid.subject
     FROM conversations conversation
     JOIN agent_push_subscriptions subscription
       ON subscription.agent_id = conversation.assigned_agent
     JOIN visitor_push_vapid vapid
       ON vapid.id = 'default'
     WHERE conversation.id = ?1
       AND conversation.assigned_agent IS NOT NULL
       AND COALESCE(
         conversation.expires_at,
         datetime(conversation.created_at, '+1 day')
       ) > CURRENT_TIMESTAMP
       AND (
         subscription.expiration_time IS NULL
         OR subscription.expiration_time > ?2
       )`,
  )
    .bind(conversationId, now)
    .all<AgentPushRow>();
  if (!subscriptions.results?.length) return;

  await Promise.all(
    subscriptions.results.map((subscription) =>
      deliverAgentPush(env, subscription.endpoint, subscription),
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
