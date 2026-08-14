export type AdminSessionState = {
  authenticated: boolean;
  configured: boolean;
};

export type ProductCatalogItem = {
  id: string;
  title: string;
  href: string | null;
  coverUrl: string | null;
  sectionId: string | null;
  sectionName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isEnabled: boolean;
};

export type AgentRoutingScope =
  | { type: 'none' }
  | { type: 'section'; sectionId: string }
  | { type: 'category'; sectionId: string; categoryIds: string[] }
  | { type: 'product'; productIds: string[] };

export type AgentAccount = {
  id: string;
  name: string;
  username: string | null;
  status: 'online' | 'busy' | 'offline';
  isEnabled: boolean;
  maxActiveConversations: number;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  hasPassword: boolean;
  productIds: string[];
  routingScope?: AgentRoutingScope;
};

export type AgentIdentity = {
  id: string;
  name: string;
  username: string;
  status: 'online' | 'busy' | 'offline';
};

export type AgentSessionState = {
  authenticated: boolean;
  agent: AgentIdentity | null;
};

export type Overview = {
  open: number;
  pending: number;
  closed: number;
  total: number;
};

export type Conversation = {
  id: string;
  site_id: string;
  visitor_id: string;
  status: 'open' | 'pending' | 'closed';
  subject: string | null;
  group_id: string | null;
  product_id: string | null;
  product_title: string | null;
  product_cover_url: string | null;
  product_href: string | null;
  assigned_agent: string | null;
  agent_unread_count: number;
  last_message_at: string;
  created_at: string;
  expires_at: string | null;
  visitor_name: string | null;
  last_message: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_type: 'visitor' | 'agent' | 'system';
  sender_id: string | null;
  body: string;
  read_by_visitor_at: string | null;
  read_by_agent_at: string | null;
  created_at: string;
};

export type ConversationDetail = {
  conversation: Conversation & Record<string, unknown>;
  messages: Message[];
};

const productSelectionScopeKey = Symbol('product-selection-routing-scope');

type ScopedProductIds = string[] & {
  [productSelectionScopeKey]?: AgentRoutingScope;
};

type AdminBootstrapPayload = {
  agents: AgentAccount[];
  products: ProductCatalogItem[];
};

let adminBootstrapRequest: Promise<AdminBootstrapPayload> | null = null;

const errorMessages: Record<string, string> = {
  INVALID_CREDENTIALS: '账号或密码错误',
  UNAUTHORIZED: '登录已失效，请重新登录',
  ADMIN_NOT_CONFIGURED: '管理员密码尚未配置',
  NOT_FOUND: '请求的内容不存在',
  INVALID_MESSAGE: '消息内容无效',
  INVALID_STATUS: '会话状态无效',
  INVALID_AGENT: '客服账号信息不完整',
  INVALID_PASSWORD: '密码至少 4 个字符',
  PASSWORD_REQUIRED: '请先为客服设置登录密码',
  USERNAME_EXISTS: '登录账号已存在',
  INVALID_GROUP: '客服分组名称无效',
  INVALID_ROUTING_RULES: '分流规则无效，请重新选择分区或分类',
  INVALID_ROUTING_SCOPE: '负责范围无效，请重新选择分区、分类或产品',
  AGENT_CREATE_FAILED: '创建客服失败，请重新提交',
  CONVERSATION_CLOSED: '会话已关闭',
};

export function attachProductSelectionScope(
  ids: string[],
  scope: AgentRoutingScope,
): string[] {
  const selection = [...ids] as ScopedProductIds;
  Object.defineProperty(selection, productSelectionScopeKey, {
    configurable: true,
    enumerable: false,
    value: scope,
    writable: true,
  });
  return selection;
}

export function getProductSelectionScope(
  ids: string[],
): AgentRoutingScope | null {
  return (ids as ScopedProductIds)[productSelectionScopeKey] ?? null;
}

export async function getAdminSession(): Promise<AdminSessionState> {
  return request('/api/auth/session');
}

export async function adminLogin(password: string): Promise<void> {
  await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function adminLogout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' });
}

export async function getAgents(): Promise<AgentAccount[]> {
  const response = await getAdminBootstrap();
  return response.agents.map((agent) => {
    const scope = normalizeRoutingScope(agent.routingScope, agent.productIds);
    return {
      ...agent,
      productIds: attachProductSelectionScope(
        expandRoutingScopeProductIds(scope, response.products),
        scope,
      ),
    };
  });
}

export async function createAgent(input: {
  name: string;
  username: string;
  password: string;
  productIds: string[];
  maxActiveConversations: number;
  isEnabled: boolean;
}): Promise<void> {
  await request('/api/admin/agents', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      routingScope: scopeForRequest(input.productIds),
    }),
  });
}

