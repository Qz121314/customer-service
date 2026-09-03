import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentInboxRecoveryCoordinator } from '../src/dashboard/agent-recovery-coordinator.ts';

test('agent inbox recovery coalesces concurrent signals and permits a later cycle', async () => {
  const calls = [];
  const resolvers = [];
  const recoverOnce = () => {
    calls.push(`recovery-${calls.length + 1}`);
    return new Promise((resolve) => resolvers.push(resolve));
  };
  const coordinator = createAgentInboxRecoveryCoordinator(recoverOnce);

  const first = coordinator.recover();
  const second = coordinator.recover();
  const third = coordinator.recover();
  assert.strictEqual(first, second);
  assert.strictEqual(second, third);
  assert.deepEqual(calls, ['recovery-1']);

  resolvers.shift()();
  await Promise.resolve();
  assert.deepEqual(calls, ['recovery-1', 'recovery-2']);
  resolvers.shift()();
  await first;
  assert.deepEqual(calls, ['recovery-1', 'recovery-2']);

  const later = coordinator.recover();
  assert.notStrictEqual(later, first);
  assert.deepEqual(calls, ['recovery-1', 'recovery-2', 'recovery-3']);
  resolvers.shift()();
  await later;
});

test('agent inbox recovery preserves completion when the recovery callback handles failure', async () => {
  let calls = 0;
  const coordinator = createAgentInboxRecoveryCoordinator(async () => {
    calls += 1;
    try {
      throw new Error('heartbeat unavailable');
    } catch {
      // The AgentPortal recovery callback owns the refresh fallback.
    }
  });

  await coordinator.recover();
  assert.equal(calls, 1);
  await coordinator.recover();
  assert.equal(calls, 2);
});
