import { prepareChatImage, releasePreparedImage } from './image-compress';
import { uploadPreparedImage, type UploadTarget } from './image-upload';

export type AgentMediaItem = {
  messageId: string;
  id: string;
  kind: 'image';
  mimeType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
  status: 'ready';
  url: string;
};

type InitResponse = {
  conversationId: string;
  media: Omit<AgentMediaItem, 'messageId' | 'url'>;
  upload: UploadTarget;
};

export async function getAgentMedia(
  conversationId: string,
): Promise<AgentMediaItem[]> {
  const response = await request<{ items: Array<Omit<AgentMediaItem, 'url'>> }>(
    `/api/agent/conversations/${encodeURIComponent(conversationId)}/media`,
  );
  return response.items.map((item) => ({
    ...item,
    url: `/api/agent/media/${encodeURIComponent(item.id)}/content`,
  }));
}

export async function sendAgentImage(
  conversationId: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<{ messageId: string; createdAt: string; media: AgentMediaItem }> {
  const image = await prepareChatImage(file);
  try {
    const init = await request<InitResponse>(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/media/init`,
      {
        method: 'POST',
        body: JSON.stringify({
          mimeType: image.mimeType,
          byteSize: image.byteSize,
          width: image.width,
          height: image.height,
          originalName: image.originalName,
        }),
      },
    );
    await uploadPreparedImage(init.upload, image, onProgress);
    const complete = await request<{
      messageId: string;
      createdAt: string;
      media: Omit<AgentMediaItem, 'messageId' | 'url'>;
    }>(`/api/agent/media/${encodeURIComponent(init.media.id)}/complete`, {
      method: 'POST',
      body: '{}',
    });
    return {
      messageId: complete.messageId,
      createdAt: complete.createdAt,
      media: {
        ...complete.media,
        messageId: complete.messageId,
        url: `/api/agent/media/${encodeURIComponent(complete.media.id)}/content`,
      },
    };
  } finally {
    releasePreparedImage(image);
  }
}

async function request<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  });
  const payload = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || `请求失败（状态码 ${response.status}）`);
  }
  return payload;
}
