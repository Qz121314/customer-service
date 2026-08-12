export type SessionState = {
  authenticated: boolean;
  configured: boolean;
};

export type Overview = {
  open: number;
  pending: number;
  closed: number;
  visitors: number;
  messages: number;
};

export type Conversation = {
  id: string;
  site_id: string;
  visitor_id: string;
  status: 'open' | 'pending' | 'closed';
  subject: string | null;
  assigned_agent: string | null;
  last_message_at: string;
  created_at: string;
  visitor_name: string | null;
  last_message: string | null;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_type: 'visitor' | 'agent' | 'system';
  sender_id: string | null;
  body: string;
  created_at: string;
};

export type ConversationDetail = {
  conversation: Conversation & Record<string, unknown>;
  messages: Message[];
};

export async function getSession(): Promise<SessionState> {
  return request('/api/auth/session');
}

export async function login(password: string): Promise<void> {
  await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export async function logout(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' });
}

export async function getOverview(): Promise<Overview> {
  return request('/api/admin/overview');
}

export async function getConversations(
  status?: Conversation['status'],
): Promise<Conversation[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const response = await request<{ conversations: Conversation[] }>(
    `/api/admin/conversations${query}`,
  );
  return response.conversations;
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  return request(`/api/admin/conversations/${id}/messages`);
}

export async function sendMessage(id: string, body: string): Promise<Message> {
  const response = await request<{ message: Message }>(
    `/api/admin/conversations/${id}/messages`,
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
  await request(`/api/admin/conversations/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export function openConversationSocket(id: string): WebSocket {
  const url = new URL(`/api/admin/realtime/${id}`, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(url);
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
    message?: string;
    error?: string;
  } & T;
  if (!response.ok) {
    throw new Error(
      payload.message || payload.error || `Request failed (${response.status})`,
    );
  }
  return payload;
}
