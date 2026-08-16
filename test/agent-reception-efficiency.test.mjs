import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('typing signals stay ephemeral and use authenticated conversation sockets', () => {
  const room = source('../src/worker/core.ts');
  const agentApi = source('../src/worker/agent-api.ts');
  const clientApi = source('../src/worker/client-api.ts');

  assert.ok(room.includes("parsed.type !== 'typing'"));
  assert.ok(room.includes("type: 'typing'"));
  assert.ok(room.includes('if (peer === socket) continue'));
  assert.ok(room.includes("request.headers.get('X-CS-Participant-Role')"));
  assert.ok(!room.includes("url.searchParams.get('participantRole')"));
  assert.ok(agentApi.includes("headers.set('X-CS-Participant-Role', 'agent')"));
  assert.ok(clientApi.includes("'/client/v1/conversations/:id/realtime'"));
  assert.ok(
    clientApi.includes("headers.set('X-CS-Participant-Role', 'visitor')"),
  );
  assert.ok(clientApi.includes('await resolveIdentity'));
});

test('agent workspace offers local sound, typing presence, and searchable slash replies', () => {
  const app = source('../src/dashboard/App.tsx');

  assert.ok(app.includes('cs-agent-sound:${agentId}'));
  assert.ok(app.includes('emitAgentMessageTone'));
  assert.ok(app.includes("document.visibilityState !== 'visible'"));
  assert.ok(
    app.includes("socket.send(JSON.stringify({ type: 'typing', active }))"),
  );
  assert.ok(app.includes('访客正在输入'));
  assert.ok(app.includes('filteredQuickReplies'));
  assert.ok(app.includes('placeholder="搜索快捷回复"'));
  assert.ok(app.includes("event.key === '/'"));
  assert.ok(app.includes('没有找到匹配的快捷回复'));
});
