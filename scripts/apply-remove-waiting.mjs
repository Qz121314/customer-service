import { access, appendFile, readFile, rm, writeFile } from 'node:fs/promises';

const root = process.cwd();
const file = (path) => `${root}/${path}`;

async function read(path) {
  return readFile(file(path), 'utf8');
}

async function write(path, content) {
  await writeFile(file(path), content, 'utf8');
}

async function replaceOnce(path, from, to) {
  const source = await read(path);
  const first = source.indexOf(from);
  if (first < 0 || source.indexOf(from, first + from.length) >= 0) {
    throw new Error(`Expected exactly one match in ${path}: ${from.slice(0, 120)}`);
  }
  await write(path, source.slice(0, first) + to + source.slice(first + from.length));
}

async function replaceRegexOnce(path, pattern, replacement) {
  const source = await read(path);
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one regex match in ${path}: ${pattern} (got ${matches.length})`);
  }
  await write(path, source.replace(pattern, replacement));
}

async function removeImportIfUnused(path, symbol, importLine) {
  let source = await read(path);
  const count = [...source.matchAll(new RegExp(`\\b${symbol}\\b`, 'g'))].length;
  if (count === 1 && source.includes(importLine)) {
    source = source.replace(importLine, '');
    await write(path, source);
  }
}

await write(
  'src/worker/no-available-agent.ts',
  `export const DEFAULT_NO_AVAILABLE_AGENT_MESSAGE =
  '当前暂无可用客服，请稍后再试。';

export class NoAvailableAgentError extends Error {
  readonly siteId: string;

  constructor(siteId: string) {
    super('NO_AVAILABLE_AGENT');
    this.name = 'NoAvailableAgentError';
    this.siteId = siteId;
  }
}

export async function unavailableAgentMessage(
  db: D1Database,
  siteId: string,
): Promise<string> {
  try {
    const row = await db
      .prepare(
        \`SELECT unavailable_agent_message
         FROM sites
         WHERE id = ?1
         LIMIT 1\`,
      )
      .bind(siteId)
      .first<{ unavailable_agent_message: string | null }>();
    const configured = row?.unavailable_agent_message?.trim() ?? '';
    return configured || DEFAULT_NO_AVAILABLE_AGENT_MESSAGE;
  } catch {
    return DEFAULT_NO_AVAILABLE_AGENT_MESSAGE;
  }
}
`,
);

await write(
  'migrations/0049_remove_waiting_conversations.sql',
  `PRAGMA foreign_keys = ON;

-- When no seat is eligible, the client receives a configurable failure instead
-- of creating a conversation that waits for a future recovery pass.
ALTER TABLE sites
  ADD COLUMN unavailable_agent_message TEXT NOT NULL
  DEFAULT '当前暂无可用客服，请稍后再试。';

-- Remove historical live rows that existed only because of the old waiting
-- mechanism. Child messages and source handoffs are removed by their FKs.
DELETE FROM conversations
WHERE assigned_agent IS NULL
  AND status IN ('open', 'pending');
`,
);

await replaceOnce(
  'src/worker/routing.ts',
  `export type AgentAssignment = {\n`,
  `import { NoAvailableAgentError } from './no-available-agent';\n\nexport type AgentAssignment = {\n`,
);
await replaceOnce(
  'src/worker/routing.ts',
  `const ROUTING_TIME_ZONE = 'America/Los_Angeles';
const MAX_WAITING_ASSIGNMENTS = 10;
const WAITING_SCAN_BATCH_SIZE = 50;

type AssignmentOptions = {
  returnExisting?: boolean;
};

export type WaitingConversationAssignment = {
  conversationId: string;
  assignment: AgentAssignmentResult & {
    newlyAssigned: true;
    assignedAt: string;
  };
};
`,
  `const ROUTING_TIME_ZONE = 'America/Los_Angeles';
`,
);
await replaceOnce(
  'src/worker/routing.ts',
  `export async function assignConversationAgent(
  db: D1Database,
  conversationId: string,
  options: AssignmentOptions = {},
): Promise<AgentAssignmentResult | null> {`,
  `export async function assignConversationAgent(
  db: D1Database,
  conversationId: string,
): Promise<AgentAssignmentResult | null> {`,
);
await replaceOnce(
  'src/worker/routing.ts',
  `         WHERE c.id = ?1
           AND c.assigned_agent IS NULL
           AND c.expires_at > CURRENT_TIMESTAMP`,
  `         WHERE c.id = ?1
           AND c.assigned_agent IS NULL
           AND c.status IN ('open', 'pending')
           AND c.expires_at > CURRENT_TIMESTAMP`,
);
await replaceOnce(
  'src/worker/routing.ts',
  `  if (!assignment) {
    return options.returnExisting === false
      ? null
      : assignedAgent(db, conversationId);
  }
`,
  `  if (!assignment) {
    const existing = await assignedAgent(db, conversationId);
    if (existing) return existing;

    const unassigned = await db
      .prepare(
        \`SELECT c.site_id,
           EXISTS (
             SELECT 1
             FROM agent_traffic_receipts receipt
             WHERE receipt.conversation_id = c.id
           ) AS already_received
         FROM conversations c
         WHERE c.id = ?1
           AND c.assigned_agent IS NULL
           AND c.status IN ('open', 'pending')
         LIMIT 1\`,
      )
      .bind(conversationId)
      .first<{ site_id: string; already_received: number }>();
    if (!unassigned) return null;

    if (Number(unassigned.already_received) > 0) {
      await db
        .prepare(
          \`UPDATE conversations
           SET status = 'closed', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?1
             AND assigned_agent IS NULL
             AND status IN ('open', 'pending')\`,
        )
        .bind(conversationId)
        .run();
      return null;
    }

    await db
      .prepare(
        \`DELETE FROM conversations
         WHERE id = ?1
           AND assigned_agent IS NULL
           AND status IN ('open', 'pending')\`,
      )
      .bind(conversationId)
      .run();
    throw new NoAvailableAgentError(unassigned.site_id);
  }
`,
);
await replaceRegexOnce(
  'src/worker/routing.ts',
  /\n\/\*\*\n \* Scan waiting rows[\s\S]*$/,
  '\n',
);

await replaceOnce(
  'src/worker/agent-api.ts',
  `import { assignWaitingConversations } from './waiting-assignment';\n`,
  '',
);
await replaceOnce(
  'src/worker/agent-api.ts',
  `  const assignedConversationIds =
    agent.is_enabled === 1
      ? await assignWaitingConversations(c.env, agent.id)
      : [];
  scheduleAgentPush(c, assignedConversationIds);
`,
  '',
);
await replaceOnce(
  'src/worker/agent-api.ts',
  `  if (agent.is_enabled === 1 && nextStatus === 'online') {
    const assignedConversationIds = await assignWaitingConversations(
      c.env,
      agent.id,
    );
    scheduleAgentPush(c, assignedConversationIds);
  }
`,
  '',
);
await replaceOnce(
  'src/worker/agent-api.ts',
  `  if (agent.is_enabled === 1 && body.status === 'online') {
    const assignedConversationIds = await assignWaitingConversations(
      c.env,
      agent.id,
    );
    scheduleAgentPush(c, assignedConversationIds);
  }
`,
  '',
);
{
  const source = await read('src/worker/agent-api.ts');
  const count = [...source.matchAll(/\bscheduleAgentPush\b/g)].length;
  if (count === 1) {
    await replaceRegexOnce(
      'src/worker/agent-api.ts',
      /\nfunction scheduleAgentPush\([\s\S]*?\n}\n(?=\n(?:async )?function|\nexport|\n$)/,
      '\n',
    );
  } else if (count !== 0) {
    throw new Error(`Unexpected scheduleAgentPush references after waiting removal: ${count}`);
  }
}
await removeImportIfUnused(
  'src/worker/agent-api.ts',
  'sendAgentPushForConversation',
  `import { sendAgentPushForConversation } from './agent-push';\n`,
);

await replaceOnce(
  'src/worker/admin-config-api.ts',
  `import { sendAgentPushForConversation } from './agent-push';\nimport { assignWaitingConversations } from './waiting-assignment';\n`,
  `import { DEFAULT_NO_AVAILABLE_AGENT_MESSAGE } from './no-available-agent';\n`,
);
await replaceOnce(
  'src/worker/admin-config-api.ts',
  `adminConfigApi.get('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({ agents: await loadAgents(c.env.DB) });
});
`,
  `adminConfigApi.get('/api/admin/unavailable-message', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const row = await c.env.DB.prepare(
    \`SELECT unavailable_agent_message
     FROM sites
     WHERE id = 'default'
     LIMIT 1\`,
  ).first<{ unavailable_agent_message: string | null }>();
  return c.json({
    message:
      row?.unavailable_agent_message?.trim() ||
      DEFAULT_NO_AVAILABLE_AGENT_MESSAGE,
  });
});

adminConfigApi.patch('/api/admin/unavailable-message', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  const body = await readJson<{ message?: unknown }>(c.req.raw);
  const message =
    typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > 300) {
    return c.json({ error: 'INVALID_UNAVAILABLE_AGENT_MESSAGE' }, 400);
  }
  await c.env.DB.prepare(
    \`UPDATE sites
     SET unavailable_agent_message = ?1, updated_at = CURRENT_TIMESTAMP
     WHERE id = 'default'\`,
  )
    .bind(message)
    .run();
  return c.json({ ok: true, message });
});

adminConfigApi.get('/api/admin/agents', async (c) => {
  if (!(await adminAuthorized(c))) return unauthorized(c);
  return c.json({ agents: await loadAgents(c.env.DB) });
});
`,
);
await replaceOnce(
  'src/worker/admin-config-api.ts',
  `  const quotaWasBlocking =
    current.traffic_quota_enabled === 1 &&
    current.traffic_quota_used >= current.traffic_quota_total;
  const quotaEligibilityRestored =
    quotaWasBlocking && (quotaApplied || trafficQuotaEnabled === 0);
  const enabledEligibilityRestored = current.is_enabled === 0 && enabled === 1;
  let assignedWaitingCount = 0;
  if (
    enabled === 1 &&
    current.status === 'online' &&
    (enabledEligibilityRestored || quotaEligibilityRestored)
  ) {
    const assignedConversationIds = await assignWaitingConversations(
      c.env,
      id,
      10,
    );
    assignedWaitingCount = assignedConversationIds.length;
    for (const conversationId of assignedConversationIds) {
      c.executionCtx.waitUntil(
        sendAgentPushForConversation(c.env, conversationId).catch((error) => {
          console.warn('Agent push dispatch failed after quota top-up.', error);
        }),
      );
    }
  }
  return c.json({ ok: true, quotaApplied, assignedWaitingCount });
`,
  `  return c.json({ ok: true, quotaApplied });
`,
);
await replaceOnce(
  'src/worker/admin-config-api.ts',
  `    if (conversationsToReassign.length) {
      await disconnectAgentRealtime(c.env, id, conversationsToReassign);
      for (const conversationId of conversationsToReassign) {
        await assignConversationAgent(c.env.DB, conversationId);
        await broadcastClientConversationEvent(
          c.env,
          conversationId,
          'conversation.assigned',
        );
      }
    }

    return c.json({
      ok: true,
      reassignedConversationCount: conversationsToReassign.length,
    });
`,
  `    let reassignedConversationCount = 0;
    let closedConversationCount = 0;
    if (conversationsToReassign.length) {
      await disconnectAgentRealtime(c.env, id, conversationsToReassign);
      for (const conversationId of conversationsToReassign) {
        const assignment = await assignConversationAgent(
          c.env.DB,
          conversationId,
        );
        if (assignment) {
          reassignedConversationCount += 1;
          await broadcastClientConversationEvent(
            c.env,
            conversationId,
            'conversation.assigned',
          );
        } else {
          closedConversationCount += 1;
          await broadcastClientConversationEvent(
            c.env,
            conversationId,
            'conversation.closed',
          );
        }
      }
    }

    return c.json({
      ok: true,
      reassignedConversationCount,
      closedConversationCount,
    });
`,
);

await replaceOnce(
  'src/worker/client-api.ts',
  `function publicStatus(
  status: ConversationStatus,
): 'waiting' | 'active' | 'closed' {
  if (status === 'closed') return 'closed';
  return status === 'pending' ? 'active' : 'waiting';
}
`,
  `function publicStatus(status: ConversationStatus): 'active' | 'closed' {
  return status === 'closed' ? 'closed' : 'active';
}
`,
);

await replaceOnce(
  'src/worker/entry.ts',
  `import { passesBurstLimit, requestSourceHash } from './abuse-control';\n`,
  `import { passesBurstLimit, requestSourceHash } from './abuse-control';
import {
  NoAvailableAgentError,
  unavailableAgentMessage,
} from './no-available-agent';
`,
);
await replaceOnce(
  'src/worker/entry.ts',
  `const app = new Hono<AppEnv>();\n`,
  `const app = new Hono<AppEnv>();

app.onError(async (error, c) => {
  if (error instanceof NoAvailableAgentError) {
    return c.json(
      {
        error: {
          code: 'NO_AVAILABLE_AGENT',
          message: await unavailableAgentMessage(c.env.DB, error.siteId),
          presentation: 'dialog' as const,
        },
      },
      409,
    );
  }
  console.error('Unhandled worker error.', error);
  return c.json({ error: 'INTERNAL_ERROR' }, 500);
});
`,
);

await write(
  'src/dashboard/UnavailableMessageSettingsPage.tsx',
  `import { FormEvent, useEffect, useState } from 'react';

type State = 'loading' | 'ready' | 'auth-required' | 'error';

type ErrorPayload = {
  error?: string | { code?: string; message?: string };
};

export function UnavailableMessageSettingsPage() {
  const [state, setState] = useState<State>('loading');
  const [message, setMessage] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    void fetch('/api/admin/unavailable-message', { credentials: 'same-origin' })
      .then(async (response) => {
        if (response.status === 401) {
          if (active) setState('auth-required');
          return;
        }
        if (!response.ok) throw new Error('LOAD_FAILED');
        const payload = (await response.json()) as { message?: string };
        if (!active) return;
        const value = payload.message?.trim() ?? '';
        setMessage(value);
        setSavedMessage(value);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('error');
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    const value = message.trim();
    if (!value || value.length > 300 || saving) return;
    setSaving(true);
    setNotice('');
    try {
      const response = await fetch('/api/admin/unavailable-message', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: value }),
      });
      if (response.status === 401) {
        setState('auth-required');
        return;
      }
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | ErrorPayload
          | null;
        throw new Error(
          typeof payload?.error === 'object'
            ? payload.error.message || payload.error.code || 'SAVE_FAILED'
            : payload?.error || 'SAVE_FAILED',
        );
      }
      const payload = (await response.json()) as { message?: string };
      const next = payload.message?.trim() || value;
      setMessage(next);
      setSavedMessage(next);
      setNotice('已保存。后续没有可用客服时，接口会直接返回这段提示语。');
    } catch {
      setNotice('保存失败，请稍后重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="unavailable-settings-page">
      <section className="unavailable-settings-card">
        <header>
          <div>
            <span className="unavailable-settings-kicker">客服系统设置</span>
            <h1>无可用客服提示</h1>
            <p>
              当当前产品没有符合分流条件的在线客服时，不创建排队会话，直接向前端返回此提示。
            </p>
          </div>
          <a href="/">返回客服管理</a>
        </header>

        {state === 'loading' && <p className="settings-state">正在加载设置…</p>}
        {state === 'auth-required' && (
          <div className="settings-state settings-warning">
            管理员登录已失效。请先返回客服管理后台重新登录。
          </div>
        )}
        {state === 'error' && (
          <div className="settings-state settings-warning">
            无法加载设置，请刷新页面重试。
          </div>
        )}
        {state === 'ready' && (
          <form onSubmit={save}>
            <label htmlFor="unavailable-agent-message">提示语</label>
            <textarea
              id="unavailable-agent-message"
              value={message}
              maxLength={300}
              rows={6}
              onChange={(event) => {
                setMessage(event.target.value);
                setNotice('');
              }}
            />
            <div className="settings-form-meta">
              <span>{message.trim().length}/300</span>
              <span>前端应按接口返回的 presentation=dialog 显示弹窗。</span>
            </div>
            <div className="settings-actions">
              <button
                type="submit"
                disabled={
                  saving ||
                  !message.trim() ||
                  message.trim().length > 300 ||
                  message.trim() === savedMessage
                }
              >
                {saving ? '保存中…' : '保存提示语'}
              </button>
              {notice && <span role="status">{notice}</span>}
            </div>
          </form>
        )}
      </section>
    </main>
  );
}
`,
);

await write(
  'src/dashboard/admin-settings.css',
  `.admin-settings-shortcut {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 80;
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  padding: 0 14px;
  border: 1px solid rgba(15, 23, 42, 0.14);
  background: rgba(255, 255, 255, 0.96);
  color: #0f172a;
  text-decoration: none;
  font-size: 13px;
  font-weight: 700;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.1);
}

.unavailable-settings-page {
  min-height: 100vh;
  padding: 48px 24px;
  background: #f6f7f9;
  color: #111827;
}

.unavailable-settings-card {
  width: min(760px, 100%);
  margin: 0 auto;
  padding: 28px;
  background: #fff;
  border: 1px solid #e5e7eb;
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.08);
}

.unavailable-settings-card header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding-bottom: 24px;
  border-bottom: 1px solid #e5e7eb;
}

.unavailable-settings-card header a {
  flex: 0 0 auto;
  color: #111827;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}

.unavailable-settings-kicker {
  display: block;
  margin-bottom: 8px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.unavailable-settings-card h1 {
  margin: 0;
  font-size: clamp(26px, 4vw, 36px);
  line-height: 1.15;
}

.unavailable-settings-card header p {
  max-width: 580px;
  margin: 12px 0 0;
  color: #6b7280;
  font-size: 14px;
  line-height: 1.7;
}

.unavailable-settings-card form {
  display: grid;
  gap: 12px;
  padding-top: 24px;
}

.unavailable-settings-card label {
  font-size: 14px;
  font-weight: 800;
}

.unavailable-settings-card textarea {
  width: 100%;
  min-height: 150px;
  resize: vertical;
  padding: 14px 16px;
  border: 1px solid #cbd5e1;
  border-radius: 4px;
  background: #fff;
  color: #111827;
  font: inherit;
  line-height: 1.65;
  outline: none;
}

.unavailable-settings-card textarea:focus {
  border-color: #111827;
  box-shadow: 0 0 0 3px rgba(17, 24, 39, 0.08);
}

.settings-form-meta,
.settings-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.settings-form-meta {
  color: #6b7280;
  font-size: 12px;
}

.settings-actions {
  margin-top: 6px;
}

.settings-actions button {
  min-height: 42px;
  padding: 0 18px;
  border: 0;
  border-radius: 4px;
  background: #111827;
  color: #fff;
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  cursor: pointer;
}

.settings-actions button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.settings-actions span,
.settings-state {
  color: #4b5563;
  font-size: 13px;
}

.settings-state {
  margin: 24px 0 0;
}

.settings-warning {
  padding: 14px 16px;
  border: 1px solid #fecaca;
  background: #fff7f7;
  color: #991b1b;
}

@media (max-width: 640px) {
  .unavailable-settings-page {
    padding: 20px 14px;
  }

  .unavailable-settings-card {
    padding: 20px;
  }

  .unavailable-settings-card header,
  .settings-form-meta,
  .settings-actions {
    align-items: stretch;
    flex-direction: column;
  }
}
`,
);

await replaceOnce(
  'src/dashboard/admin-entry.tsx',
  `import { AdminPortal } from './AdminPortal';\n`,
  `import { AdminPortal } from './AdminPortal';
import { UnavailableMessageSettingsPage } from './UnavailableMessageSettingsPage';
`,
);
await replaceOnce(
  'src/dashboard/admin-entry.tsx',
  `  await import('./admin-design-system.css');\n`,
  `  await import('./admin-design-system.css');
  await import('./admin-settings.css');
`,
);
await replaceOnce(
  'src/dashboard/admin-entry.tsx',
  `export async function bootstrap() {
  await loadAdminStyles();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AdminPortal />
    </StrictMode>,
  );
}
`,
  `export async function bootstrap() {
  await loadAdminStyles();
  const settingsPage = window.location.pathname === '/admin/settings';
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {settingsPage ? (
        <UnavailableMessageSettingsPage />
      ) : (
        <>
          <AdminPortal />
          <a className="admin-settings-shortcut" href="/admin/settings">
            无客服提示设置
          </a>
        </>
      )}
    </StrictMode>,
  );
}
`,
);

await replaceOnce(
  'test/product-agent-routing.test.mjs',
  `import {
  assignConversationAgent,
  recoverWaitingConversationAssignments,
  routingBusinessDate,
} from '../src/worker/routing.ts';
`,
  `import {
  assignConversationAgent,
  routingBusinessDate,
} from '../src/worker/routing.ts';
`,
);
await replaceRegexOnce(
  'test/product-agent-routing.test.mjs',
  /\ntest\('conversation without a matching scope remains unassigned'[\s\S]*?  database\.close\(\);\n}\);\n/,
  `
test('conversation without a matching scope is rejected instead of waiting', async () => {
  const database = await createDatabase();
  addAgent(database, { id: 'unrelated-agent' });
  addScope(database, 'unrelated-agent', {
    type: 'section',
    sectionId: 'east',
  });
  addConversation(database, 'conversation-1', 'product-without-scope');

  await assert.rejects(
    assignConversationAgent(d1(database), 'conversation-1'),
    (error) => error?.name === 'NoAvailableAgentError',
  );
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM conversations WHERE id = ?')
      .get('conversation-1').count,
    0,
  );
  database.close();
});
`,
);
await replaceRegexOnce(
  'test/product-agent-routing.test.mjs',
  /\ntest\('waiting recovery scans past ten blocked rows through canonical routing'[\s\S]*$/,
  '\n',
);

await write(
  'test/no-waiting-mode.test.mjs',
  `import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('migration removes historical waiting rows and adds configurable copy', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(\`
    PRAGMA foreign_keys = ON;
    CREATE TABLE sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public_key TEXT NOT NULL UNIQUE,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      assigned_agent TEXT,
      status TEXT NOT NULL
    );
    INSERT INTO sites (id, name, public_key) VALUES ('default', 'Default', 'pk');
    INSERT INTO conversations (id, assigned_agent, status) VALUES
      ('waiting-open', NULL, 'open'),
      ('waiting-pending', NULL, 'pending'),
      ('assigned', 'agent-a', 'pending'),
      ('closed', NULL, 'closed');
  \`);
  database.exec(await read('../migrations/0049_remove_waiting_conversations.sql'));

  assert.deepEqual(
    database
      .prepare('SELECT id FROM conversations ORDER BY id')
      .all()
      .map((row) => row.id),
    ['assigned', 'closed'],
  );
  assert.equal(
    database
      .prepare(
        \`SELECT unavailable_agent_message AS message FROM sites WHERE id = 'default'\`,
      )
      .get().message,
    '当前暂无可用客服，请稍后再试。',
  );
  database.close();
});

test('waiting recovery implementation is physically removed', async () => {
  await assert.rejects(
    access(new URL('../src/worker/waiting-assignment.ts', import.meta.url)),
  );
  const routing = await read('../src/worker/routing.ts');
  const agentApi = await read('../src/worker/agent-api.ts');
  const adminApi = await read('../src/worker/admin-config-api.ts');
  for (const source of [routing, agentApi, adminApi]) {
    assert.doesNotMatch(source, /assignWaitingConversations/u);
    assert.doesNotMatch(source, /recoverWaitingConversationAssignments/u);
  }
});
`,
);

await rm(file('src/worker/waiting-assignment.ts'));

await appendFile(
  file('README.md'),
  `

### 无可用客服：直接返回提示，不进入 Waiting

客服分流不再维护 Waiting/候补会话。新咨询发起时如果当前产品没有符合负责范围、在线状态、账号启用、每日上限和咨询额度条件的客服，服务端会删除本次未分配会话并返回 HTTP 409：

\`\`\`json
{
  "error": {
    "code": "NO_AVAILABLE_AGENT",
    "message": "当前暂无可用客服，请稍后再试。",
    "presentation": "dialog"
  }
}
\`\`\`

前端只需要按 \`presentation: "dialog"\` 显示提示窗口，不需要轮询或等待客服上线。提示语由客服管理后台 \`/admin/settings\` 配置。客服登录、心跳、从忙碌恢复在线、启用账号或补充额度都不会再扫描历史未分配会话。删除客服时会尝试立即转给当下可用坐席；如果此刻没有替代坐席，该旧会话直接关闭，不进入 Waiting。
`,
  'utf8',
);

await access(file('src/worker/no-available-agent.ts'));
console.log('Waiting-flow removal patch applied.');
