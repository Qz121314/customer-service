from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def regex_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{path}: expected one regex match, found {count}: {pattern!r}')
    write(path, updated)

# ---------------------------------------------------------------------------
# Worker routing: daily quota counts accepted conversations, not active chats.
# The business date is computed in America/Los_Angeles and persisted on the
# conversation so day boundaries do not depend on SQLite/UTC conversions.
# ---------------------------------------------------------------------------
replace_once(
    'src/worker/routing.ts',
    """export type AgentAssignment = {
  id: string;
  name: string;
};""",
    """export type AgentAssignment = {
  id: string;
  name: string;
};

const ROUTING_TIME_ZONE = 'America/Los_Angeles';

export function routingBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROUTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}""",
)

replace_once(
    'src/worker/routing.ts',
    """  const now = new Date().toISOString();
  const result = await db""",
    """  const now = new Date().toISOString();
  const businessDate = routingBusinessDate(new Date(now));
  const result = await db""",
)

replace_once(
    'src/worker/routing.ts',
    """         LEFT JOIN (
           SELECT assigned_agent, COUNT(*) AS active_count
           FROM conversations
           WHERE site_id = ?1
             AND status IN ('open', 'pending')
             AND assigned_agent IS NOT NULL
             AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
           GROUP BY assigned_agent
         ) load ON load.assigned_agent = a.id
         WHERE a.is_enabled = 1""",
    """         LEFT JOIN (
           SELECT assigned_agent, COUNT(*) AS active_count
           FROM conversations
           WHERE site_id = ?1
             AND status IN ('open', 'pending')
             AND assigned_agent IS NOT NULL
             AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
           GROUP BY assigned_agent
         ) load ON load.assigned_agent = a.id
         LEFT JOIN (
           SELECT assigned_agent, COUNT(*) AS daily_count
           FROM conversations
           WHERE site_id = ?1
             AND assigned_agent IS NOT NULL
             AND assigned_business_date = ?8
           GROUP BY assigned_agent
         ) daily ON daily.assigned_agent = a.id
         WHERE a.is_enabled = 1""",
)
replace_once(
    'src/worker/routing.ts',
    """           AND (
             a.max_active_conversations = 0
             OR COALESCE(load.active_count, 0) < a.max_active_conversations
           )
         ORDER BY
           COALESCE(load.active_count, 0) ASC,""",
    """           AND (
             a.max_active_conversations = 0
             OR COALESCE(load.active_count, 0) < a.max_active_conversations
           )
           AND (
             a.daily_conversation_limit = 0
             OR COALESCE(daily.daily_count, 0) < a.daily_conversation_limit
           )
         ORDER BY
           COALESCE(daily.daily_count, 0) ASC,
           COALESCE(load.active_count, 0) ASC,""",
)

# Apply equivalent daily quota join/check to legacy routing candidate.
replace_once(
    'src/worker/routing.ts',
    """         LEFT JOIN (
           SELECT assigned_agent, COUNT(*) AS active_count
           FROM conversations
           WHERE site_id = ?1
             AND status IN ('open', 'pending')
             AND assigned_agent IS NOT NULL
             AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
           GROUP BY assigned_agent
         ) load ON load.assigned_agent = a.id
         WHERE ?5 <> ''""",
    """         LEFT JOIN (
           SELECT assigned_agent, COUNT(*) AS active_count
           FROM conversations
           WHERE site_id = ?1
             AND status IN ('open', 'pending')
             AND assigned_agent IS NOT NULL
             AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
           GROUP BY assigned_agent
         ) load ON load.assigned_agent = a.id
         LEFT JOIN (
           SELECT assigned_agent, COUNT(*) AS daily_count
           FROM conversations
           WHERE site_id = ?1
             AND assigned_agent IS NOT NULL
             AND assigned_business_date = ?8
           GROUP BY assigned_agent
         ) daily ON daily.assigned_agent = a.id
         WHERE ?5 <> ''""",
)
# Replace second occurrence only by operating on tail after first already changed.
text = read('src/worker/routing.ts')
needle = """           AND (
             a.max_active_conversations = 0
             OR COALESCE(load.active_count, 0) < a.max_active_conversations
           )
         ORDER BY
           COALESCE(load.active_count, 0) ASC,"""
if text.count(needle) != 1:
    raise RuntimeError(f'routing legacy capacity block: expected one match, found {text.count(needle)}')
