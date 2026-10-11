PRAGMA foreign_keys = ON;

-- Keep the type-specific library tables, while registering every saved
-- material under one key that first-reply compositions can reference.
CREATE TABLE agent_materials (
  agent_id TEXT NOT NULL,
  material_type TEXT NOT NULL CHECK (
    material_type IN ('greeting', 'cta', 'contact_card', 'image')
  ),
  id TEXT NOT NULL,
  PRIMARY KEY (agent_id, material_type, id),
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

INSERT INTO agent_materials (agent_id, material_type, id)
SELECT agent_id, 'greeting', id FROM agent_greeting_presets;

INSERT INTO agent_materials (agent_id, material_type, id)
SELECT agent_id, 'cta', id FROM agent_cta_presets;

INSERT INTO agent_materials (agent_id, material_type, id)
SELECT agent_id,
       CASE WHEN kind = 'image' THEN 'image' ELSE 'contact_card' END,
       id
FROM agent_attachment_presets;

CREATE TRIGGER trg_agent_greeting_material_insert
AFTER INSERT ON agent_greeting_presets
BEGIN
  INSERT INTO agent_materials (agent_id, material_type, id)
  VALUES (NEW.agent_id, 'greeting', NEW.id);
END;

CREATE TRIGGER trg_agent_greeting_material_delete
AFTER DELETE ON agent_greeting_presets
BEGIN
  DELETE FROM agent_materials
  WHERE agent_id = OLD.agent_id
    AND material_type = 'greeting'
    AND id = OLD.id;
END;

CREATE TRIGGER trg_agent_cta_material_insert
AFTER INSERT ON agent_cta_presets
BEGIN
  INSERT INTO agent_materials (agent_id, material_type, id)
  VALUES (NEW.agent_id, 'cta', NEW.id);
END;

CREATE TRIGGER trg_agent_cta_material_delete
AFTER DELETE ON agent_cta_presets
BEGIN
  DELETE FROM agent_materials
  WHERE agent_id = OLD.agent_id
    AND material_type = 'cta'
    AND id = OLD.id;
END;

CREATE TRIGGER trg_agent_attachment_material_insert
AFTER INSERT ON agent_attachment_presets
BEGIN
  INSERT INTO agent_materials (agent_id, material_type, id)
  VALUES (
    NEW.agent_id,
    CASE WHEN NEW.kind = 'image' THEN 'image' ELSE 'contact_card' END,
    NEW.id
  );
END;

CREATE TRIGGER trg_agent_attachment_material_delete
AFTER DELETE ON agent_attachment_presets
BEGIN
  DELETE FROM agent_materials
  WHERE agent_id = OLD.agent_id
    AND material_type = CASE
      WHEN OLD.kind = 'image' THEN 'image'
      ELSE 'contact_card'
    END
    AND id = OLD.id;
END;

DROP INDEX idx_agent_first_reply_items_profile_order;
ALTER TABLE agent_first_reply_items RENAME TO agent_first_reply_items_legacy;

CREATE UNIQUE INDEX idx_agent_first_reply_profiles_agent_id_id
  ON agent_first_reply_profiles(agent_id, id);

CREATE TABLE agent_first_reply_items (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  material_type TEXT NOT NULL CHECK (
    material_type IN ('greeting', 'cta', 'contact_card', 'image')
  ),
  material_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  FOREIGN KEY (agent_id, profile_id)
    REFERENCES agent_first_reply_profiles(agent_id, id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id, material_type, material_id)
    REFERENCES agent_materials(agent_id, material_type, id) ON DELETE NO ACTION
);

INSERT INTO agent_first_reply_items (
  id, profile_id, agent_id, material_type, material_id, sort_order
)
SELECT item.id, item.profile_id, profile.agent_id, item.material_type,
       item.material_id, item.sort_order
FROM agent_first_reply_items_legacy item
JOIN agent_first_reply_profiles profile ON profile.id = item.profile_id
JOIN agent_materials material
  ON material.agent_id = profile.agent_id
 AND material.material_type = item.material_type
 AND material.id = item.material_id;

DROP TABLE agent_first_reply_items_legacy;

CREATE INDEX idx_agent_first_reply_items_profile_order
  ON agent_first_reply_items(profile_id, sort_order, id);
