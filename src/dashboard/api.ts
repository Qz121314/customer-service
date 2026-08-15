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
  dailyConversationLimit: number;
  todayConversationCount: number;
  lastLoginAt: string | null;
  lastSeenAt: string | null;
  hasPassword: boolean;
  routingScope: AgentRoutingScope;
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
  todayAccepted: number;
  dailyLimit: number;
};

export type AgentMonthlyStats = {
  month: string;
  days: number[];
  counts: Array<{ agentId: string; day: number; count: number }>;
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

type AdminBootstrapAgent = Omit<AgentAccount, 'routingScope'> & {
  productIds?: string[];
  routingScope?: AgentRoutingScope;
};

type AdminBootstrapPayload = {
  agents: AdminBootstrapAgent[];
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
  INVALID_MONTH: '月份格式无效',
  AGENT_CREATE_FAILED: '创建客服失败，请重新提交',
  CONVERSATION_CLOSED: '会话已关闭',
};

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
  return response.agents.map((agent) => ({
    ...agent,
    routingScope: normalizeRoutingScope(
      agent.routingScope,
      agent.productIds ?? [],
    ),
  }));
}

export async function createAgent(input: {
  name: string;
  username: string;
  password: string;
  routingScope: AgentRoutingScope;
  maxActiveConversations: number;
  dailyConversationLimit: number;
  isEnabled: boolean;
}): Promise<void> {
  await request('/api/admin/agents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateAgent(
  id: string,
  input: {
    name: string;
    username: string;
    password?: string;
    routingScope: AgentRoutingScope;
    maxActiveConversations: number;
    dailyConversationLimit: number;
    isEnabled: boolean;
  },
): Promise<void> {
  await request(`/api/admin/agents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function getProductCatalog(): Promise<ProductCatalogItem[]> {
  const response = await getAdminBootstrap();
  return response.products;
}

export async function getAgentMonthlyStats(
  month: string,
): Promise<AgentMonthlyStats> {
  return request(`/api/admin/agent-stats?month=${encodeURIComponent(month)}`);
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

async function getAdminBootstrap(): Promise<AdminBootstrapPayload> {
  if (adminBootstrapRequest) return adminBootstrapRequest;
  const requestPromise = request<AdminBootstrapPayload>('/api/admin/bootstrap');
  adminBootstrapRequest = requestPromise;
  requestPromise.finally(() => {
    if (adminBootstrapRequest === requestPromise) adminBootstrapRequest = null;
  });
  return requestPromise;
}

function normalizeRoutingScope(
  scope: AgentRoutingScope | undefined,
  fallbackProductIds: string[],
): AgentRoutingScope {
  if (scope?.type === 'section' && scope.sectionId) {
    return { type: 'section', sectionId: scope.sectionId };
  }
  if (scope?.type === 'category' && scope.sectionId) {
    return {
      type: 'category',
      sectionId: scope.sectionId,
      categoryIds: [...new Set(scope.categoryIds.filter(Boolean))],
    };
  }
  if (scope?.type === 'product') {
    return {
      type: 'product',
      productIds: [...new Set(scope.productIds.filter(Boolean))],
    };
  }
  const legacyProductIds = [...new Set(fallbackProductIds.filter(Boolean))];
  return legacyProductIds.length
    ? { type: 'product', productIds: legacyProductIds }
    : { type: 'none' };
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

async function request<T = { ok: boolean }>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    const code = body.error ?? 'REQUEST_FAILED';
    throw new Error(errorMessages[code] ?? code);
  }
  return body;
}
