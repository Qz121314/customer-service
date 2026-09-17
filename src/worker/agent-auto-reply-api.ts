import { Hono } from 'hono';
import {
  requireAgentSession,
  type AgentSessionIdentity,
} from './agent-session.ts';

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

type AgentFirstReplyItemType = 'greeting' | 'cta' | 'contact_card' | 'image';

type AgentFirstReplyItem = {
  id: string;
  type: AgentFirstReplyItemType;
  materialId: string;
  sortOrder: number;
};

type AgentFirstReplyProfile = {
  id: string;
  name: string;
  items: AgentFirstReplyItem[];
};

type LegacyFirstReplyProfile = {
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

export function removeMissingLegacyAttachmentIds(
  profiles: AgentFirstReplyProfile[],
  ownedAttachmentIds: ReadonlySet<string>,
): AgentFirstReplyProfile[];
export function removeMissingLegacyAttachmentIds(
  profiles: LegacyFirstReplyProfile[],
  ownedAttachmentIds: ReadonlySet<string>,
): LegacyFirstReplyProfile[];
export function removeMissingLegacyAttachmentIds(
  profiles: Array<AgentFirstReplyProfile | LegacyFirstReplyProfile>,
  ownedAttachmentIds: ReadonlySet<string>,
): Array<AgentFirstReplyProfile | LegacyFirstReplyProfile> {
  return profiles.map((profile) =>
    profile.id === 'legacy-first-reply'
      ? 'items' in profile
        ? {
            ...profile,
            items: profile.items.filter((item) =>
              item.type !== 'contact_card' && item.type !== 'image'
                ? true
                : ownedAttachmentIds.has(item.materialId),
            ),
          }
        : {
            ...profile,
            attachmentIds: profile.attachmentIds.filter((id) =>
              ownedAttachmentIds.has(id),
            ),
          }
      : profile,
  );
}

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

  const canonicalProfile = await c.env.DB.prepare(
    `SELECT 1
     FROM agent_first_reply_profiles
     WHERE agent_id = ?1
     LIMIT 1`,
  )
    .bind(agent.id)
    .first();
  const isLegacyPayload =
    !canonicalProfile &&
    profiles.some((profile) => profile.id === 'legacy-first-reply');
  let profilesToPersist = profiles;

  const greetingIds = new Set(greetings.map((item) => item.id));
  const ctaIds = new Set(ctas.map((item) => item.id));
  const profileIds = new Set(profiles.map((item) => item.id));
  if (
    (body.activeProfileId !== null && !profileIds.has(body.activeProfileId)) ||
    profiles.some((profile) =>
      profile.items.some(
        (item) =>
          (item.type === 'greeting' && !greetingIds.has(item.materialId)) ||
          (item.type === 'cta' && !ctaIds.has(item.materialId)),
      ),
    )
  ) {
    return c.json({ error: 'INVALID_FIRST_REPLY' }, 400);
  }

  const attachmentIds = [
    ...new Set(
      profiles.flatMap((profile) =>
        profile.items
          .filter(
            (item) => item.type === 'contact_card' || item.type === 'image',
          )
          .map((item) => item.materialId),
      ),
    ),
  ];
  const ownedAttachmentKinds = new Map<string, string>();
  if (attachmentIds.length > 0) {
    const owned = await c.env.DB.prepare(
      `SELECT id, kind
       FROM agent_attachment_presets
       WHERE agent_id = ?1
         AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?2))`,
    )
      .bind(agent.id, JSON.stringify(attachmentIds))
      .all<{ id: string; kind: string }>();
    for (const item of owned.results ?? []) {
      ownedAttachmentKinds.set(item.id, item.kind);
    }
    if (
      !isLegacyPayload &&
      ownedAttachmentKinds.size !== attachmentIds.length
    ) {
      return c.json({ error: 'INVALID_FIRST_REPLY' }, 400);
    }
    if (isLegacyPayload) {
      profilesToPersist = removeMissingLegacyAttachmentIds(
        profiles,
        new Set(ownedAttachmentKinds.keys()),
      );
    }
  }

  if (
    profilesToPersist.some((profile) =>
      profile.items.some((item) => {
        if (item.type !== 'contact_card' && item.type !== 'image') return false;
        const kind = ownedAttachmentKinds.get(item.materialId);
        return Boolean(
          !kind ||
          (!isLegacyPayload &&
            ((item.type === 'image' && kind !== 'image') ||
              (item.type === 'contact_card' && kind === 'image'))),
        );
      }),
    )
  ) {
    return c.json({ error: 'INVALID_FIRST_REPLY' }, 400);
  }

  const activeProfile =
    typeof body.activeProfileId === 'string'
      ? (profilesToPersist.find(
          (profile) => profile.id === body.activeProfileId,
        ) ?? null)
      : null;
  const activeGreetingItems = activeProfile
    ? activeProfile.items.filter((item) => item.type === 'greeting')
    : [];
  const activeGreeting = activeGreetingItems
    .map((item) =>
      greetings.find((greeting) => greeting.id === item.materialId),
    )
    .filter((item): item is AgentGreetingPreset => Boolean(item));
  const activeCtas = activeProfile
    ? activeProfile.items
        .filter((item) => item.type === 'cta')
        .map((item) => ctas.find((cta) => cta.id === item.materialId))
        .filter((item): item is AgentCtaPreset => Boolean(item))
    : [];
  const activeAttachments = activeProfile
    ? activeProfile.items
        .filter((item) => item.type === 'contact_card' || item.type === 'image')
        .map((item) => item.materialId)
    : [];
  if (
    body.enabled &&
    (!activeProfile ||
      (!activeGreeting.some((item) => item.text.trim()) &&
        activeAttachments.length === 0))
  ) {
    return c.json({ error: 'FIRST_REPLY_CONTENT_REQUIRED' }, 400);
  }

  const greetingsJson = JSON.stringify(greetings);
  const ctasJson = JSON.stringify(ctas);
  const profilesJson = JSON.stringify(profilesToPersist);
  const activeAttachmentsJson = JSON.stringify(activeAttachments);
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
       SELECT json_extract(profile.value, '$.id'), ?1,
              json_extract(profile.value, '$.name'),
              (
                SELECT json_extract(item.value, '$.materialId')
                FROM json_each(json_extract(profile.value, '$.items')) item
                WHERE json_extract(item.value, '$.type') = 'greeting'
                ORDER BY CAST(json_extract(item.value, '$.sortOrder') AS INTEGER)
                LIMIT 1
              ),
              CASE WHEN json_extract(profile.value, '$.id') = ?2 THEN 1 ELSE 0 END,
              key
       FROM json_each(?3) profile`,
    ).bind(agent.id, body.activeProfileId, profilesJson),
    c.env.DB.prepare(
      `INSERT INTO agent_first_reply_items (
         id, profile_id, material_type, material_id, sort_order
       )
       SELECT json_extract(item.value, '$.id'),
              json_extract(profile.value, '$.id'),
              json_extract(item.value, '$.type'),
              json_extract(item.value, '$.materialId'),
              CAST(json_extract(item.value, '$.sortOrder') AS INTEGER)
       FROM json_each(?1) profile
       JOIN json_each(json_extract(profile.value, '$.items')) item`,
    ).bind(profilesJson),
    c.env.DB.prepare(
      `INSERT INTO agent_first_reply_profile_attachments (
         profile_id, preset_id, sort_order
       )
       SELECT json_extract(profile.value, '$.id'),
              json_extract(item.value, '$.materialId'),
              CAST(json_extract(item.value, '$.sortOrder') AS INTEGER)
       FROM json_each(?1) profile
       JOIN json_each(json_extract(profile.value, '$.items')) item
       WHERE json_extract(item.value, '$.type') IN ('contact_card', 'image')`,
    ).bind(profilesJson),
    c.env.DB.prepare(
      `INSERT INTO agent_first_reply_profile_ctas (
         profile_id, cta_id, sort_order
       )
       SELECT json_extract(profile.value, '$.id'),
              json_extract(item.value, '$.materialId'),
              CAST(json_extract(item.value, '$.sortOrder') AS INTEGER)
       FROM json_each(?1) profile
       JOIN json_each(json_extract(profile.value, '$.items')) item
       WHERE json_extract(item.value, '$.type') = 'cta'`,
    ).bind(profilesJson),
    c.env.DB.prepare(
      `UPDATE agents
       SET auto_greeting_enabled = ?1,
           auto_greeting_text = ?2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?3`,
    ).bind(
      body.enabled ? 1 : 0,
      activeGreeting
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n') || null,
      agent.id,
    ),
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
  const updated = await c.env.DB.prepare(
    `SELECT id, auto_greeting_enabled, auto_greeting_text
     FROM agents WHERE id = ?1 LIMIT 1`,
  )
    .bind(agent.id)
    .first<AgentSettingsRow>();
  if (!updated) return c.json({ error: 'UNAUTHORIZED' }, 401);
  return c.json({ settings: await firstReplyPayload(c.env.DB, updated) });
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
  const itemRows = await db
    .prepare(
      `SELECT item.id, item.profile_id, item.material_type, item.material_id,
              item.sort_order
       FROM agent_first_reply_items item
       JOIN agent_first_reply_profiles profile
         ON profile.id = item.profile_id
       WHERE profile.agent_id = ?1
       ORDER BY item.profile_id, item.sort_order, item.id`,
    )
    .bind(row.id)
    .all<AgentFirstReplyItemRow>();
  const itemsByProfile = new Map<string, AgentFirstReplyItem[]>();
  for (const item of itemRows.results ?? []) {
    const current = itemsByProfile.get(item.profile_id) ?? [];
    current.push({
      id: item.id,
      type: item.material_type,
      materialId: item.material_id,
      sortOrder: item.sort_order,
    });
    itemsByProfile.set(item.profile_id, current);
  }
  const profiles = (profileRows.results ?? []).map((item) => {
    const items = itemsByProfile.get(item.id) ?? [];
    return {
      id: item.id,
      name: item.name,
      items,
      // Keep the old projection in the response for older desktop clients.
      greetingId:
        items.find((content) => content.type === 'greeting')?.materialId ??
        null,
      attachmentIds: items
        .filter(
          (content) =>
            content.type === 'contact_card' || content.type === 'image',
        )
        .map((content) => content.materialId),
      ctaIds: items
        .filter((content) => content.type === 'cta')
        .map((content) => content.materialId),
    };
  });

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
  const legacyAttachmentRows = await db
    .prepare(
      `SELECT relation.preset_id, preset.kind
       FROM agent_auto_greeting_attachments relation
       JOIN agent_attachment_presets preset
         ON preset.id = relation.preset_id
        AND preset.agent_id = relation.agent_id
       WHERE relation.agent_id = ?1
       ORDER BY relation.sort_order ASC, relation.preset_id ASC`,
    )
    .bind(row.id)
    .all<{ preset_id: string; kind: string }>();
  const hasLegacyContent = Boolean(
    row.auto_greeting_text?.trim() || legacyAttachmentRows.results?.length,
  );
  const legacyItems: AgentFirstReplyItem[] = [
    ...(row.auto_greeting_text?.trim()
      ? [
          {
            id: 'legacy-greeting-item',
            type: 'greeting' as const,
            materialId: 'legacy-greeting',
            sortOrder: 0,
          },
        ]
      : []),
    ...(legacyAttachmentRows.results ?? []).map((item, index) => ({
      id: `legacy-attachment-item-${item.preset_id}`,
      type:
        item.kind === 'image' ? ('image' as const) : ('contact_card' as const),
      materialId: item.preset_id,
      sortOrder: index + (row.auto_greeting_text?.trim() ? 1 : 0),
    })),
    ...legacyCtas.map((item, index) => ({
      id: `legacy-cta-item-${item.id}`,
      type: 'cta' as const,
      materialId: item.id,
      sortOrder:
        index +
        (row.auto_greeting_text?.trim() ? 1 : 0) +
        (legacyAttachmentRows.results?.length ?? 0),
    })),
  ];
  const legacyProfile = {
    id: 'legacy-first-reply',
    name: '默认首次回复',
    items: legacyItems,
    greetingId: row.auto_greeting_text?.trim() ? 'legacy-greeting' : null,
    attachmentIds: (legacyAttachmentRows.results ?? []).map(
      (item) => item.preset_id,
    ),
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
  is_active: number;
};

type AgentFirstReplyItemRow = {
  id: string;
  profile_id: string;
  material_type: AgentFirstReplyItemType;
  material_id: string;
  sort_order: number;
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
    let items: AgentFirstReplyItem[];
    if (Array.isArray(record.items)) {
      const normalizedItems: AgentFirstReplyItem[] = [];
      for (const rawItem of record.items) {
        if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
          return null;
        }
        const item = rawItem as Record<string, unknown>;
        const itemId = typeof item.id === 'string' ? item.id.trim() : '';
        const materialId =
          typeof item.materialId === 'string' ? item.materialId.trim() : '';
        const type = item.type;
        if (
          !itemId ||
          itemId.length > 100 ||
          !materialId ||
          materialId.length > 200 ||
          !isFirstReplyItemType(type) ||
          normalizedItems.some((current) => current.id === itemId)
        ) {
          return null;
        }
        normalizedItems.push({
          id: itemId,
          type,
          materialId,
          sortOrder: normalizedItems.length,
        });
      }
      items = normalizedItems;
    } else {
      if (
        !Array.isArray(record.attachmentIds) ||
        !Array.isArray(record.ctaIds)
      ) {
        return null;
      }
      const greetingId =
        record.greetingId === null
          ? null
          : typeof record.greetingId === 'string'
            ? record.greetingId.trim()
            : '';
      const attachmentIds = normalizeAttachmentIds(record.attachmentIds);
      const ctaIds = normalizeAttachmentIds(record.ctaIds);
      if (
        greetingId === '' ||
        attachmentIds.length > AUTO_GREETING_ATTACHMENT_LIMIT ||
        ctaIds.length > CTA_LIMIT ||
        (Array.isArray(record.attachmentIds) &&
          attachmentIds.length !== record.attachmentIds.length) ||
        (Array.isArray(record.ctaIds) && ctaIds.length !== record.ctaIds.length)
      ) {
        return null;
      }
      items = [
        ...(greetingId
          ? [
              {
                id: `${id}:greeting:${greetingId}`,
                type: 'greeting' as const,
                materialId: greetingId,
                sortOrder: 0,
              },
            ]
          : []),
        ...attachmentIds.map((materialId, index) => ({
          id: `${id}:attachment:${materialId}`,
          type: 'contact_card' as const,
          materialId,
          sortOrder: index + (greetingId ? 1 : 0),
        })),
        ...ctaIds.map((materialId, index) => ({
          id: `${id}:cta:${materialId}`,
          type: 'cta' as const,
          materialId,
          sortOrder: index + (greetingId ? 1 : 0) + attachmentIds.length,
        })),
      ];
    }
    if (
      !id ||
      id.length > 80 ||
      !name ||
      name.length > MATERIAL_NAME_LIMIT ||
      result.some((profile) => profile.id === id)
    ) {
      return null;
    }
    result.push({ id, name, items });
  }
  return result;
}

function isFirstReplyItemType(
  value: unknown,
): value is AgentFirstReplyItemType {
  return (
    value === 'greeting' ||
    value === 'cta' ||
    value === 'contact_card' ||
    value === 'image'
  );
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
