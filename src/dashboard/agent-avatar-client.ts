export type AgentAvatarProfile = {
  avatarUrl: string | null;
};

const avatarErrors: Record<string, string> = {
  UNAUTHORIZED: '登录已失效，请重新登录',
  INVALID_AVATAR_IMAGE: '头像图片无效，请重新选择',
  AVATAR_TOO_LARGE: '压缩后的头像仍然过大，请换一张图片',
};

export async function getAgentAvatarProfile(): Promise<AgentAvatarProfile> {
  return avatarRequest('/api/agent/avatar');
}

export async function uploadAgentAvatar(
  blob: Blob,
  mimeType: string,
): Promise<AgentAvatarProfile> {
  return avatarRequest('/api/agent/avatar', {
    method: 'PUT',
    headers: { 'content-type': mimeType },
    body: blob,
  });
}

export async function deleteAgentAvatar(): Promise<AgentAvatarProfile> {
  return avatarRequest('/api/agent/avatar', { method: 'DELETE' });
}

async function avatarRequest<T = AgentAvatarProfile>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    const code = body.error ?? 'REQUEST_FAILED';
    throw new Error(avatarErrors[code] ?? code);
  }
  return body;
}
