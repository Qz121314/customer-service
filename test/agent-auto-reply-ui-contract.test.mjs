import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('migrations/0035_agent_auto_reply.sql', 'utf8');
const api = readFileSync('src/worker/agent-auto-reply-api.ts', 'utf8');
const entry = readFileSync('src/worker/entry.ts', 'utf8');
const toolbar = readFileSync('src/dashboard/AgentWorkspaceChrome.tsx', 'utf8');
const panels = readFileSync('src/dashboard/AgentWorkspacePanels.tsx', 'utf8');
const modal = readFileSync('src/dashboard/AgentAutoReplySettings.tsx', 'utf8');
const client = readFileSync('src/dashboard/agent-auto-reply-client.ts', 'utf8');

test('agent auto reply defaults off and has no forced greeting copy in storage', () => {
  assert.match(migration, /auto_greeting_enabled INTEGER NOT NULL DEFAULT 0/u);
  assert.match(migration, /auto_greeting_text TEXT/u);
  assert.doesNotMatch(migration, /auto_greeting_text TEXT[^;]*DEFAULT\s+['"]/u);
  assert.match(
    migration,
    /outcome TEXT NOT NULL CHECK \(outcome IN \('sent', 'skipped'\)\)/u,
  );
});

test('auto reply settings are authenticated agent-owned API resources', () => {
  assert.match(api, /get\('\/api\/agent\/settings\/auto-reply'/u);
  assert.match(api, /patch\('\/api\/agent\/settings\/auto-reply'/u);
  assert.match(api, /authenticateAgentSettings/u);
  assert.match(api, /body\.enabled && !text/u);
  assert.match(entry, /app\.route\('\/', agentAutoReplyApi\)/u);
  assert.match(client, /getAgentAutoReplySettings/u);
  assert.match(client, /updateAgentAutoReplySettings/u);
});

test('agent workspace exposes optional first-greeting settings without making chat depend on them', () => {
  assert.match(toolbar, /workspace-auto-reply-button/u);
  assert.match(toolbar, />自动回复</u);
  assert.match(panels, /AgentAutoReplySettingsModal/u);
  assert.match(panels, /onOpenAutoReply=\{\(\) => setAutoReplyOpen\(true\)\}/u);
  assert.match(toolbar, /mobile-agent-settings-item/u);
  assert.match(toolbar, />首次问候语</u);
  assert.match(modal, /首次问候语/u);
  assert.match(modal, /未开启或未配置问候语时，会话仍会正常创建和分配/u);
  assert.match(modal, /转接、重新排队和重连也不会重复发送/u);
});
