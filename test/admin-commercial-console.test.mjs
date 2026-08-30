import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const admin = read('../src/dashboard/AdminPortal.tsx');
const agentApi = read('../src/worker/agent-api.ts');
const clientApi = read('../src/worker/client-api.ts');

test('admin primary navigation keeps management pages focused and agent workspace separate', () => {
  assert.match(admin, /type AdminView = 'agents' \| 'statistics'/u);
  assert.match(admin, /section === 'statistics'/u);
  assert.match(admin, /<AdminStatisticsPage/u);
  assert.doesNotMatch(admin, /section === 'workspace'/u);
  assert.doesNotMatch(admin, /statisticsOpen/u);
  assert.doesNotMatch(admin, /AdminStatisticsModal/u);
  assert.match(admin, /href="\/agent"/u);
});

test('admin agent list exposes the operational information administrators own', () => {
  for (const heading of [
    '客服账号',
    '负责范围',
    '状态',
    '今日接待',
    '咨询额度',
  ]) {
    assert.ok(admin.includes(`<th>${heading}</th>`));
  }

  assert.doesNotMatch(admin, /<th>登录账号<\/th>/u);
  assert.doesNotMatch(admin, /<th>同时会话<\/th>/u);
  assert.match(admin, /agent\.adminLabel/u);
  assert.match(admin, /admin-agent-label/u);
});

test('agent search and status filtering stay client-side on already loaded data', () => {
  assert.match(admin, /const \[agentSearch, setAgentSearch\]/u);
  assert.match(admin, /const \[agentFilter, setAgentFilter\]/u);
  assert.match(admin, /const visibleAgents = useMemo/u);
  assert.match(admin, /visibleAgents\.map/u);
  assert.match(admin, /\$\{agent\.adminLabel\}/u);
  assert.match(admin, /agentIsLimited/u);
  assert.match(admin, /return dailyFull \|\| trafficExhausted/u);
  assert.doesNotMatch(admin, /getAgents\([^)]/u);
});

test('private agent markers stay out of agent and visitor APIs', () => {
  for (const source of [agentApi, clientApi]) {
    assert.doesNotMatch(source, /adminLabel|admin_label/u);
  }
});
