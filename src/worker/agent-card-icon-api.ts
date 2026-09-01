import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { requireAgentSession } from './agent-session';
import {
  normalizeVisitorId,
  normalizeVisitorToken,
  resolveVisitor,
} from './client-api';
import {
  decodeContactCardIconRef,
  encodeContactCardIconRef,
  type ContactCardIconMimeType,
} from './contact-card-icon';
import type { MediaBindings } from './media-types';

type Bindings = MediaBindings;
type Env = { Bindings: Bindings };

type ContactCardRow = {
  id: string;
  original_name: string | null;
};

type ContactCardIconUpload = {
  mimeType: ContactCardIconMimeType;
  extension: 'png' | 'jpg' | 'webp';
};

const MAX_CARD_ICON_BYTES = 256 * 1024;
const CARD_ICON_TYPES: Record<string, ContactCardIconUpload> = {
  'image/png': { mimeType: 'image/png', extension: 'png' },
  'image/jpeg': { mimeType: 'image/jpeg', extension: 'jpg' },
  'image/webp': { mimeType: 'image/webp', extension: 'webp' },
};

export const agentCardIconApi = new Hono<Env>();

agentCardIconApi.use(
  '/client/v1/*',
  cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'X-CS-Visitor-Token'],
    allowMethods: ['GET', 'OPTIONS'],
    maxAge: 86400,
  }),
);

agentCardIconApi.post(
  '/api/agent/attachments/presets/:id/icon',
  async (c) => {
    const agent = await requireAgentSession(c);
    if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
    const preset = await contactCardPresetForAgent(
      c.env.DB,
      c.req.param('id'),
      agent.id,
    );
    if (!preset) return c.json({ error: 'NOT_FOUND' }, 404);

    let form: FormData;
    try {
      form = await c.req.raw.formData();
    } catch {
      return c.json({ error: 'INVALID_CARD_ICON' }, 400);
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      return c.json({ error: 'INVALID_CARD_ICON' }, 400);
    }
    const upload = normalizeCardIconUpload(file);
    if (!upload) return c.json({ error: 'INVALID_CARD_ICON' }, 400);

    const objectKey = `agent-card-icons/${agent.id}/${preset.id}/${crypto.randomUUID()}.${upload.extension}`;
    await c.env.MEDIA.put(objectKey, file.stream(), {
      httpMetadata: { contentType: upload.mimeType },
    });

    const marker = encodeContactCardIconRef({
      objectKey,
      mimeType: upload.mimeType,
    });
    const result = await c.env.DB.prepare(
      `UPDATE agent_attachment_presets
       SET original_name = ?1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?2 AND agent_id = ?3 AND kind IN ('phone', 'link')`,
    )
      .bind(marker, preset.id, agent.id)
      .run();
    if (!result.meta.changes) {
      await c.env.MEDIA.delete(objectKey).catch(() => undefined);
      return c.json({ error: 'NOT_FOUND' }, 404);
    }

    return c.json({ ok: true, hasCustomIcon: true });
  },
);

agentCardIconApi.delete(
  '/api/agent/attachments/presets/:id/icon',
  async (c) => {
    const agent = await requireAgentSession(c);
    if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
    const result = await c.env.DB.prepare(
      `UPDATE agent_attachment_presets
       SET original_name = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 AND agent_id = ?2 AND kind IN ('phone', 'link')`,
    )
      .bind(c.req.param('id'), agent.id)
      .run();
    if (!result.meta.changes) return c.json({ error: 'NOT_FOUND' }, 404);

    // The old R2 object is intentionally retained. Existing messages may hold
    // the immutable marker copied when the card was sent.
    return c.json({ ok: true, hasCustomIcon: false });
  },
);

agentCardIconApi.get(
  '/api/agent/attachments/presets/:id/icon',
  async (c) => {
    const agent = await requireAgentSession(c);
    if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
    const preset = await contactCardPresetForAgent(
      c.env.DB,
      c.req.param('id'),
      agent.id,
    );
    if (!preset) return c.json({ error: 'NOT_FOUND' }, 404);
    return readCardIcon(c.env.MEDIA, preset.original_name);
  },
);