export async function updateAgent(
  id: string,
  input: {
    name: string;
    username: string;
    password?: string;
    productIds: string[];
    maxActiveConversations: number;
    isEnabled: boolean;
  },
): Promise<void> {
  await request(`/api/admin/agents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...input,
      routingScope: scopeForRequest(input.productIds),
    }),
  });
}

export async function getProductCatalog(): Promise<ProductCatalogItem[]> {
  const response = await getAdminBootstrap();
  return response.products;
}

export async function getAgentSession(): Promise<AgentSessionState> {
  return request('/api/agent/auth/session');
}

export async function agentLogin(
  username: string,
  password: string,
): Promise<AgentIdentity> {
  const response = await request<{ agent: AgentIdentity }>(
    '/api/agent/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    },
  );
  return response.agent;
}

export async function agentLogout(): Promise<void> {
  await request('/api/agent/auth/logout', { method: 'POST' });
}

export async function heartbeat(): Promise<void> {
  await request('/api/agent/auth/heartbeat', { method: 'POST' });
}

export async function getOverview(): Promise<Overview> {
  return request('/api/agent/overview');
}

export async function getConversations(
  status?: Conversation['status'],
): Promise<Conversation[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await request<{ conversations: Conversation[] }>(
    `/api/agent/conversations${query}`,
  );
  return response.conversations;
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  return request(`/api/agent/conversations/${encodeURIComponent(id)}/messages`);
}

export async function markConversationRead(
  id: string,
  lastMessageId: string | null = null,
): Promise<void> {
  await request(`/api/agent/conversations/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    body: JSON.stringify({ lastMessageId }),
  });
}

export async function sendMessage(id: string, body: string): Promise<Message> {
  const response = await request<{ message: Message }>(
    `/api/agent/conversations/${encodeURIComponent(id)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    },
  );
  return response.message;
}

export async function setConversationStatus(
  id: string,
  status: Conversation['status'],
): Promise<void> {
  await request(`/api/agent/conversations/${encodeURIComponent(id)}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export function openAgentInboxSocket(): WebSocket {
  return openSocket('/api/agent/realtime/inbox', true);
}

export function openConversationSocket(id: string): WebSocket {
  return openSocket(`/api/agent/realtime/${encodeURIComponent(id)}`);
}

function getAdminBootstrap(): Promise<AdminBootstrapPayload> {
  if (!adminBootstrapRequest) {
    const pending = request<AdminBootstrapPayload>('/api/admin/bootstrap');
    adminBootstrapRequest = pending;
    void pending.then(
      () => {
        if (adminBootstrapRequest === pending) adminBootstrapRequest = null;
      },
      () => {
        if (adminBootstrapRequest === pending) adminBootstrapRequest = null;
      },
    );
  }
  return adminBootstrapRequest;
}

function normalizeRoutingScope(
  scope: AgentRoutingScope | undefined,
  productIds: string[],
): AgentRoutingScope {
  if (!scope) {
    return productIds.length
      ? { type: 'product', productIds: [...productIds] }
      : { type: 'none' };
  }
  if (scope.type === 'category') {
    return {
      type: 'category',
      sectionId: scope.sectionId,
      categoryIds: [...scope.categoryIds],
    };
  }
  if (scope.type === 'product') {
    return { type: 'product', productIds: [...scope.productIds] };
  }
  return scope;
}

function expandRoutingScopeProductIds(
  scope: AgentRoutingScope,
  products: ProductCatalogItem[],
): string[] {
  if (scope.type === 'none') return [];
  if (scope.type === 'product') return [...scope.productIds];
  if (scope.type === 'section') {
    return products
      .filter(
        (product) => product.isEnabled && product.sectionId === scope.sectionId,
      )
      .map((product) => product.id);
  }
  const categoryIds = new Set(scope.categoryIds);
  return products
    .filter(
      (product) =>
        product.isEnabled &&
        product.sectionId === scope.sectionId &&
        Boolean(product.categoryId) &&
        categoryIds.has(product.categoryId as string),
    )
    .map((product) => product.id);
}

function scopeForRequest(productIds: string[]): AgentRoutingScope {
  return (
    getProductSelectionScope(productIds) ??
    (productIds.length
      ? { type: 'product', productIds: [...productIds] }
      : { type: 'none' })
  );
}

function openSocket(path: string, keepAlive = false): WebSocket {
  const url = new URL(path, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  if (!keepAlive) return socket;

  let timer: number | null = null;
  const stop = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };
  const ping = () => {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send('ping');
    } catch {
      socket.close();
    }
  };
  socket.addEventListener('open', () => {
    ping();
    stop();
    timer = window.setInterval(ping, 60_000);
  });
  socket.addEventListener('close', stop);
  return socket;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  });

  if (response.status === 204) return undefined as T;
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  } & T;
  if (!response.ok) {
    throw new Error(
      (payload.error && errorMessages[payload.error]) ||
        `请求失败（状态码 ${response.status}）`,
    );
  }
  return payload;
}
