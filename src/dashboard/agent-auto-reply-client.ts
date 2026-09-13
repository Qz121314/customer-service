export type AgentAutoReplySettings = {
  enabled: boolean;
  text: string;
  attachmentIds: string[];
};

export type AgentQuickReply = {
  id: string;
  question: string;
  answer: string;
  enabled: boolean;
};

type AgentAutoReplyPayload = {
  settings: AgentAutoReplySettings;
};

export async function getAgentAutoReplySettings(): Promise<AgentAutoReplySettings> {
  const response = await autoReplyRequest<AgentAutoReplyPayload>(
    '/api/agent/settings/auto-reply',
  );
  return response.settings;
}

export async function updateAgentAutoReplySettings(
  settings: AgentAutoReplySettings,
): Promise<AgentAutoReplySettings> {
  const response = await autoReplyRequest<AgentAutoReplyPayload>(
    '/api/agent/settings/auto-reply',
    {
      method: 'PATCH',
      body: JSON.stringify(settings),
    },
  );
  return response.settings;
}

export async function getAgentQuickReplies(): Promise<AgentQuickReply[]> {
  const response = await autoReplyRequest<{
    quickReplies: AgentQuickReply[];
  }>('/api/agent/settings/quick-replies');
  return response.quickReplies;
}

export async function updateAgentQuickReplies(
  quickReplies: AgentQuickReply[],
): Promise<AgentQuickReply[]> {
  const response = await autoReplyRequest<{
    quickReplies: AgentQuickReply[];
  }>('/api/agent/settings/quick-replies', {
    method: 'PUT',
    body: JSON.stringify({ quickReplies }),
  });
  return response.quickReplies;
}

async function autoReplyRequest<T>(
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
    if (body.error === 'UNAUTHORIZED') {
      throw new Error('登录已失效，请重新登录');
    }
    if (body.error === 'INVALID_AUTO_REPLY') {
      throw new Error('问候语或附件设置无效，请检查后保存');
    }
    if (body.error === 'INVALID_QUICK_REPLIES') {
      throw new Error('快捷问答无效，请检查问题和答案后保存');
    }
    throw new Error(body.error ?? '自动回复设置保存失败');
  }
  return body;
}