text = text.replace(
    needle,
    """           AND (
             a.max_active_conversations = 0
             OR COALESCE(load.active_count, 0) < a.max_active_conversations
           )
           AND (
             a.daily_conversation_limit = 0
             OR COALESCE(daily.daily_count, 0) < a.daily_conversation_limit
           )
         ORDER BY
           COALESCE(daily.daily_count, 0) ASC,
           COALESCE(load.active_count, 0) ASC,""",
    1,
)
write('src/worker/routing.ts', text)

replace_once(
    'src/worker/routing.ts',
    """       UPDATE conversations
       SET assigned_agent = (SELECT id FROM candidate),
           status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
           updated_at = ?7""",
    """       UPDATE conversations
       SET assigned_agent = (SELECT id FROM candidate),
           assigned_at = ?7,
           assigned_business_date = ?8,
           status = CASE WHEN status = 'open' THEN 'pending' ELSE status END,
           updated_at = ?7""",
)
replace_once(
    'src/worker/routing.ts',
    """      conversationId,
      now,
    )""",
    """      conversationId,
      now,
      businessDate,
    )""",
)

# ---------------------------------------------------------------------------
# Admin API: persist daily limit, return today's accepted count in bootstrap,
# and expose one monthly statistics request for all agents and days 1..30.
# ---------------------------------------------------------------------------
replace_once(
    'src/worker/admin-config-api.ts',
    """  max_active_conversations: number;
  last_login_at: string | null;""",
    """  max_active_conversations: number;
  daily_conversation_limit: number;
  last_login_at: string | null;""",
)
replace_once(
    'src/worker/admin-config-api.ts',
    """const SESSION_COOKIE = 'cs_session';""",
    """const SESSION_COOKIE = 'cs_session';
const REPORTING_TIME_ZONE = 'America/Los_Angeles';""",
)

replace_once(
    'src/worker/admin-config-api.ts',
    """adminConfigApi.get('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({ agents: await loadAgents(c.env.DB) });
});""",
    """adminConfigApi.get('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({ agents: await loadAgents(c.env.DB) });
});

adminConfigApi.get('/api/admin/agent-stats', async (c) => {
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
});""",
)

# Create body adds dailyConversationLimit.
replace_once(
    'src/worker/admin-config-api.ts',
    """    maxActiveConversations?: number;
    isEnabled?: boolean;""",
    """    maxActiveConversations?: number;
    dailyConversationLimit?: number;
    isEnabled?: boolean;""",
)
replace_once(
    'src/worker/admin-config-api.ts',
    """  const maxActive = normalizeCapacity(body?.maxActiveConversations);
  const credentials = await hashAgentPassword(password);""",
    """  const maxActive = normalizeCapacity(body?.maxActiveConversations);
  const dailyLimit = normalizeDailyLimit(body?.dailyConversationLimit);
  const credentials = await hashAgentPassword(password);""",
)
replace_once(
    'src/worker/admin-config-api.ts',
    """         password_iterations, status, is_enabled, max_active_conversations
       ) VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6, 'offline', ?7, ?8)`,""",
    """         password_iterations, status, is_enabled, max_active_conversations,
         daily_conversation_limit
       ) VALUES (?1, 'default', ?2, ?3, ?4, ?5, ?6, 'offline', ?7, ?8, ?9)`,""",
)
replace_once(
    'src/worker/admin-config-api.ts',
    """      enabled,
      maxActive,
    ),""",
    """      enabled,
      maxActive,
      dailyLimit,
    ),""",
)

# Current row query and patch body.
replace_once(
    'src/worker/admin-config-api.ts',
    """    `SELECT id, name, username, status, is_enabled, max_active_conversations,
       last_login_at, last_seen_at, password_hash, password_salt, password_iterations""",
    """    `SELECT id, name, username, status, is_enabled, max_active_conversations,
       daily_conversation_limit, last_login_at, last_seen_at, password_hash,
       password_salt, password_iterations""",
)
# Replace the remaining patch body occurrence.
text = read('src/worker/admin-config-api.ts')
needle = """    maxActiveConversations?: number;
    isEnabled?: boolean;"""
if text.count(needle) != 1:
    raise RuntimeError(f'admin patch body: expected one match, found {text.count(needle)}')
text = text.replace(
    needle,
    """    maxActiveConversations?: number;
    dailyConversationLimit?: number;
    isEnabled?: boolean;""",
    1,
)
write('src/worker/admin-config-api.ts', text)

