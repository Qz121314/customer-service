import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAgentDraftSaveScheduler,
  loadAgentConversationDrafts,
  saveAgentConversationDrafts,
} from '../src/dashboard/dashboard-runtime.ts';

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('agent drafts persist per seat, expire after 24 hours and clear empty state', () => {
  const storage = memoryStorage();
  const restoreWindow = replaceGlobal('window', { localStorage: storage });
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  try {
    saveAgentConversationDrafts('agent-a', {
      'conversation-fresh': { body: '继续跟进', updatedAt: now },
      'conversation-expired': {
        body: '过期草稿',
        updatedAt: now - oneDay - 1_000,
      },
    });
    saveAgentConversationDrafts('agent-b', {
      'conversation-b': { body: '另一个坐席', updatedAt: now },
    });

    assert.deepEqual(loadAgentConversationDrafts('agent-a'), {
      'conversation-fresh': { body: '继续跟进', updatedAt: now },
    });
    assert.deepEqual(loadAgentConversationDrafts('agent-b'), {
      'conversation-b': { body: '另一个坐席', updatedAt: now },
    });

    saveAgentConversationDrafts('agent-a', {});
    assert.equal(storage.getItem('cs-agent-drafts:agent-a'), null);
    assert.deepEqual(loadAgentConversationDrafts('agent-a'), {});
    assert.deepEqual(loadAgentConversationDrafts('agent-b'), {
      'conversation-b': { body: '另一个坐席', updatedAt: now },
    });
  } finally {
    restoreWindow();
  }
});

test('invalid or unavailable local storage never interrupts agent reception', () => {
  const storage = memoryStorage();
  const restoreWindow = replaceGlobal('window', { localStorage: storage });

  try {
    storage.setItem('cs-agent-drafts:agent-a', '{invalid-json');
    assert.deepEqual(loadAgentConversationDrafts('agent-a'), {});

    storage.setItem(
      'cs-agent-drafts:agent-a',
      JSON.stringify({
        missingBody: { updatedAt: Date.now() },
        emptyBody: { body: '', updatedAt: Date.now() },
        invalidUpdatedAt: { body: 'draft', updatedAt: 'invalid' },
      }),
    );
    assert.deepEqual(loadAgentConversationDrafts('agent-a'), {});
  } finally {
    restoreWindow();
  }

  const restoreUnavailableWindow = replaceGlobal('window', {
    localStorage: {
      getItem() {
        throw new Error('storage unavailable');
      },
      setItem() {
        throw new Error('storage unavailable');
      },
      removeItem() {
        throw new Error('storage unavailable');
      },
    },
  });

  try {
    assert.deepEqual(loadAgentConversationDrafts('agent-a'), {});
    assert.doesNotThrow(() =>
      saveAgentConversationDrafts('agent-a', {
        conversation: { body: 'draft', updatedAt: Date.now() },
      }),
    );
    assert.doesNotThrow(() => saveAgentConversationDrafts('agent-a', {}));
  } finally {
    restoreUnavailableWindow();
  }
});


test('draft persistence debounces typing, flushes seat changes and supports lifecycle flush', () => {
  const saves = [];
  const cleared = [];
  let nextTimerId = 0;
  let pendingTimer = null;
  let pendingDelay = null;
  const scheduler = createAgentDraftSaveScheduler(
    (agentId, drafts) => saves.push({ agentId, drafts }),
    400,
    {
      set(callback, delay) {
        nextTimerId += 1;
        pendingTimer = callback;
        pendingDelay = delay;
        return nextTimerId;
      },
      clear(timerId) {
        cleared.push(timerId);
      },
    },
  );

  const first = {
    conversation: { body: 'H', updatedAt: 1 },
  };
  const latest = {
    conversation: { body: 'Hello', updatedAt: 2 },
  };
  scheduler.schedule('agent-a', first);
  scheduler.schedule('agent-a', latest);

  assert.equal(pendingDelay, 400);
  assert.deepEqual(saves, []);
  assert.deepEqual(cleared, [1]);

  pendingTimer();
  assert.deepEqual(saves, [{ agentId: 'agent-a', drafts: latest }]);

  const beforeSeatChange = {
    conversation: { body: 'Before logout', updatedAt: 3 },
  };
  const nextSeat = {
    conversation: { body: 'Next seat', updatedAt: 4 },
  };
  scheduler.schedule('agent-a', beforeSeatChange);
  scheduler.schedule('agent-b', nextSeat);
  assert.deepEqual(saves.at(-1), {
    agentId: 'agent-a',
    drafts: beforeSeatChange,
  });

  scheduler.flush();
  assert.deepEqual(saves.at(-1), {
    agentId: 'agent-b',
    drafts: nextSeat,
  });
  assert.equal(scheduler.hasPending(), false);
});
