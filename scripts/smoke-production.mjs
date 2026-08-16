import assert from 'node:assert/strict';

const baseUrl = process.env.BASE_URL?.replace(/\/$/u, '');

if (!baseUrl) {
  throw new Error('BASE_URL is required.');
}

function endpoint(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readJson(response) {
  const contentType = response.headers.get('content-type') ?? '';
  assert.ok(
    contentType.includes('application/json'),
    `${response.url} did not return JSON (${contentType || 'no content-type'}).`,
  );
  return response.json();
}

async function waitForHealth() {
  let lastError;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const response = await fetch(endpoint('/api/health'), {
        headers: { Accept: 'application/json' },
      });
      assert.equal(
        response.status,
        200,
        'Health endpoint must return HTTP 200.',
      );
      const value = await readJson(response);
      assert.equal(value.ok, true);
      assert.equal(value.service, 'customer-service');
      console.log(`HEALTH=ready attempt=${attempt}`);
      return value;
    } catch (error) {
      lastError = error;
      if (attempt < 20) await sleep(3_000);
    }
  }
  throw lastError ?? new Error('Production health check failed.');
}

async function waitForIntegrationProtocol() {
  let lastError;
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      const statusResponse = await fetch(endpoint('/integration/v1/status'), {
        headers: { Accept: 'application/json' },
      });
      assert.equal(
        statusResponse.status,
        200,
        `Integration status endpoint returned HTTP ${statusResponse.status}.`,
      );
      const status = await readJson(statusResponse);
      assert.equal(status.ok, true);
      assert.equal(status.protocolVersion, 'v1');

      const verifyResponse = await fetch(endpoint('/integration/v1/verify'), {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      assert.equal(
        verifyResponse.status,
        401,
        `Integration verification token is not active; expected HTTP 401, got ${verifyResponse.status}.`,
      );
      console.log(`INTEGRATION_ROLLOUT=ready attempt=${attempt}`);
      console.log('INTEGRATION_API=ready_auth_required');
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 20) await sleep(3_000);
    }
  }
  throw lastError ?? new Error('Integration protocol rollout check failed.');
}

async function assertRemovedLegacyProtocols() {
  const checks = [
    ['/api/public/sites/pk_default', 'legacy public site API'],
    ['/management/v1/groups', 'legacy management API'],
  ];

  for (const [path, label] of checks) {
    const response = await fetch(endpoint(path), {
      headers: { Accept: 'application/json' },
    });
    assert.equal(
      response.status,
      404,
      `${label} must remain unavailable; got HTTP ${response.status}.`,
    );
  }

  const conversationResponse = await fetch(
    endpoint('/api/public/conversations'),
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        siteKey: 'pk_default',
        message: 'legacy protocol smoke probe',
      }),
    },
  );
  assert.equal(
    conversationResponse.status,
    404,
    `legacy public conversation API must remain unavailable; got HTTP ${conversationResponse.status}.`,
  );
  console.log('LEGACY_PROTOCOLS=removed');
}

async function assertBrowserCors() {
  const response = await fetch(endpoint('/client/v1/conversations'), {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://storefront-smoke.invalid',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.ok(
    response.status >= 200 && response.status < 300,
    `CORS preflight returned HTTP ${response.status}.`,
  );
  assert.equal(
    response.headers.get('access-control-allow-origin'),
    '*',
    'Client API must allow cross-origin Storefront requests.',
  );
  console.log('CLIENT_CORS=ready');
}

async function assertClientRest() {
  const url = new URL(endpoint('/client/v1/conversations'));
  url.searchParams.set('visitorId', 'SMK123');

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  assert.equal(
    response.status,
    200,
    `Client conversations endpoint returned HTTP ${response.status}.`,
  );
  const value = await readJson(response);
  assert.ok(
    Array.isArray(value.conversations),
    'Client response must contain conversations.',
  );
  console.log('CLIENT_REST=ready');
}

async function assertClientWebSocket() {
  const url = new URL(endpoint('/client/v1/realtime'));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('visitorId', 'SMK123');

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await connectClientWebSocket(url);
      console.log(`CLIENT_WEBSOCKET=ready attempt=${attempt}`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 1_500);
    }
  }
  throw lastError ?? new Error('Client WebSocket smoke check failed.');
}

async function connectClientWebSocket(url) {
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    let ready = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      callback();
    };
    const timeout = setTimeout(
      () =>
        finish(() =>
          reject(
            new Error(
              'Client WebSocket did not complete ready/pong within 10 seconds.',
            ),
          ),
        ),
      10_000,
    );

    socket.addEventListener('message', (event) => {
      try {
        const value = JSON.parse(String(event.data));
        if (value?.type === 'ready' && !ready) {
          ready = true;
          socket.send('ping');
          return;
        }
        if (ready && value?.type === 'pong') finish(resolve);
      } catch {
        // Ignore non-JSON frames and keep waiting for the protocol events.
      }
    });
    socket.addEventListener('error', () =>
      finish(() => reject(new Error('Client WebSocket connection failed.'))),
    );
  });
}

const health = await waitForHealth();
await waitForIntegrationProtocol();
await assertRemovedLegacyProtocols();
await assertBrowserCors();
await assertClientRest();
await assertClientWebSocket();

console.log(
  `PROTOCOL_SMOKE=ready version=${health.version ?? 'unknown'} base=${baseUrl}`,
);
