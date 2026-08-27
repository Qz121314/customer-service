from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 exact match, got {count}')
    return text.replace(old, new, 1)


def regex_once(text, pattern, repl, label):
    text, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 regex match, got {count}')
    return text


# Automatic routing: daily reception limit is a hard candidate gate.
path = 'src/worker/routing.ts'
text = read(path)
text = replace_once(
    text,
    ''' * Automatic traffic delivery is deliberately presence-agnostic: online/busy,
 * heartbeat freshness, active load and daily reception limits do not decide who
 * receives traffic. A fresh billable conversation only requires an enabled,
 * configured seat with available paid traffic quota. Already-receipted traffic
 * can always be requeued without consuming another unit.
''',
    ''' * Automatic traffic delivery is deliberately presence-agnostic: online/busy,
 * heartbeat freshness and active load do not decide who receives traffic. A seat
 * must still be below its Los Angeles business-day reception limit and, for fresh
 * billable traffic, have available paid traffic quota. Already-receipted traffic
 * never consumes another paid unit, but it still respects the daily reception cap.
''',
    'routing comment',
)
text = replace_once(
    text,
    '''         JOIN context ctx ON ctx.site_id = a.site_id
         WHERE a.is_enabled = 1
''',
    '''         JOIN context ctx ON ctx.site_id = a.site_id
         LEFT JOIN agent_daily_stats daily
           ON daily.site_id = a.site_id
          AND daily.agent_id = a.id
          AND daily.business_date = ?3
         WHERE a.is_enabled = 1
''',
    'daily stats join',
)
text = replace_once(
    text,
    '''           AND a.username IS NOT NULL
           AND a.password_hash IS NOT NULL
           AND (
             ctx.already_received = 1
''',
    '''           AND a.username IS NOT NULL
           AND a.password_hash IS NOT NULL
           AND (
             a.daily_conversation_limit = 0
             OR COALESCE(daily.conversation_count, 0) < a.daily_conversation_limit
           )
           AND (
             ctx.already_received = 1
''',
    'daily limit gate',
)
write(path, text)

# Admin editor: remove manual-transfer concurrency controls; daily cap is routing policy.
path = 'src/dashboard/AgentEditorModal.tsx'
text = read(path)
text = regex_once(
    text,
    r'''              <div className="agent-editor-section agent-editor-capacity-section">.*?              </div>\n\n              <div className="agent-editor-section agent-editor-quota-section">''',
    '''              <div className="agent-editor-section agent-editor-capacity-section">
                <div className="agent-editor-section-head">
                  <strong>每日接待上限</strong>
                  <span className="agent-editor-section-hint">
                    0 = 不限制 · 达到上限后当天停止自动分流
                  </span>
                </div>

                <div className="agent-editor-capacity-grid">
                  <label className="agent-editor-number-field">
                    <strong>每日接待上限</strong>
                    <div>
                      <input
                        type="number"
                        min="0"
                        max="9999"
                        value={draft.dailyConversationLimit}
                        onChange={(event) =>
                          onDraftChange({
                            ...draft,
                            dailyConversationLimit:
                              Number(event.target.value) || 0,
                          })
                        }
                      />
                      <em>次</em>
                    </div>
                  </label>
                </div>
              </div>

              <div className="agent-editor-section agent-editor-quota-section">''',
    'capacity editor',
)
text = replace_once(
    text,
    '''                <p className="agent-editor-quota-note">
                  每个会话首次有效接待只扣 1
                  次。并发和每日接待上限只限制人工指定转接，不参与自动轮询；每日接待上限按天重置，咨询额度按累计总量计算。转接、重新排队和恢复同一会话不会重复扣减。
                </p>''',
    '''                <p className="agent-editor-quota-note">
                  每个会话首次有效接待只扣 1
                  次。每日接待上限参与自动分流，并按洛杉矶业务日自动重置；咨询额度按累计总量计算。内部重新分配和等待恢复同一会话不会重复扣减咨询额度。
                </p>''',
    'quota note',
)
write(path, text)

