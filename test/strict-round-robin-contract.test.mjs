import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [readme, routing, editor, agentApi, dashboardApi, portal] =
  await Promise.all([
    readFile(new URL('../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../src/worker/routing.ts', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/dashboard/AgentEditorModal.tsx', import.meta.url),
      'utf8',
    ),
    readFile(new URL('../src/worker/agent-api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/dashboard/api.ts', import.meta.url), 'utf8'),
    readFile(
      new URL('../src/dashboard/AgentPortal.tsx', import.meta.url),
      'utf8',
    ),
  ]);

test('automatic routing stays presence-agnostic, daily-capped and strict round robin', () => {
  assert.match(readme, /每日接待上限属于自动分流硬约束/u);
  assert.match(readme, /不存在坐席端人工转接或手动重新排队入口/u);

  assert.match(routing, /agent_daily_stats daily/u);
  assert.match(routing, /a\.daily_conversation_limit = 0/u);
  assert.match(routing, /daily\.business_date = \?3/u);
  assert.match(routing, /a\.round_robin_seq ASC/u);
  assert.doesNotMatch(routing, /a\.status\s*=/u);
  assert.doesNotMatch(routing, /a\.last_seen_at/u);
  assert.doesNotMatch(routing, /a\.max_active_conversations/u);

  assert.match(editor, />每日接待上限</u);
  assert.match(editor, /达到上限后当天停止自动分流/u);
  assert.doesNotMatch(editor, /人工转接限制/u);
  assert.doesNotMatch(editor, />并发上限</u);

  for (const source of [agentApi, dashboardApi, portal]) {
    assert.doesNotMatch(source, /transferTargets/u);
    assert.doesNotMatch(source, /transferConversation/u);
  }
  assert.doesNotMatch(agentApi, /conversations\/:id\/transfer/u);
  assert.doesNotMatch(portal, />转接</u);
});
