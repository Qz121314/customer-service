import { Hono, type Context } from 'hono';

type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
};

type Env = { Bindings: Bindings };

type AgentAvatarSession = {
  id: string;
  avatar_version: string | null;
};

const COOKIE = 'cs_agent_session';
const MAX_AVATAR_BYTES = 320 * 1024;
const AVATAR_KEY_PREFIX = 'agent-avatars';
const AVATAR_CONTENT_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

export const agentAvatarApi = new Hono<Env>();

agentAvatarApi.get('/api/agent/avatar', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  return c.json({
    avatarUrl: avatarUrl(agent.id, agent.avatar_version),
  });
});

agentAvatarApi.put('/api/agent/avatar', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const contentType = normalizeContentType(c.req.header('content-type'));
  if (!contentType || !AVATAR_CONTENT_TYPES.has(contentType)) {
    return c.json({ error: 'INVALID_AVATAR_IMAGE' }, 400);
  }

  const declaredLength = Number(c.req.header('content-length') ?? 0);
  if (declaredLength > MAX_AVATAR_BYTES) {
    return c.json({ error: 'AVATAR_TOO_LARGE' }, 413);
  }

  const bytes = await c.req.arrayBuffer();
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_AVATAR_BYTES ||
    !matchesImageSignature(new Uint8Array(bytes), contentType)
  ) {
    return c.json(
      {
        error:
          bytes.byteLength > MAX_AVATAR_BYTES
            ? 'AVATAR_TOO_LARGE'
            : 'INVALID_AVATAR_IMAGE',
      },
      bytes.byteLength > MAX_AVATAR_BYTES ? 413 : 400,
    );
  }

  const version = crypto.randomUUID();
  const key = avatarObjectKey(agent.id);

  // One stable R2 object exists per seat. R2 put replaces the previous object at
  // the same key, so changing an avatar never leaves old image objects behind.
  await c.env.MEDIA.put(key, bytes, {
    httpMetadata: {
      contentType,
      cacheControl: 'public, max-age=31536000, immutable',
    },
    customMetadata: {
      agentId: agent.id,
      version,
    },
  });

  const updated = await c.env.DB.prepare(
    `UPDATE agents
     SET avatar_version = ?1,
         avatar_updated_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?2 AND is_enabled = 1`,
  )
    .bind(version, agent.id)
    .run();

  if (!updated.meta.changes) {
    await c.env.MEDIA.delete(key).catch(() => undefined);
    return c.json({ error: 'UNAUTHORIZED' }, 401);
  }

  return c.json({
    ok: true,
    avatarUrl: avatarUrl(agent.id, version),
  });
});

agentAvatarApi.delete('/api/agent/avatar', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const updated = await c.env.DB.prepare(
    `UPDATE agents
     SET avatar_version = NULL,
         avatar_updated_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1 AND is_enabled = 1`,
  )
    .bind(agent.id)
    .run();
  if (!updated.meta.changes) return c.json({ error: 'UNAUTHORIZED' }, 401);

  await c.env.MEDIA.delete(avatarObjectKey(agent.id));
  return c.json({ ok: true, avatarUrl: null });
});

agentAvatarApi.get('/client/v1/avatars/:agentId', async (c) => {
  const agentId = normalizeAgentId(c.req.param('agentId'));
  if (!agentId) return new Response(null, { status: 404 });

  const object = await c.env.MEDIA.get(avatarObjectKey(agentId));
  if (!object) return new Response(null, { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('ETag', object.httpEtag);
  return new Response(object.body, { headers });
});

function avatarUrl(agentId: string, version: string | null): string | null {
  if (!version) return null;
  return `/client/v1/avatars/${encodeURIComponent(agentId)}?v=${encodeURIComponent(version)}`;
}

function avatarObjectKey(agentId: string): string {
  return `${AVATAR_KEY_PREFIX}/${agentId}/current`;
}

function normalizeContentType(value: string | undefined): string | null {
  const contentType = value?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return contentType || null;
}

function normalizeAgentId(value: string): string | null {
  const id = value.trim();
  return /^[a-zA-Z0-9-]{1,100}$/u.test(id) ? id : null;
}

function matchesImageSignature(
  bytes: Uint8Array,
  contentType: string,
): boolean {
  if (contentType === 'image/jpeg') {
    return (
      bytes.length >= 3 &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff
    );
  }
  if (contentType === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  return (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === 'RIFF' &&
    ascii(bytes, 8, 12) === 'WEBP'
  );
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.slice(start, end));
}

async function authenticateAgent(
  c: Context<Env>,
): Promise<AgentAvatarSession | null> {
  const token = cookieValue(c.req.header('Cookie'), COOKIE);
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT a.id, a.avatar_version
     FROM agent_sessions s
     JOIN agents a ON a.id = s.agent_id
     WHERE s.token_hash = ?1
       AND datetime(s.expires_at) > CURRENT_TIMESTAMP
       AND a.is_enabled = 1
       AND a.username IS NOT NULL
     LIMIT 1`,
  )
    .bind(await sha256(token))
    .first<AgentAvatarSession>();
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function cookieValue(header: string | undefined, name: string): string | null {
  const prefix = `${name}=`;
  return (
    (header ?? '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix))
      ?.slice(prefix.length) ?? null
  );
}
