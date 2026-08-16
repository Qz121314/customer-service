import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('a conversation counts only for its first receiving seat', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      assigned_agent TEXT,
      assigned_business_date TEXT,
      assigned_at TEXT,
      updated_at TEXT,
      created_at TEXT
    );
    INSERT INTO agents VALUES ('agent-a', 'default'), ('agent-b', 'default');
    INSERT INTO conversations VALUES (
      'conversation-1', 'default', NULL, NULL, NULL,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );
  `);
  database.exec(
    await read('../migrations/0017_agent_daily_stats_retention.sql'),
  );
  database.exec(await read('../migrations/0018_agent_quick_replies.sql'));
  database.exec(await read('../migrations/0020_agent_traffic_receipts.sql'));

  const assign = database.prepare(`
    UPDATE conversations
    SET assigned_agent = ?, assigned_business_date = '2026-08-15'
    WHERE id = 'conversation-1'
  `);
  assign.run('agent-a');
  assign.run('agent-b');
  assign.run(null);
  assign.run('agent-b');

  const counts = database
    .prepare(
      `SELECT agent_id, conversation_count
       FROM agent_daily_stats
       ORDER BY agent_id`,
    )
    .all()
    .map((row) => ({
      agent_id: row.agent_id,
      conversation_count: row.conversation_count,
    }));
  assert.deepEqual(counts, [{ agent_id: 'agent-a', conversation_count: 1 }]);
  assert.deepEqual(
    database
      .prepare(
        `SELECT conversation_id, agent_id
         FROM agent_traffic_receipts`,
      )
      .all()
      .map((row) => ({
        conversation_id: row.conversation_id,
        agent_id: row.agent_id,
      })),
    [{ conversation_id: 'conversation-1', agent_id: 'agent-a' }],
  );
});

test('transfer stays server-side while personal quick replies stay browser-local', async () => {
  const [worker, routing, dashboard, runtime, api, styles, cleanup] =
    await Promise.all([
      read('../src/worker/agent-api.ts'),
      read('../src/worker/routing.ts'),
      read('../src/dashboard/AgentPortal.tsx'),
      read('../src/dashboard/dashboard-runtime.ts'),
      read('../src/dashboard/api.ts'),
      read('../src/dashboard/agent-workspace.css'),
      read('../migrations/0029_remove_server_quick_replies.sql'),
    ]);

  assert.match(worker, /conversations\/:id\/transfer/u);
  assert.match(worker, /target\.status = 'online'/u);
  assert.match(worker, /loadTransferTargets/u);
  assert.doesNotMatch(worker, /agent_quick_replies|agent\/quick-replies/u);
  assert.doesNotMatch(api, /createQuickReply|deleteQuickReply/u);
  assert.match(runtime, /cs-agent-quick-replies:/u);
  assert.match(runtime, /window\.localStorage/u);
  assert.match(routing, /excludedAgentId/u);
  assert.match(dashboard, /重新排队/u);
  assert.match(dashboard, /保存到本机/u);
  assert.match(dashboard, /conversation-context-card/u);
  assert.match(styles, /\.transfer-menu-panel/u);
  assert.match(styles, /\.quick-replies-panel/u);
  assert.match(cleanup, /DROP TABLE IF EXISTS agent_quick_replies/u);
});
