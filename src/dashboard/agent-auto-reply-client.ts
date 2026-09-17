export type AgentAutoReplySettings = {
  enabled: boolean;
  text: string;
  attachmentIds: string[];
  ctas: AgentGreetingCta[];
};

export type AgentGreetingCta = {
  id: string;
  label: string;
  answer: string;
  enabled: boolean;
};

export type AgentGreetingPreset = {
  id: string;
  name: string;
  text: string;
};

export type AgentCtaPreset = AgentGreetingCta;

export type AgentFirstReplyItemType =
  'greeting' | 'cta' | 'contact_card' | 'image';

export type AgentFirstReplyItem = {
  id: string;
  type: AgentFirstReplyItemType;
  materialId: string;
  sortOrder: number;
};

export type AgentFirstReplyProfile = {
  id: string;
  name: string;
  items: AgentFirstReplyItem[];
};

export type AgentFirstReplySettings = {
  enabled: boolean;
  activeProfileId: string | null;
  greetings: AgentGreetingPreset[];
  ctas: AgentCtaPreset[];
  profiles: AgentFirstReplyProfile[];
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

export async function getAgentFirstReplySettings(): Promise<AgentFirstReplySettings> {
  const response = await autoReplyRequest<{
    settings: AgentFirstReplySettings;
  }>('/api/agent/first-reply');
  return normalizeFirstReplySettings(response.settings);
}

export async function updateAgentFirstReplySettings(
  settings: AgentFirstReplySettings,
): Promise<AgentFirstReplySettings> {
  const response = await autoReplyRequest<{
    settings: AgentFirstReplySettings;
  }>('/api/agent/first-reply', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  });
  return normalizeFirstReplySettings(response.settings);
}

function normalizeFirstReplySettings(
  settings: AgentFirstReplySettings,
): AgentFirstReplySettings {
  return {
    ...settings,
    profiles: settings.profiles.map((profile) => {
      const legacy = profile as AgentFirstReplyProfile & {
        greetingId?: string | null;
        attachmentIds?: string[];
        ctaIds?: string[];
      };
      if (Array.isArray(profile.items)) {
        return {
          id: profile.id,
          name: profile.name,
          items: profile.items.map((item, index) => ({
            ...item,
            sortOrder: index,
          })),
        };
      }
      const greetingId = legacy.greetingId ?? null;
      const attachmentIds = legacy.attachmentIds ?? [];
      const ctaIds = legacy.ctaIds ?? [];
      return {
        id: profile.id,
        name: profile.name,
        items: [
          ...(greetingId
            ? [
                {
                  id: `${profile.id}:greeting:${greetingId}`,
                  type: 'greeting' as const,
                  materialId: greetingId,
                  sortOrder: 0,
                },
              ]
            : []),
          ...attachmentIds.map((materialId, index) => ({
            id: `${profile.id}:attachment:${materialId}`,
            type: 'contact_card' as const,
            materialId,
            sortOrder: index + (greetingId ? 1 : 0),
          })),
          ...ctaIds.map((materialId, index) => ({
            id: `${profile.id}:cta:${materialId}`,
            type: 'cta' as const,
            materialId,
            sortOrder: index + (greetingId ? 1 : 0) + attachmentIds.length,
          })),
        ],
      };
    }),
  };
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
    if (body.error === 'INVALID_FIRST_REPLY') {
      throw new Error('首次回复配置无效，请检查素材和组合关系');
    }
    if (body.error === 'FIRST_REPLY_CONTENT_REQUIRED') {
      throw new Error('开启自动回复时至少保留一个问候语或附件');
    }
    throw new Error(body.error ?? '自动回复设置保存失败');
  }
  return body;
}
