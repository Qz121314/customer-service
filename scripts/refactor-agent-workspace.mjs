import { readFileSync, writeFileSync, rmSync } from 'node:fs';

function read(path) {
  return readFileSync(path, 'utf8');
}

function write(path, content) {
  writeFileSync(path, content);
}

function replaceOnce(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`Missing expected source for ${label}`);
  }
  return source.replace(needle, replacement);
}

function replaceRegex(source, pattern, replacement, label) {
  if (!pattern.test(source)) {
    throw new Error(`Missing expected pattern for ${label}`);
  }
  return source.replace(pattern, replacement);
}

let main = read('src/dashboard/main.tsx');
main = replaceOnce(
  main,
  "import { setupAgentMobileNavigation } from './agent-mobile';\n",
  '',
  'mobile navigation import',
);
for (const legacyImport of [
  "import './agent-mobile-layout.css';\n",
  "import './agent-mobile-thread.css';\n",
  "import './agent-mobile-composer.css';\n",
]) {
  main = replaceOnce(main, legacyImport, '', legacyImport.trim());
}
main = replaceOnce(
  main,
  "import './ui-polish.css';\n",
  "import './ui-polish.css';\nimport './agent-workspace.css';\n",
  'agent workspace stylesheet import',
);
main = replaceOnce(main, '\nsetupAgentMobileNavigation();\n', '\n', 'mobile setup call');
write('src/dashboard/main.tsx', main);

let runtime = read('src/dashboard/dashboard-runtime.ts');
runtime = replaceOnce(
  runtime,
  `type PendingAgentText = {\n  conversationId: string;\n  clientMessageId: string;\n  body: string;\n  status: 'sending' | 'failed';\n};\n`,
  `type PendingAgentText = {\n  conversationId: string;\n  clientMessageId: string;\n  body: string;\n  status: 'sending' | 'failed';\n};\n\ntype AgentQuickReply = {\n  id: string;\n  title: string;\n  body: string;\n  updatedAt: number;\n};\n\nconst AGENT_QUICK_REPLY_LIMIT = 100;\n\nfunction loadAgentQuickReplies(agentId: string): AgentQuickReply[] {\n  try {\n    const raw = window.localStorage.getItem(\`cs-agent-quick-replies:\${agentId}\`);\n    if (!raw) return [];\n    const parsed = JSON.parse(raw) as unknown;\n    if (!Array.isArray(parsed)) return [];\n    return parsed\n      .flatMap((value) => {\n        if (!value || typeof value !== 'object') return [];\n        const candidate = value as Record<string, unknown>;\n        if (\n          typeof candidate.id !== 'string' ||\n          typeof candidate.title !== 'string' ||\n          typeof candidate.body !== 'string' ||\n          typeof candidate.updatedAt !== 'number'\n        ) {\n          return [];\n        }\n        const title = candidate.title.trim().slice(0, 40);\n        const body = candidate.body.trim().slice(0, 1000);\n        if (!title || !body) return [];\n        return [\n          {\n            id: candidate.id,\n            title,\n            body,\n            updatedAt: candidate.updatedAt,\n          },\n        ];\n      })\n      .sort((left, right) => right.updatedAt - left.updatedAt)\n      .slice(0, AGENT_QUICK_REPLY_LIMIT);\n  } catch {\n    return [];\n  }\n}\n\nfunction saveAgentQuickReplies(\n  agentId: string,\n  replies: AgentQuickReply[],\n): void {\n  try {\n    const key = \`cs-agent-quick-replies:\${agentId}\`;\n    const normalized = replies.slice(0, AGENT_QUICK_REPLY_LIMIT);\n    if (normalized.length === 0) {\n      window.localStorage.removeItem(key);\n      return;\n    }\n    window.localStorage.setItem(key, JSON.stringify(normalized));\n  } catch {\n    // Personal quick replies are local-only and must never interrupt chat work.\n  }\n}\n`,
  'local quick reply runtime',
);
runtime = replaceOnce(
  runtime,
  `  PendingAgentText,\n  InboxRealtimeEvent,\n`,
  `  PendingAgentText,\n  AgentQuickReply,\n  InboxRealtimeEvent,\n`,
  'quick reply type export',
);
runtime = replaceOnce(
  runtime,
  `  saveAgentSoundEnabled,\n  emitAgentMessageTone,\n`,
  `  saveAgentSoundEnabled,\n  loadAgentQuickReplies,\n  saveAgentQuickReplies,\n  emitAgentMessageTone,\n`,
  'quick reply function exports',
);
write('src/dashboard/dashboard-runtime.ts', runtime);

