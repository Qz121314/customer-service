-- Repair polymorphic first-reply references left behind by previously deleted
-- materials. Keep only references owned by the profile's agent.
DELETE FROM agent_first_reply_items
WHERE NOT EXISTS (
  SELECT 1
  FROM agent_first_reply_profiles profile
  WHERE profile.id = agent_first_reply_items.profile_id
    AND (
      (
        agent_first_reply_items.material_type = 'greeting'
        AND EXISTS (
          SELECT 1
          FROM agent_greeting_presets greeting
          WHERE greeting.id = agent_first_reply_items.material_id
            AND greeting.agent_id = profile.agent_id
        )
      )
      OR (
        agent_first_reply_items.material_type = 'cta'
        AND EXISTS (
          SELECT 1
          FROM agent_cta_presets cta
          WHERE cta.id = agent_first_reply_items.material_id
            AND cta.agent_id = profile.agent_id
        )
      )
      OR (
        agent_first_reply_items.material_type = 'contact_card'
        AND EXISTS (
          SELECT 1
          FROM agent_attachment_presets preset
          WHERE preset.id = agent_first_reply_items.material_id
            AND preset.agent_id = profile.agent_id
            AND preset.kind <> 'image'
        )
      )
      OR (
        agent_first_reply_items.material_type = 'image'
        AND EXISTS (
          SELECT 1
          FROM agent_attachment_presets preset
          WHERE preset.id = agent_first_reply_items.material_id
            AND preset.agent_id = profile.agent_id
            AND preset.kind = 'image'
        )
      )
    )
);
