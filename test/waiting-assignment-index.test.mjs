import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const migrationsDirectory = fileURLToPath(
  new URL('../migrations/', import.meta.url),
);
const migrationNames = readdirSync(migrationsDirectory)
  .filter((value) => /^\d+.*\.sql$/u.test(value))
  .sort();

function applyThrough(database, lastMigration) {
  for (const name of migrationNames) {
    if (name > lastMigration) break;
    database.exec(readFileSync(`${migrationsDirectory}/${name}`, 'utf8'));
  }
}

function plan(database, sql, ...bindings) {
  return database
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...bindings)
    .map((row) => row.detail)
    .join('\n');
}

test('final schema drops the unused waiting-assignment index without changing critical plans', () => {
  const database = new DatabaseSync(':memory:');
  applyThrough(database, '0055_remove_duplicate_assignment_attention.sql');

  const assignmentContextSql = `
    SELECT c.site_id, c.product_id,
      COALESCE(c.section_id, p.section_id) AS section_id,
      COALESCE(c.category_id, p.category_id) AS category_id
    FROM conversations c
    LEFT JOIN product_catalog p
      ON p.site_id = c.site_id AND p.id = c.product_id
    WHERE c.id = ?
      AND c.assigned_agent IS NULL
      AND c.expires_at > CURRENT_TIMESTAMP
      AND NOT EXISTS (
        SELECT 1 FROM agent_traffic_receipts receipt
        WHERE receipt.conversation_id = c.id
      )
    LIMIT 1`;
  const cleanupSql = `
    DELETE FROM conversations
    WHERE id = ? AND site_id = ? AND assigned_agent IS NULL`;
  const assignmentPlanBefore = plan(
    database,
    assignmentContextSql,
    'conversation-1',
  );
  const cleanupPlanBefore = plan(
    database,
    cleanupSql,
    'conversation-1',
    'default',
  );
  assert.doesNotMatch(
    `${assignmentPlanBefore}\n${cleanupPlanBefore}`,
    /idx_conversations_waiting_assignment/u,
  );

  database.exec(
    readFileSync(
      `${migrationsDirectory}/0056_drop_waiting_assignment_index.sql`,
      'utf8',
    ),
  );

  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM sqlite_master
         WHERE type = 'index' AND name = 'idx_conversations_waiting_assignment'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    plan(database, assignmentContextSql, 'conversation-1'),
    assignmentPlanBefore,
  );
  assert.equal(
    plan(database, cleanupSql, 'conversation-1', 'default'),
    cleanupPlanBefore,
  );

  database.close();
});
