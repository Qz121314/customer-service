import { sendDataLessPush, type VapidRow } from './visitor-push';

type AgentPushBindings = {
  DB: D1Database;
};

type AgentPushRow = VapidRow & {
  endpoint: string;
  expiration_time: number | null;
};

export async function sendAgentPushForConversation(
  env: AgentPushBindings,
  conversationId: string,
): Promise<void> {
  const now = Date.now();
  const subscriptions = await env.DB.prepare(
    `SELECT
       subscription.endpoint,
       subscription.expiration_time,
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
       ) > CURRENT_TIMESTAMP`,
  )
    .bind(conversationId)
    .all<AgentPushRow>();
  if (!subscriptions.results?.length) return;

  const staleEndpoints = new Set<string>();
  const activeSubscriptions = subscriptions.results.filter((subscription) => {
    if (
      subscription.expiration_time !== null &&
      subscription.expiration_time <= now
    ) {
      staleEndpoints.add(subscription.endpoint);
      return false;
    }
    return true;
  });

  const deliveryResults = await Promise.all(
    activeSubscriptions.map(async (subscription) => ({
      endpoint: subscription.endpoint,
      gone: await deliverAgentPush(subscription.endpoint, subscription),
    })),
  );
  for (const result of deliveryResults) {
    if (result.gone) staleEndpoints.add(result.endpoint);
  }

  if (staleEndpoints.size > 0) {
    await deleteAgentPushSubscriptions(env.DB, [...staleEndpoints]);
  }
}

async function deliverAgentPush(
  endpoint: string,
  config: VapidRow,
): Promise<boolean> {
  try {
    const response = await sendDataLessPush(endpoint, config);
    if (response.status === 404 || response.status === 410) return true;
    if (!response.ok) {
      console.warn('Agent push delivery failed.', response.status);
    }
  } catch (error) {
    console.warn('Agent push delivery failed.', error);
  }
  return false;
}

async function deleteAgentPushSubscriptions(
  db: D1Database,
  endpoints: string[],
): Promise<void> {
  if (endpoints.length === 0) return;
  await db
    .prepare(
      `DELETE FROM agent_push_subscriptions
       WHERE endpoint IN (
         SELECT CAST(value AS TEXT) FROM json_each(?1)
       )`,
    )
    .bind(JSON.stringify(endpoints))
    .run();
}
