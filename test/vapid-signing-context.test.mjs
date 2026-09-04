import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createVapidSigningContext,
  sendDataLessPush,
  sendPayloadPush,
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

function concatBytes(...values) {
  const result = new Uint8Array(
    values.reduce((total, value) => total + value.length, 0),
  );
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.length;
  }
  return result;
}

async function hkdf(input, salt, info, byteLength) {
  const key = await crypto.subtle.importKey('raw', input, 'HKDF', false, [
    'deriveBits',
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      key,
      byteLength * 8,
    ),
  );
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

test('payload push encrypts exact notification identity without a collapsing topic', async () => {
  const clientKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const clientPublic = new Uint8Array(
    await crypto.subtle.exportKey('raw', clientKeys.publicKey),
  );
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const notification = {
    type: 'CUSTOMER_REPLY',
    conversationId: 'conversation-12',
    messageId: 'message-34',
    title: '客户回复',
    body: '客户：还在吗？',
    conversationUnreadCount: 3,
  };
  let request;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(null, { status: 201 });
  };

  try {
    const context = await createVapidSigningContext(await createConfig());
    await sendPayloadPush(
      'https://push.example.test/message-34',
      context,
      {
        p256dh: Buffer.from(clientPublic).toString('base64url'),
        auth: Buffer.from(authSecret).toString('base64url'),
      },
      notification,
      { ttlSeconds: 86_400 },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(request.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(
    request.init.headers['Content-Type'],
    'application/octet-stream',
  );
  assert.equal(request.init.headers.TTL, '86400');
  assert.equal(request.init.headers.Topic, undefined);

  const record = new Uint8Array(request.init.body);
  const salt = record.slice(0, 16);
  assert.equal(new DataView(record.buffer).getUint32(16), 4096);
  const serverKeyLength = record[20];
  const serverPublic = record.slice(21, 21 + serverKeyLength);
  const ciphertext = record.slice(21 + serverKeyLength);
  const serverKey = await crypto.subtle.importKey(
    'raw',
    serverPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: serverKey },
      clientKeys.privateKey,
      256,
    ),
  );
  const inputKeyMaterial = await hkdf(
    sharedSecret,
    authSecret,
    concatBytes(
      new TextEncoder().encode('WebPush: info\0'),
      clientPublic,
      serverPublic,
    ),
    32,
  );
  const contentEncryptionKey = await hkdf(
    inputKeyMaterial,
    salt,
    new TextEncoder().encode('Content-Encoding: aes128gcm\0'),
    16,
  );
  const nonce = await hkdf(
    inputKeyMaterial,
    salt,
    new TextEncoder().encode('Content-Encoding: nonce\0'),
    12,
  );
  const aesKey = await crypto.subtle.importKey(
    'raw',
    contentEncryptionKey,
    'AES-GCM',
    false,
    ['decrypt'],
  );
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesKey,
      ciphertext,
    ),
  );
  assert.equal(plaintext.at(-1), 2);
  assert.deepEqual(
    JSON.parse(new TextDecoder().decode(plaintext.slice(0, -1))),
    notification,
  );
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
