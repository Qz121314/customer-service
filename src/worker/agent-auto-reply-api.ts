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
const QUICK_REPLY_LIMIT = 10;
const QUICK_REPLY_QUESTION_LIMIT = 120;
const QUICK_REPLY_ANSWER_LIMIT = 2000;

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

agentAutoReplyApi.get('/api/agent/settings/quick-replies', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  return c.json({ quickReplies: await loadQuickReplies(c.env.DB, agent.id) });
});

agentAutoReplyApi.put('/api/agent/settings/quick-replies', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  const body = await readJson<{ quickReplies?: unknown }>(c.req.raw);
  const quickReplies = normalizeQuickReplies(body?.quickReplies);
  if (!quickReplies) return c.json({ error: 'INVALID_QUICK_REPLIES' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare(
      'DELETE FROM agent_quick_replies WHERE agent_id = ?1',
    ).bind(agent.id),
    ...quickReplies.map((reply, index) =>
      c.env.DB.prepare(
        `INSERT INTO agent_quick_replies (
           id, agent_id, question, answer, enabled, sort_order
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        reply.id,
        agent.id,
        reply.question,
        reply.answer,
        reply.enabled ? 1 : 0,
        index,
      ),
    ),
  ]);
  return c.json({ quickReplies });
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

async function loadQuickReplies(
  db: D1Database,
  agentId: string,
): Promise<AgentQuickReply[]> {
  const rows = await db
    .prepare(
      `SELECT id, question, answer, enabled
       FROM agent_quick_replies
       WHERE agent_id = ?1
       ORDER BY sort_order ASC, id ASC`,
    )
    .bind(agentId)
    .all<AgentQuickReplyRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    question: row.question,
    answer: row.answer,
    enabled: row.enabled === 1,
  }));
}

type AgentQuickReply = {
  id: string;
  question: string;
  answer: string;
  enabled: boolean;
};

type AgentQuickReplyRow = Omit<AgentQuickReply, 'enabled'> & {
  enabled: number;
};

function normalizeQuickReplies(value: unknown): AgentQuickReply[] | null {
  if (!Array.isArray(value) || value.length > QUICK_REPLY_LIMIT) return null;
  const result: AgentQuickReply[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const question =
      typeof record.question === 'string' ? record.question.trim() : '';
    const answer =
      typeof record.answer === 'string' ? record.answer.trim() : '';
    if (
      !id ||
      id.length > 80 ||
      !question ||
      question.length > QUICK_REPLY_QUESTION_LIMIT ||
      !answer ||
      answer.length > QUICK_REPLY_ANSWER_LIMIT ||
      typeof record.enabled !== 'boolean' ||
      result.some((reply) => reply.id === id)
    ) {
      return null;
    }
    result.push({ id, question, answer, enabled: record.enabled });
  }
  return result;
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