# Agent API: remove manual transfer discovery and endpoint.
path = 'src/worker/agent-api.ts'
text = read(path)
text = replace_once(
    text,
    "import { assignConversationAgent, routingBusinessDate } from './routing';",
    "import { routingBusinessDate } from './routing';",
    'routing import',
)
text = regex_once(
    text,
    r'''type TransferTargetRow = \{.*?type TransferConversationRow = \{.*?\};\n\n''',
    '',
    'transfer types',
)
text = regex_once(
    text,
    r'''async function loadTransferTargets\(.*?\n\}\n\nasync function loadAgentInbox''',
    'async function loadAgentInbox',
    'loadTransferTargets',
)
text = text.replace(
    '  const transferTargetsRequest = loadTransferTargets(db, agent.id);\n\n',
    '',
)
text = replace_once(
    text,
    '    const [result, overview, transferTargets] = await Promise.all([',
    '    const [result, overview] = await Promise.all([',
    'filtered inbox promise',
)
text = replace_once(
    text,
    '      loadAgentOverview(db, agent.id),\n      transferTargetsRequest,\n',
    '      loadAgentOverview(db, agent.id),\n',
    'filtered transfer request',
)
text = text.replace('      transferTargets,\n', '')
text = replace_once(
    text,
    '  const [result, quotaOverview, transferTargets] = await Promise.all([',
    '  const [result, quotaOverview] = await Promise.all([',
    'unfiltered inbox promise',
)
text = replace_once(
    text,
    '    loadAgentQuotaOverview(db, agent.id),\n    transferTargetsRequest,\n',
    '    loadAgentQuotaOverview(db, agent.id),\n',
    'unfiltered transfer request',
)
text = text.replace('    transferTargets,\n', '')
text = regex_once(
    text,
    r'''agentApi\.post\('/api/agent/conversations/:id/transfer'.*?\n\}\);\n\nagentApi\.get\('/api/agent/realtime/inbox',''',
    "agentApi.get('/api/agent/realtime/inbox',",
    'transfer endpoint',
)
text = regex_once(
    text,
    r'''async function assignedConversationForTransfer\(.*?\n\}\n\nasync function assignedConversation\(''',
    'async function assignedConversation(',
    'transfer helper',
)
text = regex_once(
    text,
    r'''\nfunction normalizeOptionalId\(.*?\n\}\n''',
    '\n',
    'transfer id normalizer',
)
write(path, text)

# Dashboard API contract no longer exposes transfer targets/actions.
path = 'src/dashboard/api.ts'
text = read(path)
text = replace_once(
    text,
    '  transferTargets: TransferTarget[];\n',
    '',
    'AgentInbox transferTargets',
)
text = regex_once(
    text,
    r'''\nexport type TransferTarget = \{.*?\};\n''',
    '',
    'TransferTarget type',
)
text = text.replace("  INVALID_TRANSFER_TARGET: '请选择有效的转接客服',\n", '')
text = text.replace("  TRANSFER_TARGET_UNAVAILABLE: '该客服当前无法接收新会话',\n", '')
text = regex_once(
    text,
    r'''\nexport async function transferConversation\(.*?\n\}\n\nexport function openAgentInboxSocket''',
    '\nexport function openAgentInboxSocket',
    'dashboard transfer api',
)
write(path, text)

# Agent workspace: remove manual transfer state, action and UI.
path = 'src/dashboard/AgentPortal.tsx'
text = read(path)
text = text.replace('  TransferTarget,\n', '')
text = text.replace('  transferConversation,\n', '')
text = text.replace(
    '  const [transferTargets, setTransferTargets] = useState<TransferTarget[]>([]);\n',
    '',
)
text = text.replace('  const [transferring, setTransferring] = useState(false);\n', '')
text = text.replace('    setTransferTargets(inbox.transferTargets);\n', '')
text = replace_once(
    text,
    '''        if (payload.type === 'conversation.transferred') {
          setSelectedId(null);
          setDetail(null);
          void refresh().catch(() => undefined);
          return;
        }

''',
    '',
    'transfer realtime handler',
)
text = regex_once(
    text,
    r'''\n  async function handoffConversation\(.*?\n  \}\n\n  return \(''',
    '\n\n  return (',
    'handoff function',
)
text = regex_once(
    text,
    r'''\n                \{detail\.conversation\.status !== 'closed' && \(\n                  <details className="transfer-menu">.*?\n                \)\}''',
    '',
    'transfer menu',
)
write(path, text)

# Admin copy reflects final routing.
path = 'src/dashboard/AdminPortal.tsx'
text = read(path)
text = replace_once(
    text,
    "      ? '管理登录身份、人工转接限制、咨询额度和产品负责范围。自动分流采用严格轮询。'",
    "      ? '管理登录身份、每日接待上限、咨询额度和产品负责范围。自动分流采用严格轮询。'",
    'admin section hint',
)
write(path, text)

