import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const admin = read('../src/dashboard/AdminPortal.tsx');
const statistics = read('../src/dashboard/AdminStatisticsPage.tsx');
const styles = read('../src/dashboard/admin-commercial.css');
const main = read('../src/dashboard/main.tsx');

test('admin primary navigation keeps management pages focused and workspace separate', () => {
  assert.match(admin, /type AdminView = 'agents' \| 'statistics'/u);
  assert.match(admin, /section === 'statistics'/u);
  assert.match(admin, /<AdminStatisticsPage/u);
  assert.doesNotMatch(admin, /section === 'workspace'/u);
  assert.doesNotMatch(admin, /statisticsOpen/u);
  assert.doesNotMatch(admin, /AdminStatisticsModal/u);
  assert.match(admin, /<span>客服账号<\/span>/u);
  assert.match(admin, /<span>流量统计<\/span>/u);
  assert.match(admin, /href="\/agent"/u);
  assert.match(statistics, /className="admin-statistics-page"/u);
  assert.match(statistics, /statistics-global-summary/u);
  assert.match(statistics, /statistics-footnote/u);
  assert.doesNotMatch(statistics, /modal-backdrop/u);
});

test('admin agent list groups operational information into six compact columns', () => {
  for (const heading of [
    '客服账号',
    '负责范围',
    '状态',
    '接待能力',
    '咨询额度',
  ]) {
    assert.ok(admin.includes(`<th>${heading}</th>`));
  }

  assert.doesNotMatch(admin, /<th>登录账号<\/th>/u);
  assert.doesNotMatch(admin, /<th>同时会话<\/th>/u);
  assert.doesNotMatch(admin, /<th>今日接待<\/th>/u);
  assert.doesNotMatch(admin, /<th>最后在线<\/th>/u);
  assert.match(admin, /admin-overview-strip/u);
  assert.match(admin, /admin-agent-identity/u);
  assert.match(admin, /admin-capacity-cell/u);
  assert.match(admin, /最后在线/u);
  assert.match(styles, /\.admin-table\.admin-agent-table/u);
  assert.match(styles, /min-width: 940px/u);
});

test('agent search and status filtering stay client-side on already loaded data', () => {
  assert.match(admin, /const \[agentSearch, setAgentSearch\]/u);
  assert.match(admin, /const \[agentFilter, setAgentFilter\]/u);
  assert.match(admin, /const visibleAgents = useMemo/u);
  assert.match(admin, /visibleAgents\.map/u);
  assert.match(admin, /agentIsLimited/u);
  assert.match(admin, /admin-list-toolbar/u);
  assert.match(admin, /admin-agent-search/u);
  assert.match(admin, /admin-agent-filters/u);
  assert.match(styles, /\.admin-list-toolbar/u);
  assert.match(styles, /\.admin-agent-filters/u);
  assert.doesNotMatch(admin, /getAgents\([^)]/u);
});

test('commercial admin styles stay out of the agent workspace bundle', () => {
  assert.match(main, /await import\('\.\/admin-commercial\.css'\)/u);
  assert.doesNotMatch(main, /ui-polish\.css/u);
  const agentStyles = main.slice(
    main.indexOf('async function loadAgentStyles'),
    main.indexOf('async function loadAdminStyles'),
  );
  assert.doesNotMatch(agentStyles, /admin-commercial/u);
  assert.match(styles, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/u);
});
