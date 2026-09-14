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
  ctas: AgentGreetingCta[];
};

type AgentGreetingPreset = {
  id: string;
  name: string;
  text: string;
};

type AgentCtaPreset = AgentGreetingCta;

type AgentFirstReplyProfile = {
  id: string;
  name: string;
  greetingId: string | null;
  attachmentIds: string[];
  ctaIds: string[];
};

type AgentSettingsRow = Pick<
  AgentSessionIdentity,
  'id' | 'auto_greeting_enabled' | 'auto_greeting_text'
>;

const AUTO_GREETING_LIMIT = 1000;
const AUTO_GREETING_ATTACHMENT_LIMIT = 6;
const CTA_LIMIT = 10;
const CTA_LABEL_LIMIT = 120;
const CTA_ANSWER_LIMIT = 2000;
const MATERIAL_NAME_LIMIT = 80;
const PROFILE_LIMIT = 20;

export const agentAutoReplyApi = new Hono<Env>();

agentAutoReplyApi.get('/api/agent/first-reply', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);
  return c.json({ settings: await firstReplyPayload(c.env.DB, agent) });
});

agentAutoReplyApi.patch('/api/agent/first-reply', async (c) => {
  const agent = await requireAgentSession(c);
  if (!agent) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const body = await readJson<{
    enabled?: boolean;
    activeProfileId?: unknown;
    greetings?: unknown;
    ctas?: unknown;
    profiles?: unknown;
  }>(c.req.raw);
  if (
    !body ||
    typeof body.enabled !== 'boolean' ||
    (body.activeProfileId !== null && typeof body.activeProfileId !== 'string')
  ) {
    return c.json({ error: 'INVALID_FIRST_REPLY' }, 400);
  }

  const greetings = normalizeGreetingPresets(body.greetings);
  const ctas = normalizeCtaPresets(body.ctas);
  const profiles = normalizeFirstReplyProfiles(body.profiles);
  if (!greetings || !ctas || !profiles) {
    return c.json({ error: 'INVALID_FIRST_REPLY' }, 400);
  }

  const greetingIds = new Set(greetings.map((item) => item.id));
  const ctaIds = new Set(ctas.map((item) => item.id));
  const profileIds = new Set(profiles.map((item) => item.id));
  if (
    (body.activeProfileId !== null && !profileIds.has(body.activeProfileId)) ||
    profiles.some(
      (profile) =>
        (profile.greetingId !== null && !greetingIds.has(profile.greetingId)) ||
        profile.ctaIds.some((id) => !ctaIds.has(id)),
    )
  ) {
    return c.json({ error: 'INVALID_FIRST_REPLY' }, 400);
  }

  const attachmentIds = [
    ...new Set(profiles.flatMap((profile) => profile.attachmentIds)),
  ];
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
      return c.json({ error: 'INVALID_FIRST_REPLY' }, 400);
    }
  }

  const activeProfile =
    typeof body.activeProfileId === 'string'
      ? (profiles.find((profile) => profile.id === body.activeProfileId) ??
        null)
      : null;
  const activeGreeting = activeProfile?.greetingId
    ? (greetings.find((item) => item.id === activeProfile.greetingId) ?? null)
    : null;
  const activeCtas = activeProfile
    ? activeProfile.ctaIds
        .map((id) => ctas.find((item) => item.id === id))
        .filter((item): item is AgentCtaPreset => Boolean(item))
    : [];
  if (
    body.enabled &&
    (!activeProfile ||
      (!activeGreeting?.text.trim() &&
        activeProfile.attachmentIds.length === 0))
  ) {
    return c.json({ error: 'INVALID_FIRST_REPLY' }, 400);
  }

  const greetingsJson = JSON.stringify(greetings);
  const ctasJson = JSON.stringify(ctas);
  const profilesJson = JSON.stringify(profiles);
  const activeAttachmentsJson = JSON.stringify(
    activeProfile?.attachmentIds ?? [],
  );
  const activeCtasJson = JSON.stringify(activeCtas);
  const statements = [
    c.env.DB.prepare(
      `DELETE FROM agent_first_reply_profile_attachments
       WHERE profile_id IN (
         SELECT id FROM agent_first_reply_profiles WHERE agent_id = ?1
       )`,
    ).bind(agent.id),
    c.env.DB.prepare(
      `DELETE FROM agent_first_reply_profile_ctas
       WHERE profile_id IN (
         SELECT id FROM agent_first_reply_profiles WHERE agent_id = ?1
       )`,
    ).bind(agent.id),
    c.env.DB.prepare(
      `DELETE FROM agent_first_reply_profiles WHERE agent_id = ?1`,
    ).bind(agent.id),
    c.env.DB.prepare(`DELETE FROM agent_cta_presets WHERE agent_id = ?1`).bind(
      agent.id,
    ),
    c.env.DB.prepare(
      `DELETE FROM agent_greeting_presets WHERE agent_id = ?1`,
    ).bind(agent.id),
    c.env.DB.prepare(
      `INSERT INTO agent_greeting_presets (id, agent_id, name, text, sort_order)
       SELECT json_extract(value, '$.id'), ?1,
              json_extract(value, '$.name'), json_extract(value, '$.text'), key
       FROM json_each(?2)`,
    ).bind(agent.id, greetingsJson),
    c.env.DB.prepare(
      `INSERT INTO agent_cta_presets (
         id, agent_id, label, answer, enabled, sort_order
       )
       SELECT json_extract(value, '$.id'), ?1,
              json_extract(value, '$.label'), json_extract(value, '$.answer'),
              CASE json_extract(value, '$.enabled') WHEN 1 THEN 1 ELSE 0 END,
              key
       FROM json_each(?2)`,
    ).bind(agent.id, ctasJson),
    c.env.DB.prepare(
      `INSERT INTO agent_first_reply_profiles (
         id, agent_id, name, greeting_id, is_active, sort_order
       )
       SELECT json_extract(value, '$.id'), ?1,
              json_extract(value, '$.name'), json_extract(value, '$.greetingId'),
              CASE WHEN json_extract(value, '$.id') = ?2 THEN 1 ELSE 0 END,
              key
       FROM json_each(?3)`,
    ).bind(agent.id, body.activeProfileId, profilesJson),
    c.env.DB.prepare(
      `INSERT INTO agent_first_reply_profile_attachments (
         profile_id, preset_id, sort_order
       )
       SELECT json_extract(profile.value, '$.id'), attachment.value,
              attachment.key
       FROM json_each(?1) profile
       JOIN json_each(json_extract(profile.value, '$.attachmentIds')) attachment`,
    ).bind(profilesJson),
    c.env.DB.prepare(
      `INSERT INTO agent_first_reply_profile_ctas (
         profile_id, cta_id, sort_order
       )
       SELECT json_extract(profile.value, '$.id'), cta.value, cta.key
       FROM json_each(?1) profile
       JOIN json_each(json_extract(profile.value, '$.ctaIds')) cta`,
    ).bind(profilesJson),
    c.env.DB.prepare(
      `UPDATE agents
       SET auto_greeting_enabled = ?1,
           auto_greeting_text = ?2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?3`,
    ).bind(body.enabled ? 1 : 0, activeGreeting?.text.trim() || null, agent.id),
    c.env.DB.prepare(
      `DELETE FROM agent_auto_greeting_attachments WHERE agent_id = ?1`,
    ).bind(agent.id),
    c.env.DB.prepare(
      `DELETE FROM agent_auto_greeting_ctas WHERE agent_id = ?1`,
    ).bind(agent.id),
    c.env.DB.prepare(
      `INSERT INTO agent_auto_greeting_attachments (
         agent_id, preset_id, sort_order
       )
       SELECT ?1, value, key FROM json_each(?2)`,
    ).bind(agent.id, activeAttachmentsJson),
    c.env.DB.prepare(
      `INSERT INTO agent_auto_greeting_ctas (
         id, agent_id, label, answer, enabled, sort_order
       )
       SELECT json_extract(value, '$.id'), ?1,
              json_extract(value, '$.label'), json_extract(value, '$.answer'),
              CASE json_extract(value, '$.enabled') WHEN 1 THEN 1 ELSE 0 END,
              key
       FROM json_each(?2)`,
    ).bind(agent.id, activeCtasJson),
  ];
  await c.env.DB.batch(statements);
  return c.json({ settings: await firstReplyPayload(c.env.DB, agent) });
});

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
    ctas?: unknown;
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
  const ctas = normalizeGreetingCtas(body.ctas);
  if (
    text.length > AUTO_GREETING_LIMIT ||
    attachmentIds.length > AUTO_GREETING_ATTACHMENT_LIMIT ||
    attachmentIds.length !== body.attachmentIds.length ||
    (body.enabled && !text && attachmentIds.length === 0) ||
    !ctas
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
    c.env.DB.prepare(
      `DELETE FROM agent_auto_greeting_ctas WHERE agent_id = ?1`,
    ).bind(agent.id),
    ...attachmentIds.map((presetId, index) =>
      c.env.DB.prepare(
        `INSERT INTO agent_auto_greeting_attachments (
           agent_id, preset_id, sort_order
         ) VALUES (?1, ?2, ?3)`,
      ).bind(agent.id, presetId, index),
    ),
    ...ctas.map((cta, index) =>
      c.env.DB.prepare(
        `INSERT INTO agent_auto_greeting_ctas (
           id, agent_id, label, answer, enabled, sort_order
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(
        cta.id,
        agent.id,
        cta.label,
        cta.answer,
        cta.enabled ? 1 : 0,
        index,
      ),
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
      ctas,
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
  const ctas = await loadGreetingCtas(db, row.id);
  return {
    enabled: row.auto_greeting_enabled === 1,
    text: row.auto_greeting_text ?? '',
    attachmentIds: (relations.results ?? []).map((item) => item.preset_id),
    ctas,
  };
}

async function firstReplyPayload(
  db: D1Database,
  row: AgentSettingsRow,
): Promise<{
  enabled: boolean;
  activeProfileId: string | null;
  greetings: AgentGreetingPreset[];
  ctas: AgentCtaPreset[];
  profiles: AgentFirstReplyProfile[];
}> {
  const [greetingRows, ctaRows, profileRows] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, text
         FROM agent_greeting_presets
         WHERE agent_id = ?1
         ORDER BY sort_order ASC, id ASC`,
      )
      .bind(row.id)
      .all<AgentGreetingPreset>(),
    db
      .prepare(
        `SELECT id, label, answer, enabled
         FROM agent_cta_presets
         WHERE agent_id = ?1
         ORDER BY sort_order ASC, id ASC`,
      )
      .bind(row.id)
      .all<AgentGreetingCtaRow>(),
    db
      .prepare(
        `SELECT id, name, greeting_id, is_active
         FROM agent_first_reply_profiles
         WHERE agent_id = ?1
         ORDER BY sort_order ASC, id ASC`,
      )
      .bind(row.id)
      .all<AgentFirstReplyProfileRow>(),
  ]);
  const greetings = (greetingRows.results ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    text: item.text,
  }));
  const ctas = (ctaRows.results ?? []).map((item) => ({
    id: item.id,
    label: item.label,
    answer: item.answer,
    enabled: item.enabled === 1,
  }));
  const [attachmentRows, profileCtaRows] = await Promise.all([
    db
      .prepare(
        `SELECT relation.profile_id, relation.preset_id
         FROM agent_first_reply_profile_attachments relation
         JOIN agent_first_reply_profiles profile
           ON profile.id = relation.profile_id
         WHERE profile.agent_id = ?1
         ORDER BY relation.profile_id, relation.sort_order, relation.preset_id`,
      )
      .bind(row.id)
      .all<{ profile_id: string; preset_id: string }>(),
    db
      .prepare(
        `SELECT relation.profile_id, relation.cta_id
         FROM agent_first_reply_profile_ctas relation
         JOIN agent_first_reply_profiles profile
           ON profile.id = relation.profile_id
         WHERE profile.agent_id = ?1
         ORDER BY relation.profile_id, relation.sort_order, relation.cta_id`,
      )
      .bind(row.id)
      .all<{ profile_id: string; cta_id: string }>(),
  ]);
  const attachmentsByProfile = new Map<string, string[]>();
  for (const item of attachmentRows.results ?? []) {
    const current = attachmentsByProfile.get(item.profile_id) ?? [];
    current.push(item.preset_id);
    attachmentsByProfile.set(item.profile_id, current);
  }
  const ctasByProfile = new Map<string, string[]>();
  for (const item of profileCtaRows.results ?? []) {
    const current = ctasByProfile.get(item.profile_id) ?? [];
    current.push(item.cta_id);
    ctasByProfile.set(item.profile_id, current);
  }
  const profiles = (profileRows.results ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    greetingId: item.greeting_id,
    attachmentIds: attachmentsByProfile.get(item.id) ?? [],
    ctaIds: ctasByProfile.get(item.id) ?? [],
  }));

  if (profiles.length > 0) {
    return {
      enabled: row.auto_greeting_enabled === 1,
      activeProfileId:
        (profileRows.results ?? []).find((item) => item.is_active === 1)?.id ??
        null,
      greetings,
      ctas,
      profiles,
    };
  }

  const legacyCtas = await loadGreetingCtas(db, row.id);
  const hasLegacyContent = Boolean(
    row.auto_greeting_text?.trim() ||
    (await db
      .prepare(
        `SELECT 1 FROM agent_auto_greeting_attachments
           WHERE agent_id = ?1 LIMIT 1`,
      )
      .bind(row.id)
      .first()),
  );
  const legacyProfile = {
    id: 'legacy-first-reply',
    name: '默认首次回复',
    greetingId: row.auto_greeting_text?.trim() ? 'legacy-greeting' : null,
    attachmentIds: await legacyAttachmentIds(db, row.id),
    ctaIds: legacyCtas.map((cta) => cta.id),
  };
  return {
    enabled: row.auto_greeting_enabled === 1,
    activeProfileId: hasLegacyContent ? legacyProfile.id : null,
    greetings: row.auto_greeting_text?.trim()
      ? [
          {
            id: 'legacy-greeting',
            name: '默认问候语',
            text: row.auto_greeting_text.trim(),
          },
        ]
      : [],
    ctas: legacyCtas,
    profiles: [legacyProfile],
  };
}

