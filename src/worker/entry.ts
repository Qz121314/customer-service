import { Hono } from 'hono';
import legacyApp, { ConversationRoom } from './index';
import { clientApi, broadcastClientConversationEvent } from './client-api';
import { integrationApi } from './integration-api';
import { assignConversationAgent } from './routing';
import { adminConfigApi } from './admin-config-api';
import { agentApi } from './agent-api';
import { mediaApi } from './media-api';
import { pushApi } from './push-api';
import { sendVisitorPushForConversation } from './visitor-push';

interface Bindings {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  MANAGEMENT_TOKEN?: string;
  INTEGRATION_VERIFY_TOKEN?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
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

type MediaCompletePayload = {
  conversationId?: string;
  [key: string]: unknown;
};

const app = new Hono<AppEnv>();
const AGENT_TEXT_MESSAGE_PATH = /^\/api\/agent\/conversations\/([^/]+)\/messages$/u;
const AGENT_MEDIA_COMPLETE_PATH = /^\/api\/agent\/media\/[^/]+\/complete$/u;

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

  await Promise.all([
    broadcastClientConversationEvent(
      c.env,
      conversationId,
      'conversation.assigned',
    ),
    broadcastAgentInbox(c.env, conversationId),
  ]);

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

// Agent replies are persisted by the existing APIs first. A successful text or
// image reply then wakes subscribed visitor devices. Push delivery never owns
// the chat transaction, so a push-service failure cannot make a sent message fail.
app.use('/api/agent/*', async (c, next) => {
  await next();
  if (c.req.method !== 'POST' || !c.res.ok) return;

  const pathname = new URL(c.req.url).pathname;
  const textMatch = pathname.match(AGENT_TEXT_MESSAGE_PATH);
  if (textMatch?.[1] && c.res.status === 201) {
    const conversationId = decodeURIComponent(textMatch[1]);
    c.executionCtx.waitUntil(
      sendVisitorPushForConversation(c.env, conversationId).catch((error) => {
        console.warn('Visitor push dispatch failed.', error);
      }),
    );
    return;
  }

  if (!AGENT_MEDIA_COMPLETE_PATH.test(pathname)) return;
  try {
    const payload = (await c.res.clone().json()) as MediaCompletePayload;
    if (!payload.conversationId) return;
    c.executionCtx.waitUntil(
      sendVisitorPushForConversation(c.env, payload.conversationId).catch((error) => {
        console.warn('Visitor push dispatch failed.', error);
      }),
    );
  } catch {
    // Media completion still succeeds if a response cannot be inspected for push.
  }
});

app.route('/', adminConfigApi);
app.route('/', mediaApi);
app.route('/', agentApi);
app.route('/', pushApi);
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

async function broadcastAgentInbox(
  env: Pick<Bindings, 'CONVERSATION_ROOMS'>,
  conversationId: string,
): Promise<void> {
  const room = env.CONVERSATION_ROOMS.get(
    env.CONVERSATION_ROOMS.idFromName('admin-inbox'),
  );
  await room.fetch('https://conversation-room/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'conversation.changed',
      conversationId,
    }),
  });
}

export default app;
export { ConversationRoom };
