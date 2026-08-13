import { Hono } from 'hono';
import legacyApp, { ConversationRoom } from './index';
import { clientApi, broadcastClientConversationEvent } from './client-api';
import { integrationApi } from './integration-api';
import { assignConversationAgent } from './routing';
import { adminConfigApi } from './admin-config-api';
import { agentApi } from './agent-api';

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

// Storefront creates conversations directly on this service. Routing is done
// here against the configured support group and currently-online seat accounts.
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

app.route('/', adminConfigApi);
app.route('/', agentApi);
app.route('/', clientApi);

// Management-center administrators must not use the legacy conversation API.
// Chat traffic belongs exclusively to authenticated seat accounts under
// /api/agent/*.
app.all('/api/admin/conversations', (c) => c.json({ error: 'NOT_FOUND' }, 404));
app.all('/api/admin/conversations/*', (c) =>
  c.json({ error: 'NOT_FOUND' }, 404),
);
app.all('/api/admin/realtime/*', (c) => c.json({ error: 'NOT_FOUND' }, 404));

// Keep the existing admin-password login endpoints and static asset handling
// while the management UI uses the new configuration APIs above.
app.route('/', legacyApp);

export default app;
export { ConversationRoom };