replace_once(
    'src/worker/admin-config-api.ts',
    """  const maxActive =
    body.maxActiveConversations === undefined
      ? current.max_active_conversations
      : normalizeCapacity(body.maxActiveConversations);""",
    """  const maxActive =
    body.maxActiveConversations === undefined
      ? current.max_active_conversations
      : normalizeCapacity(body.maxActiveConversations);
  const dailyLimit =
    body.dailyConversationLimit === undefined
      ? current.daily_conversation_limit
      : normalizeDailyLimit(body.dailyConversationLimit);""",
)
replace_once(
    'src/worker/admin-config-api.ts',
    """           is_enabled = ?6,
           max_active_conversations = ?7,
           status = CASE WHEN ?6 = 0 THEN 'offline' ELSE status END,""",
    """           is_enabled = ?6,
           max_active_conversations = ?7,
           daily_conversation_limit = ?8,
           status = CASE WHEN ?6 = 0 THEN 'offline' ELSE status END,""",
)
replace_once(
    'src/worker/admin-config-api.ts',
    """       WHERE id = ?8 AND site_id = 'default'`,""",
    """       WHERE id = ?9 AND site_id = 'default'`,""",
)
replace_once(
    'src/worker/admin-config-api.ts',
    """      enabled,
      maxActive,
      id,
    ),""",
    """      enabled,
      maxActive,
      dailyLimit,
      id,
    ),""",
)

# loadAgents returns daily limit + today's count without another Worker request.
replace_once(
    'src/worker/admin-config-api.ts',
    """  const [agentsResult, assignmentsResult] = await Promise.all([""",
    """  const businessDate = reportingBusinessDate();
  const [agentsResult, assignmentsResult, todayResult] = await Promise.all([""",
)
replace_once(
    'src/worker/admin-config-api.ts',
    """        `SELECT id, name, username, status, is_enabled, max_active_conversations,
           last_login_at, last_seen_at, password_hash, password_salt, password_iterations""",
    """        `SELECT id, name, username, status, is_enabled, max_active_conversations,
           daily_conversation_limit, last_login_at, last_seen_at, password_hash,
           password_salt, password_iterations""",
)
replace_once(
    'src/worker/admin-config-api.ts',
    """      .all<ScopeRow>(),
  ]);""",
    """      .all<ScopeRow>(),
    db
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
  ]);""",
)
replace_once(
    'src/worker/admin-config-api.ts',
    """  const rowsByAgent = new Map<string, ScopeRow[]>();""",
    """  const todayByAgent = new Map(
    (todayResult.results ?? []).map((row) => [row.agent_id, Number(row.count)]),
  );
  const rowsByAgent = new Map<string, ScopeRow[]>();""",
)
replace_once(
    'src/worker/admin-config-api.ts',
    """      maxActiveConversations: agent.max_active_conversations,
      lastLoginAt: agent.last_login_at,""",
    """      maxActiveConversations: agent.max_active_conversations,
      dailyConversationLimit: agent.daily_conversation_limit,
      todayConversationCount: todayByAgent.get(agent.id) ?? 0,
      lastLoginAt: agent.last_login_at,""",
)

replace_once(
    'src/worker/admin-config-api.ts',
    """function normalizeCapacity(value?: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(999, Math.trunc(value ?? 0)));
}""",
    """function normalizeCapacity(value?: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(999, Math.trunc(value ?? 0)));
}

function normalizeDailyLimit(value?: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(9999, Math.trunc(value ?? 0)));
}

function normalizeMonth(value?: string): string | null {
  const month = value?.trim() ?? '';
  return /^\\d{4}-(0[1-9]|1[0-2])$/u.test(month) ? month : null;
}

function reportingBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORTING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}""",
)

