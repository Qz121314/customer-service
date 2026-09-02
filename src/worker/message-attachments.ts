import { hasContactCardIconRef } from './contact-card-icon.ts';

export type ContactCardKind = 'sms' | 'whatsapp' | 'telegram' | 'website';
export type AttachmentKind = 'image' | ContactCardKind;

export type AttachmentPresetRow = {
  id: string;
  agent_id: string;
  kind: AttachmentKind;
  label: string;
  value: string | null;
  preset_message: string | null;
  icon_ref: string | null;
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
  preset_message: string | null;
  icon_ref: string | null;
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
  preset_message: string | null;
  icon_ref: string | null;
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
const TELEGRAM_USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/u;
const LABEL_LIMIT = 80;
const VALUE_LIMIT = 2048;
const PRESET_MESSAGE_LIMIT = 2000;

export function isContactCardKind(value: unknown): value is ContactCardKind {
  return (
    value === 'sms' ||
    value === 'whatsapp' ||
    value === 'telegram' ||
    value === 'website'
  );
}

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

export function normalizeTelegramValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  const username = input.startsWith('@') ? input.slice(1) : input;
  return TELEGRAM_USERNAME_PATTERN.test(username) ? username : null;
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

export function normalizeContactCardValue(
  kind: ContactCardKind,
  value: unknown,
): string | null {
  switch (kind) {
    case 'sms':
    case 'whatsapp':
      return normalizePhoneValue(value);
    case 'telegram':
      return normalizeTelegramValue(value);
    case 'website':
      return normalizeLinkValue(value);
  }
}

export function normalizePresetMessage(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const message = value.trim();
  if (!message) return null;
  return message.length <= PRESET_MESSAGE_LIMIT ? message : null;
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
      : {
          presetMessage: row.preset_message,
          hasCustomIcon: hasContactCardIconRef(row.icon_ref),
        }),
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
      : {
          presetMessage: row.preset_message,
          hasCustomIcon: hasContactCardIconRef(row.icon_ref),
        }),
  };
}

export async function listAgentAttachmentPresets(
  db: D1Database,
  agentId: string,
): Promise<AttachmentPresetRow[]> {
  const result = await db
    .prepare(
      `SELECT id, agent_id, kind, label, value, preset_message, icon_ref,
         object_key, mime_type, byte_size, width, height, original_name,
         sort_order, created_at, updated_at
       FROM agent_attachment_presets
       WHERE agent_id = ?1
       ORDER BY CASE kind
         WHEN 'sms' THEN 0
         WHEN 'whatsapp' THEN 1
         WHEN 'telegram' THEN 2
         WHEN 'website' THEN 3
         ELSE 4
       END, sort_order ASC, created_at ASC, id ASC`,
    )
    .bind(agentId)
    .all<AttachmentPresetRow>();
  return result.results ?? [];
}

export type ConversationAttachmentPage =
  | {
      direction: 'latest';
      limit: number;
    }
  | {
      direction: 'after' | 'before';
      cursor: { id: string; createdAt: string };
      limit: number;
    };

export async function listConversationAttachments(
  db: D1Database,
  conversationId: string,
  page?: ConversationAttachmentPage,
) {
  let pageMessagesSql = `SELECT id
    FROM messages
    WHERE conversation_id = ?1`;
  let bindings: Array<string | number> = [conversationId];

  if (page?.direction === 'latest') {
    pageMessagesSql += `
      ORDER BY created_at DESC, id DESC
      LIMIT ?2`;
    bindings = [conversationId, page.limit];
  } else if (page) {
    const operator = page.direction === 'after' ? '>' : '<';
    const order = page.direction === 'after' ? 'ASC' : 'DESC';
    pageMessagesSql += `
      AND (
        created_at ${operator} ?2
        OR (created_at = ?2 AND id ${operator} ?3)
      )
      ORDER BY created_at ${order}, id ${order}
      LIMIT ?4`;
    bindings = [
      conversationId,
      page.cursor.createdAt,
      page.cursor.id,
      page.limit,
    ];
  }

  const result = await db
    .prepare(
      `WITH page_messages AS (
         ${pageMessagesSql}
       )
       SELECT
         mi.id AS id,
         mi.message_id AS message_id,
         'image' AS kind,
         COALESCE(mi.original_name, 'Image') AS label,
         NULL AS value,
         NULL AS preset_message,
         NULL AS icon_ref,
         mi.object_key AS object_key,
         mi.mime_type AS mime_type,
         mi.byte_size AS byte_size,
         mi.width AS width,
         mi.height AS height,
         mi.original_name AS original_name,
         0 AS sort_order,
         'media' AS source
       FROM media_items mi
       JOIN page_messages page ON page.id = mi.message_id
       WHERE mi.status = 'ready'
         AND mi.message_id IS NOT NULL
       UNION ALL
       SELECT
         attachment.id,
         attachment.message_id,
         attachment.kind,
         attachment.label,
         attachment.value,
         attachment.preset_message,
         attachment.icon_ref,
         attachment.object_key,
         attachment.mime_type,
         attachment.byte_size,
         attachment.width,
         attachment.height,
         attachment.original_name,
         attachment.sort_order,
         'snapshot' AS source
       FROM message_attachments attachment
       JOIN page_messages page ON page.id = attachment.message_id
       ORDER BY message_id ASC, sort_order ASC, id ASC`,
    )
    .bind(...bindings)
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
      : {
          presetMessage: row.preset_message,
          hasCustomIcon: hasContactCardIconRef(row.icon_ref),
        }),
  }));
}

export async function loadMessageAttachments(
  db: D1Database,
  messageId: string,
): Promise<MessageAttachmentRow[]> {
  const result = await db
    .prepare(
      `SELECT id, message_id, kind, label, value, preset_message, icon_ref,
         object_key, mime_type, byte_size, width, height, original_name,
         sort_order, created_at
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
  row: Pick<
    MessageAttachmentRow | AttachmentPresetRow,
    'kind' | 'object_key' | 'mime_type'
  >,
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
