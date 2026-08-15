import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      assigned_agent TEXT,
      assigned_business_date TEXT
    );
  `);
  return database;
}

test('daily agent stats survive conversation retention and prune beyond 45 business days', () => {
  const database = createDatabase();

  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, assigned_agent, assigned_business_date
       ) VALUES ('existing', 'default', 'agent-a', '2026-08-14')`,
    )
    .run();

  const migration = readFileSync(
    new URL(
      '../migrations/0017_agent_daily_stats_retention.sql',
      import.meta.url,
    ),
    'utf8',
  );
  database.exec(migration);

  assert.equal(
    database
      .prepare(
        `SELECT conversation_count AS count
         FROM agent_daily_stats
         WHERE site_id = 'default'
           AND agent_id = 'agent-a'
           AND business_date = '2026-08-14'`,
      )
      .get().count,
    1,
  );

  database
    .prepare(
      `INSERT INTO agent_daily_stats (
         site_id, agent_id, business_date, conversation_count
       ) VALUES ('default', 'agent-a', '2026-06-01', 9)`,
    )
    .run();

  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, assigned_agent, assigned_business_date
       ) VALUES ('new-1', 'default', NULL, NULL)`,
    )
    .run();
  database
    .prepare(
      `UPDATE conversations
       SET assigned_agent = 'agent-a', assigned_business_date = '2026-08-15'
       WHERE id = 'new-1'`,
    )
    .run();

  assert.equal(
    database
      .prepare(
        `SELECT conversation_count AS count
         FROM agent_daily_stats
         WHERE site_id = 'default'
           AND agent_id = 'agent-a'
           AND business_date = '2026-08-15'`,
      )
      .get().count,
    1,
  );
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM agent_daily_stats
         WHERE business_date = '2026-06-01'`,
      )
      .get().count,
    0,
  );

  database.exec(
    "DELETE FROM conversations WHERE id IN ('existing', 'new-1')",
  );

  assert.equal(
    database
      .prepare(
        `SELECT conversation_count AS count
         FROM agent_daily_stats
         WHERE site_id = 'default'
           AND agent_id = 'agent-a'
           AND business_date = '2026-08-15'`,
      )
      .get().count,
    1,
  );

  database.close();
});