# ---------------------------------------------------------------------------
# Agent overview: expose own daily count/limit in the existing overview request.
# ---------------------------------------------------------------------------
replace_once(
    'src/worker/agent-api.ts',
    """import { assignConversationAgent } from './routing';""",
    """import { assignConversationAgent, routingBusinessDate } from './routing';""",
)
regex_once(
    'src/worker/agent-api.ts',
    r"agentApi.get\('/api/agent/overview', async \(c\) => \{[\s\S]*?\n\}\);\n\nagentApi.get\('/api/agent/conversations'",
    """agentApi.get('/api/agent/overview', async (c) => {
  const agent = await authenticateAgent(c);
  if (!agent) return unauthorized(c);
  const businessDate = routingBusinessDate();
  const [statusResult, quotaRow] = await Promise.all([
    c.env.DB.prepare(
      `SELECT status, COUNT(*) AS count
       FROM conversations
       WHERE assigned_agent = ?1
         AND COALESCE(expires_at, datetime(created_at, '+1 day')) > CURRENT_TIMESTAMP
       GROUP BY status`,
    )
      .bind(agent.id)
      .all<{ status: ConversationStatus; count: number }>(),
    c.env.DB.prepare(
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
  ]);
  const counts = { open: 0, pending: 0, closed: 0 };
  for (const row of statusResult.results ?? [])
    counts[row.status] = Number(row.count ?? 0);
  return c.json({
    ...counts,
    total: counts.open + counts.pending + counts.closed,
    todayAccepted: Number(quotaRow?.today_count ?? 0),
    dailyLimit: Number(quotaRow?.daily_conversation_limit ?? 0),
  });
});

agentApi.get('/api/agent/conversations'""",
)

# ---------------------------------------------------------------------------
# Dashboard API types/requests.
# ---------------------------------------------------------------------------
replace_once(
    'src/dashboard/api.ts',
    """  maxActiveConversations: number;
  lastLoginAt: string | null;""",
    """  maxActiveConversations: number;
  dailyConversationLimit: number;
  todayConversationCount: number;
  lastLoginAt: string | null;""",
)
replace_once(
    'src/dashboard/api.ts',
    """export type Overview = {
  open: number;
  pending: number;
  closed: number;
  total: number;
};""",
    """export type Overview = {
  open: number;
  pending: number;
  closed: number;
  total: number;
  todayAccepted: number;
  dailyLimit: number;
};

export type AgentMonthlyStats = {
  month: string;
  days: number[];
  counts: Array<{ agentId: string; day: number; count: number }>;
};""",
)
# create and update input fields.
replace_once(
    'src/dashboard/api.ts',
    """  maxActiveConversations: number;
  isEnabled: boolean;""",
    """  maxActiveConversations: number;
  dailyConversationLimit: number;
  isEnabled: boolean;""",
)
text = read('src/dashboard/api.ts')
needle = """    maxActiveConversations: number;
    isEnabled: boolean;"""
if text.count(needle) != 1:
    raise RuntimeError(f'api update input: expected one match, found {text.count(needle)}')
text = text.replace(
    needle,
    """    maxActiveConversations: number;
    dailyConversationLimit: number;
    isEnabled: boolean;""",
    1,
)
write('src/dashboard/api.ts', text)
replace_once(
    'src/dashboard/api.ts',
    """export async function getProductCatalog(): Promise<ProductCatalogItem[]> {
  const response = await getAdminBootstrap();
  return response.products;
}""",
    """export async function getProductCatalog(): Promise<ProductCatalogItem[]> {
  const response = await getAdminBootstrap();
  return response.products;
}

export async function getAgentMonthlyStats(
  month: string,
): Promise<AgentMonthlyStats> {
  return request(`/api/admin/agent-stats?month=${encodeURIComponent(month)}`);
}""",
)

# ---------------------------------------------------------------------------
# Admin UI: daily limit editor + today's quota column + 1..30 monthly statistics.
# ---------------------------------------------------------------------------
replace_once(
    'src/dashboard/App.tsx',
    """  AgentRoutingScope,
  ProductCatalogItem,""",
    """  AgentRoutingScope,
  AgentMonthlyStats,
  ProductCatalogItem,""",
)
replace_once(
    'src/dashboard/App.tsx',
    """  getAdminSession,
  getAgentSession,""",
    """  getAdminSession,
  getAgentMonthlyStats,
  getAgentSession,""",
)
replace_once(
    'src/dashboard/App.tsx',
    """type AdminSection = 'agents' | 'workspace';""",
    """type AdminSection = 'agents' | 'statistics' | 'workspace';""",
)
replace_once(
    'src/dashboard/App.tsx',
    """  maxActiveConversations: number;
  isEnabled: boolean;""",
    """  maxActiveConversations: number;
  dailyConversationLimit: number;
  isEnabled: boolean;""",
)
replace_once(
    'src/dashboard/App.tsx',
    """  maxActiveConversations: 0,
  isEnabled: true,""",
    """  maxActiveConversations: 0,
  dailyConversationLimit: 40,
  isEnabled: true,""",
)