agentCardIconApi.get('/api/agent/attachments/:id/icon', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const row = await c.env.DB.prepare(
    `SELECT attachment.id, attachment.original_name
     FROM message_attachments attachment
     JOIN messages message ON message.id = attachment.message_id
     JOIN conversations conversation ON conversation.id = message.conversation_id
     WHERE attachment.id = ?1
       AND attachment.kind IN ('phone', 'link')
       AND conversation.assigned_agent = ?2
       AND COALESCE(conversation.expires_at, datetime(conversation.created_at, '+1 day')) > CURRENT_TIMESTAMP
     LIMIT 1`,
  )
    .bind(c.req.param('id'), agent.id)
    .first<ContactCardRow>();
  if (!row) return c.json({ error: 'NOT_FOUND' }, 404);
  return readCardIcon(c.env.MEDIA, row.original_name);
});

agentCardIconApi.get('/client/v1/attachments/:id/icon', async (c) => {
  const visitorId = normalizeVisitorId(c.req.query('visitorId'));
  const visitorToken = normalizeVisitorToken(
    c.req.query('visitorToken') ?? c.req.header('X-CS-Visitor-Token'),
  );
  if (!visitorId && !visitorToken) {
    return clientError(c, 400, 'INVALID_VISITOR_ID');
  }
  const projectId = normalizeProjectId(c.req.query('projectId'));
  const site = await findSite(c.env.DB, projectId);
  if (!site) return clientError(c, 404, 'PROJECT_NOT_FOUND');
  const visitor = await resolveVisitor(c.env.DB, site.id, {
    externalId: visitorId,
    accessToken: visitorToken,
  });
  if (!visitor) return clientError(c, 401, 'INVALID_VISITOR_TOKEN');

  const row = await c.env.DB.prepare(
    `SELECT attachment.id, attachment.original_name
     FROM message_attachments attachment
     JOIN messages message ON message.id = attachment.message_id
     JOIN conversations conversation ON conversation.id = message.conversation_id
     JOIN visitors v ON v.id = conversation.visitor_id
     JOIN sites site ON site.id = conversation.site_id
     WHERE attachment.id = ?1
       AND attachment.kind IN ('phone', 'link')
       AND (site.id = ?2 OR site.public_key = ?2)
       AND site.is_enabled = 1
       AND v.external_id = ?3
       AND conversation.assigned_agent IS NOT NULL
       AND COALESCE(conversation.expires_at, datetime(conversation.created_at, '+1 day')) > CURRENT_TIMESTAMP
     LIMIT 1`,
  )
    .bind(c.req.param('id'), projectId, visitor.external_id)
    .first<ContactCardRow>();
  if (!row) return clientError(c, 404, 'ATTACHMENT_ICON_NOT_FOUND');
  const icon = await readCardIcon(c.env.MEDIA, row.original_name);
  if (icon.status === 404) {
    return clientError(c, 404, 'ATTACHMENT_ICON_NOT_FOUND');
  }
  return icon;
});

function normalizeCardIconUpload(file: File): ContactCardIconUpload | null {
  const upload = CARD_ICON_TYPES[file.type.trim().toLowerCase()];
  if (!upload || file.size < 1 || file.size > MAX_CARD_ICON_BYTES) return null;
  return upload;
}

async function contactCardPresetForAgent(
  db: D1Database,
  id: string,
  agentId: string,
): Promise<ContactCardRow | null> {
  return db
    .prepare(
      `SELECT id, original_name
       FROM agent_attachment_presets
       WHERE id = ?1 AND agent_id = ?2 AND kind IN ('phone', 'link')
       LIMIT 1`,
    )
    .bind(id, agentId)
    .first<ContactCardRow>();
}

async function readCardIcon(
  bucket: R2Bucket,
  marker: string | null,
): Promise<Response> {
  const ref = decodeContactCardIconRef(marker);
  if (!ref) return new Response('Not found', { status: 404 });
  const object = await bucket.get(ref.objectKey);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  headers.set('Content-Type', ref.mimeType);
  headers.set('Content-Length', String(object.size));
  headers.set('Cache-Control', 'private, max-age=300');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
}

async function findSite(db: D1Database, projectId: string) {
  return db
    .prepare(
      `SELECT id FROM sites
       WHERE (id = ?1 OR public_key = ?1) AND is_enabled = 1 LIMIT 1`,
    )
    .bind(projectId)
    .first<{ id: string }>();
}

function normalizeProjectId(value?: string | null): string {
  const project = value?.trim();
  return project && project.length <= 200 ? project : 'default';
}

function clientError(c: Context<Env>, status: 400 | 401 | 404, code: string) {
  return c.json({ error: { code, message: code } }, status);
}
