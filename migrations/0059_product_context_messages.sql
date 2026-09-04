PRAGMA foreign_keys = ON;

ALTER TABLE messages
  ADD COLUMN message_kind TEXT NOT NULL DEFAULT 'text'
  CHECK (message_kind IN ('text', 'image', 'product_context'));

ALTER TABLE messages
  ADD COLUMN structured_payload_json TEXT
  CHECK (
    (
      message_kind = 'product_context'
      AND structured_payload_json IS NOT NULL
      AND json_valid(structured_payload_json)
    )
    OR (
      message_kind <> 'product_context'
      AND (
        structured_payload_json IS NULL
        OR json_valid(structured_payload_json)
      )
    )
  );

UPDATE messages
SET message_kind = kind
WHERE kind IN ('text', 'image');
