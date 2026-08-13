import { Hono } from 'hono';
import legacyApp, { ConversationRoom } from './index';
import { broadcastClientConversationEvent, clientApi } from './client-api';
import { integrationApi } from './integration-api';
import { assignConversationAgent } from './routing';

interface Bindings {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  MANAGEMENT_TOKEN?: string;
  INTEGRATION_VERIFY_TOKEN?: string;
  ENVIRONMENT: string;
  APP_VERSION: string;
}

type AppEnv = { Bindings: Bindings };

type CreatedConversationPayload = {
  conversation?: {
    id?: string;
    agentName?: string | null;
    status?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const app = new Hono<AppEnv>();

app.route('/', integrationApi);

// The old management-group protocol is no longer part of the integration
// contract. External site admins use /integration/v1/verify instead.
app.all('/management/v1/*', (c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404),
);

// Storefront creates the conversation directly on customer-service. After the
// conversation is persisted, route it to an available agent in the selected
// support group. No site/backend proxy participates in this data path.
app.use('/client/v1/conversations', async (c, next) => {
  await next();
  if (c.req.method !== 'POST' || c.res.status !== 201) return;

  let payload: CreatedConversationPayload | null = null;
  try {
    payload = (await c.res.clone().json()) as CreatedConversationPayload;
  } catch {
    return;
  }

  const conversationId = payload.conversation?.id;
  if (!conversationId) return;

  const assignment = await assignConversationAgent(c.env.DB, conversationId);
  if (!assignment) return;

  await broadcastClientConversationEvent(
    c.env,
    conversationId,
    'conversation.assigned',
  );

  const headers = new Headers(c.res.headers);
  payload.conversation = {
    ...payload.conversation,
    agentName: assignment.name,
    status: 'active',
  };
  c.res = new Response(JSON.stringify(payload), {
    status: 201,
    headers,
  });
});

// Keep the existing authenticated Admin API as the source of truth. After a
// successful agent mutation, update the visitor-facing projection and notify
// the visitor-level realtime channel used by the Site Storefront.
app.use('/api/admin/conversations/:id/messages', async (c, next) => {
  await next();
  if (c.req.method !== 'POST' || c.res.status < 200 || c.res.status >= 300)
    return;

  const id = c.req.param('id');
  await c.env.DB.prepare(
    `UPDATE conversations
     SET assigned_agent = COALESCE(assigned_agent, 'admin'),
         status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
         visitor_unread_count = visitor_unread_count + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1`,
  )
    .bind(id)
    .run();

  await broadcastClientConversationEvent(c.env, id, 'message.created');
});

app.use('/api/admin/conversations/:id/status', async (c, next) => {
  await next();
  if (c.req.method !== 'POST' || c.res.status < 200 || c.res.status >= 300)
    return;

  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT status FROM conversations WHERE id = ?1',
  )
    .bind(id)
    .first<{ status: string }>();
  await broadcastClientConversationEvent(
    c.env,
    id,
    row?.status === 'closed' ? 'conversation.closed' : 'conversation.assigned',
  );
});

app.route('/', clientApi);
app.route('/', legacyApp);

export default app;
export { ConversationRoom };
