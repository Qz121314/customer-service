from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}: {old[:100]!r}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/dashboard/api.ts',
    """export type AgentMonthlyStats = {
  month: string;
  days: number[];
  counts: Array<{ agentId: string; day: number; count: number }>;
};
""",
    """export type AgentMonthlyStats = {
  month: string;
  days: number[];
  counts: Array<{ agentId: string; day: number; count: number }>;
  retainedFrom: string;
};

export type AgentSelfMonthlyStats = {
  month: string;
  days: number[];
  counts: Array<{ day: number; count: number }>;
  total: number;
  todayCount: number;
  dailyLimit: number;
  retainedFrom: string;
};
""",
)

replace_once(
    'src/dashboard/api.ts',
    """export async function getAgentMonthlyStats(
  month: string,
): Promise<AgentMonthlyStats> {
  return request(`/api/admin/agent-stats?month=${encodeURIComponent(month)}`);
}

export async function getAgentSession(): Promise<AgentSessionState> {
""",
    """export async function getAgentMonthlyStats(
  month: string,
): Promise<AgentMonthlyStats> {
  return request(`/api/admin/agent-stats?month=${encodeURIComponent(month)}`);
}

export async function getAgentSelfMonthlyStats(
  month: string,
): Promise<AgentSelfMonthlyStats> {
  return request(`/api/agent/stats?month=${encodeURIComponent(month)}`);
}

export async function getAgentSession(): Promise<AgentSessionState> {
""",
)

old_admin_stats = """adminConfigApi.get('/api/admin/agent-stats', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const month = normalizeMonth(c.req.query('month'));
  if (!month) return c.json({ error: 'INVALID_MONTH' }, 400);
  const result = await c.env.DB.prepare(
    `SELECT assigned_agent AS agent_id,
       CAST(substr(assigned_business_date, 9, 2) AS INTEGER) AS day,
       COUNT(*) AS count
     FROM conversations
     WHERE site_id = 'default'
       AND assigned_agent IS NOT NULL
       AND assigned_business_date >= ?1
       AND assigned_business_date <= ?2
       AND CAST(substr(assigned_business_date, 9, 2) AS INTEGER) BETWEEN 1 AND 30
     GROUP BY assigned_agent, assigned_business_date
     ORDER BY assigned_agent ASC, assigned_business_date ASC`,
  )
    .bind(`${month}-01`, `${month}-30`)
    .all<{ agent_id: string; day: number; count: number }>();
  return c.json({
    month,
    days: Array.from({ length: 30 }, (_, index) => index + 1),
    counts: (result.results ?? []).map((row) => ({
      agentId: row.agent_id,
      day: Number(row.day),
      count: Number(row.count),
    })),
  });
});
"""
new_admin_stats = """adminConfigApi.get('/api/admin/agent-stats', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const month = normalizeMonth(c.req.query('month'));
  if (!month) return c.json({ error: 'INVALID_MONTH' }, 400);
  const retainedFrom = reportingRetentionCutoff();
  const result = await c.env.DB.prepare(
    `SELECT agent_id,
       CAST(substr(business_date, 9, 2) AS INTEGER) AS day,
       conversation_count AS count
     FROM agent_daily_stats
     WHERE site_id = 'default'
       AND business_date >= ?1
       AND business_date <= ?2
       AND business_date >= ?3
       AND CAST(substr(business_date, 9, 2) AS INTEGER) BETWEEN 1 AND 30
     ORDER BY agent_id ASC, business_date ASC`,
  )
    .bind(`${month}-01`, `${month}-30`, retainedFrom)
    .all<{ agent_id: string; day: number; count: number }>();
  return c.json({
    month,
    days: Array.from({ length: 30 }, (_, index) => index + 1),
    counts: (result.results ?? []).map((row) => ({
      agentId: row.agent_id,
      day: Number(row.day),
      count: Number(row.count),
    })),
    retainedFrom,
  });
});
"""
replace_once('src/worker/admin-config-api.ts', old_admin_stats, new_admin_stats)

replace_once(
    'src/worker/admin-config-api.ts',
    """    db
      .prepare(
        `SELECT assigned_agent AS agent_id, COUNT(*) AS count
         FROM conversations
         WHERE site_id = 'default'
           AND assigned_agent IS NOT NULL
           AND assigned_business_date = ?1
         GROUP BY assigned_agent`,
      )
      .bind(businessDate)
      .all<{ agent_id: string; count: number }>(),
""",
    """    db
      .prepare(
        `SELECT agent_id, conversation_count AS count
         FROM agent_daily_stats
         WHERE site_id = 'default'
           AND business_date = ?1`,
      )
      .bind(businessDate)
      .all<{ agent_id: string; count: number }>(),
""",
)

replace_once(
    'src/worker/admin-config-api.ts',
    """function reportingBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}
""",
    """function reportingBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function reportingRetentionCutoff(now = new Date()): string {
  const today = reportingBusinessDate(now);
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 44);
  return date.toISOString().slice(0, 10);
}
""",
)

replace_once(
    'src/worker/agent-api.ts',
    """    c.env.DB.prepare(
      `SELECT a.daily_conversation_limit,
         (SELECT COUNT(*) FROM conversations c
          WHERE c.assigned_agent = a.id
            AND c.site_id = a.site_id
            AND c.assigned_business_date = ?2) AS today_count
       FROM agents a
       WHERE a.id = ?1
       LIMIT 1`,
    )
      .bind(agent.id, businessDate)
      .first<{ daily_conversation_limit: number; today_count: number }>(),
""",
    """    c.env.DB.prepare(
      `SELECT a.daily_conversation_limit,
         COALESCE(s.conversation_count, 0) AS today_count
       FROM agents a
       LEFT JOIN agent_daily_stats s
         ON s.site_id = a.site_id
        AND s.agent_id = a.id
        AND s.business_date = ?2
       WHERE a.id = ?1
       LIMIT 1`,
    )
      .bind(agent.id, businessDate)
      .first<{ daily_conversation_limit: number; today_count: number }>(),
""",
)