# Documentation: one routing model, no user-facing transfer feature.
path = 'README.md'
text = read(path)
text = text.replace(
    '按产品负责范围、账号启用状态、已购买额度、CTA 两小时原客服优先和严格轮询，',
    '按产品负责范围、账号启用状态、每日接待上限、已购买额度、CTA 两小时原客服优先和严格轮询，',
)
text = text.replace(
    '→ 根据负责范围、账号启用状态和剩余额度筛选坐席',
    '→ 根据负责范围、账号启用状态、每日接待上限和剩余额度筛选坐席',
)
text = text.replace(
    '| 客服管理中心 `/`    | 配置客服账号、负责范围、人工转接限制、按量额度和统计 |',
    '| 客服管理中心 `/`    | 配置客服账号、负责范围、每日接待上限、按量额度和统计 |',
)
text = text.replace(
    '| 客服坐席端 `/agent` | 登录、接收分配会话、聊天、转接、头像、通知和个人工具 |',
    '| 客服坐席端 `/agent` | 登录、接收分配会话、聊天、头像、通知和个人工具       |',
)
text = text.replace(
    '- 负责范围、账号启用状态、按量额度和 CTA 原客服优先约束下的严格轮询；',
    '- 负责范围、账号启用状态、每日接待上限、按量额度和 CTA 原客服优先约束下的严格轮询；',
)
text = text.replace(
    '- 设置人工指定转接使用的同时会话和每日接待限制；',
    '- 设置参与自动分流的每日接待上限；',
)
text = text.replace('- 会话转给其他仍有容量的在线客服；\n', '')
text = text.replace('- 排除自己后重新进入自动分流；\n', '')
text = replace_once(
    text,
    '''已配置可登录的客服账号和密码
未耗尽坐席总接待额度（未启用额度限制时跳过）
不是本次手动退回自动分流时被排除的原客服
```

自动分流不读取在线 / 忙碌 / 离线状态、心跳新鲜度、当前进行中会话数、并发上限或每日接待上限。工作状态只用于坐席端展示和触发等待队列恢复，不改变严格轮询的候选资格。停用账号会撤销登录资格并释放仍未结束的会话重新分配。''',
    '''已配置可登录的客服账号和密码
未达到当日接待上限（0 表示不限制）
未耗尽坐席总接待额度（未启用额度限制时跳过）
```

自动分流不读取在线 / 忙碌 / 离线状态、心跳新鲜度、当前进行中会话数或并发上限。每日接待上限属于自动分流硬约束：达到上限后该客服在当前洛杉矶业务日退出候选池，下一个业务日自动重新进入。工作状态只用于坐席端展示和触发等待队列恢复，不改变严格轮询排序。停用账号会撤销登录资格并释放仍未结束的会话；释放后的会话仍通过同一套候选规则重新分配。''',
    'README candidates',
)
text = regex_once(
    text,
    r'''### 6\.5 人工转接\n.*?\n## 7\. 会话生命周期与计数''',
    '''### 6.5 每日接待上限

`daily_conversation_limit` 直接参与自动分流。`0` 表示不限制；大于 `0` 时，系统读取 `agent_daily_stats` 中当前洛杉矶业务日的首次有效接待数，达到上限后跳过该客服。跨入下一个洛杉矶自然日后，无需 Cron 重置计数，新的业务日期天然从 0 开始。

在线状态、心跳、当前并发量不影响这个规则。等待队列恢复、停用客服后的内部重新分配也统一调用同一套路由逻辑，不存在坐席端人工转接或手动重新排队入口。已生成的咨询流量凭证保持不可变，内部重新分配不会重复扣减已购买咨询额度。

## 7. 会话生命周期与计数''',
    'README transfer section',
)
text = text.replace(
    '- 转接、重新排队、关闭、重新打开不重复计数；',
    '- 内部重新分配、关闭、重新打开不重复生成有效流量凭证；',
)
text = text.replace(
    '- Inbox 一次返回会话概览、额度摘要和可转接坐席；',
    '- Inbox 一次返回会话概览和额度摘要；',
)
write(path, text)

