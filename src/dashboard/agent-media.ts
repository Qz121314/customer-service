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
  media: Omit<AgentMediaItem, 'messageId' | 'url' | 'status'> & {
    status: 'pending' | 'ready';
  };
  upload?: UploadTarget;
  completed?: { messageId: string; createdAt: string };
};

export async function sendAgentImage(
  conversationId: string,
  file: File,
  clientUploadId: string,
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
          clientUploadId,
        }),
      },
    );
    if (init.completed && init.media.status === 'ready') {
      onProgress?.(1);
      return {
        messageId: init.completed.messageId,
        createdAt: init.completed.createdAt,
        media: {
          ...init.media,
          status: 'ready',
          messageId: init.completed.messageId,
          url: `/api/agent/media/${encodeURIComponent(init.media.id)}/content`,
        },
      };
    }
    if (!init.upload) throw new Error('图片上传地址无效');
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
