import {
  createVapidSigningContext,
  sendDataLessPush,
  sendPayloadPush,
  type VapidRow,
  type VapidSigningContext,
} from './visitor-push';
import type { AgentNotificationEvent } from './agent-notification-event';
export type {
  AgentNotificationEvent,
  AgentNotificationType,
} from './agent-notification-event';

type AgentPushBindings = {
  DB: D1Database;
};

type AgentPushRow = VapidRow & {
  endpoint: string;
  p256dh: string | null;
  auth: string | null;
  visitor_name: string | null;
  product_title: string | null;
  agent_unread_count: number;
};

const AGENT_PUSH_TTL_SECONDS = 24 * 60 * 60;

export async function sendAgentPushForMessage(
  env: AgentPushBindings,
  notification: AgentNotificationEvent,
): Promise<void> {
  const subscriptions = await env.DB.prepare(
    `SELECT
       subscription.endpoint,
       subscription.p256dh,
       subscription.auth,
       vapid.public_key,
       vapid.private_jwk,
       vapid.subject,
       visitor.display_name AS visitor_name,
       conversation.product_title,
       conversation.agent_unread_count
     FROM conversations conversation
     JOIN visitors visitor ON visitor.id = conversation.visitor_id
     JOIN agent_push_subscriptions subscription
       ON subscription.agent_id = conversation.assigned_agent
     JOIN agent_sessions session
       ON session.id = subscription.session_id
      AND session.agent_id = conversation.assigned_agent
     JOIN visitor_push_vapid vapid
       ON vapid.id = 'default'
     WHERE conversation.id = ?1
       AND conversation.assigned_agent IS NOT NULL
       AND datetime(session.expires_at) > CURRENT_TIMESTAMP
       AND (
         subscription.expiration_time IS NULL
         OR subscription.expiration_time > ?2
       )
       AND COALESCE(
         conversation.expires_at,
         datetime(conversation.created_at, '+1 day')
       ) > CURRENT_TIMESTAMP`,
  )
    .bind(notification.conversationId, Date.now())
    .all<AgentPushRow>();
  if (!subscriptions.results?.length) return;

  const staleEndpoints = new Set<string>();
  const signingContext = await createVapidSigningContext(
    subscriptions.results[0],
  );
  const deliveryResults = await Promise.all(
    subscriptions.results.map(async (subscription) => ({
      endpoint: subscription.endpoint,
      gone: await deliverAgentPush(subscription, signingContext, notification),
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
  subscription: AgentPushRow,
  signingContext: VapidSigningContext,
  notification: AgentNotificationEvent,
): Promise<boolean> {
  try {
    const response =
      subscription.p256dh && subscription.auth
        ? await sendPayloadPush(
            subscription.endpoint,
            signingContext,
            { p256dh: subscription.p256dh, auth: subscription.auth },
            {
              type: notification.type,
              conversationId: notification.conversationId,
              messageId: notification.messageId,
              title:
                notification.type === 'NEW_CONVERSATION'
                  ? '新客户咨询'
                  : '客户回复',
              body: notificationBody(subscription, notification),
              conversationUnreadCount: Number(
                subscription.agent_unread_count || 0,
              ),
            },
            { ttlSeconds: AGENT_PUSH_TTL_SECONDS },
          )
        : await sendDataLessPush(subscription.endpoint, signingContext, {
            ttlSeconds: AGENT_PUSH_TTL_SECONDS,
          });
    if (response.status === 404 || response.status === 410) return true;
    if (!response.ok) {
      console.warn('Agent push delivery failed.', response.status);
    }
  } catch (error) {
    console.warn('Agent push delivery failed.', error);
  }
  return false;
}

function notificationBody(
  subscription: AgentPushRow,
  notification: AgentNotificationEvent,
): string {
  const context =
    subscription.visitor_name?.trim() ||
    subscription.product_title?.trim() ||
    '客户';
  const preview = notification.preview.trim();
  return preview
    ? `${context}：${preview.slice(0, 120)}`
    : `${context} 发来新消息`;
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