# Add monthly stats state.
replace_once(
    'src/dashboard/App.tsx',
    """  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');""",
    """  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [statsMonth, setStatsMonth] = useState(() => currentBusinessMonth());
  const [monthlyStats, setMonthlyStats] = useState<AgentMonthlyStats | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);""",
)

replace_once(
    'src/dashboard/App.tsx',
    """  useEffect(() => {
    if (!editorOpen || saving) return;""",
    """  useEffect(() => {
    if (section !== 'statistics') return;
    let active = true;
    setStatsBusy(true);
    getAgentMonthlyStats(statsMonth)
      .then((result) => {
        if (active) setMonthlyStats(result);
      })
      .catch((reason) => {
        if (active) setError(message(reason, '无法加载会话统计'));
      })
      .finally(() => {
        if (active) setStatsBusy(false);
      });
    return () => {
      active = false;
    };
  }, [section, statsMonth]);

  useEffect(() => {
    if (!editorOpen || saving) return;""",
)

replace_once(
    'src/dashboard/App.tsx',
    """      maxActiveConversations: agent.maxActiveConversations,
      isEnabled: agent.isEnabled,""",
    """      maxActiveConversations: agent.maxActiveConversations,
      dailyConversationLimit: agent.dailyConversationLimit,
      isEnabled: agent.isEnabled,""",
)
# save inputs two occurrences.
replace_once(
    'src/dashboard/App.tsx',
    """          maxActiveConversations: draft.maxActiveConversations,
          isEnabled: draft.isEnabled,""",
    """          maxActiveConversations: draft.maxActiveConversations,
          dailyConversationLimit: draft.dailyConversationLimit,
          isEnabled: draft.isEnabled,""",
)
text = read('src/dashboard/App.tsx')
needle = """          maxActiveConversations: draft.maxActiveConversations,
          isEnabled: draft.isEnabled,"""
if text.count(needle) != 1:
    raise RuntimeError(f'App create input: expected one match, found {text.count(needle)}')
text = text.replace(
    needle,
    """          maxActiveConversations: draft.maxActiveConversations,
          dailyConversationLimit: draft.dailyConversationLimit,
          isEnabled: draft.isEnabled,""",
    1,
)
write('src/dashboard/App.tsx', text)

# Section titles/hints.
replace_once(
    'src/dashboard/App.tsx',
    """  const sectionTitle = section === 'agents' ? '客服坐席' : '坐席工作台';
  const sectionHint =
    section === 'agents'
      ? '管理员创建客服账号，并按分区、分类或单个产品配置负责范围。'
      : '员工统一使用这个地址登录聊天工作台，管理后台本身不处理访客会话。';""",
    """  const sectionTitle =
    section === 'agents'
      ? '客服坐席'
      : section === 'statistics'
        ? '会话统计'
        : '坐席工作台';
  const sectionHint =
    section === 'agents'
      ? '管理员创建客服账号，并配置负责范围、同时会话上限和每日接待配额。'
      : section === 'statistics'
        ? '按客服查看所选月份 1 号到 30 号每天实际接收的新会话数量。'
        : '员工统一使用这个地址登录聊天工作台，管理后台本身不处理访客会话。';""",
)

# Sidebar stats nav.
replace_once(
    'src/dashboard/App.tsx',
    """          <button
            type="button"
            className={section === 'workspace' ? 'active' : ''}""",
    """          <button
            type="button"
            className={section === 'statistics' ? 'active' : ''}
            onClick={() => setSection('statistics')}
          >
            <span>会话统计</span>
            <small>1–30 日</small>
          </button>
          <button
            type="button"
            className={section === 'workspace' ? 'active' : ''}""",
)

