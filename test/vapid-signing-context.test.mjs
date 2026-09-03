import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVapidSigningContext,
  sendDataLessPush,
  sendVisitorPushForConversation,
} from '../src/worker/visitor-push.ts';

async function createConfig() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  return {
    public_key: 'public-key',
    private_jwk: JSON.stringify(
      await crypto.subtle.exportKey('jwk', pair.privateKey),
    ),
    subject: 'https://customer-service.example',
  };
}

async function sendBatch(endpoints, options = {}) {
  const config = await createConfig();
  const fetches = [];
  let importKeyCalls = 0;
  let signCalls = 0;
  const originalFetch = globalThis.fetch;
  const originalImportKey = crypto.subtle.importKey.bind(crypto.subtle);
  const originalSign = crypto.subtle.sign.bind(crypto.subtle);
  globalThis.fetch = async (input, init) => {
    fetches.push({ url: String(input), init });
    return new Response(null, { status: 201 });
  };
  crypto.subtle.importKey = async (...args) => {
    importKeyCalls += 1;
    return originalImportKey(...args);
  };
  crypto.subtle.sign = async (...args) => {
    signCalls += 1;
    return originalSign(...args);
  };

  try {
    const context = await createVapidSigningContext(config);
    await Promise.all(
      endpoints.map((endpoint) => sendDataLessPush(endpoint, context, options)),
    );
    return { fetches, importKeyCalls, signCalls };
  } finally {
    globalThis.fetch = originalFetch;
    crypto.subtle.importKey = originalImportKey;
    crypto.subtle.sign = originalSign;
  }
}

test('same-origin push batch imports once, signs once, and fetches every endpoint', async () => {
  const result = await sendBatch([
    'https://push.example.test/a',
    'https://push.example.test/b',
    'https://push.example.test/c',
  ]);

  assert.equal(result.importKeyCalls, 1);
  assert.equal(result.signCalls, 1);
  assert.equal(result.fetches.length, 3);
  assert.equal(
    new Set(result.fetches.map((request) => request.init.headers.Authorization))
      .size,
    1,
  );
  for (const request of result.fetches) {
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.TTL, '60');
    assert.equal(request.init.headers.Urgency, 'high');
  }
});

test('distinct push origins reuse the key import but sign once per origin', async () => {
  const result = await sendBatch([
    'https://push-one.example.test/a',
    'https://push-two.example.test/b',
    'https://push-one.example.test/c',
  ]);

  assert.equal(result.importKeyCalls, 1);
  assert.equal(result.signCalls, 2);
  assert.equal(result.fetches.length, 3);
  assert.equal(
    new Set(result.fetches.map((request) => request.init.headers.Authorization))
      .size,
    2,
  );
});

test('single endpoint preserves TTL, Topic, and VAPID authorization behavior', async () => {
  const result = await sendBatch(['https://push.example.test/one'], {
    ttlSeconds: 86_400,
    topic: 'agent-unread',
  });

  assert.equal(result.importKeyCalls, 1);
  assert.equal(result.signCalls, 1);
  assert.equal(result.fetches.length, 1);
  const headers = result.fetches[0].init.headers;
  assert.match(headers.Authorization, /^vapid t=.+, k=public-key$/u);
  assert.equal(headers.TTL, '86400');
  assert.equal(headers.Topic, 'agent-unread');
});

test('visitor push still removes terminal 404 and 410 endpoints', async () => {
  for (const status of [404, 410]) {
    const config = await createConfig();
    const deleted = [];
    const database = {
      prepare(sql) {
        return {
          bind(...values) {
            this.values = values;
            return this;
          },
          async all() {
            assert.match(sql, /FROM conversations/u);
            return {
              results: [
                {
                  endpoint: `https://push.example.test/${status}`,
                  ...config,
                },
              ],
            };
          },
          async run() {
            deleted.push({ sql, values: this.values });
            return { meta: { changes: 1 } };
          },
        };
      },
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(null, { status });
    try {
      await sendVisitorPushForConversation(
        { DB: database },
        'conversation-terminal-push',
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    assert.equal(deleted.length, 1);
    assert.match(deleted[0].sql, /DELETE FROM visitor_push_subscriptions/u);
  }
});
