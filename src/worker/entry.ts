import { Hono } from 'hono';
import legacyApp, { ConversationRoom } from './index';
import { clientApi } from './client-api';
import { integrationApi } from './integration-api';
import { adminConfigApi } from './admin-config-api';
import { agentApi } from './agent-api';
import { mediaApi } from './media-api';
import { pushApi } from './push-api';
import { sendVisitorPushForConversation } from './visitor-push';
import { purgeExpiredConversations } from './conversation-retention';

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

type MediaCompletePayload = {
  conversationId?: string;
  [key: string]: unknown;
};

const app = new Hono<AppEnv>();
const AGENT_TEXT_MESSAGE_PATH =
  /^\/api\/agent\/conversations\/([^/]+)\/messages$/u;
const AGENT_MEDIA_COMPLETE_PATH = /^\/api\/agent\/media\/[^/]+\/complete$/u;

app.route('/', integrationApi);

// The old management-group protocol is no longer part of the integration
// contract. External site admins use /integration/v1/verify instead.
app.all('/management/v1/*', (c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, 404),
);

// Storefront conversations are created, routed, and broadcast inside clientApi.
// Keeping the whole transaction there avoids a second assignment/read pass.

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
      sendVisitorPushForConversation(c.env, payload.conversationId).catch(
        (error) => {
          console.warn('Visitor push dispatch failed.', error);
        },
      ),
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

export default {
  fetch: app.fetch,
  scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      purgeExpiredConversations(env).catch((error) => {
        console.error('Expired conversation cleanup failed.', error);
      }),
    );
  },
};
export { ConversationRoom };
