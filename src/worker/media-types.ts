export type MediaBindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  CONVERSATION_ROOMS: DurableObjectNamespace;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
};

export type MediaSenderType = 'visitor' | 'agent';

export type MediaRow = {
  id: string;
  conversation_id: string;
  message_id: string | null;
  reserved_message_id: string;
  sender_type: MediaSenderType;
  sender_id: string | null;
  object_key: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  original_name: string | null;
  status: 'pending' | 'ready' | 'failed';
  is_initial: number;
  reserved_created_at: string;
};

export type MediaInput = {
  mimeType?: string;
  byteSize?: number;
  width?: number | null;
  height?: number | null;
  originalName?: string | null;
};

export type NormalizedMedia = {
  mimeType: 'image/webp' | 'image/jpeg' | 'image/png' | 'image/gif';
  byteSize: number;
  width: number | null;
  height: number | null;
  originalName: string | null;
};

export const MIME_EXTENSIONS: Record<NormalizedMedia['mimeType'], string> = {
  'image/webp': 'webp',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
};

const STATIC_IMAGE_LIMIT = 1024 * 1024;
const GIF_LIMIT = 5 * 1024 * 1024;

export function normalizeMediaInput(value: MediaInput | null): NormalizedMedia | null {
  const mimeType = value?.mimeType?.trim().toLowerCase();
  if (!mimeType || !(mimeType in MIME_EXTENSIONS)) return null;
  const byteSize = Number(value?.byteSize ?? 0);
  const limit = mimeType === 'image/gif' ? GIF_LIMIT : STATIC_IMAGE_LIMIT;
  if (!Number.isInteger(byteSize) || byteSize < 1 || byteSize > limit) return null;
  const width = normalizeDimension(value?.width);
  const height = normalizeDimension(value?.height);
  if (mimeType !== 'image/gif' && (!width || !height)) return null;
  return {
    mimeType: mimeType as NormalizedMedia['mimeType'],
    byteSize,
    width,
    height,
    originalName: normalizeText(value?.originalName, 240),
  };
}

export function publicMedia(media: MediaRow) {
  return {
    id: media.id,
    kind: 'image' as const,
    mimeType: media.mime_type,
    byteSize: media.byte_size,
    width: media.width,
    height: media.height,
    originalName: media.original_name,
    status: media.status,
  };
}

export function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function normalizeDimension(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 10000 ? number : null;
}
