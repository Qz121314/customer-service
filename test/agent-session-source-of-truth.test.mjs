import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('agent token authentication lives only in agent-session while login may check session existence', async () => {
  const [session, api, autoReply, avatar] = await Promise.all([
    readFile('src/worker/agent-session.ts', 'utf8'),
    readFile('src/worker/agent-api.ts', 'utf8'),
    readFile('src/worker/agent-auto-reply-api.ts', 'utf8'),
    readFile('src/worker/agent-avatar-api.ts', 'utf8'),
  ]);

  assert.match(session, /FROM agent_sessions/u);
  assert.match(session, /crypto\.subtle\.digest/u);
  for (const source of [autoReply, avatar]) {
    assert.doesNotMatch(source, /FROM agent_sessions\s+(?:s|session)/u);
    assert.doesNotMatch(source, /crypto\.subtle\.digest/u);
    assert.doesNotMatch(source, /function cookieValue/u);
  }
  assert.match(api, /EXISTS \([\s\S]*FROM agent_sessions session/u);
  assert.doesNotMatch(api, /crypto\.subtle\.digest/u);
  assert.doesNotMatch(api, /function cookieValue/u);
  assert.match(api, /requireAgentSession/u);
  assert.match(autoReply, /requireAgentSession/u);
  assert.match(avatar, /requireAgentSession/u);
});
