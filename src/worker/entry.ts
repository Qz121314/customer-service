import { Hono } from 'hono';
import { coreApp, ConversationRoom } from './core';
import { clientApi } from './client-api';
import { integrationApi } from './integration-api';
import { adminConfigApi } from './admin-config-api';
import { adminQuotaApi } from './admin-quota-api';
import { adminRoutingApi } from './admin-routing-api';
import { agentApi } from './agent-api';
import { agentAttachmentApi } from './agent-attachment-api';
import { agentCardIconApi } from './agent-card-icon-api';
import { agentBootstrapApi } from './agent-bootstrap-api';
import { agentAutoReplyApi } from './agent-auto-reply-api';
import { agentAvatarApi } from './agent-avatar-api';
import { mediaApi } from './media-api';
import { pushApi } from './push-api';
import { sendVisitorPushForConversation } from './visitor-push';
import { sendAgentPushForMessage } from './agent-push';
import {
  agentNotificationForVisitorResponse,
  type AgentNotificationVariables,
} from './agent-notification-event';
import { agentPushApi } from './agent-push-api';
import { purgeExpiredConversations } from './conversation-retention';
import { passesBurstLimit, requestSourceHash } from './abuse-control';
import {
  isRemovedProtocolPath,
  removedProtocolResponse,
} from './protocol-boundary';

interface Bindings {
  DB: D1Database;
  MEDIA: R2Bucket;
  ASSETS: Fetcher;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  CONVERSATION_BURST_LIMITER: RateLimit;
  MEDIA_BURST_LIMITER: RateLimit;
  AUTH_BURST_LIMITER?: RateLimit;
  ADMIN_PASSWORD?: string;
  INTEGRATION_VERIFY_TOKEN?: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  ENVIRONMENT: string;
  APP_VERSION: string;
}

type AppEnv = {
  Bindings: Bindings;
  Variables: AgentNotificationVariables;
};

type MediaCompletePayload = {
  conversationId?: string;
  messageId?: string;
  duplicate?: boolean;
  [key: string]: unknown;
};

const app = new Hono<AppEnv>();
const AUTH_LOGIN_PATHS = new Map([
  ['/api/auth/login', 'admin'],
  ['/api/agent/auth/login', 'agent'],
]);
const PROTOCOL_NAMESPACE_PREFIXES = [
  '/api',
  '/client',
  '/integration',
  '/management',
] as const;
const AGENT_TEXT_MESSAGE_PATH =
  /^\/api\/agent\/conversations\/([^/]+)\/messages$/u;
const AGENT_ATTACHMENT_MESSAGE_PATH =
  /^\/api\/agent\/conversations\/([^/]+)\/attachments$/u;
const AGENT_MEDIA_COMPLETE_PATH = /^\/api\/agent\/media\/[^/]+\/complete$/u;

// Authentication is deliberately rate-limited before any D1 lookup or password
// derivation. The Cloudflare Rate Limiter binding keeps this guard off D1's
// write quota while protecting both administrator and agent login endpoints.
app.use('*', async (c, next) => {
  if (c.req.method === 'POST') {
    const pathname = new URL(c.req.url).pathname;
    const authScope = AUTH_LOGIN_PATHS.get(pathname);
    if (authScope) {
      const sourceHash = await requestSourceHash(c.req.raw, 'auth-login');
      const allowed = await passesBurstLimit(
        c.env.AUTH_BURST_LIMITER,
        `${authScope}:${sourceHash}`,
      );
      if (!allowed) {
        c.header('Retry-After', '60');
        return c.json({ error: 'AUTH_RATE_LIMITED' }, 429);
      }
    }
  }
  await next();
});

app.route('/', integrationApi);

// Visitor writes notify only the assigned seat. Delivery runs after the chat
// response and never blocks or changes the result of the message transaction.
app.use('/client/v1/*', async (c, next) => {
  await next();
  if (c.req.method !== 'POST' || !c.res.ok) return;

  const pathname = new URL(c.req.url).pathname;
  const notification =
    c.get('agentNotification') ??
    (await agentNotificationForVisitorResponse(pathname, c.res));
  if (!notification) return;

  c.executionCtx.waitUntil(
    sendAgentPushForMessage(c.env, notification).catch((error) => {
      console.warn('Agent push dispatch failed.', error);
    }),
  );
});

// Agent replies are persisted first. A successful text, structured attachment,
// or image reply then wakes subscribed visitor devices without owning the chat
// transaction.
app.use('/api/agent/*', async (c, next) => {
  await next();
  if (c.req.method !== 'POST' || !c.res.ok) return;

  const pathname = new URL(c.req.url).pathname;
  const textMatch = pathname.match(AGENT_TEXT_MESSAGE_PATH);
  const attachmentMatch = pathname.match(AGENT_ATTACHMENT_MESSAGE_PATH);
  const conversationMatch = textMatch ?? attachmentMatch;
  if (conversationMatch?.[1] && c.res.status === 201) {
    const conversationId = decodeURIComponent(conversationMatch[1]);
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
    if (!payload.conversationId || payload.duplicate) return;
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

app.route('/', adminQuotaApi);
app.route('/', adminConfigApi);
app.route('/', adminRoutingApi);
app.route('/', mediaApi);
app.route('/', agentAttachmentApi);
app.route('/', agentCardIconApi);
app.route('/', agentAvatarApi);
app.route('/', agentAutoReplyApi);
app.route('/', agentBootstrapApi);
app.route('/', agentApi);
app.route('/', agentPushApi);
app.route('/', pushApi);
app.route('/', clientApi);

// Core owns health, admin authentication, Durable Object implementation,
// unknown API rejection, and direct asset lookup. SPA shell fallback is kept
// explicit below so protocol requests can never inherit an HTML 200 response.
app.route('/', coreApp);

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const pathname = new URL(request.url).pathname;

    // Removed protocols are rejected before Hono and before any asset lookup.
    if (isRemovedProtocolPath(pathname)) {
      return removedProtocolResponse();
    }

    const response = await app.fetch(request, env, ctx);
    if (
      response.status !== 404 ||
      isProtocolNamespacePath(pathname) ||
      !isSpaNavigationRequest(request)
    ) {
      return response;
    }

    const shellUrl = new URL('/index.html', request.url);
    const shellRequest = new Request(shellUrl, {
      method: request.method,
      headers: request.headers,
    });
    return env.ASSETS.fetch(shellRequest);
  },
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

function isProtocolNamespacePath(pathname: string): boolean {
  return PROTOCOL_NAMESPACE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isSpaNavigationRequest(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  return (request.headers.get('Accept') ?? '').includes('text/html');
}