# Agent table columns and quota display.
replace_once(
    'src/dashboard/App.tsx',
    """                        <th>最大会话</th>
                        <th>最后在线</th>""",
    """                        <th>同时会话</th>
                        <th>今日接待</th>
                        <th>最后在线</th>""",
)
replace_once(
    'src/dashboard/App.tsx',
    """                          <td>{agent.maxActiveConversations || '不限'}</td>
                          <td>""",
    """                          <td>{agent.maxActiveConversations || '不限'}</td>
                          <td>
                            <div className="daily-quota-cell">
                              <strong>
                                {agent.todayConversationCount}
                                <span>/</span>
                                {agent.dailyConversationLimit || '∞'}
                              </strong>
                              {agent.dailyConversationLimit > 0 ? (
                                <span
                                  className={`quota-state ${
                                    agent.todayConversationCount >=
                                    agent.dailyConversationLimit
                                      ? 'full'
                                      : ''
                                  }`}
                                >
                                  {agent.todayConversationCount >=
                                  agent.dailyConversationLimit
                                    ? '今日已满'
                                    : `剩余 ${Math.max(
                                        0,
                                        agent.dailyConversationLimit -
                                          agent.todayConversationCount,
                                      )}`}
                                </span>
                              ) : (
                                <span className="quota-state">不限</span>
                              )}
                            </div>
                          </td>
                          <td>""",
)

# Insert statistics section before workspace.
replace_once(
    'src/dashboard/App.tsx',
    """        {section === 'workspace' && (
          <section className="workspace-access-card">""",
    """        {section === 'statistics' && (
          <MonthlyAgentStatistics
            agents={agents}
            month={statsMonth}
            stats={monthlyStats}
            busy={statsBusy}
            onMonthChange={setStatsMonth}
          />
        )}

        {section === 'workspace' && (
          <section className="workspace-access-card">""",
)

# Editor: add daily quota next to concurrent capacity.
replace_once(
    'src/dashboard/App.tsx',
    """              <label>
                <span>最大同时会话数</span>
                <input
                  type="number"
                  min="0"
                  max="999"
                  value={draft.maxActiveConversations}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      maxActiveConversations: Number(event.target.value) || 0,
                    })
                  }
                />
                <small>填写 0 表示不限制。</small>
              </label>""",
    """              <div className="form-two-columns quota-fields">
                <label>
                  <span>最大同时会话数</span>
                  <input
                    type="number"
                    min="0"
                    max="999"
                    value={draft.maxActiveConversations}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        maxActiveConversations: Number(event.target.value) || 0,
                      })
                    }
                  />
                  <small>控制正在处理中的并发会话，0 表示不限制。</small>
                </label>
                <label>
                  <span>每日会话上限</span>
                  <input
                    type="number"
                    min="0"
                    max="9999"
                    value={draft.dailyConversationLimit}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        dailyConversationLimit: Number(event.target.value) || 0,
                      })
                    }
                  />
                  <small>例如 40：当天接满 40 个后停止分流，第二天自动恢复。0 表示不限。</small>
                </label>
              </div>""",
)

# Agent workspace initial overview shape.
replace_once(
    'src/dashboard/App.tsx',
    """    closed: 0,
    total: 0,
  });""",
    """    closed: 0,
    total: 0,
    todayAccepted: 0,
    dailyLimit: 0,
  });""",
)

# Append quota display into existing overview/stats area by inserting near filterLabels use.
replace_once(
    'src/dashboard/App.tsx',
    """function AgentPortal() {""",
    """function MonthlyAgentStatistics({
  agents,
  month,
  stats,
  busy,
  onMonthChange,
}: {
  agents: AgentAccount[];
  month: string;
  stats: AgentMonthlyStats | null;
  busy: boolean;
  onMonthChange: (month: string) => void;
}) {
  const countMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of stats?.counts ?? []) {
      map.set(`${item.agentId}:${item.day}`, item.count);
    }
    return map;
  }, [stats]);
  const total = (stats?.counts ?? []).reduce((sum, item) => sum + item.count, 0);
  const days = stats?.days ?? Array.from({ length: 30 }, (_, index) => index + 1);
  const agentTotals = new Map(
    agents.map((agent) => [
      agent.id,
      days.reduce(
        (sum, day) => sum + (countMap.get(`${agent.id}:${day}`) ?? 0),
        0,
      ),
    ]),
  );

  return (
    <section className="statistics-panel">
      <div className="statistics-toolbar">
        <div>
          <strong>每日新会话</strong>
          <span>统计口径：会话首次分配给客服时计 1 次</span>
        </div>
        <label>
          <span>月份</span>
          <input
            type="month"
            value={month}
            onChange={(event) => onMonthChange(event.target.value)}
          />
        </label>
      </div>
      <div className="statistics-summary">
        <div>
          <span>本月 1–30 日</span>
          <strong>{busy ? '—' : total}</strong>
        </div>
        <div>
          <span>客服人数</span>
          <strong>{agents.length}</strong>
        </div>
        <div>
          <span>平均每客服</span>
          <strong>{agents.length && !busy ? Math.round(total / agents.length) : 0}</strong>
        </div>
      </div>
      <div className="statistics-table-wrap">
        <table className="statistics-table">
          <thead>
            <tr>
              <th className="sticky-agent">客服</th>
              {days.map((day) => (
                <th key={day}>{day}</th>
              ))}
              <th>合计</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <th className="sticky-agent">
                  <strong>{agent.name}</strong>
                  <small>{agent.username || '—'}</small>
                </th>
                {days.map((day) => {
                  const value = countMap.get(`${agent.id}:${day}`) ?? 0;
                  return (
                    <td key={day} className={value ? 'has-value' : ''}>
                      {busy ? '·' : value || '—'}
                    </td>
                  );
                })}
                <td className="statistics-total">
                  {busy ? '—' : agentTotals.get(agent.id) ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="statistics-note">
        每日上限按 America/Los_Angeles 自然日计算；达到上限后仅停止接收新会话，已分配会话仍可继续处理。31 日会正常参与每日限额，但月度表按要求只展示 1–30 日。
      </p>
    </section>
  );
}

function currentBusinessMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHAT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}`;
}

function AgentPortal() {""",
)

