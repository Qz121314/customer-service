export type AttachmentKind = 'image' | 'phone' | 'link';

export type AttachmentPresetRow = {
  id: string;
  agent_id: string;
  kind: AttachmentKind;
  label: string;
  value: string | null;
  object_key: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  original_name: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type MessageAttachmentRow = {
  id: string;
  message_id: string;
  kind: AttachmentKind;
  label: string;
  value: string | null;
  object_key: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  original_name: string | null;
  sort_order: number;
  created_at: string;
};

type UnifiedAttachmentRow = {
  id: string;
  message_id: string;
  kind: AttachmentKind;
  label: string | null;
  value: string | null;
  object_key: string | null;
  mime_type: string | null;
  byte_size: number | null;
  width: number | null;
  height: number | null;
  original_name: string | null;
  sort_order: number;
  source: 'media' | 'snapshot';
};

const PHONE_PATTERN = /^\+?[0-9][0-9 ()-]{4,30}$/u;
const LABEL_LIMIT = 80;
const VALUE_LIMIT = 2048;

export function normalizeAttachmentLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const label = value.trim();
  return label && label.length <= LABEL_LIMIT ? label : null;
}

export function normalizePhoneValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!PHONE_PATTERN.test(input)) return null;
  const leadingPlus = input.startsWith('+');
  const digits = input.replace(/\D/gu, '');
  if (digits.length < 5 || digits.length > 18) return null;
  return `${leadingPlus ? '+' : ''}${digits}`;
}

export function normalizeLinkValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (!input || input.length > VALUE_LIMIT) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (!url.hostname) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function publicPreset(row: AttachmentPresetRow) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    value: row.value,
    ...(row.kind === 'image'
      ? {
          mimeType: row.mime_type,
          byteSize: row.byte_size,
          width: row.width,
          height: row.height,
          originalName: row.original_name,
        }
      : {}),
  };
}

export function publicMessageAttachment(row: MessageAttachmentRow) {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    value: row.value,
    ...(row.kind === 'image'
      ? {
          mimeType: row.mime_type,
          byteSize: row.byte_size,
          width: row.width,
          height: row.height,
          originalName: row.original_name,
          source: 'snapshot' as const,
        }
      : {}),
  };
}

export async function listAgentAttachmentPresets(
  db: D1Database,
  agentId: string,
): Promise<AttachmentPresetRow[]> {
  const result = await db
    .prepare(
      `SELECT id, agent_id, kind, label, value, object_key, mime_type,
         byte_size, width, height, original_name, sort_order, created_at, updated_at
       FROM agent_attachment_presets
       WHERE agent_id = ?1
       ORDER BY CASE kind WHEN 'phone' THEN 0 WHEN 'link' THEN 1 ELSE 2 END,
         sort_order ASC, created_at ASC, id ASC`,
    )
    .bind(agentId)
    .all<AttachmentPresetRow>();
  return result.results ?? [];
}

export async function listConversationAttachments(
  db: D1Database,
  conversationId: string,
  after?: { id: string; createdAt: string } | null,
) {
  const result = await db
    .prepare(
      `SELECT
         mi.id AS id,
         mi.message_id AS message_id,
         'image' AS kind,
         COALESCE(mi.original_name, 'Image') AS label,
         NULL AS value,
         mi.object_key AS object_key,
         mi.mime_type AS mime_type,
         mi.byte_size AS byte_size,
         mi.width AS width,
         mi.height AS height,
         mi.original_name AS original_name,
         0 AS sort_order,
         'media' AS source
       FROM media_items mi
       JOIN messages m ON m.id = mi.message_id
       WHERE mi.conversation_id = ?1
         AND mi.status = 'ready'
         AND mi.message_id IS NOT NULL
         AND (
           ?2 IS NULL
           OR m.created_at > ?2
           OR (m.created_at = ?2 AND m.id > ?3)
         )
       UNION ALL
       SELECT
         attachment.id,
         attachment.message_id,
         attachment.kind,
         attachment.label,
         attachment.value,
         attachment.object_key,
         attachment.mime_type,
         attachment.byte_size,
         attachment.width,
         attachment.height,
         attachment.original_name,
         attachment.sort_order,
         'snapshot' AS source
       FROM message_attachments attachment
       JOIN messages m ON m.id = attachment.message_id
       WHERE m.conversation_id = ?1
         AND (
           ?2 IS NULL
           OR m.created_at > ?2
           OR (m.created_at = ?2 AND m.id > ?3)
         )
       ORDER BY message_id ASC, sort_order ASC, id ASC`,
    )
    .bind(conversationId, after?.createdAt ?? null, after?.id ?? null)
    .all<UnifiedAttachmentRow>();

  return (result.results ?? []).map((row) => ({
    messageId: row.message_id,
    id: row.id,
    kind: row.kind,
    label: row.label ?? (row.kind === 'image' ? 'Image' : ''),
    value: row.value,
    ...(row.kind === 'image'
      ? {
          mimeType: row.mime_type,
          byteSize: row.byte_size,
          width: row.width,
          height: row.height,
          originalName: row.original_name,
          source: row.source,
        }
      : {}),
  }));
}

export async function loadMessageAttachments(
  db: D1Database,
  messageId: string,
): Promise<MessageAttachmentRow[]> {
  const result = await db
    .prepare(
      `SELECT id, message_id, kind, label, value, object_key, mime_type,
         byte_size, width, height, original_name, sort_order, created_at
       FROM message_attachments
       WHERE message_id = ?1
       ORDER BY sort_order ASC, id ASC`,
    )
    .bind(messageId)
    .all<MessageAttachmentRow>();
  return result.results ?? [];
}

export async function readAttachmentObject(
  bucket: R2Bucket,
  row: Pick<MessageAttachmentRow | AttachmentPresetRow, 'kind' | 'object_key' | 'mime_type'>,
) {
  if (row.kind !== 'image' || !row.object_key || !row.mime_type) {
    return new Response('Not found', { status: 404 });
  }
  const object = await bucket.get(row.object_key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  headers.set('Content-Type', row.mime_type);
  headers.set('Content-Length', String(object.size));
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}
