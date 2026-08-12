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
// successful agent mutation, update the visitor-facing projection and notify
// the visitor-level realtime channel used by the Site Storefront.
app.use('/api/admin/conversations/:id/messages', async (c, next) => {
  await next();
  if (c.req.method !== 'POST' || c.res.status < 200 || c.res.status >= 300) return;

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
  if (c.req.method !== 'POST' || c.res.status < 200 || c.res.status >= 300) return;

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