async function legacyAttachmentIds(
  db: D1Database,
  agentId: string,
): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT preset_id
       FROM agent_auto_greeting_attachments
       WHERE agent_id = ?1
       ORDER BY sort_order ASC, preset_id ASC`,
    )
    .bind(agentId)
    .all<{ preset_id: string }>();
  return (rows.results ?? []).map((item) => item.preset_id);
}

async function loadGreetingCtas(
  db: D1Database,
  agentId: string,
): Promise<AgentGreetingCta[]> {
  const rows = await db
    .prepare(
      `SELECT id, label, answer, enabled
       FROM agent_auto_greeting_ctas
       WHERE agent_id = ?1
       ORDER BY sort_order ASC, id ASC`,
    )
    .bind(agentId)
    .all<AgentGreetingCtaRow>();
  return (rows.results ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    answer: row.answer,
    enabled: row.enabled === 1,
  }));
}

type AgentGreetingCta = {
  id: string;
  label: string;
  answer: string;
  enabled: boolean;
};

type AgentGreetingCtaRow = Omit<AgentGreetingCta, 'enabled'> & {
  enabled: number;
};

type AgentFirstReplyProfileRow = {
  id: string;
  name: string;
  greeting_id: string | null;
  is_active: number;
};

function normalizeGreetingPresets(
  value: unknown,
): AgentGreetingPreset[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const result: AgentGreetingPreset[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const text = typeof record.text === 'string' ? record.text.trim() : '';
    if (
      !id ||
      id.length > 80 ||
      !name ||
      name.length > MATERIAL_NAME_LIMIT ||
      !text ||
      text.length > AUTO_GREETING_LIMIT ||
      result.some((preset) => preset.id === id)
    ) {
      return null;
    }
    result.push({ id, name, text });
  }
  return result;
}

function normalizeCtaPresets(value: unknown): AgentCtaPreset[] | null {
  return normalizeGreetingCtas(value);
}

function normalizeFirstReplyProfiles(
  value: unknown,
): AgentFirstReplyProfile[] | null {
  if (!Array.isArray(value) || value.length > PROFILE_LIMIT) return null;
  const result: AgentFirstReplyProfile[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const greetingId =
      record.greetingId === null
        ? null
        : typeof record.greetingId === 'string'
          ? record.greetingId.trim()
          : '';
    if (!Array.isArray(record.attachmentIds) || !Array.isArray(record.ctaIds)) {
      return null;
    }
    const attachmentIds = normalizeAttachmentIds(record.attachmentIds);
    const ctaIds = normalizeAttachmentIds(record.ctaIds);
    if (
      !id ||
      id.length > 80 ||
      !name ||
      name.length > MATERIAL_NAME_LIMIT ||
      greetingId === '' ||
      attachmentIds.length > AUTO_GREETING_ATTACHMENT_LIMIT ||
      ctaIds.length > CTA_LIMIT ||
      (Array.isArray(record.attachmentIds) &&
        attachmentIds.length !== record.attachmentIds.length) ||
      (Array.isArray(record.ctaIds) &&
        ctaIds.length !== record.ctaIds.length) ||
      result.some((profile) => profile.id === id)
    ) {
      return null;
    }
    result.push({ id, name, greetingId, attachmentIds, ctaIds });
  }
  return result;
}

function normalizeGreetingCtas(value: unknown): AgentGreetingCta[] | null {
  if (!Array.isArray(value) || value.length > CTA_LIMIT) return null;
  const result: AgentGreetingCta[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const answer =
      typeof record.answer === 'string' ? record.answer.trim() : '';
    if (
      !id ||
      id.length > 80 ||
      !label ||
      label.length > CTA_LABEL_LIMIT ||
      !answer ||
      answer.length > CTA_ANSWER_LIMIT ||
      typeof record.enabled !== 'boolean' ||
      result.some((cta) => cta.id === id)
    ) {
      return null;
    }
    result.push({ id, label, answer, enabled: record.enabled });
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
