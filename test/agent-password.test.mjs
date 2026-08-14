import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hashAgentPassword,
  verifyAgentPassword,
} from '../src/worker/agent-password.ts';

test('agent passwords round-trip and reject the wrong password', async () => {
  const credential = await hashAgentPassword('correct horse battery staple', 1_000);

  assert.equal(
    await verifyAgentPassword(
      'correct horse battery staple',
      credential.hash,
      credential.salt,
      credential.iterations,
    ),
    true,
  );
  assert.equal(
    await verifyAgentPassword(
      'wrong password',
      credential.hash,
      credential.salt,
      credential.iterations,
    ),
    false,
  );
});

test('agent password verification rejects invalid credential metadata', async () => {
  assert.equal(await verifyAgentPassword('password', 'deadbeef', 'not-hex', 1_000), false);
  assert.equal(await verifyAgentPassword('password', 'deadbeef', '0011', 999), false);
});