# ---------------------------------------------------------------------------
# UI styles for refined quota/statistics surfaces.
# ---------------------------------------------------------------------------
with (ROOT / 'src/dashboard/styles.css').open('a', encoding='utf-8') as handle:
    handle.write(
        """

/* Daily routing quota + monthly operations statistics */
.daily-quota-cell {
  display: grid;
  min-width: 86px;
  gap: 3px;
}

.daily-quota-cell strong {
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.daily-quota-cell strong span {
  margin: 0 2px;
  color: #a3a8b2;
  font-weight: 500;
}

.quota-state {
  color: #777c86;
  font-size: 11px;
  font-weight: 650;
}

.quota-state.full {
  color: #b34747;
}

.quota-fields small {
  display: block;
  margin-top: 2px;
  color: #888e98;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.45;
}

.statistics-panel {
  display: grid;
  gap: 16px;
}

.statistics-toolbar,
.statistics-summary,
.statistics-table-wrap,
.statistics-note {
  border: 1px solid #e4e6ea;
  background: #fff;
}

.statistics-toolbar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  border-radius: 16px;
}

.statistics-toolbar > div {
  display: grid;
  gap: 5px;
}

.statistics-toolbar > div > strong {
  font-size: 16px;
}

.statistics-toolbar > div > span,
.statistics-note {
  color: #777d87;
  font-size: 12px;
  line-height: 1.55;
}

.statistics-toolbar label {
  display: grid;
  gap: 6px;
  color: #666c76;
  font-size: 11px;
  font-weight: 750;
}

.statistics-toolbar input[type='month'] {
  min-height: 40px;
  padding: 0 11px;
  border: 1px solid #dfe2e7;
  border-radius: 10px;
  color: #1a1d22;
  background: #fff;
}

.statistics-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  overflow: hidden;
  border-radius: 16px;
}

.statistics-summary > div {
  display: grid;
  gap: 8px;
  padding: 17px 20px;
}

.statistics-summary > div + div {
  border-left: 1px solid #eceef1;
}

.statistics-summary span {
  color: #7d838e;
  font-size: 11px;
  font-weight: 700;
}

.statistics-summary strong {
  font-size: 24px;
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
}

.statistics-table-wrap {
  overflow: auto;
  border-radius: 16px;
  box-shadow: 0 8px 28px rgba(24, 28, 36, 0.035);
}

.statistics-table {
  width: max-content;
  min-width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.statistics-table th,
.statistics-table td {
  min-width: 42px;
  height: 44px;
  padding: 0 8px;
  border-right: 1px solid #f0f1f3;
  border-bottom: 1px solid #eef0f2;
  text-align: center;
  white-space: nowrap;
}

.statistics-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  color: #777d86;
  background: #fafbfc;
  font-size: 10px;
  font-weight: 800;
}

.statistics-table .sticky-agent {
  position: sticky;
  left: 0;
  z-index: 3;
  min-width: 154px;
  padding-inline: 14px;
  text-align: left;
  background: #fff;
  box-shadow: 1px 0 0 #e9ebef;
}

.statistics-table thead .sticky-agent {
  z-index: 4;
  background: #fafbfc;
}

.statistics-table tbody .sticky-agent {
  display: table-cell;
  vertical-align: middle;
}

.statistics-table tbody .sticky-agent strong,
.statistics-table tbody .sticky-agent small {
  display: block;
}

.statistics-table tbody .sticky-agent strong {
  color: #262a30;
  font-size: 12px;
}

.statistics-table tbody .sticky-agent small {
  margin-top: 2px;
  color: #8b9099;
  font-size: 10px;
  font-weight: 500;
}

.statistics-table td {
  color: #a0a5ae;
}

.statistics-table td.has-value {
  color: #21252b;
  background: #f7f8fa;
  font-weight: 750;
}

.statistics-table .statistics-total {
  min-width: 58px;
  color: #171a1f;
  background: #fafbfc;
  font-weight: 850;
}

.statistics-note {
  margin: 0;
  padding: 13px 16px;
  border-radius: 12px;
}

@media (max-width: 760px) {
  .statistics-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .statistics-summary {
    grid-template-columns: 1fr;
  }

  .statistics-summary > div + div {
    border-top: 1px solid #eceef1;
    border-left: 0;
  }

  .statistics-table .sticky-agent {
    min-width: 126px;
  }
}
"""
    )

