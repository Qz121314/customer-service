import { Hono } from 'hono';
import {
  requireAgentSession,
  type AgentSessionIdentity,
} from './agent-session';

type Bindings = {
  DB: D1Database;
};

type Env = { Bindings: Bindings };

type AgentAutoReplySettings = {
  enabled: boolean;
  text: string;
  attachmentIds: string[];
};

type AgentSettingsRow = Pick<
  AgentSessionIdentity,
  'id' | 'auto_greeting_enabled' | 'auto_greeting_text'
>;

const AUTO_GREETING_LIMIT = 1000;
const AUTO_GREETING_ATTACHMENT_LIMIT = 6;

export const agentAutoReplyApi = new Hono<Env>();

agentAutoReplyApi.get('/api/agent/settings/auto-reply', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  return c.json({
    settings: await settingsPayload(c.env.DB, agent),
  });
});

agentAutoReplyApi.patch('/api/agent/settings/auto-reply', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const body = await readJson<{
    enabled?: boolean;
    text?: string;
    attachmentIds?: string[];
  }>(c.req.raw);
  if (
    !body ||
    typeof body.enabled !== 'boolean' ||
    typeof body.text !== 'string' ||
    !Array.isArray(body.attachmentIds)
  ) {
    return c.json({ error: 'INVALID_AUTO_REPLY' }, 400);
  }

  const text = body.text.trim();
  const attachmentIds = normalizeAttachmentIds(body.attachmentIds);
  if (
    text.length > AUTO_GREETING_LIMIT ||
    attachmentIds.length > AUTO_GREETING_ATTACHMENT_LIMIT ||
    attachmentIds.length !== body.attachmentIds.length ||
    (body.enabled && !text && attachmentIds.length === 0)
  ) {
    return c.json({ error: 'INVALID_AUTO_REPLY' }, 400);
  }

  if (attachmentIds.length > 0) {
    const owned = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM agent_attachment_presets
       WHERE agent_id = ?1
         AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?2))`,
    )
      .bind(agent.id, JSON.stringify(attachmentIds))
      .first<{ count: number }>();
    if (Number(owned?.count ?? 0) !== attachmentIds.length) {
      return c.json({ error: 'INVALID_AUTO_REPLY' }, 400);
    }
  }

  const statements = [
    c.env.DB.prepare(
      `UPDATE agents
       SET auto_greeting_enabled = ?1,
           auto_greeting_text = ?2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?3`,
    ).bind(body.enabled ? 1 : 0, text || null, agent.id),
    c.env.DB.prepare(
      `DELETE FROM agent_auto_greeting_attachments WHERE agent_id = ?1`,
    ).bind(agent.id),
    ...attachmentIds.map((presetId, index) =>
      c.env.DB.prepare(
        `INSERT INTO agent_auto_greeting_attachments (
           agent_id, preset_id, sort_order
         ) VALUES (?1, ?2, ?3)`,
      ).bind(agent.id, presetId, index),
    ),
  ];
  await c.env.DB.batch(statements);

  const updated = await c.env.DB.prepare(
    `SELECT id, auto_greeting_enabled, auto_greeting_text
     FROM agents WHERE id = ?1 LIMIT 1`,
  )
    .bind(agent.id)
    .first<AgentSettingsRow>();
  if (!updated) return c.json({ error: 'UNAUTHORIZED' }, 401);

  return c.json({
    settings: {
      enabled: updated.auto_greeting_enabled === 1,
      text: updated.auto_greeting_text ?? '',
      attachmentIds,
    },
  });
});

async function settingsPayload(
  db: D1Database,
  row: AgentSettingsRow,
): Promise<AgentAutoReplySettings> {
  const relations = await db
    .prepare(
      `SELECT preset_id
       FROM agent_auto_greeting_attachments
       WHERE agent_id = ?1
       ORDER BY sort_order ASC, preset_id ASC`,
    )
    .bind(row.id)
    .all<{ preset_id: string }>();
  return {
    enabled: row.auto_greeting_enabled === 1,
    text: row.auto_greeting_text ?? '',
    attachmentIds: (relations.results ?? []).map((item) => item.preset_id),
  };
}

function normalizeAttachmentIds(value: unknown[]): string[] {
  const ids = value.map((item) =>
    typeof item === 'string' ? item.trim() : '',
  );
  if (ids.some((id) => !id || id.length > 200)) return [];
  const unique = [...new Set(ids)];
  return unique.length === ids.length ? unique : [];
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
