import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(path, 'utf8');

test('agent workspace exposes business actions instead of a raw status selector', async () => {
  const portal = await read('src/dashboard/AgentPortal.tsx');
  assert.equal(portal.includes('aria-label="会话状态"'), false);
  assert.match(portal, /开始处理/u);
  assert.match(portal, /结束会话/u);
  assert.match(portal, /重新处理/u);
  assert.match(portal, /重新分配/u);
  assert.doesNotMatch(portal, /重新进入自动分流|排除当前客服后自动分流/u);
});

test('agent inbox shows per-conversation status without exposing routing implementation copy', async () => {
  const panels = await read('src/dashboard/AgentWorkspacePanels.tsx');
  assert.ok(panels.includes('conversation-status is-${conversation.status}'));
  assert.match(panels, /新咨询分配给你后会自动出现在这里/u);
  assert.doesNotMatch(panels, /自动轮询/u);
});

test('desktop and mobile workspace styles own the new status action controls', async () => {
  const [shared, desktop, mobile] = await Promise.all([
    read('src/dashboard/agent-workspace.css'),
    read('src/dashboard/agent-desktop.css'),
    read('src/dashboard/agent-mobile.css'),
  ]);
  assert.ok(shared.includes('.thread-status-action'));
  assert.ok(shared.includes('.conversation-status.is-pending'));
  assert.ok(desktop.includes('.workspace-shell .thread-status-action'));
  assert.ok(mobile.includes('grid-template-columns: auto auto 38px'));
  assert.equal(mobile.includes('.thread-head select'), false);
});