agent_stats_endpoint = """
agentApi.get('/api/agent/stats', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const month = normalizeMonth(c.req.query('month'));
  if (!month) return c.json({ error: 'INVALID_MONTH' }, 400);

  const businessDate = routingBusinessDate();
  const retainedFrom = retentionCutoffBusinessDate();
  const [result, quotaRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT CAST(substr(business_date, 9, 2) AS INTEGER) AS day,
         conversation_count AS count
       FROM agent_daily_stats
       WHERE agent_id = ?1
         AND business_date >= ?2
         AND business_date <= ?3
         AND business_date >= ?4
         AND CAST(substr(business_date, 9, 2) AS INTEGER) BETWEEN 1 AND 30
       ORDER BY business_date ASC`,
    )
      .bind(agent.id, `${month}-01`, `${month}-30`, retainedFrom)
      .all<{ day: number; count: number }>(),
    c.env.DB.prepare(
      `SELECT a.daily_conversation_limit,
         COALESCE(s.conversation_count, 0) AS today_count
       FROM agents a
       LEFT JOIN agent_daily_stats s
         ON s.site_id = a.site_id
        AND s.agent_id = a.id
        AND s.business_date = ?2
       WHERE a.id = ?1
       LIMIT 1`,
    )
      .bind(agent.id, businessDate)
      .first<{ daily_conversation_limit: number; today_count: number }>(),
  ]);
  const counts = (result.results ?? []).map((row) => ({
    day: Number(row.day),
    count: Number(row.count),
  }));
  return c.json({
    month,
    days: Array.from({ length: 30 }, (_, index) => index + 1),
    counts,
    total: counts.reduce((sum, row) => sum + row.count, 0),
    todayCount: Number(quotaRow?.today_count ?? 0),
    dailyLimit: Number(quotaRow?.daily_conversation_limit ?? 0),
    retainedFrom,
  });
});

"""
replace_once(
    'src/worker/agent-api.ts',
    """agentApi.get('/api/agent/conversations', async (c) => {
""",
    agent_stats_endpoint + """agentApi.get('/api/agent/conversations', async (c) => {
""",
)

replace_once(
    'src/worker/agent-api.ts',
    """function normalizeMessageId(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed.length <= 200 ? trimmed : null;
}
""",
    """function normalizeMessageId(value?: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed && trimmed.length <= 200 ? trimmed : null;
}

function normalizeMonth(value?: string): string | null {
  const month = value?.trim() ?? '';
  return /^\\d{4}-(0[1-9]|1[0-2])$/u.test(month) ? month : null;
}

function retentionCutoffBusinessDate(now = new Date()): string {
  const today = routingBusinessDate(now);
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 44);
  return date.toISOString().slice(0, 10);
}
""",
)

replace_once(
    'src/dashboard/App.tsx',
    """import { ProductAssignmentPicker } from './ProductAssignmentPicker';
""",
    """import { ProductAssignmentPicker } from './ProductAssignmentPicker';
import { AgentStatisticsWorkspace } from './AgentStatisticsWorkspace';
""",
)

old_agent_return = """  return (
    <AgentWorkspace
      identity={identity}
      onLogout={async () => {
        await agentLogout();
        setIdentity(null);
        setState('signed-out');
      }}
    />
  );
}
"""
new_agent_return = """  const onLogout = async () => {
    await agentLogout();
    setIdentity(null);
    setState('signed-out');
  };

  return window.location.pathname.startsWith('/agent/stats') ? (
    <AgentStatisticsWorkspace identity={identity} onLogout={onLogout} />
  ) : (
    <AgentWorkspace identity={identity} onLogout={onLogout} />
  );
}
"""
replace_once('src/dashboard/App.tsx', old_agent_return, new_agent_return)

replace_once(
    'src/dashboard/App.tsx',
    """        <button
          type=\"button\"
          className=\"ghost-button full\"
          onClick={() => void onLogout()}
        >
          退出客服账号
        </button>
""",
    """        <a className=\"ghost-button full\" href=\"/agent/stats\">
          会话统计
        </a>
        <button
          type=\"button\"
          className=\"ghost-button full\"
          onClick={() => void onLogout()}
        >
          退出客服账号
        </button>
""",
)

replace_once(
    'src/dashboard/App.tsx',
    """        每日上限按 America/Los_Angeles
        自然日计算；达到上限后仅停止接收新会话，已分配会话仍可继续处理。31
        日会正常参与每日限额，但月度表按要求只展示 1–30 日。
""",
    """        每日上限按 America/Los_Angeles
        自然日计算；统计数据独立于 24 小时聊天记录保存并保留 45 天。达到上限后仅停止接收新会话，已分配会话仍可继续处理。31
        日会正常参与每日限额，但月度表按要求只展示 1–30 日。
""",
)

replace_once(
    'README.md',
    """- 客服启用 / 停用、最大同时会话数；
""",
    """- 客服启用 / 停用、最大同时会话数、每日新会话上限；
- 管理员和客服本人都可查看按月 1–30 日会话统计；统计按 America/Los_Angeles 自然日记账并独立保留 45 天；
""",
)

replace_once(
    'README.md',
    """未超过最大同时会话数
""",
    """未超过最大同时会话数
未达到当天每日新会话上限
""",
)
