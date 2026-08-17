type QuickReply = {
  id: string;
  title: string;
  body: string;
};

type AgentPayload = {
  agent?: { id?: unknown } | null;
  authenticated?: boolean;
};

type AgentInboxPayload = {
  quickReplies?: unknown;
  [key: string]: unknown;
};

const QUICK_REPLY_LIMIT = 30;
const QUICK_REPLY_TITLE_LIMIT = 40;
const QUICK_REPLY_BODY_LIMIT = 1000;
const ACTIVE_AGENT_KEY = 'cs-agent-active-id';
const LOCAL_ONLY_HEADER = 'X-CS-Quick-Replies-Local';
const LOCAL_ONLY_HEADER_VALUE = '1';
const QUICK_REPLY_PATH = '/api/agent/quick-replies';
const INBOX_PATH = '/api/agent/conversations';
const HEARTBEAT_PATH = '/api/agent/auth/heartbeat';
const STATUS_PATH = '/api/agent/auth/status';
const SESSION_PATH = '/api/agent/auth/session';
const LOGIN_PATH = '/api/agent/auth/login';
const LOGOUT_PATH = '/api/agent/auth/logout';

let activeAgentId = readSessionAgentId();

if (window.location.pathname.startsWith('/agent')) {
  installLocalQuickReplyTransport();
}

function installLocalQuickReplyTransport(): void {
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== window.location.origin) return nativeFetch(request);

    const method = request.method.toUpperCase();
    const pathname = url.pathname;

    if (pathname === QUICK_REPLY_PATH && method === 'POST') {
      return createQuickReplyResponse(request);
    }

    if (pathname.startsWith(`${QUICK_REPLY_PATH}/`) && method === 'DELETE') {
      return deleteQuickReplyResponse(pathname);
    }

    const shouldHydrateInbox = isInboxResponse(pathname, method);
    const shouldBypassRemoteQuickReplies =
      shouldHydrateInbox &&
      Boolean(activeAgentId) &&
      hasCompletedMigration(activeAgentId as string);
    const forwardedRequest = shouldBypassRemoteQuickReplies
      ? withLocalOnlyHeader(request)
      : request;
    const response = await nativeFetch(forwardedRequest);

    if (pathname === SESSION_PATH && method === 'GET') {
      await captureSessionIdentity(response);
      return response;
    }

    if (pathname === LOGIN_PATH && method === 'POST') {
      await captureLoginIdentity(response);
      return response;
    }

    if (pathname === LOGOUT_PATH && method === 'POST') {
      if (response.ok) clearActiveAgent();
      return response;
    }

    if (!shouldHydrateInbox || !response.ok || !activeAgentId) return response;
    return hydrateInboxQuickReplies(response, activeAgentId);
  };
}

function isInboxResponse(pathname: string, method: string): boolean {
  return (
    (pathname === INBOX_PATH && method === 'GET') ||
    (pathname === HEARTBEAT_PATH && method === 'POST') ||
    (pathname === STATUS_PATH && method === 'POST')
  );
}

function withLocalOnlyHeader(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.set(LOCAL_ONLY_HEADER, LOCAL_ONLY_HEADER_VALUE);
  return new Request(request, { headers });
}

async function captureSessionIdentity(response: Response): Promise<void> {
  if (!response.ok) return;
  const payload = await readJsonClone<AgentPayload>(response);
  if (!payload) return;
  if (!payload.authenticated || !payload.agent) {
    clearActiveAgent();
    return;
  }
  captureAgent(payload.agent.id);
}

async function captureLoginIdentity(response: Response): Promise<void> {
  if (!response.ok) return;
  const payload = await readJsonClone<AgentPayload>(response);
  if (!payload?.agent) return;
  captureAgent(payload.agent.id);
}

function captureAgent(value: unknown): void {
  if (typeof value !== 'string' || !value) return;
  activeAgentId = value;
  try {
    window.sessionStorage.setItem(ACTIVE_AGENT_KEY, value);
  } catch {
    // Session identity is only an optimization hint; auth remains server-owned.
  }
}

function clearActiveAgent(): void {
  activeAgentId = null;
  try {
    window.sessionStorage.removeItem(ACTIVE_AGENT_KEY);
  } catch {
    // Session storage failures must not interrupt logout.
  }
}

function readSessionAgentId(): string | null {
  try {
    return window.sessionStorage.getItem(ACTIVE_AGENT_KEY);
  } catch {
    return null;
  }
}

