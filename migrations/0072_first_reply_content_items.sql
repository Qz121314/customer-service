PRAGMA foreign_keys = ON;

-- A profile is an ordered composition of reusable materials. The material id
-- is validated against the owning agent by the API because it is polymorphic.
CREATE TABLE agent_first_reply_items (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  material_type TEXT NOT NULL CHECK (material_type IN ('greeting', 'cta', 'contact_card', 'image')),
  material_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  FOREIGN KEY (profile_id) REFERENCES agent_first_reply_profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_agent_first_reply_items_profile_order
  ON agent_first_reply_items(profile_id, sort_order, id);

-- Existing profiles did not store cross-type ordering. Preserve their content
-- deterministically, then let the new editor own ordering for future saves.
INSERT INTO agent_first_reply_items (
  id, profile_id, material_type, material_id, sort_order
)
SELECT
  profile.id || ':greeting:' || profile.greeting_id,
  profile.id,
  'greeting',
  profile.greeting_id,
  0
FROM agent_first_reply_profiles profile
WHERE profile.greeting_id IS NOT NULL;

INSERT INTO agent_first_reply_items (
  id, profile_id, material_type, material_id, sort_order
)
SELECT
  relation.profile_id || ':attachment:' || relation.preset_id,
  relation.profile_id,
  CASE WHEN preset.kind = 'image' THEN 'image' ELSE 'contact_card' END,
  relation.preset_id,
  relation.sort_order + CASE
    WHEN EXISTS (
      SELECT 1
      FROM agent_first_reply_items greeting
      WHERE greeting.profile_id = relation.profile_id
    ) THEN 1
    ELSE 0
  END
FROM agent_first_reply_profile_attachments relation
JOIN agent_first_reply_profiles profile
  ON profile.id = relation.profile_id
JOIN agent_attachment_presets preset
  ON preset.id = relation.preset_id
 AND preset.agent_id = profile.agent_id;

INSERT INTO agent_first_reply_items (
  id, profile_id, material_type, material_id, sort_order
)
SELECT
  relation.profile_id || ':cta:' || relation.cta_id,
  relation.profile_id,
  'cta',
  relation.cta_id,
  relation.sort_order + CASE
    WHEN EXISTS (
      SELECT 1
      FROM agent_first_reply_items greeting
      WHERE greeting.profile_id = relation.profile_id
        AND greeting.material_type = 'greeting'
    ) THEN 1
    ELSE 0
  END + (
    SELECT COUNT(*)
    FROM agent_first_reply_profile_attachments attachment
    WHERE attachment.profile_id = relation.profile_id
  )
FROM agent_first_reply_profile_ctas relation
JOIN agent_first_reply_profiles profile
  ON profile.id = relation.profile_id
JOIN agent_cta_presets preset
  ON preset.id = relation.cta_id
 AND preset.agent_id = profile.agent_id;
