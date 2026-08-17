import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent avatar is locally prepared, explicitly confirmed and stored as one R2 object', () => {
  const migration = source('../migrations/0030_agent_avatar.sql');
  const api = source('../src/worker/agent-avatar-api.ts');
  const clientApi = source('../src/worker/client-api.ts');
  const control = source('../src/dashboard/AgentAvatarControl.tsx');
  const image = source('../src/dashboard/agent-avatar-image.ts');
  const styles = source('../src/dashboard/agent-avatar.css');
  const entry = source('../src/worker/entry.ts');
  const main = source('../src/dashboard/main.tsx');

  assert.ok(migration.includes('avatar_version'));
  assert.ok(api.includes("agentAvatarApi.put('/api/agent/avatar'"));
  assert.ok(api.includes("agentAvatarApi.delete('/api/agent/avatar'"));
  assert.ok(api.includes("agentAvatarApi.get('/client/v1/avatars/:agentId'"));
  assert.ok(api.includes("`${AVATAR_KEY_PREFIX}/${agentId}/current`"));
  assert.ok(api.includes('c.env.MEDIA.put(key, bytes'));
  assert.ok(api.includes('c.env.MEDIA.delete(avatarObjectKey(agent.id))'));
  assert.ok(clientApi.includes('a.avatar_version AS agent_avatar_version'));
  assert.ok(clientApi.includes('/client/v1/avatars/${encodeURIComponent(conversation.assigned_agent)}'));
  assert.ok(control.includes('prepareAgentAvatar(file)'));
  assert.ok(control.includes('confirmAvatar'));
  assert.ok(control.includes('确认使用'));
  assert.ok(image.includes('MAX_AVATAR_EDGE = 512'));
  assert.ok(image.includes("compressCanvas(canvas, 'image/webp')"));
  assert.ok(styles.includes('min-height: 44px'));
  assert.ok(styles.includes('env(safe-area-inset-bottom)'));
  assert.ok(entry.includes("import { agentAvatarApi } from './agent-avatar-api';"));
  assert.ok(main.includes("import './agent-avatar.css';"));
});
