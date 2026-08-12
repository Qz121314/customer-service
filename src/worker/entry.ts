import { Hono } from 'hono';
import legacyApp, { ConversationRoom } from './index';
import {
  broadcastClientConversationEvent,
  clientApi,
} from './client-api';

interface Bindings {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  ADMIN_PASSWORD?: string;
  MANAGEMENT_TOKEN?: string;
  ENVIRONMENT: string;
  APP_VERSION: string;
}

type AppEnv = { Bindings: Bindings };

const app = new Hono<AppEnv>();

// Keep the existing authenticated Admin API as the source of truth. After a
// successful agent mutation, notify the visitor-level realtime channel used by
// the Site Storefront.
app.use('/api/admin/conversations/:id/messages', async (c, next) => {
  await next();
  if (c.req.method === 'POST' && c.res.status >= 200 && c.res.status < 300) {
    await broadcastClientConversationEvent(
      c.env,
      c.req.param('id'),
      'message.created',
    );
  }
});

app.use('/api/admin/conversations/:id/status', async (c, next) => {
  await next();
  if (c.req.method !== 'POST' || c.res.status < 200 || c.res.status >= 300) return;

  const row = await c.env.DB.prepare(
    'SELECT status FROM conversations WHERE id = ?1',
  )
    .bind(c.req.param('id'))
    .first<{ status: string }>();
  await broadcastClientConversationEvent(
    c.env,
    c.req.param('id'),
    row?.status === 'closed' ? 'conversation.closed' : 'conversation.assigned',
  );
});

app.route('/', clientApi);
app.route('/', legacyApp);

export default app;
export { ConversationRoom };