async function hydrateInboxQuickReplies(
  response: Response,
  agentId: string,
): Promise<Response> {
  const payload = await readJsonClone<AgentInboxPayload>(response);
  if (!payload) return response;

  if (!hasCompletedMigration(agentId)) {
    const legacyReplies = sanitizeQuickReplies(payload.quickReplies);
    if (legacyReplies.length > 0 && loadQuickReplies(agentId).length === 0) {
      storeQuickReplies(agentId, legacyReplies);
    }
    markMigrationComplete(agentId);
  }

  payload.quickReplies = loadQuickReplies(agentId);
  return replaceJsonResponse(response, payload);
}

async function createQuickReplyResponse(request: Request): Promise<Response> {
  if (!activeAgentId) return errorResponse('UNAUTHORIZED', 401);
  const input = await readJsonClone<{ title?: unknown; body?: unknown }>(
    request,
  );
  const title = normalizeText(input?.title, QUICK_REPLY_TITLE_LIMIT);
  const body = normalizeText(input?.body, QUICK_REPLY_BODY_LIMIT);
  if (!title || !body) return errorResponse('INVALID_QUICK_REPLY', 400);

  const current = loadQuickReplies(activeAgentId);
  if (current.length >= QUICK_REPLY_LIMIT) {
    return errorResponse('QUICK_REPLY_LIMIT_REACHED', 409);
  }

  const reply: QuickReply = { id: crypto.randomUUID(), title, body };
  storeQuickReplies(activeAgentId, [reply, ...current]);
  markMigrationComplete(activeAgentId);
  return jsonResponse({ reply }, 201);
}

function deleteQuickReplyResponse(pathname: string): Response {
  if (!activeAgentId) return errorResponse('UNAUTHORIZED', 401);
  const encodedId = pathname.slice(`${QUICK_REPLY_PATH}/`.length);
  let id = '';
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    return errorResponse('NOT_FOUND', 404);
  }
  if (!id) return errorResponse('NOT_FOUND', 404);

  const current = loadQuickReplies(activeAgentId);
  const next = current.filter((reply) => reply.id !== id);
  if (next.length === current.length) return errorResponse('NOT_FOUND', 404);
  storeQuickReplies(activeAgentId, next);
  markMigrationComplete(activeAgentId);
  return jsonResponse({ ok: true });
}

function loadQuickReplies(agentId: string): QuickReply[] {
  try {
    const raw = window.localStorage.getItem(storageKey(agentId));
    if (!raw) return [];
    return sanitizeQuickReplies(JSON.parse(raw));
  } catch {
    return [];
  }
}

function storeQuickReplies(agentId: string, replies: QuickReply[]): void {
  try {
    const next = sanitizeQuickReplies(replies);
    const key = storageKey(agentId);
    if (next.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Quick replies are local convenience data and must never block active chat.
  }
}

function sanitizeQuickReplies(value: unknown): QuickReply[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const replies: QuickReply[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const row = candidate as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    const title = normalizeText(row.title, QUICK_REPLY_TITLE_LIMIT);
    const body = normalizeText(row.body, QUICK_REPLY_BODY_LIMIT);
    if (!id || !title || !body || seen.has(id)) continue;
    seen.add(id);
    replies.push({ id, title, body });
    if (replies.length >= QUICK_REPLY_LIMIT) break;
  }
  return replies;
}

function normalizeText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function storageKey(agentId: string): string {
  return `cs-agent-quick-replies:${agentId}`;
}

function migrationKey(agentId: string): string {
  return `cs-agent-quick-replies-migrated:${agentId}`;
}

function hasCompletedMigration(agentId: string): boolean {
  try {
    return window.localStorage.getItem(migrationKey(agentId)) === '1';
  } catch {
    return false;
  }
}

function markMigrationComplete(agentId: string): void {
  try {
    window.localStorage.setItem(migrationKey(agentId), '1');
  } catch {
    // A failed migration marker only causes another best-effort legacy read.
  }
}

async function readJsonClone<T>(source: Response | Request): Promise<T | null> {
  try {
    return (await source.clone().json()) as T;
  } catch {
    return null;
  }
}

function replaceJsonResponse(response: Response, payload: unknown): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function errorResponse(error: string, status: number): Response {
  return jsonResponse({ error }, status);
}
