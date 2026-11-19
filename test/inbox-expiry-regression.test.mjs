import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../src/worker/agent-inbox.ts', import.meta.url),
  'utf8',
);
const js = ts.transpile(
  source.replace(
    "import { routingBusinessDate } from './routing';",
    "const routingBusinessDate = () => '2026-01-01';",
  ),
  { module: ts.ModuleKind.ESNext },
);
const { loadAgentInbox } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
);

test('inbox excludes expired ISO and SQLite timestamps', async () => {
  const sql = new DatabaseSync(':memory:');
  sql.exec(`CREATE TABLE agents (id TEXT, site_id TEXT, daily_conversation_limit INTEGER, traffic_quota_enabled INTEGER, traffic_quota_total INTEGER, traffic_quota_used INTEGER);
    CREATE TABLE agent_daily_stats (site_id TEXT, agent_id TEXT, business_date TEXT, conversation_count INTEGER);
    CREATE TABLE visitors (id TEXT, display_name TEXT);
    CREATE TABLE conversations (id TEXT, site_id TEXT, visitor_id TEXT, status TEXT, subject TEXT, product_id TEXT, section_id TEXT, section_name TEXT, category_id TEXT, category_name TEXT, product_title TEXT, product_cover_url TEXT, product_href TEXT, assigned_agent TEXT, agent_unread_count INTEGER, last_message_at TEXT, created_at TEXT, expires_at TEXT, last_message_preview TEXT);
    INSERT INTO agents VALUES ('a', 's', 0, 0, 0, 0);
    INSERT INTO visitors VALUES ('v', 'Visitor');`);
  const insert = sql.prepare(
    `INSERT INTO conversations (id, site_id, visitor_id, status, assigned_agent, expires_at) VALUES (?, 's', 'v', 'open', 'a', ?)`,
  );
  const day = new Date().toISOString().slice(0, 10);
  insert.run('expired-iso', `${day}T00:00:00.000Z`);
  insert.run('expired-sqlite', `${day} 00:00:00`);
  insert.run('active', new Date(Date.now() + 86400000).toISOString());
  const db = {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async all() {
              return { results: sql.prepare(query).all(...args) };
            },
            async first() {
              return sql.prepare(query).get(...args);
            },
          };
        },
      };
    },
  };
  for (const filter of [undefined, 'open']) {
    const inbox = await loadAgentInbox(
      db,
      { id: 'a', status: 'online' },
      filter,
    );
    assert.deepEqual(
      inbox.conversations.map((row) => row.id),
      ['active'],
    );
    assert.equal(inbox.overview.open, 1);
  }
  sql.close();
});

