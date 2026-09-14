PRAGMA foreign_keys = ON;

-- Convert agents that still use the pre-0069 first-reply columns/tables into
-- the reusable material model. A deterministic per-agent id keeps this
-- migration safe to retry without sharing materials between agents.
INSERT OR IGNORE INTO agent_greeting_presets (
  id, agent_id, name, text, sort_order
)
SELECT
  'legacy-greeting:' || a.id,
  a.id,
  '默认问候语',
  trim(a.auto_greeting_text),
  0
FROM agents a
WHERE NOT EXISTS (
  SELECT 1
  FROM agent_first_reply_profiles profile
  WHERE profile.agent_id = a.id
)
  AND length(trim(COALESCE(a.auto_greeting_text, ''))) > 0;

INSERT OR IGNORE INTO agent_cta_presets (
  id, agent_id, label, answer, enabled, sort_order, created_at, updated_at
)
SELECT
  legacy.id,
  legacy.agent_id,
  legacy.label,
  legacy.answer,
  legacy.enabled,
  legacy.sort_order,
  legacy.created_at,
  legacy.updated_at
FROM agent_auto_greeting_ctas legacy
WHERE NOT EXISTS (
  SELECT 1
  FROM agent_first_reply_profiles profile
  WHERE profile.agent_id = legacy.agent_id
);

INSERT OR IGNORE INTO agent_first_reply_profiles (
  id, agent_id, name, greeting_id, is_active, sort_order
)
SELECT
  'legacy-first-reply:' || a.id,
  a.id,
  '默认首次回复',
  CASE
    WHEN length(trim(COALESCE(a.auto_greeting_text, ''))) > 0
      THEN 'legacy-greeting:' || a.id
    ELSE NULL
  END,
  CASE
    WHEN a.auto_greeting_enabled = 1
      AND (
        length(trim(COALESCE(a.auto_greeting_text, ''))) > 0
        OR EXISTS (
          SELECT 1
          FROM agent_auto_greeting_attachments legacy_attachment
          JOIN agent_attachment_presets preset
            ON preset.id = legacy_attachment.preset_id
           AND preset.agent_id = a.id
          WHERE legacy_attachment.agent_id = a.id
        )
      )
      THEN 1
    ELSE 0
  END,
  0
FROM agents a
WHERE NOT EXISTS (
  SELECT 1
  FROM agent_first_reply_profiles profile
  WHERE profile.agent_id = a.id
);

INSERT OR IGNORE INTO agent_first_reply_profile_attachments (
  profile_id, preset_id, sort_order
)
SELECT
  'legacy-first-reply:' || legacy_attachment.agent_id,
  legacy_attachment.preset_id,
  legacy_attachment.sort_order
FROM agent_auto_greeting_attachments legacy_attachment
JOIN agent_first_reply_profiles profile
  ON profile.id = 'legacy-first-reply:' || legacy_attachment.agent_id
JOIN agent_attachment_presets preset
  ON preset.id = legacy_attachment.preset_id
 AND preset.agent_id = legacy_attachment.agent_id;

INSERT OR IGNORE INTO agent_first_reply_profile_ctas (
  profile_id, cta_id, sort_order
)
SELECT
  'legacy-first-reply:' || legacy.agent_id,
  legacy.id,
  legacy.sort_order
FROM agent_auto_greeting_ctas legacy
JOIN agent_first_reply_profiles profile
  ON profile.id = 'legacy-first-reply:' || legacy.agent_id
JOIN agent_cta_presets preset
  ON preset.id = legacy.id
 AND preset.agent_id = legacy.agent_id;

-- Repair references that could survive an older deployment with foreign-key
-- enforcement disabled. Relations are scoped by the owning agent as well as
-- by id; otherwise one agent could block every first-reply save for another.
DELETE FROM agent_first_reply_profile_attachments
WHERE NOT EXISTS (
  SELECT 1
  FROM agent_first_reply_profiles profile
  JOIN agent_attachment_presets preset
    ON preset.id = agent_first_reply_profile_attachments.preset_id
   AND preset.agent_id = profile.agent_id
  WHERE profile.id = agent_first_reply_profile_attachments.profile_id
);

DELETE FROM agent_first_reply_profile_ctas
WHERE NOT EXISTS (
  SELECT 1
  FROM agent_first_reply_profiles profile
  JOIN agent_cta_presets preset
    ON preset.id = agent_first_reply_profile_ctas.cta_id
   AND preset.agent_id = profile.agent_id
  WHERE profile.id = agent_first_reply_profile_ctas.profile_id
);

UPDATE agent_first_reply_profiles
SET greeting_id = NULL
WHERE greeting_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM agent_greeting_presets greeting
    WHERE greeting.id = agent_first_reply_profiles.greeting_id
      AND greeting.agent_id = agent_first_reply_profiles.agent_id
  );

-- Keep the legacy compatibility columns in sync with the canonical active
-- profile. An enabled profile without usable content is normalized to off.
UPDATE agents
SET auto_greeting_text = (
      SELECT trim(greeting.text)
      FROM agent_first_reply_profiles profile
      JOIN agent_greeting_presets greeting
        ON greeting.id = profile.greeting_id
       AND greeting.agent_id = profile.agent_id
      WHERE profile.agent_id = agents.id
        AND profile.is_active = 1
        AND length(trim(greeting.text)) > 0
      ORDER BY profile.sort_order ASC, profile.id ASC
      LIMIT 1
    )
WHERE EXISTS (
  SELECT 1
  FROM agent_first_reply_profiles profile
  WHERE profile.agent_id = agents.id
);

UPDATE agents
SET auto_greeting_enabled = 0,
    auto_greeting_text = NULL
WHERE auto_greeting_enabled = 1
  AND NOT EXISTS (
    SELECT 1
    FROM agent_first_reply_profiles profile
    WHERE profile.agent_id = agents.id
      AND profile.is_active = 1
      AND (
        EXISTS (
          SELECT 1
          FROM agent_greeting_presets greeting
          WHERE greeting.id = profile.greeting_id
            AND greeting.agent_id = profile.agent_id
            AND length(trim(greeting.text)) > 0
        )
        OR EXISTS (
          SELECT 1
          FROM agent_first_reply_profile_attachments relation
          JOIN agent_attachment_presets preset
            ON preset.id = relation.preset_id
           AND preset.agent_id = profile.agent_id
          WHERE relation.profile_id = profile.id
        )
      )
  );