# ---------------------------------------------------------------------------
# Tests: daily quota closes channel at limit and resets by business date.
# ---------------------------------------------------------------------------
replace_once(
    'test/product-agent-routing.test.mjs',
    """      max_active_conversations INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,""",
    """      max_active_conversations INTEGER NOT NULL DEFAULT 0,
      daily_conversation_limit INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,""",
)
replace_once(
    'test/product-agent-routing.test.mjs',
    """      assigned_agent TEXT,
      status TEXT NOT NULL,""",
    """      assigned_agent TEXT,
      assigned_at TEXT,
      assigned_business_date TEXT,
      status TEXT NOT NULL,""",
)
replace_once(
    'test/product-agent-routing.test.mjs',
    """    maxActiveConversations = 0,
  },""",
    """    maxActiveConversations = 0,
    dailyConversationLimit = 0,
  },""",
)
replace_once(
    'test/product-agent-routing.test.mjs',
    """         max_active_conversations, last_seen_at, last_assigned_at
       ) VALUES (?, 'default', ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, ?)`,""",
    """         max_active_conversations, daily_conversation_limit,
         last_seen_at, last_assigned_at
       ) VALUES (?, 'default', ?, ?, ?, ?, 1, ?, ?, CURRENT_TIMESTAMP, ?)`,""",
)
replace_once(
    'test/product-agent-routing.test.mjs',
    """      maxActiveConversations,
      lastAssignedAt,""",
    """      maxActiveConversations,
      dailyConversationLimit,
      lastAssignedAt,""",
)

with (ROOT / 'test/product-agent-routing.test.mjs').open('a', encoding='utf-8') as handle:
    handle.write(
        """

test('daily conversation limit closes routing after quota and reopens next business day', async () => {
  const database = createDatabase();
  addAgent(database, { id: 'quota-agent', dailyConversationLimit: 2 });
  addScope(database, 'quota-agent', { type: 'section', sectionId: 'west' });
  addConversation(database, 'conversation-1', 'product-a');
  addConversation(database, 'conversation-2', 'product-b');
  addConversation(database, 'conversation-3', 'product-c');

  const db = d1(database);
  const first = await assignConversationAgent(db, 'conversation-1');
  const second = await assignConversationAgent(db, 'conversation-2');
  const third = await assignConversationAgent(db, 'conversation-3');

  assert.equal(first?.id, 'quota-agent');
  assert.equal(second?.id, 'quota-agent');
  assert.equal(third, null);

  const today = database
    .prepare(
      `SELECT assigned_business_date AS day
       FROM conversations WHERE id = 'conversation-1'`,
    )
    .get().day;
  database
    .prepare(
      `UPDATE conversations
       SET assigned_business_date = '2000-01-01'
       WHERE assigned_agent = 'quota-agent'`,
    )
    .run();

  const reopened = await assignConversationAgent(db, 'conversation-3');
  assert.equal(reopened?.id, 'quota-agent');
  assert.ok(today && today !== '2000-01-01');
  database.close();
});
"""
    )

print('Daily quota and monthly statistics patch applied.')
