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

test('agent workspace offers local sound and typing presence', () => {
  const agent = source('../src/dashboard/AgentPortal.tsx');
  const runtime = [
    source('../src/dashboard/dashboard-runtime.ts'),
    source('../src/dashboard/dashboard-runtime-core.ts'),
  ].join('\n');

  assert.ok(runtime.includes('cs-agent-sound:${agentId}'));
  assert.ok(runtime.includes('emitAgentMessageTone'));
  assert.ok(agent.includes("document.visibilityState !== 'visible'"));
  assert.ok(agent.includes('payload.reminder?.messageId'));
  assert.ok(agent.includes('payload.reminder.messageId'));
  assert.ok(!agent.includes('`${next.id}:${next.last_message_at}`'));
  assert.ok(
    agent.includes("socket.send(JSON.stringify({ type: 'typing', active }))"),
  );
  assert.ok(agent.includes('访客正在输入'));
});
