export type AgentAutoReplySettings = {
  enabled: boolean;
  text: string;
  attachmentIds: string[];
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
    throw new Error(body.error ?? '自动回复设置保存失败');
  }
  return body;
}
