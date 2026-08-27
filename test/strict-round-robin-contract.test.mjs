import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [readme, routing, editor] = await Promise.all([
  readFile(new URL('../README.md', import.meta.url), 'utf8'),
  readFile(new URL('../src/worker/routing.ts', import.meta.url), 'utf8'),
  readFile(
    new URL('../src/dashboard/AgentEditorModal.tsx', import.meta.url),
    'utf8',
  ),
]);

test('automatic routing contract stays presence-agnostic and round-robin', () => {
  assert.match(readme, /自动分流不读取在线 \/ 忙碌 \/ 离线状态/u);
  assert.match(readme, /自动路由不读取在线新鲜度/u);
  assert.doesNotMatch(readme, /等待队列按客服剩余容量批量认领/u);

  assert.match(routing, /a\.round_robin_seq ASC/u);
  assert.doesNotMatch(routing, /a\.status\s*=/u);
  assert.doesNotMatch(routing, /a\.last_seen_at/u);
  assert.doesNotMatch(routing, /a\.max_active_conversations/u);
  assert.doesNotMatch(routing, /a\.daily_conversation_limit/u);

  assert.match(editor, />人工转接限制</u);
  assert.match(editor, /不影响自动轮询/u);
});
