import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const api = readFileSync('src/worker/agent-api.ts', 'utf8');
const clientApi = readFileSync('src/worker/client-api.ts', 'utf8');
const dashboardApi = readFileSync('src/dashboard/api.ts', 'utf8');
const panels = readFileSync('src/dashboard/AgentWorkspacePanels.tsx', 'utf8');
const layout = readFileSync('src/dashboard/admin-layout.css', 'utf8');

test('agent nickname is self-service while the login username stays separate', () => {
  assert.match(api, /patch\('\/api\/agent\/profile'/u);
  assert.match(api, /SET name = \?1/u);
  assert.match(api, /nickname\.length > 40/u);
  assert.match(dashboardApi, /updateAgentNickname/u);
  assert.match(panels, />对外昵称</u);
  assert.match(panels, /登录账号不会改变/u);
  assert.match(clientApi, /agentName: conversation\.agent_name/u);
});

test('long admin agent directories scroll as one complete content surface', () => {
  assert.match(layout, /\.admin-content:has\(\.admin-agent-layout\)/u);
  assert.match(layout, /overflow-y: auto/u);
  assert.match(
    layout,
    /\.admin-content:has\(\.admin-agent-layout\) \.admin-table-wrap/u,
  );
  assert.match(layout, /overflow-y: visible/u);
});
