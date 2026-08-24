import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const quotaApi = read('../src/worker/admin-quota-api.ts');
const adminConfig = read('../src/worker/admin-config-api.ts');
const adminPortal = read('../src/dashboard/AdminPortal.tsx');
const editor = read('../src/dashboard/AgentEditorModal.tsx');

test('quota reconciliation is one explicit D1 read and stays off admin bootstrap', () => {
  assert.match(quotaApi, /\/api\/admin\/agents\/:id\/quota-ledger/u);
  assert.equal((quotaApi.match(/c\.env\.DB\.prepare\(/gu) ?? []).length, 1);
  assert.match(quotaApi, /traffic_quota_total_baseline/u);
  assert.match(quotaApi, /traffic_quota_archived_used/u);
  assert.match(quotaApi, /adjustment\.applied_at IS NOT NULL/u);
  assert.match(quotaApi, /receipt\.quota_consumed = 1/u);
  assert.match(quotaApi, /total === expectedTotal && used === expectedUsed/u);

  const loadAgentsStart = adminConfig.indexOf('async function loadAgents');
  const loadAgentsEnd = adminConfig.indexOf('async function loadProducts');
  const loadAgents = adminConfig.slice(loadAgentsStart, loadAgentsEnd);
  assert.doesNotMatch(loadAgents, /agent_traffic_receipts/u);
  assert.doesNotMatch(loadAgents, /agent_quota_adjustments/u);

  assert.match(adminPortal, /async function loadQuotaLedger\(\)/u);
  assert.match(adminPortal, /getAgentQuotaLedger\(draft\.id\)/u);
  assert.doesNotMatch(
    adminPortal,
    /useEffect\(\(\) => \{[\s\S]{0,500}getAgentQuotaLedger/u,
  );
  assert.match(editor, /onLoadQuotaLedger/u);
  assert.match(editor, /quotaHistoryBusy\s*\?\s*'读取中…'\s*:\s*'查看记录'/u);
  assert.match(editor, /不查看时不会额外读取账本数据/u);
});

test('admin copy separates daily reception limits from cumulative consultation quota', () => {
  assert.match(editor, />每日接待上限</u);
  assert.match(editor, />咨询额度</u);
  assert.match(editor, /每个会话首次有效接待只扣 1\s*次/u);
  assert.match(editor, />保存后累计额度</u);
  assert.match(editor, />已使用额度</u);
  assert.match(editor, />保存后剩余</u);
  assert.match(editor, /每日接待上限按天重置/u);
  assert.match(editor, /转接、重新排队和恢复同一会话不会重复扣减/u);
  assert.match(editor, /账本已核对/u);
  assert.match(editor, /账本需检查/u);
  assert.match(editor, /quotaLedger\.total/u);
  assert.match(editor, /quotaLedger\.expectedTotal/u);
  assert.match(editor, /quotaLedger\.used/u);
  assert.match(editor, /quotaLedger\.expectedUsed/u);
});
