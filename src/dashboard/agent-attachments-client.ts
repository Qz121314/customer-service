import type { Message } from './api';

export type AgentAttachmentPreset =
  | {
      id: string;
      kind: 'phone' | 'link';
      label: string;
      value: string;
    }
  | {
      id: string;
      kind: 'image';
      label: string;
      value: null;
      mimeType: string;
      byteSize: number;
      width: number | null;
      height: number | null;
      originalName: string | null;
    };

export type AgentMessageAttachment =
  | {
      id: string;
      messageId?: string;
      kind: 'phone' | 'link';
      label: string;
      value: string;
    }
  | {
      id: string;
      messageId?: string;
      kind: 'image';
      label: string;
      value?: null;
      mimeType: string;
      byteSize: number;
      width: number | null;
      height: number | null;
      originalName: string | null;
      source?: 'media' | 'snapshot';
      url?: string;
    };

export async function getAgentAttachmentPresets(): Promise<AgentAttachmentPreset[]> {
  const response = await attachmentRequest<{ presets: AgentAttachmentPreset[] }>(
    '/api/agent/attachments/presets',
  );
  return response.presets;
}

export async function createAgentAttachmentPreset(input: {
  kind: 'phone' | 'link';
  label: string;
  value: string;
}): Promise<AgentAttachmentPreset> {
  const response = await attachmentRequest<{ preset: AgentAttachmentPreset }>(
    '/api/agent/attachments/presets',
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  return response.preset;
}

export async function updateAgentAttachmentPreset(
  id: string,
  input: { label: string; value?: string },
): Promise<AgentAttachmentPreset> {
  const response = await attachmentRequest<{ preset: AgentAttachmentPreset }>(
    `/api/agent/attachments/presets/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
  return response.preset;
}

export async function deleteAgentAttachmentPreset(id: string): Promise<void> {
  await attachmentRequest(`/api/agent/attachments/presets/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function uploadAgentAttachmentImage(
  file: File,
  label = '问候图片',
): Promise<AgentAttachmentPreset> {
  const form = new FormData();
  form.set('file', file);
  form.set('label', label);
  const response = await fetch('/api/agent/attachments/presets/image', {
    method: 'POST',
    body: form,
  });
  const body = (await response.json().catch(() => ({}))) as {
    preset?: AgentAttachmentPreset;
    error?: string;
  };
  if (!response.ok || !body.preset) {
    throw new Error(attachmentError(body.error));
  }
  return body.preset;
}

export async function sendAgentPresetAttachments(
  conversationId: string,
  input: {
    body: string;
    presetIds: string[];
    clientMessageId: string;
  },
): Promise<{ message: Message; attachments: AgentMessageAttachment[] }> {
  return attachmentRequest(
    `/api/agent/conversations/${encodeURIComponent(conversationId)}/attachments`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
}

export function agentAttachmentContentUrl(
  attachment: Pick<AgentMessageAttachment, 'id' | 'kind'> & {
    source?: 'media' | 'snapshot';
  },
): string | null {
  if (attachment.kind !== 'image') return null;
  return attachment.source === 'snapshot'
    ? `/api/agent/attachments/${encodeURIComponent(attachment.id)}/content`
    : `/api/agent/media/${encodeURIComponent(attachment.id)}/content`;
}

export function agentPresetImageUrl(presetId: string): string {
  return `/api/agent/attachments/presets/${encodeURIComponent(presetId)}/content`;
}

async function attachmentRequest<T = { ok: boolean }>(
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
  if (!response.ok) throw new Error(attachmentError(body.error));
  return body;
}

function attachmentError(code?: string): string {
  switch (code) {
    case 'INVALID_ATTACHMENT_PRESET':
      return '联系方式或链接格式无效';
    case 'INVALID_ATTACHMENT_IMAGE':
      return '问候图片无效，请选择 JPG、PNG、WebP 或 GIF 图片';
    case 'INVALID_MESSAGE_ATTACHMENTS':
      return '附件消息无效，请重新选择';
    case 'CONVERSATION_CLOSED':
      return '会话已关闭';
    case 'UNAUTHORIZED':
      return '登录已失效，请重新登录';
    case 'NOT_FOUND':
      return '附件或会话不存在';
    default:
      return code || '附件操作失败';
  }
}
