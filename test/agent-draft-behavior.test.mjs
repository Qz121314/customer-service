import assert from 'node:assert/strict';
import test from 'node:test';
import {
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
