export type AdminSiteSettings = {
  noAgentMessage: string;
};

const errorMessages: Record<string, string> = {
  UNAUTHORIZED: '登录已失效，请重新登录',
  INVALID_NO_AGENT_MESSAGE: '提示语不能为空，且最多 300 个字符',
  SITE_SETTINGS_UPDATE_FAILED: '保存访客提示失败，请稍后重试',
};

export async function getAdminSiteSettings(): Promise<AdminSiteSettings> {
  const response = await request<{ settings: AdminSiteSettings }>(
    '/api/admin/settings',
  );
  return response.settings;
}

export async function updateAdminSiteSettings(
  settings: AdminSiteSettings,
): Promise<AdminSiteSettings> {
  const response = await request<{ settings: AdminSiteSettings }>(
    '/api/admin/settings',
    {
      method: 'PATCH',
      body: JSON.stringify(settings),
    },
  );
  return response.settings;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