# Source-level regression contract.
write(
    'test/strict-round-robin-contract.test.mjs',
    '''import assert from 'node:assert/strict';
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
    readFile(new URL('../src/dashboard/AgentPortal.tsx', import.meta.url), 'utf8'),
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
''',
)

# Behavioral daily-cap coverage: cap one means exactly one fresh assignment that day.
path = 'test/agent-daily-quota.test.mjs'
text = read(path)
text = replace_once(
    text,
    """test('daily and active limits do not block automatic traffic delivery', async () => {
  const database = await databaseWithDailyLimit(1);
  addConversation(database, 'conversation-1');
  addConversation(database, 'conversation-2');

  const db = d1(database);
  const first = await assignConversationAgent(db, 'conversation-1');
  const second = await assignConversationAgent(db, 'conversation-2');

  assert.equal(first?.id, 'agent-a');
  assert.equal(second?.id, 'agent-a');
  assert.equal(
    database
      .prepare(
        `SELECT conversation_count AS count
         FROM agent_daily_stats
         WHERE agent_id = 'agent-a'`,
      )
      .get().count,
    2,
    'daily counts remain available for reporting even though they do not gate traffic',
  );
  database.close();
});
""",
    """test('daily reception limit blocks fresh automatic traffic after the cap', async () => {
  const database = await databaseWithDailyLimit(1);
  addConversation(database, 'conversation-1');
  addConversation(database, 'conversation-2');

  const db = d1(database);
  const first = await assignConversationAgent(db, 'conversation-1');
  const second = await assignConversationAgent(db, 'conversation-2');

  assert.equal(first?.id, 'agent-a');
  assert.equal(second, null);
  assert.equal(
    database
      .prepare(
        `SELECT conversation_count AS count
         FROM agent_daily_stats
         WHERE agent_id = 'agent-a'`,
      )
      .get().count,
    1,
  );
  assert.equal(
    database
      .prepare(
        `SELECT assigned_agent FROM conversations
         WHERE id = 'conversation-2'`,
      )
      .get().assigned_agent,
    null,
  );
  database.close();
});
""",
    'daily quota behavior test',
)
write(path, text)

# Full flow: delete user-facing transfer flows; keep internal disable/reassignment behavior.
path = 'test/customer-service-full-flow.test.mjs'
text = read(path)
text = regex_once(
    text,
    r'''\n  const standbyToken = 'agent-session-standby';.*?  assert\.equal\(requeued\.assignment\.id, 'agent-standby'\);\n''',
    '\n',
    'full-flow transfer block',
)
text = regex_once(
    text,
    r'''\n  const tokenA = 'quota-final-session-a';.*?      expiresAt,\n    \);\n''',
    '\n',
    'commercial agent session setup',
)
replacement = '''
  const beforeReassignmentB = database
    .prepare(
      `SELECT a.traffic_quota_used AS used,
         COALESCE(SUM(s.conversation_count), 0) AS daily
       FROM agents a
       LEFT JOIN agent_daily_stats s ON s.agent_id = a.id
       WHERE a.id = ?
       GROUP BY a.id`,
    )
    .get(agentB);
'''
text = regex_once(
    text,
    r'''\n  const cookieA = `cs_agent_session=\$\{tokenA\}`;.*?  assert\.equal\(\n    database\n      \.prepare\('SELECT traffic_quota_used FROM agents WHERE id = \?'\)\n      \.get\(agentA\)\.traffic_quota_used,\n    2,\n  \);\n''',
    replacement,
    'commercial transfer/requeue block',
)
text = text.replace('beforeTransferB', 'beforeReassignmentB')
text = replace_once(
    text,
    """    [agentB, agentB, agentB],
    'disabling a seat must reassign its already-counted active traffic even when the target has no new-traffic quota',
""",
    """    [null, null, null],
    'disabling a seat must leave traffic waiting when every matching seat has reached its daily reception limit',
""",
    'disable expected assignments',
)
text = text.replace(
    "    'reassignment after seat disable must not bill the target again',",
    "    'blocked reassignment must not change the capped target quota or daily count',",
)
text = text.replace(
    "    'immutable first-reception receipts must remain the billing source of truth after transfers',",
    "    'immutable first-reception receipts remain the billing source of truth after internal reassignment attempts',",
)
write(path, text)

# Transfer-only tests no longer describe a supported product capability.
for path in [
    'test/agent-transfer-context.test.mjs',
    'test/transfer-realtime-cost.test.mjs',
]:
    Path(path).unlink()