let portal = read('src/dashboard/AgentPortal.tsx');
for (const removed of [
  '  QuickReply,\n',
  '  createQuickReply,\n',
  '  deleteQuickReply,\n',
]) {
  portal = replaceOnce(portal, removed, '', removed.trim());
}
portal = replaceOnce(
  portal,
  `  AgentConversationDrafts,\n  PendingAgentText,\n`,
  `  AgentConversationDrafts,\n  AgentQuickReply,\n  PendingAgentText,\n`,
  'quick reply runtime type import',
);
portal = replaceOnce(
  portal,
  `  saveAgentSoundEnabled,\n  emitAgentMessageTone,\n`,
  `  saveAgentSoundEnabled,\n  loadAgentQuickReplies,\n  saveAgentQuickReplies,\n  emitAgentMessageTone,\n`,
  'quick reply runtime function imports',
);
portal = replaceOnce(
  portal,
  `  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);\n`,
  `  const [quickReplies, setQuickReplies] = useState<AgentQuickReply[]>(() =>\n    loadAgentQuickReplies(identity.id),\n  );\n`,
  'quick reply state',
);
portal = replaceOnce(
  portal,
  `  const [quickReplySaving, setQuickReplySaving] = useState(false);\n`,
  '',
  'quick reply saving state',
);
portal = replaceOnce(
  portal,
  `    setQuickReplies(inbox.quickReplies);\n`,
  '',
  'server quick reply hydration',
);
portal = replaceRegex(
  portal,
  /  async function saveQuickReply\(\) \{[\s\S]*?  function applyQuickReply\(reply: QuickReply\) \{/u,
  `  function saveQuickReply() {\n    const title = quickReplyTitle.trim().slice(0, 40);\n    const body = quickReplyBody.trim().slice(0, 1000);\n    if (!title || !body) return;\n    const reply: AgentQuickReply = {\n      id: crypto.randomUUID(),\n      title,\n      body,\n      updatedAt: Date.now(),\n    };\n    setQuickReplies((current) => {\n      const next = [reply, ...current].slice(0, 100);\n      saveAgentQuickReplies(identity.id, next);\n      return next;\n    });\n    setQuickReplyTitle('');\n    setQuickReplyBody('');\n  }\n\n  function removeQuickReply(id: string) {\n    setQuickReplies((current) => {\n      const next = current.filter((reply) => reply.id !== id);\n      saveAgentQuickReplies(identity.id, next);\n      return next;\n    });\n  }\n\n  function applyQuickReply(reply: AgentQuickReply) {`,
  'quick reply local handlers',
);
portal = replaceOnce(
  portal,
  '搜索名称或内容，选择后仍可编辑再发送。',
  '仅保存在当前浏览器，搜索后点选即可填入输入框。',
  'quick reply local hint',
);
portal = replaceRegex(
  portal,
  /disabled=\{\s*quickReplySaving \|\|\s*!quickReplyTitle\.trim\(\) \|\|\s*!quickReplyBody\.trim\(\)\s*\}/u,
  `disabled={!quickReplyTitle.trim() || !quickReplyBody.trim()}`,
  'quick reply save disabled state',
);
portal = replaceOnce(
  portal,
  `{quickReplySaving ? '保存中…' : '保存快捷回复'}`,
  '保存到本机',
  'quick reply save label',
);
write('src/dashboard/AgentPortal.tsx', portal);

let api = read('src/dashboard/api.ts');
api = replaceOnce(api, `  quickReplies: QuickReply[];\n`, '', 'AgentInbox quick replies');
api = replaceRegex(
  api,
  /\nexport type QuickReply = \{[\s\S]*?\n\};\n/u,
  '\n',
  'QuickReply API type',
);
api = api.replace("  INVALID_QUICK_REPLY: '快捷回复名称或内容无效',\n", '');
api = api.replace("  QUICK_REPLY_LIMIT_REACHED: '每个客服最多保存 30 条快捷回复',\n", '');
api = replaceRegex(
  api,
  /\nexport async function createQuickReply\([\s\S]*?\nexport function openAgentInboxSocket/u,
  `\nexport function openAgentInboxSocket`,
  'quick reply network API',
);
write('src/dashboard/api.ts', api);

let worker = read('src/worker/agent-api.ts');
worker = replaceRegex(
  worker,
  /\ntype QuickReplyRow = \{[\s\S]*?\n\};\n/u,
  '\n',
  'QuickReplyRow',
);
worker = replaceRegex(
  worker,
  /\nasync function loadQuickReplies\([\s\S]*?\n\}\n\nasync function loadAgentInbox/u,
  `\nasync function loadAgentInbox`,
  'loadQuickReplies',
);
worker = replaceOnce(
  worker,
  `  const quickRepliesRequest = loadQuickReplies(db, agent.id);\n`,
  '',
  'quick reply inbox request',
);
worker = replaceOnce(
  worker,
  `[result, overview, transferTargets, quickReplies]`,
  `[result, overview, transferTargets]`,
  'filtered inbox quick reply destructure',
);
worker = worker.replaceAll(`        quickRepliesRequest,\n`, '');
worker = worker.replaceAll(`      quickReplies,\n`, '');
worker = replaceOnce(
  worker,
  `[result, quotaOverview, transferTargets, quickReplies]`,
  `[result, quotaOverview, transferTargets]`,
  'inbox quick reply destructure',
);
worker = worker.replaceAll(`    quickReplies,\n`, '');
worker = replaceRegex(
  worker,
  /\nagentApi\.post\('\/api\/agent\/quick-replies'[\s\S]*?\nagentApi\.get\('\/api\/agent\/conversations\/:id\/messages'/u,
  `\nagentApi.get('/api/agent/conversations/:id/messages'`,
  'quick reply server routes',
);
write('src/worker/agent-api.ts', worker);

let readme = read('README.md');
readme = replaceOnce(
  readme,
  '- 最多 30 条个人快捷回复；',
  '- 个人快捷回复按坐席保存在当前浏览器，不写 D1、不产生额外 Worker 请求；',
  'README quick reply capability',
);
readme = replaceOnce(
  readme,
  '- 坐席收件箱概览、统计摘要、会话列表、快捷回复和可转接坐席合并返回；',
  '- 坐席收件箱概览、统计摘要、会话列表和可转接坐席合并返回；快捷回复、输入草稿和提示音偏好保存在浏览器本地；',
  'README request strategy',
);
write('README.md', readme);

write(
  'migrations/0029_remove_server_quick_replies.sql',
  `-- Quick replies are a per-browser agent productivity preference.\n-- Keeping them out of D1 removes a read from inbox/heartbeat hot paths and\n-- avoids server writes for data that does not need cross-device sync.\nDROP TABLE IF EXISTS agent_quick_replies;\n`,
);

write(
  'test/agent-transfer-quick-replies.test.mjs',
  `import assert from 'node:assert/strict';\nimport { readFile } from 'node:fs/promises';\nimport test from 'node:test';\nimport { DatabaseSync } from 'node:sqlite';\nimport { URL } from 'node:url';\n\nconst read = (path) => readFile(new URL(path, import.meta.url), 'utf8');\n\ntest('a conversation counts only for its first receiving seat', async () => {\n  const database = new DatabaseSync(':memory:');\n  database.exec(\`\n    CREATE TABLE agents (\n      id TEXT PRIMARY KEY,\n      site_id TEXT NOT NULL\n    );\n    CREATE TABLE conversations (\n      id TEXT PRIMARY KEY,\n      site_id TEXT NOT NULL,\n      assigned_agent TEXT,\n      assigned_business_date TEXT,\n      assigned_at TEXT,\n      updated_at TEXT,\n      created_at TEXT\n    );\n    INSERT INTO agents VALUES ('agent-a', 'default'), ('agent-b', 'default');\n    INSERT INTO conversations VALUES (\n      'conversation-1', 'default', NULL, NULL, NULL,\n      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP\n    );\n  \`);\n  database.exec(\n    await read('../migrations/0017_agent_daily_stats_retention.sql'),\n  );\n  database.exec(await read('../migrations/0018_agent_quick_replies.sql'));\n  database.exec(await read('../migrations/0020_agent_traffic_receipts.sql'));\n\n  const assign = database.prepare(\`\n    UPDATE conversations\n    SET assigned_agent = ?, assigned_business_date = '2026-08-15'\n    WHERE id = 'conversation-1'\n  \`);\n  assign.run('agent-a');\n  assign.run('agent-b');\n  assign.run(null);\n  assign.run('agent-b');\n\n  const counts = database\n    .prepare(\n      \`SELECT agent_id, conversation_count\n       FROM agent_daily_stats\n       ORDER BY agent_id\`,\n    )\n    .all()\n    .map((row) => ({\n      agent_id: row.agent_id,\n      conversation_count: row.conversation_count,\n    }));\n  assert.deepEqual(counts, [{ agent_id: 'agent-a', conversation_count: 1 }]);\n  assert.deepEqual(\n    database\n      .prepare(\n        \`SELECT conversation_id, agent_id\n         FROM agent_traffic_receipts\`,\n      )\n      .all()\n      .map((row) => ({\n        conversation_id: row.conversation_id,\n        agent_id: row.agent_id,\n      })),\n    [{ conversation_id: 'conversation-1', agent_id: 'agent-a' }],\n  );\n});\n\ntest('transfer stays server-side while personal quick replies stay browser-local', async () => {\n  const [worker, routing, dashboard, runtime, api, styles, cleanup] =\n    await Promise.all([\n      read('../src/worker/agent-api.ts'),\n      read('../src/worker/routing.ts'),\n      read('../src/dashboard/AgentPortal.tsx'),\n      read('../src/dashboard/dashboard-runtime.ts'),\n      read('../src/dashboard/api.ts'),\n      read('../src/dashboard/agent-workspace.css'),\n      read('../migrations/0029_remove_server_quick_replies.sql'),\n    ]);\n\n  assert.match(worker, /conversations\\/:id\\/transfer/u);\n  assert.match(worker, /target\\.status = 'online'/u);\n  assert.match(worker, /loadTransferTargets/u);\n  assert.doesNotMatch(worker, /agent_quick_replies|agent\\/quick-replies/u);\n  assert.doesNotMatch(api, /createQuickReply|deleteQuickReply/u);\n  assert.match(runtime, /cs-agent-quick-replies:/u);\n  assert.match(runtime, /window\\.localStorage/u);\n  assert.match(routing, /excludedAgentId/u);\n  assert.match(dashboard, /重新排队/u);\n  assert.match(dashboard, /保存到本机/u);\n  assert.match(dashboard, /conversation-context-card/u);\n  assert.match(styles, /\\.transfer-menu-panel/u);\n  assert.match(styles, /\\.quick-replies-panel/u);\n  assert.match(cleanup, /DROP TABLE IF EXISTS agent_quick_replies/u);\n});\n`,
);

let mobileTest = read('test/agent-mobile-layout-contract.test.mjs');
mobileTest = replaceOnce(
  mobileTest,
  `const css = source('../src/dashboard/agent-mobile-layout.css');`,
  `const css = source('../src/dashboard/agent-workspace.css');`,
  'mobile layout contract source',
);
write('test/agent-mobile-layout-contract.test.mjs', mobileTest);

write(
  'test/agent-workspace-ui-contract.test.mjs',
  `import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport { URL } from 'node:url';\nimport test from 'node:test';\n\nfunction source(path) {\n  return readFileSync(new URL(path, import.meta.url), 'utf8');\n}\n\ntest('agent workspace uses one responsive commercial stylesheet', () => {\n  const main = source('../src/dashboard/main.tsx');\n  const css = source('../src/dashboard/agent-workspace.css');\n\n  assert.ok(main.includes(\"'./agent-workspace.css'\"));\n  assert.ok(\n    main.indexOf(\"'./agent-workspace.css'\") >\n      main.indexOf(\"'./ui-polish.css'\"),\n  );\n  assert.ok(!main.includes('agent-mobile-layout.css'));\n  assert.ok(!main.includes('agent-mobile-thread.css'));\n  assert.ok(!main.includes('agent-mobile-composer.css'));\n  assert.ok(!main.includes('setupAgentMobileNavigation'));\n  assert.match(\n    css,\n    /grid-template-columns:\\s*80px minmax\\(330px, 380px\\) minmax\\(0, 1fr\\)/u,\n  );\n  assert.match(css, /--agent-accent:\\s*#ff5a1f/u);\n  assert.ok(css.includes('@media (max-width: 760px)'));\n  assert.ok(css.includes('.workspace-shell.is-thread-open .thread-pane'));\n  assert.ok(css.includes('bottom: calc(66px + env(safe-area-inset-bottom));'));\n});\n`,
);

write(
  'src/dashboard/agent-workspace.css',
  `/* Agent workspace v2\n * One responsive workspace stylesheet for desktop and mobile.\n * The design prioritizes dense reception work, a large readable thread,\n * predictable controls and local-first personal productivity features.\n */\n\n.workspace-shell {\n  --agent-accent: #ff5a1f;\n  --agent-accent-strong: #e84b13;\n  --agent-accent-soft: #fff1eb;\n  --agent-ink: #17191e;\n  --agent-muted: #707784;\n  --agent-line: #e4e7eb;\n  --agent-canvas: #f4f5f7;\n  --agent-surface: #ffffff;\n  --agent-rail: #17191f;\n  height: 100dvh;\n  min-height: 560px;\n  display: grid;\n  grid-template-columns: 80px minmax(330px, 380px) minmax(0, 1fr);\n  overflow: hidden;\n  color: var(--agent-ink);\n  background: var(--agent-canvas);\n}\n\n.workspace-shell button,\n.workspace-shell input,\n.workspace-shell textarea,\n.workspace-shell select,\n.workspace-shell summary {\n  -webkit-tap-highlight-color: transparent;\n}\n\n.workspace-shell button:focus-visible,\n.workspace-shell input:focus-visible,\n.workspace-shell textarea:focus-visible,\n.workspace-shell select:focus-visible,\n.workspace-shell summary:focus-visible {\n  outline: 2px solid rgb(255 90 31 / 28%);\n  outline-offset: 2px;\n}\n\n.workspace-sidebar {\n  min-width: 0;\n  padding: 14px 10px 12px;\n  border-right: 1px solid #282b31;\n  color: #fff;\n  background: var(--agent-rail);\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 16px;\n}\n\n.workspace-brand-lockup {\n  display: grid;\n  place-items: center;\n}\n\n.workspace-brand-lockup > span {\n  display: none;\n}\n\n.workspace-sidebar .workspace-brand {\n  width: 44px;\n  height: 44px;\n  border: 1px solid rgb(255 255 255 / 8%);\n  border-radius: 13px;\n  color: #fff;\n  background: linear-gradient(145deg, #2b2f37, #121419);\n  box-shadow: inset 0 1px rgb(255 255 255 / 6%);\n}\n\n.workspace-sidebar .agent-profile {\n  position: relative;\n  width: 52px;\n  padding: 8px 0 16px;\n  border: 0;\n  border-bottom: 1px solid rgb(255 255 255 / 9%);\n  display: grid;\n  grid-template-columns: 1fr;\n  place-items: center;\n}\n\n.workspace-sidebar .agent-profile > div {\n  display: none;\n}\n\n.workspace-sidebar .avatar {\n  width: 40px;\n  height: 40px;\n  border: 1px solid rgb(255 255 255 / 10%);\n  border-radius: 12px;\n  color: #f8fafc;\n  background: #343943;\n}\n\n.workspace-sidebar .agent-profile .presence {\n  position: absolute;\n  right: 3px;\n  bottom: 13px;\n  width: 10px;\n  height: 10px;\n  border: 2px solid var(--agent-rail);\n  box-shadow: none;\n}\n\n.workspace-sidebar-actions {\n  width: 100%;\n  margin-top: auto;\n  display: grid;\n  justify-items: center;\n  gap: 8px;\n}\n\n.workspace-sidebar .ghost-button,\n.workspace-sidebar .ghost-button.full {\n  width: 46px;\n  min-width: 46px;\n  height: 46px;\n  min-height: 46px;\n  margin: 0;\n  padding: 0;\n  border: 1px solid transparent;\n  border-radius: 12px;\n  color: #aeb5c0;\n  background: transparent;\n  box-shadow: none;\n}\n\n.workspace-sidebar .ghost-button:hover:not(:disabled),\n.workspace-sidebar .ghost-button.is-enabled {\n  border-color: rgb(255 255 255 / 8%);\n  color: #fff;\n  background: #242830;\n  transform: none;\n}\n\n.workspace-sidebar .ghost-button.is-enabled {\n  color: #ff9b76;\n}\n\n.workspace-sidebar .ghost-button > span:last-child {\n  display: none;\n}\n\n.workspace-sidebar .ui-icon {\n  width: 19px;\n  height: 19px;\n}\n\n.conversation-pane {\n  min-width: 0;\n  min-height: 0;\n  border-right: 1px solid var(--agent-line);\n  background: #fff;\n  box-shadow: 8px 0 26px rgb(23 25 30 / 2%);\n  display: flex;\n  flex-direction: column;\n}\n\n.conversation-head {\n  min-height: 78px;\n  padding: 14px 16px 12px;\n  border-bottom: 1px solid #eceef1;\n  background: #fff;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n}\n\n.conversation-head h1 {\n  display: flex;\n  align-items: center;\n  gap: 7px;\n  font-size: 20px;\n  line-height: 1.15;\n  letter-spacing: -0.025em;\n}\n\n.conversation-head .eyebrow {\n  margin-bottom: 4px;\n  color: #8a909a;\n  font-size: 9px;\n  letter-spacing: 0.12em;\n}\n\n.unread-total {\n  min-width: 20px;\n  height: 20px;\n  padding: 0 6px;\n  border-radius: 999px;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  color: #fff;\n  background: var(--agent-accent);\n  font-size: 10px;\n  font-weight: 800;\n}\n\n.conversation-head-status {\n  margin-left: auto;\n  min-width: 0;\n  display: grid;\n  justify-items: end;\n  gap: 5px;\n}\n\n.availability-pill {\n  min-height: 30px;\n  padding: 0 10px;\n  border: 1px solid #dce1e6;\n  border-radius: 999px;\n  color: #48505b;\n  background: #fff;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  font-size: 10px;\n  font-weight: 750;\n}\n\n.availability-pill > span {\n  width: 7px;\n  height: 7px;\n  border-radius: 50%;\n  background: #36a66f;\n}\n\n.availability-pill.is-busy > span {\n  background: #d89942;\n}\n\n.availability-pill:hover:not(:disabled) {\n  border-color: #cbd1d8;\n  background: #fafbfc;\n}\n\n.connection-status {\n  color: #8b919b;\n  display: flex;\n  align-items: center;\n  gap: 5px;\n  font-size: 9px;\n  white-space: nowrap;\n}\n\n.connection-status i {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: #a6adb7;\n}\n\n.connection-status.is-connected i {\n  background: #32a66d;\n}\n\n.connection-status.is-offline i {\n  background: #d45454;\n}\n\n.inbox-overview {\n  padding: 10px 12px;\n  border-bottom: 1px solid #edf0f2;\n  background: #fafbfc;\n  display: grid;\n  grid-template-columns: repeat(4, minmax(0, 1fr));\n  gap: 6px;\n}\n\n.inbox-overview .metric {\n  min-width: 0;\n  min-height: 48px;\n  padding: 7px 8px;\n  border: 1px solid #e6e9ed;\n  border-radius: 10px;\n  background: #fff;\n  box-shadow: none;\n  display: grid;\n  align-content: center;\n  gap: 2px;\n}\n\n.inbox-overview .metric strong {\n  overflow: hidden;\n  color: #1f2329;\n  font-size: 17px;\n  line-height: 1;\n  text-overflow: ellipsis;\n}\n\n.inbox-overview .metric span {\n  color: #8a909a;\n  font-size: 9px;\n  white-space: nowrap;\n}\n\n.filters {\n  min-height: 46px;\n  padding: 7px 12px;\n  border-bottom: 0;\n  background: #fff;\n  display: flex;\n  gap: 4px;\n}\n\n.filter {\n  min-height: 32px;\n  padding: 0 11px;\n  border: 1px solid transparent;\n  border-radius: 9px;\n  color: #737a85;\n  background: transparent;\n  font-size: 11px;\n  font-weight: 650;\n}\n\n.filter:hover {\n  color: #343942;\n  background: #f6f7f9;\n}\n\n.filter.active {\n  border-color: #ffd3c3;\n  color: #d9480f;\n  background: var(--agent-accent-soft);\n}\n\n.inbox-tools {\n  padding: 0 12px 10px;\n  border-bottom: 1px solid #eceef1;\n  background: #fff;\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;\n  gap: 7px;\n}\n\n.inbox-search {\n  min-width: 0;\n  height: 36px;\n  padding: 0 10px;\n  border: 1px solid #e0e3e7;\n  border-radius: 10px;\n  background: #f8f9fa;\n  display: flex;\n  align-items: center;\n  gap: 7px;\n}\n\n.inbox-search:focus-within {\n  border-color: #ffb79d;\n  background: #fff;\n  box-shadow: 0 0 0 3px rgb(255 90 31 / 7%);\n}\n\n.inbox-search svg {\n  width: 15px;\n  height: 15px;\n  fill: none;\n  stroke: #8d949e;\n  stroke-width: 1.8;\n}\n\n.inbox-search input {\n  width: 100%;\n  min-width: 0;\n  height: 34px;\n  padding: 0;\n  border: 0;\n  outline: 0;\n  color: #252a31;\n  background: transparent;\n  font-size: 11px;\n}\n\n.unread-first-toggle {\n  min-height: 36px;\n  padding: 0 10px;\n  border: 1px solid #e0e3e7;\n  border-radius: 10px;\n  color: #707782;\n  background: #fff;\n  font-size: 10px;\n  font-weight: 700;\n}\n\n.unread-first-toggle.is-active {\n  border-color: #ffd0bf;\n  color: #d9480f;\n  background: #fff7f3;\n}\n\n.conversation-list {\n  min-height: 0;\n  flex: 1;\n  padding: 4px 7px 10px;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  scrollbar-width: thin;\n  scrollbar-color: #d9dde2 transparent;\n}\n\n.conversation-row {\n  position: relative;\n  width: 100%;\n  min-height: 76px;\n  padding: 10px 10px;\n  border: 1px solid transparent;\n  border-radius: 12px;\n  background: transparent;\n  display: grid;\n  grid-template-columns: 40px minmax(0, 1fr);\n  align-items: center;\n  gap: 10px;\n  text-align: left;\n}\n\n.conversation-row + .conversation-row {\n  margin-top: 2px;\n}\n\n.conversation-row:hover {\n  border-color: #eceef1;\n  background: #f8f9fa;\n}\n\n.conversation-row.selected {\n  border-color: #ffd9cb;\n  background: #fff5f0;\n}\n\n.conversation-row.selected::before {\n  content: '';\n  position: absolute;\n  left: -1px;\n  top: 14px;\n  bottom: 14px;\n  width: 3px;\n  border-radius: 0 3px 3px 0;\n  background: var(--agent-accent);\n}\n\n.conversation-row.unread:not(.selected) {\n  background: #fffdfb;\n}\n\n.conversation-row .avatar.small {\n  width: 40px;\n  height: 40px;\n  border-radius: 12px;\n  color: #59616d;\n  background: #eef0f3;\n  font-size: 11px;\n}\n\n.conversation-row.unread .avatar.small {\n  color: #c64312;\n  background: #ffebe3;\n}\n\n.conversation-copy {\n  min-width: 0;\n  display: grid;\n  gap: 3px;\n}\n\n.conversation-copy > span {\n  min-width: 0;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.conversation-copy > span strong {\n  min-width: 0;\n  overflow: hidden;\n  color: #24282f;\n  font-size: 13px;\n  font-weight: 730;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.conversation-copy time {\n  margin-left: auto;\n  color: #9aa0a9;\n  font-size: 9px;\n  white-space: nowrap;\n}\n\n.conversation-copy small {\n  overflow: hidden;\n  color: #7e8590;\n  font-size: 10px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.conversation-copy p {\n  overflow: hidden;\n  color: #8e949e;\n  font-size: 10px;\n  line-height: 1.4;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.unread-badge {\n  flex: 0 0 auto;\n  min-width: 18px;\n  height: 18px;\n  padding: 0 5px;\n  border-radius: 999px;\n  color: #fff;\n  background: var(--agent-accent);\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  font-size: 9px;\n  font-weight: 800;\n}\n\n.thread-pane {\n  position: relative;\n  min-width: 0;\n  min-height: 0;\n  background: #f5f6f8;\n  display: flex;\n  flex-direction: column;\n  overflow: hidden;\n}\n\n.thread-head {\n  position: relative;\n  z-index: 6;\n  min-height: 72px;\n  padding: 11px 18px;\n  border-bottom: 1px solid var(--agent-line);\n  background: rgb(255 255 255 / 96%);\n  backdrop-filter: blur(14px);\n  display: flex;\n  align-items: center;\n  gap: 14px;\n}\n\n.thread-back-button {\n  display: none;\n}\n\n.thread-head-copy {\n  min-width: 0;\n}\n\n.thread-head .eyebrow {\n  margin-bottom: 3px;\n  color: #979da6;\n  font-size: 8px;\n  letter-spacing: 0.12em;\n}\n\n.thread-head h2 {\n  overflow: hidden;\n  color: #20242a;\n  font-size: 17px;\n  letter-spacing: -0.02em;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.thread-head p {\n  max-width: 520px;\n  margin-top: 2px;\n  overflow: hidden;\n  color: #7e858f;\n  font-size: 10px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.thread-actions {\n  margin-left: auto;\n  display: flex;\n  align-items: center;\n  gap: 7px;\n}\n\n.thread-head select,\n.transfer-menu > summary {\n  min-height: 36px;\n  border: 1px solid #dde1e6;\n  border-radius: 10px;\n  color: #404650;\n  background: #fff;\n  font-size: 10px;\n  font-weight: 680;\n}\n\n.thread-head select {\n  min-width: 98px;\n  padding: 0 28px 0 10px;\n}\n\n.transfer-menu {\n  position: relative;\n}\n\n.transfer-menu > summary {\n  min-width: 68px;\n  padding: 0 11px;\n  list-style: none;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n\n.transfer-menu > summary::-webkit-details-marker {\n  display: none;\n}\n\n.transfer-menu[open] > summary {\n  border-color: #ffbca4;\n  color: #d94a13;\n  background: #fff7f3;\n}\n\n.transfer-menu-panel {\n  position: absolute;\n  z-index: 30;\n  top: calc(100% + 8px);\n  right: 0;\n  width: 300px;\n  padding: 8px;\n  border: 1px solid #dfe3e8;\n  border-radius: 14px;\n  background: #fff;\n  box-shadow: 0 18px 48px rgb(23 25 30 / 16%);\n}\n\n.transfer-menu-panel header {\n  padding: 7px 8px 9px;\n  display: grid;\n  gap: 3px;\n}\n\n.transfer-menu-panel header strong {\n  font-size: 12px;\n}\n\n.transfer-menu-panel header span,\n.transfer-menu-panel p {\n  color: #858c96;\n  font-size: 9px;\n}\n\n.transfer-menu-panel button {\n  width: 100%;\n  min-height: 48px;\n  padding: 8px 9px;\n  border: 0;\n  border-radius: 9px;\n  color: #3f454e;\n  background: transparent;\n  display: grid;\n  gap: 2px;\n  text-align: left;\n}\n\n.transfer-menu-panel button:hover:not(:disabled) {\n  background: #f7f8fa;\n}\n\n.transfer-menu-panel button span {\n  font-size: 11px;\n  font-weight: 700;\n}\n\n.transfer-menu-panel button small {\n  color: #8c929b;\n  font-size: 9px;\n}\n\n.conversation-expiry {\n  margin-top: 4px;\n  min-height: 19px;\n  padding: 2px 7px;\n  border-radius: 999px;\n  color: #7c828c;\n  background: #f3f4f6;\n  font-size: 8px;\n}\n\n.conversation-context-card {\n  width: min(calc(100% - 32px), 960px);\n  min-height: 58px;\n  margin: 10px auto 0;\n  padding: 7px 9px;\n  border: 1px solid #e1e4e8;\n  border-radius: 13px;\n  background: rgb(255 255 255 / 88%);\n  box-shadow: 0 4px 14px rgb(23 25 30 / 3%);\n  display: grid;\n  grid-template-columns: 42px minmax(0, 1fr) auto;\n  align-items: center;\n  gap: 9px;\n}\n\n.conversation-context-card img,\n.conversation-context-placeholder {\n  width: 42px;\n  height: 42px;\n  border-radius: 9px;\n  object-fit: cover;\n}\n\n.conversation-context-placeholder {\n  color: #b94a21;\n  background: #fff0ea;\n  display: grid;\n  place-items: center;\n  font-size: 10px;\n  font-weight: 800;\n}\n\n.conversation-context-card > div {\n  min-width: 0;\n  display: grid;\n  gap: 2px;\n}\n\n.conversation-context-card > div span,\n.conversation-context-card small {\n  color: #8a919b;\n  font-size: 8px;\n}\n\n.conversation-context-card strong {\n  overflow: hidden;\n  color: #333840;\n  font-size: 11px;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.conversation-context-card a {\n  min-height: 30px;\n  padding: 0 9px;\n  border: 1px solid #e1e4e8;\n  border-radius: 9px;\n  color: #5e6570;\n  background: #fff;\n  display: inline-flex;\n  align-items: center;\n  font-size: 9px;\n  font-weight: 700;\n}\n\n.messages {\n  width: min(100%, 980px);\n  min-height: 0;\n  flex: 1;\n  margin: 0 auto;\n  padding: 20px 22px 24px;\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  scrollbar-width: thin;\n  scrollbar-color: #d4d8de transparent;\n  display: flex;\n  flex-direction: column;\n  gap: 7px;\n}\n\n.message {\n  width: 100%;\n}\n\n.message > div {\n  max-width: min(68%, 620px);\n  padding: 0;\n  border: 0;\n  background: transparent;\n  box-shadow: none;\n}\n\n.message p {\n  margin: 0;\n  padding: 9px 12px;\n  border: 1px solid #e1e4e8;\n  border-radius: 14px 14px 14px 5px;\n  color: #363b43;\n  background: #fff;\n  box-shadow: 0 2px 8px rgb(23 25 30 / 3%);\n  font-size: 13px;\n  line-height: 1.55;\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n}\n\n.message.mine > div {\n  margin-left: auto;\n}\n\n.message.mine p {\n  border-color: #252a31;\n  border-radius: 14px 14px 5px 14px;\n  color: #fff;\n  background: #252a31;\n}\n\n.message-meta {\n  margin-top: 4px;\n  color: #9aa0a9;\n  font-size: 8px;\n}\n\n.message.mine .message-meta {\n  justify-content: flex-end;\n}\n\n.visitor-typing {\n  align-self: flex-start;\n  padding: 7px 10px;\n  border: 1px solid #e3e6ea;\n  border-radius: 12px;\n  color: #7d848e;\n  background: #fff;\n  font-size: 9px;\n}\n\n.composer {\n  position: relative;\n  z-index: 8;\n  width: 100%;\n  flex: 0 0 auto;\n  margin: 0;\n  padding: 10px max(18px, calc((100% - 940px) / 2)) 12px;\n  border-top: 1px solid var(--agent-line);\n  background: rgb(255 255 255 / 96%);\n  box-shadow: 0 -10px 28px rgb(23 25 30 / 3%);\n  backdrop-filter: blur(14px);\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto;\n  gap: 7px 10px;\n}\n\n.composer-tools {\n  grid-column: 1 / -1;\n  display: flex;\n  align-items: center;\n  gap: 6px;\n}\n\n.media-picker,\n.quick-replies-trigger {\n  min-height: 32px;\n  padding: 0 10px;\n  border: 1px solid #dfe3e7;\n  border-radius: 9px;\n  color: #626973;\n  background: #fff;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 5px;\n  font-size: 10px;\n  font-weight: 700;\n}\n\n.media-picker {\n  cursor: pointer;\n}\n\n.media-picker:hover,\n.quick-replies-trigger:hover:not(:disabled),\n.quick-replies-trigger[aria-expanded='true'] {\n  border-color: #ffc2aa;\n  color: #d94a13;\n  background: #fff7f3;\n}\n\n.quick-replies {\n  position: relative;\n}\n\n.quick-replies-panel {\n  position: absolute;\n  z-index: 40;\n  left: 0;\n  bottom: calc(100% + 9px);\n  width: 420px;\n  max-height: min(560px, 70vh);\n  padding: 10px;\n  border: 1px solid #dde1e6;\n  border-radius: 15px;\n  background: #fff;\n  box-shadow: 0 22px 54px rgb(23 25 30 / 16%);\n  overflow: auto;\n}\n\n.quick-replies-panel > header {\n  padding: 3px 2px 9px;\n  display: grid;\n  gap: 3px;\n}\n\n.quick-replies-panel > header strong {\n  color: #24282e;\n  font-size: 13px;\n}\n\n.quick-replies-panel > header span {\n  color: #8a909a;\n  font-size: 9px;\n}\n\n.quick-reply-search {\n  height: 38px;\n  padding: 0 10px;\n  border: 1px solid #e0e3e7;\n  border-radius: 10px;\n  background: #f8f9fa;\n  display: flex;\n  align-items: center;\n  gap: 7px;\n}\n\n.quick-reply-search:focus-within {\n  border-color: #ffb79d;\n  background: #fff;\n}\n\n.quick-reply-search svg {\n  width: 15px;\n  height: 15px;\n  fill: none;\n  stroke: #8e949d;\n  stroke-width: 1.8;\n}\n\n.quick-reply-search input {\n  width: 100%;\n  min-width: 0;\n  border: 0;\n  outline: 0;\n  background: transparent;\n  font-size: 11px;\n}\n\n.quick-replies-list {\n  max-height: 230px;\n  margin-top: 8px;\n  overflow-y: auto;\n  display: grid;\n  gap: 4px;\n}\n\n.quick-replies-list > div {\n  min-width: 0;\n  border: 1px solid transparent;\n  border-radius: 10px;\n  background: #fafbfc;\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) 32px;\n  align-items: stretch;\n}\n\n.quick-replies-list > div.is-active {\n  border-color: #ffd2c2;\n  background: #fff7f3;\n}\n\n.quick-replies-list button {\n  border: 0;\n  background: transparent;\n}\n\n.quick-replies-list > div > button:first-child {\n  min-width: 0;\n  padding: 8px 9px;\n  display: grid;\n  gap: 3px;\n  text-align: left;\n}\n\n.quick-replies-list strong {\n  color: #40464f;\n  font-size: 10px;\n}\n\n.quick-replies-list span {\n  overflow: hidden;\n  color: #7f8690;\n  font-size: 9px;\n  line-height: 1.4;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n\n.quick-replies-list > div > button:last-child {\n  color: #a0a6af;\n  border-radius: 8px;\n  font-size: 16px;\n}\n\n.quick-replies-list > div > button:last-child:hover {\n  color: #c64141;\n  background: #fff0f0;\n}\n\n.quick-reply-empty {\n  padding: 18px 8px;\n  color: #9298a2;\n  text-align: center;\n  font-size: 10px;\n}\n\n.quick-reply-create {\n  margin-top: 9px;\n  padding-top: 9px;\n  border-top: 1px solid #eceef1;\n  display: grid;\n  gap: 6px;\n}\n\n.quick-reply-create input,\n.quick-reply-create textarea {\n  width: 100%;\n  border: 1px solid #e0e3e7;\n  border-radius: 9px;\n  outline: 0;\n  color: #343940;\n  background: #fff;\n  font-size: 10px;\n}\n\n.quick-reply-create input {\n  height: 36px;\n  padding: 0 9px;\n}\n\n.quick-reply-create textarea {\n  min-height: 68px;\n  padding: 8px 9px;\n  resize: vertical;\n}\n\n.quick-reply-create input:focus,\n.quick-reply-create textarea:focus {\n  border-color: #ffb79d;\n  box-shadow: 0 0 0 3px rgb(255 90 31 / 6%);\n}\n\n.quick-reply-create button {\n  min-height: 36px;\n  border: 1px solid var(--agent-accent);\n  border-radius: 9px;\n  color: #fff;\n  background: var(--agent-accent);\n  font-size: 10px;\n  font-weight: 750;\n}\n\n.quick-reply-create button:disabled {\n  opacity: 0.45;\n  cursor: not-allowed;\n}\n\n.composer > textarea {\n  grid-column: 1;\n  grid-row: 2;\n  width: 100%;\n  min-height: 66px;\n  max-height: 160px;\n  padding: 11px 13px;\n  border: 1px solid #dfe3e7;\n  border-radius: 12px;\n  outline: 0;\n  color: #252a31;\n  background: #fff;\n  resize: none;\n  font-size: 13px;\n  line-height: 1.5;\n}\n\n.composer > textarea:focus {\n  border-color: #ffb89e;\n  box-shadow: 0 0 0 3px rgb(255 90 31 / 6%);\n}\n\n.composer-foot {\n  grid-column: 2;\n  grid-row: 2;\n  min-width: 112px;\n  margin: 0;\n  display: flex;\n  flex-direction: column;\n  justify-content: flex-end;\n  align-items: stretch;\n  gap: 6px;\n}\n\n.composer-foot > span {\n  max-width: 180px;\n  color: #9399a2;\n  font-size: 8px;\n  line-height: 1.35;\n  text-align: right;\n}\n\n.composer-foot .primary-button {\n  min-width: 112px;\n  min-height: 40px;\n  height: 40px;\n  border: 1px solid var(--agent-accent);\n  border-radius: 10px;\n  color: #fff;\n  background: linear-gradient(180deg, #ff6832, #f1531b);\n  box-shadow: 0 7px 16px rgb(255 90 31 / 16%);\n}\n\n.composer-foot .primary-button:hover:not(:disabled) {\n  border-color: var(--agent-accent-strong);\n  background: linear-gradient(180deg, #f85d27, #e4470f);\n  transform: translateY(-1px);\n}\n\n.thread-empty {\n  width: min(420px, calc(100% - 40px));\n  min-height: 180px;\n  margin: auto;\n  padding: 28px;\n  border: 1px dashed #d7dbe0;\n  border-radius: 16px;\n  color: #8a9099;\n  background: rgb(255 255 255 / 60%);\n  display: grid;\n  place-content: center;\n  gap: 5px;\n  text-align: center;\n}\n\n.thread-empty strong {\n  color: #535a64;\n  font-size: 14px;\n}\n\n.thread-empty span {\n  font-size: 10px;\n  line-height: 1.5;\n}\n\n.notice.error.floating {\n  z-index: 80;\n  top: 10px;\n  right: 12px;\n  max-width: 360px;\n  border-radius: 10px;\n  box-shadow: 0 12px 32px rgb(23 25 30 / 14%);\n}\n\n@media (max-width: 1180px) and (min-width: 761px) {\n  .workspace-shell {\n    grid-template-columns: 70px 330px minmax(0, 1fr);\n  }\n\n  .workspace-sidebar {\n    padding-inline: 8px;\n  }\n\n  .inbox-overview {\n    gap: 4px;\n    padding-inline: 9px;\n  }\n\n  .conversation-context-card {\n    width: calc(100% - 22px);\n  }\n\n  .messages {\n    padding-inline: 16px;\n  }\n}\n\n@media (max-width: 760px) {\n  html,\n  body,\n  #root {\n    width: 100%;\n    height: 100%;\n    min-height: 100%;\n    overflow: hidden;\n  }\n\n  body {\n    overscroll-behavior: none;\n    background: #f5f6f8;\n  }\n\n  .workspace-shell {\n    position: relative;\n    display: block;\n    width: 100%;\n    height: 100dvh;\n    min-height: 0;\n    padding-top: env(safe-area-inset-top);\n    overflow: hidden;\n    background: #f5f6f8;\n  }\n\n  .workspace-sidebar {\n    width: 100%;\n    height: 56px;\n    min-height: 56px;\n    padding: 7px 9px;\n    border: 0;\n    border-bottom: 1px solid #e5e8ec;\n    color: #252a31;\n    background: rgb(255 255 255 / 97%);\n    backdrop-filter: blur(14px);\n    display: flex;\n    flex-direction: row;\n    align-items: center;\n    gap: 7px;\n  }\n\n  .workspace-brand-lockup {\n    display: none;\n  }\n\n  .workspace-sidebar .agent-profile {\n    width: auto;\n    min-width: 0;\n    flex: 1;\n    padding: 0;\n    border: 0;\n    display: grid;\n    grid-template-columns: 36px minmax(0, 1fr) auto;\n    place-items: initial;\n    align-items: center;\n    gap: 8px;\n  }\n\n  .workspace-sidebar .agent-profile > div {\n    min-width: 0;\n    display: grid;\n    gap: 1px;\n  }\n\n  .workspace-sidebar .agent-profile strong {\n    overflow: hidden;\n    color: #252a31;\n    font-size: 12px;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n\n  .workspace-sidebar .agent-profile small {\n    overflow: hidden;\n    color: #9399a2;\n    font-size: 8px;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n\n  .workspace-sidebar .avatar {\n    width: 36px;\n    height: 36px;\n    border: 0;\n    border-radius: 11px;\n    color: #c24719;\n    background: #fff0ea;\n    font-size: 10px;\n  }\n\n  .workspace-sidebar .agent-profile .presence {\n    position: static;\n    width: 8px;\n    height: 8px;\n    border: 0;\n  }\n\n  .workspace-sidebar-actions {\n    width: auto;\n    margin: 0;\n    display: flex;\n    flex: 0 0 auto;\n    gap: 3px;\n  }\n\n  .workspace-sidebar .ghost-button,\n  .workspace-sidebar .ghost-button.full {\n    width: 34px;\n    min-width: 34px;\n    height: 34px;\n    min-height: 34px;\n    border: 0;\n    border-radius: 9px;\n    color: #6e7580;\n    background: transparent;\n  }\n\n  .workspace-sidebar .ghost-button:hover:not(:disabled),\n  .workspace-sidebar .ghost-button.is-enabled {\n    color: #d84a14;\n    background: #fff1eb;\n  }\n\n  .workspace-sidebar .ui-icon {\n    width: 17px;\n    height: 17px;\n  }\n\n  .conversation-pane {\n    width: 100%;\n    height: calc(100dvh - 56px - env(safe-area-inset-top));\n    min-height: 0;\n    border: 0;\n    box-shadow: none;\n  }\n\n  .conversation-head {\n    min-height: 62px;\n    padding: 9px 11px 8px;\n  }\n\n  .conversation-head .eyebrow {\n    display: none;\n  }\n\n  .conversation-head h1 {\n    font-size: 19px;\n  }\n\n  .conversation-head-status {\n    gap: 3px;\n  }\n\n  .availability-pill {\n    min-height: 30px;\n    padding: 0 9px;\n    font-size: 9px;\n  }\n\n  .connection-status {\n    max-width: 112px;\n    overflow: hidden;\n    font-size: 8px;\n    text-overflow: ellipsis;\n    white-space: nowrap;\n  }\n\n  .inbox-overview {\n    min-height: 59px;\n    padding: 7px 8px;\n    grid-template-columns: repeat(4, minmax(68px, 1fr));\n    gap: 4px;\n    overflow-x: auto;\n    scrollbar-width: none;\n  }\n\n  .inbox-overview::-webkit-scrollbar {\n    display: none;\n  }\n\n  .inbox-overview .metric {\n    min-height: 44px;\n    padding: 6px 7px;\n  }\n\n  .inbox-overview .metric strong {\n    font-size: 15px;\n  }\n\n  .inbox-overview .metric span {\n    font-size: 8px;\n  }\n\n  .filters {\n    min-height: 42px;\n    padding: 5px 8px;\n    gap: 3px;\n    overflow-x: auto;\n    scrollbar-width: none;\n  }\n\n  .filters::-webkit-scrollbar {\n    display: none;\n  }\n\n  .filter {\n    min-height: 32px;\n    padding: 0 10px;\n    font-size: 10px;\n  }\n\n  .inbox-tools {\n    padding: 0 8px 8px;\n    gap: 5px;\n  }\n\n  .inbox-search {\n    height: 36px;\n  }\n\n  .unread-first-toggle {\n    min-height: 36px;\n    padding-inline: 9px;\n    font-size: 9px;\n  }\n\n  .conversation-list {\n    padding: 2px 6px 10px;\n    -webkit-overflow-scrolling: touch;\n  }\n\n  .conversation-row {\n    min-height: 74px;\n    padding: 9px 8px;\n    grid-template-columns: 42px minmax(0, 1fr);\n    gap: 9px;\n    border-radius: 11px;\n  }\n\n  .conversation-row .avatar.small {\n    width: 42px;\n    height: 42px;\n    font-size: 11px;\n  }\n\n  .conversation-copy > span strong {\n    font-size: 13px;\n  }\n\n  .conversation-copy time,\n  .conversation-copy small,\n  .conversation-copy p {\n    font-size: 9px;\n  }\n\n  .workspace-shell:not(.is-thread-open) .thread-pane {\n    display: none;\n  }\n\n  .workspace-shell.is-thread-open {\n    padding-top: env(safe-area-inset-top);\n  }\n\n  .workspace-shell.is-thread-open .workspace-sidebar,\n  .workspace-shell.is-thread-open .conversation-pane {\n    display: none;\n  }\n\n  .workspace-shell.is-thread-open .thread-pane {\n    position: absolute;\n    inset: env(safe-area-inset-top) 0 0;\n    z-index: 20;\n    width: 100%;\n    height: calc(100dvh - env(safe-area-inset-top));\n    min-height: 0;\n    display: flex;\n  }\n\n  .thread-head {\n    min-height: 60px;\n    padding: 7px 8px;\n    display: grid;\n    grid-template-columns: 38px minmax(0, 1fr) auto;\n    align-items: center;\n    gap: 6px;\n  }\n\n  .thread-back-button {\n    width: 38px;\n    height: 38px;\n    padding: 0 0 2px;\n    border: 0;\n    border-radius: 10px;\n    color: #363b43;\n    background: transparent;\n    display: grid;\n    place-items: center;\n    font-size: 28px;\n    line-height: 1;\n  }\n\n  .thread-back-button:active {\n    background: #f1f3f5;\n    transform: scale(0.96);\n  }\n\n  .thread-head .eyebrow {\n    display: none;\n  }\n\n  .thread-head h2 {\n    font-size: 14px;\n  }\n\n  .thread-head p {\n    max-width: 44vw;\n    margin-top: 1px;\n    font-size: 8px;\n  }\n\n  .conversation-expiry {\n    margin-top: 2px;\n    font-size: 7px;\n  }\n\n  .thread-actions {\n    gap: 4px;\n  }\n\n  .thread-head select {\n    min-width: 78px;\n    min-height: 34px;\n    padding: 0 22px 0 7px;\n    border-radius: 9px;\n    font-size: 9px;\n  }\n\n  .transfer-menu > summary {\n    min-width: 48px;\n    min-height: 34px;\n    padding: 0 7px;\n    border-radius: 9px;\n    font-size: 9px;\n  }\n\n  .transfer-menu-panel {\n    position: fixed;\n    top: calc(env(safe-area-inset-top) + 54px);\n    right: 7px;\n    left: 7px;\n    width: auto;\n    max-height: 62vh;\n    overflow-y: auto;\n  }\n\n  .conversation-context-card {\n    width: calc(100% - 14px);\n    min-height: 52px;\n    margin: 7px auto 0;\n    padding: 5px 7px;\n    border-radius: 11px;\n    grid-template-columns: 38px minmax(0, 1fr) auto;\n    gap: 7px;\n  }\n\n  .conversation-context-card img,\n  .conversation-context-placeholder {\n    width: 38px;\n    height: 38px;\n    border-radius: 8px;\n  }\n\n  .conversation-context-card strong {\n    font-size: 10px;\n  }\n\n  .conversation-context-card a {\n    min-height: 28px;\n    padding-inline: 7px;\n    font-size: 8px;\n  }\n\n  .messages {\n    width: 100%;\n    flex: 1;\n    min-height: 0;\n    padding: 12px 9px 14px;\n    gap: 6px;\n    -webkit-overflow-scrolling: touch;\n  }\n\n  .message > div {\n    max-width: 84%;\n  }\n\n  .message p {\n    padding: 8px 10px;\n    border-radius: 13px 13px 13px 4px;\n    font-size: 14px;\n    line-height: 1.48;\n  }\n\n  .message.mine p {\n    border-radius: 13px 13px 4px 13px;\n  }\n\n  .composer {\n    width: 100%;\n    padding: 7px 7px calc(7px + env(safe-area-inset-bottom));\n    border-top-color: #e4e7eb;\n    display: grid;\n    grid-template-columns: auto minmax(0, 1fr) 58px;\n    align-items: end;\n    gap: 5px;\n  }\n\n  .composer-tools {\n    grid-column: 1;\n    grid-row: 1;\n    display: flex;\n    gap: 4px;\n  }\n\n  .media-picker,\n  .quick-replies-trigger {\n    width: 36px;\n    min-width: 36px;\n    height: 42px;\n    min-height: 42px;\n    padding: 0;\n    border-radius: 12px;\n    font-size: 18px;\n  }\n\n  .quick-replies-trigger > span:last-child {\n    display: none;\n  }\n\n  .composer > textarea {\n    grid-column: 2;\n    grid-row: 1;\n    height: 42px;\n    min-height: 42px;\n    max-height: 104px;\n    padding: 10px 12px;\n    border-radius: 15px;\n    font-size: 16px;\n    line-height: 1.35;\n  }\n\n  .composer-foot {\n    grid-column: 3;\n    grid-row: 1;\n    min-width: 58px;\n    margin: 0;\n    display: block;\n  }\n\n  .composer-foot > span {\n    display: none;\n  }\n\n  .composer-foot .primary-button {\n    width: 58px;\n    min-width: 58px;\n    height: 42px;\n    min-height: 42px;\n    padding: 0;\n    border-radius: 12px;\n    font-size: 12px;\n  }\n\n  .quick-replies-panel {\n    position: fixed;\n    z-index: 60;\n    right: 7px;\n    bottom: calc(66px + env(safe-area-inset-bottom));\n    left: 7px;\n    width: auto;\n    max-height: min(62vh, 520px);\n    border-radius: 16px;\n    box-shadow: 0 18px 50px rgb(23 25 30 / 22%);\n  }\n\n  .quick-replies-list {\n    max-height: 180px;\n  }\n\n  .quick-reply-create textarea {\n    min-height: 64px;\n  }\n\n  .notice.error.floating {\n    top: calc(env(safe-area-inset-top) + 6px);\n    right: 7px;\n    left: 7px;\n    max-width: none;\n  }\n}\n\n@media (max-width: 380px) {\n  .workspace-sidebar .workspace-statistics-button {\n    display: none;\n  }\n\n  .connection-status {\n    display: none;\n  }\n\n  .thread-head p {\n    max-width: 35vw;\n  }\n\n  .thread-head select {\n    min-width: 72px;\n  }\n\n  .transfer-menu > summary {\n    min-width: 44px;\n  }\n\n  .composer {\n    grid-template-columns: auto minmax(0, 1fr) 52px;\n  }\n\n  .media-picker,\n  .quick-replies-trigger {\n    width: 34px;\n    min-width: 34px;\n  }\n\n  .composer-foot {\n    min-width: 52px;\n  }\n\n  .composer-foot .primary-button {\n    width: 52px;\n    min-width: 52px;\n  }\n}\n`,
);

for (const legacyFile of [
  'src/dashboard/agent-mobile-layout.css',
  'src/dashboard/agent-mobile-thread.css',
  'src/dashboard/agent-mobile-composer.css',
  'src/dashboard/agent-mobile.ts',
]) {
  rmSync(legacyFile, { force: true });
}
