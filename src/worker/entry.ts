import { Hono } from 'hono';
import { coreApp, ConversationRoom } from './core';
import { clientApi } from './client-api';
import { integrationApi } from './integration-api';
import { adminConfigApi } from './admin-config-api';
import { agentApi } from './agent-api';
import { mediaApi } from './media-api';
import { pushApi } from './push-api';
import { sendVisitorPushForConversation } from './visitor-push';
import { sendAgentPushForConversation } from './agent-push';
import { agentPushApi } from './agent-push-api';
import { purgeExpiredConversations } from './conversation-retention';
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
  ADMIN_PASSWORD?: string;
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
  duplicate?: boolean;
  [key: string]: unknown;
};

const app = new Hono<AppEnv>();
const AGENT_TEXT_MESSAGE_PATH =
  /^\/api\/agent\/conversations\/([^/]+)\/messages$/u;
const AGENT_MEDIA_COMPLETE_PATH = /^\/api\/agent\/media\/[^/]+\/complete$/u;
const CLIENT_CONVERSATION_CREATE_PATH = /^\/client\/v1\/conversations$/u;
const CLIENT_MESSAGE_PATH = /^\/client\/v1\/conversations\/([^/]+)\/messages$/u;
const CLIENT_MEDIA_COMPLETE_PATH = /^\/client\/v1\/media\/[^/]+\/complete$/u;
const LOCAL_QUICK_REPLY_HEADER = 'X-CS-Quick-Replies-Local';
const LEGACY_QUICK_REPLY_WRITE_PATH =
  /^\/api\/agent\/quick-replies(?:\/[^/]+)?$/u;
const LEGACY_QUICK_REPLY_SELECT = /\bFROM\s+agent_quick_replies\b/iu;

app.route('/', integrationApi);

// Visitor writes notify only the assigned seat. Delivery runs after the chat
// response and never blocks or changes the result of the message transaction.
app.use('/client/v1/*', async (c, next) => {
  await next();
  if (c.req.method !== 'POST' || !c.res.ok) return;

  const pathname = new URL(c.req.url).pathname;
  let conversationId: string | null = null;
  const messageMatch = pathname.match(CLIENT_MESSAGE_PATH);
  if (messageMatch?.[1] && c.res.status === 201) {
    conversationId = decodeURIComponent(messageMatch[1]);
  } else if (
    CLIENT_CONVERSATION_CREATE_PATH.test(pathname) &&
    c.res.status === 201
  ) {
    conversationId = await responseConversationId(c.res);
  } else if (CLIENT_MEDIA_COMPLETE_PATH.test(pathname)) {
    const payload = await responseMediaComplete(c.res);
    if (!payload?.duplicate) conversationId = payload?.conversationId ?? null;
  }
  if (!conversationId) return;

  c.executionCtx.waitUntil(
    sendAgentPushForConversation(c.env, conversationId).catch((error) => {
      console.warn('Agent push dispatch failed.', error);
    }),
  );
});

// Agent replies are persisted first. A successful text or image reply then
// wakes subscribed visitor devices without owning the chat transaction.
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

app.route('/', adminConfigApi);
app.route('/', mediaApi);
app.route('/', agentApi);
app.route('/', agentPushApi);
app.route('/', pushApi);
app.route('/', clientApi);

// Core owns only health, admin authentication, Durable Object implementation,
// unknown API rejection, and static asset fallback.
app.route('/', coreApp);

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const pathname = new URL(request.url).pathname;
    // This check runs before Hono and the Assets binding. Removed API paths can
    // therefore never be rewritten to the SPA's index.html with HTTP 200.
    if (isRemovedProtocolPath(pathname)) {
      return removedProtocolResponse();
    }
    if (
      LEGACY_QUICK_REPLY_WRITE_PATH.test(pathname) &&
      (request.method === 'POST' || request.method === 'DELETE')
    ) {
      return new Response(
        JSON.stringify({ error: 'LOCAL_QUICK_REPLIES_ONLY' }),
        {
          status: 410,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        },
      );
    }
    const requestEnv =
      request.headers.get(LOCAL_QUICK_REPLY_HEADER) === '1'
        ? { ...env, DB: withoutLegacyQuickReplyReads(env.DB) }
        : env;
    return app.fetch(request, requestEnv, ctx);
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

function withoutLegacyQuickReplyReads(db: D1Database): D1Database {
  return new Proxy(db, {
    get(target, property) {
      if (property === 'prepare') {
        return (query: string) =>
          LEGACY_QUICK_REPLY_SELECT.test(query)
            ? emptyQuickReplyStatement()
            : target.prepare(query);
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function emptyQuickReplyStatement(): D1PreparedStatement {
  const emptyResult = { results: [], success: true, meta: {} };
  const statement = {
    bind: () => statement,
    first: async () => null,
    run: async () => emptyResult,
    all: async () => emptyResult,
    raw: async () => [],
  } as unknown as D1PreparedStatement;
  return statement;
}

async function responseConversationId(
  response: Response,
): Promise<string | null> {
  try {
    const value = (await response.clone().json()) as {
      conversation?: { id?: string };
    };
    const id = value.conversation?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

async function responseMediaComplete(
  response: Response,
): Promise<MediaCompletePayload | null> {
  try {
    return (await response.clone().json()) as MediaCompletePayload;
  } catch {
    return null;
  }
}
