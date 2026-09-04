import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

function migratedDatabase() {
  const database = new DatabaseSync(':memory:');
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of readdirSync(directory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  }
  return database;
}

test('product context messages require structured JSON and preserve existing message kinds', () => {
  const database = migratedDatabase();
  const columns = database
    .prepare(`PRAGMA table_info('messages')`)
    .all()
    .map((column) => column.name);
  assert.ok(columns.includes('message_kind'));
  assert.ok(columns.includes('structured_payload_json'));

  database.exec(`
    INSERT INTO visitors (
      id, site_id, token_hash, external_id, expires_at
    ) VALUES (
      'product-context-visitor', 'default', 'product-context-token',
      'PCX123', datetime('now', '+1 day')
    );
    INSERT INTO conversations (
      id, site_id, visitor_id, expires_at
    ) VALUES (
      'product-context-conversation', 'default', 'product-context-visitor',
      datetime('now', '+1 day')
    );
  `);

  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO messages (
           id, conversation_id, sender_type, sender_id, body,
           message_kind, structured_payload_json
         ) VALUES (?, ?, 'visitor', ?, ?, 'product_context', ?)`,
      )
      .run(
        'invalid-product-context',
        'product-context-conversation',
        'product-context-visitor',
        'Product',
        '{invalid',
      ),
  );
  assert.throws(() =>
    database
      .prepare(
        `INSERT INTO messages (
           id, conversation_id, sender_type, sender_id, body, message_kind
         ) VALUES (?, ?, 'visitor', ?, ?, 'product_context')`,
      )
      .run(
        'missing-product-context',
        'product-context-conversation',
        'product-context-visitor',
        'Product',
      ),
  );

  const snapshot = {
    productId: 'product-1',
    title: 'Product 1',
    coverUrl: null,
    href: 'https://storefront.example/products/product-1/',
    sectionId: 'west',
    sectionName: 'West',
    categoryId: 'massage',
    categoryName: 'Massage',
  };
  database
    .prepare(
      `INSERT INTO messages (
         id, conversation_id, sender_type, sender_id, body,
         message_kind, structured_payload_json
       ) VALUES (?, ?, 'visitor', ?, ?, 'product_context', ?)`,
    )
    .run(
      'valid-product-context',
      'product-context-conversation',
      'product-context-visitor',
      'Product 1',
      JSON.stringify(snapshot),
    );
  const stored = database
    .prepare(
      `SELECT message_kind, structured_payload_json
       FROM messages WHERE id = 'valid-product-context'`,
    )
    .get();
  assert.equal(stored.message_kind, 'product_context');
  assert.deepEqual(JSON.parse(stored.structured_payload_json), snapshot);
  database.close();
});
