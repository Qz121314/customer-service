import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('a transferred conversation counts once for every receiving seat', async () => {
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
      assigned_business_date TEXT
    );
    INSERT INTO agents VALUES ('agent-a', 'default'), ('agent-b', 'default');
    INSERT INTO conversations VALUES ('conversation-1', 'default', NULL, NULL);
  `);
  database.exec(
    await read('../migrations/0017_agent_daily_stats_retention.sql'),
  );
  database.exec(await read('../migrations/0018_agent_quick_replies.sql'));

  const assign = database.prepare(`
    UPDATE conversations
    SET assigned_agent = ?, assigned_business_date = '2026-08-15'
    WHERE id = 'conversation-1'
  `);
  assign.run('agent-a');
  assign.run('agent-b');
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
  assert.deepEqual(counts, [
    { agent_id: 'agent-a', conversation_count: 1 },
    { agent_id: 'agent-b', conversation_count: 1 },
  ]);

  database
    .prepare(
      `INSERT INTO agent_quick_replies (id, agent_id, title, body)
       VALUES ('reply-1', 'agent-a', 'Welcome', 'Hello')`,
    )
    .run();
  assert.equal(
    database
      .prepare(
        `SELECT body FROM agent_quick_replies
         WHERE agent_id = 'agent-a'`,
      )
      .get().body,
    'Hello',
  );
});

test('agent workspace exposes transfer, requeue, quick replies and product context', async () => {
  const [worker, routing, dashboard, styles] = await Promise.all([
    read('../src/worker/agent-api.ts'),
    read('../src/worker/routing.ts'),
    read('../src/dashboard/App.tsx'),
    read('../src/dashboard/cloud-service-ui.css'),
  ]);

  assert.match(worker, /conversations\/:id\/transfer/u);
  assert.match(worker, /target\.status = 'online'/u);
  assert.match(worker, /loadTransferTargets/u);
  assert.match(worker, /agent_quick_replies/u);
  assert.match(routing, /excludedAgentId/u);
  assert.match(dashboard, /重新排队/u);
  assert.match(dashboard, /快捷回复/u);
  assert.match(dashboard, /conversation-context-card/u);
  assert.match(styles, /\.transfer-menu-panel/u);
  assert.match(styles, /\.quick-replies-panel/u);
});
