import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, createHmac } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';
const workerDirectory = fileURLToPath(
  new URL('../src/worker/', import.meta.url),
);
const sharedDirectory = fileURLToPath(
  new URL('../src/shared/', import.meta.url),
);
const moduleShims = [];
for (const directory of [workerDirectory, sharedDirectory]) {
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue;
    const shimPath = join(directory, name.slice(0, -3));
    if (existsSync(shimPath)) continue;
    symlinkSync(name, shimPath);
    moduleShims.push(shimPath);
  }
}

let adminConfigApi;
let agentApi;
let clientApi;
let mediaApi;
let hashAgentPassword;
try {
  [
    { adminConfigApi },
    { agentApi },
    { clientApi },
    { mediaApi },
    { hashAgentPassword },
  ] = await Promise.all([
    import('../src/worker/admin-config-api.ts'),
    import('../src/worker/agent-api.ts'),
    import('../src/worker/client-api.ts'),
    import('../src/worker/media-api.ts'),
    import('../src/worker/agent-password.ts'),
  ]);
} finally {
  for (const shimPath of moduleShims) unlinkSync(shimPath);
}

function applyMigrations(database) {
  const directory = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const name of readdirSync(directory)
    .filter((value) => /^\d+.*\.sql$/u.test(value))
    .sort()) {
    database.exec(readFileSync(`${directory}/${name}`, 'utf8'));
  }
}

function d1(database) {
  function statement(sql) {
    let bindings = [];
    return {
      bind(...values) {
        bindings = values;
        return this;
      },
      async first(column) {
        const row = database.prepare(sql).get(...bindings) ?? null;
        if (column === undefined || row === null) return row;
        return row[column] ?? null;
      },
      async all() {
        return { results: database.prepare(sql).all(...bindings) };
      },
      async run() {
        const result = database.prepare(sql).run(...bindings);
        return { meta: { changes: Number(result.changes) } };
      },
    };
  }

  return {
    prepare: statement,
    async batch(statements) {
      const results = [];
      database.exec('BEGIN');
      try {
        for (const item of statements) results.push(await item.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function fakeRooms() {
  const events = new Map();
  return {
    events,
    namespace: {
      idFromName(name) {
        return name;
      },
      get(name) {
        return {
          async fetch(_input, init) {
            const payload = JSON.parse(String(init?.body ?? '{}'));
            const current = events.get(name) ?? [];
            current.push(payload);
            events.set(name, current);
            return { status: 204 };
          },
        };
      },
    },
  };
}

function fakeMediaBucket() {
  const objects = new Map();
  return {
    objects,
    bucket: {
      async put(key, body, options) {
        const bytes = Buffer.from(
          await new globalThis.Response(body).arrayBuffer(),
        );
        objects.set(key, {
          bytes,
          contentType: options?.httpMetadata?.contentType ?? null,
        });
      },
      async head(key) {
        const object = objects.get(key);
        if (!object) return null;
        return {
          size: object.bytes.length,
          httpMetadata: { contentType: object.contentType },
        };
      },
      async get(key) {
        const object = objects.get(key);
        if (!object) return null;
        return {
          size: object.bytes.length,
          httpEtag: 'test-etag',
          httpMetadata: { contentType: object.contentType },
          body: object.bytes,
        };
      },
      async delete(keyOrKeys) {
        for (const key of Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys]) {
          objects.delete(key);
        }
      },
    },
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function adminCookie(password) {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString('base64url');
  const signature = createHmac('sha256', password)
    .update(payload)
    .digest('base64url');
  return `cs_session=${payload}.${signature}`;
}

test('admin can save multiple whole-section routing rules in one request', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  database.exec(`
    INSERT INTO product_catalog (
      site_id, id, title, section_id, section_name, is_enabled
    ) VALUES
      ('default', 'product-west', 'West product', 'west', 'West', 1),
      ('default', 'product-east', 'East product', 'east', 'East', 1);
  `);

  const adminPassword = 'admin-password';
  const response = await adminConfigApi.request(
    '/api/admin/agents',
    {
      method: 'POST',
      headers: {
        cookie: adminCookie(adminPassword),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Multi Section Agent',
        username: 'multi-section',
        password: 'pass',
        routingScope: { type: 'section', sectionIds: ['west', 'east'] },
        dailyConversationLimit: 0,
        trafficQuotaEnabled: true,
        trafficQuotaTopUp: 100,
        trafficQuotaRequestId: 'quota-create-request-001',
        isEnabled: true,
      }),
    },
    {
      DB: d1(database),
      CONVERSATION_ROOMS: fakeRooms().namespace,
      ADMIN_PASSWORD: adminPassword,
    },
  );
  const created = await json(response);

  assert.equal(response.status, 201);
  assert.deepEqual(
    database
      .prepare(
        `SELECT section_id
         FROM agent_routing_scopes
         WHERE agent_id = ? AND scope_type = 'section'
         ORDER BY section_id`,
      )
      .all(created.id)
      .map((row) => row.section_id),
    ['east', 'west'],
  );
  const topUpResponse = await adminConfigApi.request(
    `/api/admin/agents/${encodeURIComponent(created.id)}`,
    {
      method: 'PATCH',
      headers: {
        cookie: adminCookie(adminPassword),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        trafficQuotaTopUp: 50,
        trafficQuotaRequestId: 'quota-topup-request-001',
      }),
    },
    {
      DB: d1(database),
      CONVERSATION_ROOMS: fakeRooms().namespace,
      ADMIN_PASSWORD: adminPassword,
    },
  );
  assert.equal(topUpResponse.status, 200);
  const quota = database
    .prepare(
      `SELECT traffic_quota_enabled AS enabled,
         traffic_quota_total AS total, traffic_quota_used AS used
       FROM agents WHERE id = ?`,
    )
    .get(created.id);
  assert.equal(quota.enabled, 1);
  assert.equal(quota.total, 150);
  assert.equal(quota.used, 0);

  const duplicateTopUpResponse = await adminConfigApi.request(
    `/api/admin/agents/${encodeURIComponent(created.id)}`,
    {
      method: 'PATCH',
      headers: {
        cookie: adminCookie(adminPassword),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        trafficQuotaTopUp: 50,
        trafficQuotaRequestId: 'quota-topup-request-001',
      }),
    },
    {
      DB: d1(database),
      CONVERSATION_ROOMS: fakeRooms().namespace,
      ADMIN_PASSWORD: adminPassword,
    },
  );
  assert.equal(duplicateTopUpResponse.status, 200);
  assert.equal(
    database
      .prepare('SELECT traffic_quota_total FROM agents WHERE id = ?')
      .get(created.id).traffic_quota_total,
    150,
  );

  const conflictingTopUpResponse = await adminConfigApi.request(
    `/api/admin/agents/${encodeURIComponent(created.id)}`,
    {
      method: 'PATCH',
      headers: {
        cookie: adminCookie(adminPassword),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        trafficQuotaTopUp: 60,
        trafficQuotaRequestId: 'quota-topup-request-001',
      }),
    },
    {
      DB: d1(database),
      CONVERSATION_ROOMS: fakeRooms().namespace,
      ADMIN_PASSWORD: adminPassword,
    },
  );
  assert.equal(conflictingTopUpResponse.status, 409);
  assert.equal(
    (await conflictingTopUpResponse.json()).error,
    'QUOTA_REQUEST_CONFLICT',
  );

  const historyResponse = await adminConfigApi.request(
    `/api/admin/agents/${encodeURIComponent(created.id)}/quota-adjustments`,
    {
      headers: { cookie: adminCookie(adminPassword) },
    },
    {
      DB: d1(database),
      CONVERSATION_ROOMS: fakeRooms().namespace,
      ADMIN_PASSWORD: adminPassword,
    },
  );
  const history = await json(historyResponse);
  assert.deepEqual(
    history.adjustments
      .map((adjustment) => adjustment.amount)
      .sort((a, b) => a - b),
    [50, 100],
  );

  database.exec(`
    UPDATE agents
    SET status = 'online',
        last_seen_at = CURRENT_TIMESTAMP,
        traffic_quota_used = traffic_quota_total
    WHERE id = '${created.id}';
  `);
  const restoredQuotaResponse = await adminConfigApi.request(
    `/api/admin/agents/${encodeURIComponent(created.id)}`,
    {
      method: 'PATCH',
      headers: {
        cookie: adminCookie(adminPassword),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        trafficQuotaTopUp: 1,
        trafficQuotaRequestId: 'quota-restore-request-001',
      }),
    },
    {
      DB: d1(database),
      CONVERSATION_ROOMS: fakeRooms().namespace,
      ADMIN_PASSWORD: adminPassword,
    },
  );
  const restoredQuota = await json(restoredQuotaResponse);
  assert.equal(restoredQuota.quotaApplied, true);
  const restoredAgentQuota = database
    .prepare(
      `SELECT traffic_quota_total AS total, traffic_quota_used AS used
       FROM agents WHERE id = ?`,
    )
    .get(created.id);
  assert.equal(restoredAgentQuota.total, 151);
  assert.equal(restoredAgentQuota.used, 150);
  database.close();
});

test('admin can save and update a private agent marker', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const adminPassword = 'admin-password';
  const env = {
    DB: d1(database),
    CONVERSATION_ROOMS: fakeRooms().namespace,
    ADMIN_PASSWORD: adminPassword,
  };
  const headers = {
    cookie: adminCookie(adminPassword),
    'content-type': 'application/json',
  };

  const createResponse = await adminConfigApi.request(
    '/api/admin/agents',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Numbered Agent',
        adminLabel: ' 1号 ',
        username: 'numbered-agent',
        password: 'pass',
        routingScope: { type: 'none' },
        dailyConversationLimit: 0,
        trafficQuotaEnabled: false,
        trafficQuotaTopUp: 0,
        isEnabled: true,
      }),
    },
    env,
  );
  const created = await json(createResponse);

  const bootstrapResponse = await adminConfigApi.request(
    '/api/admin/bootstrap',
    { headers },
    env,
  );
  const bootstrap = await json(bootstrapResponse);
  assert.equal(
    bootstrap.agents.find((agent) => agent.id === created.id).adminLabel,
    '1号',
  );

  const updateResponse = await adminConfigApi.request(
    `/api/admin/agents/${encodeURIComponent(created.id)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ adminLabel: '2号' }),
    },
    env,
  );
  assert.equal(updateResponse.status, 200);
  assert.equal(
    database
      .prepare('SELECT admin_label FROM agents WHERE id = ?')
      .get(created.id).admin_label,
    '2号',
  );

  const loginResponse = await agentApi.request(
    '/api/agent/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'numbered-agent', password: 'pass' }),
    },
    env,
  );
  const login = await json(loginResponse);
  assert.equal(login.agent.name, 'Numbered Agent');
  assert.equal(login.agent.username, 'numbered-agent');
  assert.ok(!Object.hasOwn(login.agent, 'adminLabel'));

  const invalidResponse = await adminConfigApi.request(
    `/api/admin/agents/${encodeURIComponent(created.id)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ adminLabel: '12345678901' }),
    },
    env,
  );
  assert.equal(invalidResponse.status, 400);
  assert.equal((await invalidResponse.json()).error, 'INVALID_AGENT_LABEL');
  database.close();
});

async function json(response, { allowError = false } = {}) {
  const value = await response.json();
  if (!allowError) {
    assert.ok(response.ok, `${response.status}: ${JSON.stringify(value)}`);
  }
  return value;
}

test('isolated client -> routing -> agent -> client flow works through real Hono handlers', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const db = d1(database);
  const rooms = fakeRooms();
  const media = fakeMediaBucket();
  const env = {
    DB: db,
    MEDIA: media.bucket,
    CONVERSATION_ROOMS: rooms.namespace,
    ADMIN_PASSWORD: 'admin-password',
  };

  const token = 'agent-session-e2e';
  const agentPassword = 'agent-e2e-password';
  const agentCredentials = await hashAgentPassword(agentPassword, 1_000);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         password_iterations, status, is_enabled, last_seen_at
       ) VALUES (?, 'default', ?, ?, ?, ?, ?, 'online', 1, CURRENT_TIMESTAMP)`,
    )
    .run(
      'agent-e2e',
      'Agent E2E',
      'agent-e2e',
      agentCredentials.hash,
      agentCredentials.salt,
      agentCredentials.iterations,
    );
  database
    .prepare(
      `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run('session-e2e', 'agent-e2e', sha256(token), expiresAt);
  database
    .prepare(
      `INSERT INTO agent_routing_scopes (
         site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
       ) VALUES ('default', 'agent-e2e', 'section', 'west', '', '', 1)`,
    )
    .run();

  const visitorId = 'TST123';
  const sourceHandoffId = '018f47c2-6c72-4d8a-9f11-4b0db21c7358';
  const createResponse = await clientApi.request(
    '/client/v1/conversations',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitorId,
        sourceHandoffId,
        clientMessageId: 'client-message-e2e-1',
        message: 'Hello from visitor',
        product: {
          id: 'product-e2e',
          sectionId: 'west',
          sectionName: 'West',
          categoryId: 'massage',
          categoryName: 'Massage',
          title: 'Product E2E',
          href: '/sections/west/products/product-e2e/',
          coverUrl: null,
        },
      }),
    },
    env,
  );
  const created = await json(createResponse);
  assert.equal(createResponse.status, 201);
  const conversationId = created.conversation.id;
  assert.ok(conversationId);
  assert.equal(created.conversation.agentName, 'Agent E2E');
  assert.equal(created.conversation.status, 'active');
  assert.equal(created.conversation.messages.length, 1);
  assert.equal(created.conversation.messages[0].direction, 'customer');

  const duplicateHandoffResponse = await clientApi.request(
    '/client/v1/conversations',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitorId,
        sourceHandoffId,
        clientMessageId: 'client-message-e2e-duplicate',
        message: 'This duplicate handoff must not create traffic',
        product: {
          id: 'product-e2e',
          sectionId: 'west',
          sectionName: 'West',
          categoryId: 'massage',
          categoryName: 'Massage',
          title: 'Product E2E',
          href: '/sections/west/products/product-e2e/',
          coverUrl: null,
        },
      }),
    },
    env,
  );
  assert.equal(duplicateHandoffResponse.status, 200);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM conversations
         WHERE source_handoff_id = ?`,
      )
      .get(sourceHandoffId).count,
    1,
  );

  const assigned = database
    .prepare(
      `SELECT assigned_agent, status, section_id, category_id, source_handoff_id
       FROM conversations WHERE id = ?`,
    )
    .get(conversationId);
  assert.equal(assigned.assigned_agent, 'agent-e2e');
  assert.equal(assigned.status, 'pending');
  assert.equal(assigned.section_id, 'west');
  assert.equal(assigned.category_id, 'massage');
  assert.equal(assigned.source_handoff_id, sourceHandoffId);
  const trafficReceipt = database
    .prepare(
      `SELECT source_handoff_id, product_id, product_title, business_date
       FROM agent_traffic_receipts
       WHERE conversation_id = ?`,
    )
    .get(conversationId);
  assert.equal(trafficReceipt.source_handoff_id, sourceHandoffId);
  assert.equal(trafficReceipt.product_id, 'product-e2e');
  assert.equal(trafficReceipt.product_title, 'Product E2E');

  const conversationTrafficReceipt = database
    .prepare(
      `SELECT product_id, product_title, agent_id, agent_name, business_date
       FROM conversation_traffic_receipts
       WHERE conversation_id = ?`,
    )
    .get(conversationId);
  assert.equal(conversationTrafficReceipt.product_id, 'product-e2e');
  assert.equal(conversationTrafficReceipt.product_title, 'Product E2E');
  assert.equal(conversationTrafficReceipt.agent_id, 'agent-e2e');
  assert.equal(conversationTrafficReceipt.agent_name, 'Agent E2E');

  const statisticsMonth = trafficReceipt.business_date.slice(0, 7);
  const trafficStatsResponse = await adminConfigApi.request(
    `/api/admin/traffic-stats?from=${conversationTrafficReceipt.business_date}&to=${conversationTrafficReceipt.business_date}`,
    { headers: { cookie: adminCookie('admin-password') } },
    env,
  );
  assert.equal(trafficStatsResponse.status, 200);
  const trafficStats = await json(trafficStatsResponse);
  assert.equal(trafficStats.total, 1);
  assert.deepEqual(trafficStats.agents, [
    { agentId: 'agent-e2e', agentName: 'Agent E2E', count: 1 },
  ]);
  assert.deepEqual(trafficStats.products, [
    {
      productId: 'product-e2e',
      productTitle: 'Product E2E',
      count: 1,
    },
  ]);

  const agentStatsResponse = await adminConfigApi.request(
    `/api/admin/agent-stats?month=${statisticsMonth}&agentId=agent-e2e`,
    { headers: { cookie: adminCookie('admin-password') } },
    env,
  );
  assert.equal(agentStatsResponse.status, 200);
  const agentStats = await json(agentStatsResponse);
  assert.deepEqual(agentStats.counts, [
    { day: Number(trafficReceipt.business_date.slice(-2)), count: 1 },
  ]);

  const cookie = `cs_agent_session=${token}`;
  const inboxResponse = await agentApi.request(
    '/api/agent/conversations',
    { headers: { cookie } },
    env,
  );
  const inbox = await json(inboxResponse);
  assert.equal(inbox.conversations.length, 1);
  assert.equal(inbox.conversations[0].id, conversationId);
  assert.equal(inbox.conversations[0].assigned_agent, 'agent-e2e');

  const replyResponse = await agentApi.request(
    `/api/agent/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Hello from agent',
        clientMessageId: 'agent-message-e2e-1',
      }),
    },
    env,
  );
  assert.equal(replyResponse.status, 201);
  const reply = await json(replyResponse);
  assert.equal(reply.message.sender_type, 'agent');
  assert.equal(reply.message.body, 'Hello from agent');

  const retryResponse = await agentApi.request(
    `/api/agent/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        body: 'Hello from agent',
        clientMessageId: 'agent-message-e2e-1',
      }),
    },
    env,
  );
  assert.equal(retryResponse.status, 200);
  const retried = await json(retryResponse);
  assert.equal(retried.message.id, reply.message.id);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM messages
         WHERE conversation_id = ? AND client_message_id = ?`,
      )
      .get(conversationId, 'agent-message-e2e-1').count,
    1,
  );

  const uploadId = 'agent-image-e2e-1';
  const imageInitBody = JSON.stringify({
    mimeType: 'image/png',
    byteSize: 4,
    width: 1,
    height: 1,
    originalName: 'test.png',
    clientUploadId: uploadId,
  });
  const firstInitResponse = await mediaApi.request(
    `/api/agent/conversations/${encodeURIComponent(conversationId)}/media/init`,
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: imageInitBody,
    },
    env,
  );
  assert.equal(firstInitResponse.status, 201);
  const firstInit = await json(firstInitResponse);
  const retryInitResponse = await mediaApi.request(
    `/api/agent/conversations/${encodeURIComponent(conversationId)}/media/init`,
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: imageInitBody,
    },
    env,
  );
  assert.equal(retryInitResponse.status, 200);
  const retryInit = await json(retryInitResponse);
  assert.equal(retryInit.media.id, firstInit.media.id);
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM media_items WHERE client_upload_id = ?',
      )
      .get(uploadId).count,
    1,
  );

  const uploadPath = new URL(firstInit.upload.url).pathname;
  const uploadResponse = await mediaApi.request(
    uploadPath,
    {
      method: 'PUT',
      headers: { cookie, 'content-type': 'image/png' },
      body: new Uint8Array([1, 2, 3, 4]),
    },
    env,
  );
  await json(uploadResponse);
  const completePath = `/api/agent/media/${encodeURIComponent(firstInit.media.id)}/complete`;
  const firstComplete = await json(
    await mediaApi.request(
      completePath,
      { method: 'POST', headers: { cookie }, body: '{}' },
      env,
    ),
  );
  const retryComplete = await json(
    await mediaApi.request(
      completePath,
      { method: 'POST', headers: { cookie }, body: '{}' },
      env,
    ),
  );
  assert.equal(retryComplete.messageId, firstComplete.messageId);
  assert.equal(firstComplete.duplicate, false);
  assert.equal(retryComplete.duplicate, true);
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count FROM messages
         WHERE conversation_id = ? AND kind = 'image'`,
      )
      .get(conversationId).count,
    1,
  );

  const completedInit = await json(
    await mediaApi.request(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/media/init`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: imageInitBody,
      },
      env,
    ),
  );
  assert.equal(completedInit.completed.messageId, firstComplete.messageId);

  for (let index = 0; index < 3; index += 1) {
    const pending = await mediaApi.request(
      `/api/agent/conversations/${encodeURIComponent(conversationId)}/media/init`,
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          mimeType: 'image/png',
          byteSize: 4,
          width: 1,
          height: 1,
          originalName: `pending-${index}.png`,
          clientUploadId: `pending-agent-image-${index}`,
        }),
      },
      env,
    );
    assert.equal(pending.status, 201);
  }
  const excessPending = await mediaApi.request(
    `/api/agent/conversations/${encodeURIComponent(conversationId)}/media/init`,
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        mimeType: 'image/png',
        byteSize: 4,
        width: 1,
        height: 1,
        originalName: 'pending-excess.png',
        clientUploadId: 'pending-agent-image-excess',
      }),
    },
    env,
  );
  assert.equal(excessPending.status, 429);
  assert.deepEqual(await excessPending.json(), {
    error: 'MEDIA_RESERVATION_LIMIT_REACHED',
  });

  const deltaResponse = await agentApi.request(
    `/api/agent/conversations/${encodeURIComponent(conversationId)}/messages?afterId=${encodeURIComponent(created.conversation.messages[0].id)}&afterCreatedAt=${encodeURIComponent(created.conversation.messages[0].sentAt)}`,
    { headers: { cookie } },
    env,
  );
  const delta = await json(deltaResponse);
  assert.deepEqual(
    delta.messages.map((item) => item.id),
    [reply.message.id, firstComplete.messageId],
  );
  assert.equal(delta.media.length, 1);
  assert.equal(delta.media[0].messageId, firstComplete.messageId);

  const clientDetailResponse = await clientApi.request(
    `/client/v1/conversations/${encodeURIComponent(conversationId)}?visitorId=${encodeURIComponent(visitorId)}`,
    undefined,
    env,
  );
  const clientDetail = await json(clientDetailResponse);
  assert.equal(clientDetail.conversation.messages.length, 3);
  assert.equal(
    clientDetail.conversation.messages[0].body,
    'Hello from visitor',
  );
  assert.equal(clientDetail.conversation.messages[1].body, 'Hello from agent');
  assert.equal(clientDetail.conversation.messages[1].direction, 'agent');
  assert.equal(clientDetail.conversation.messages[2].direction, 'agent');

  const visitorEvents = rooms.events.get(`client:default:${visitorId}`) ?? [];
  assert.ok(
    visitorEvents.some(
      (event) =>
        event.type === 'message.created' &&
        event.conversationId === conversationId &&
        event.message?.body === 'Hello from agent',
    ),
  );
  const inboxEvents = rooms.events.get('agent-inbox:agent-e2e') ?? [];
  assert.ok(
    inboxEvents.some(
      (event) =>
        event.type === 'conversation.changed' &&
        event.conversation?.id === conversationId,
    ),
  );
  assert.equal(rooms.events.has('admin-inbox'), false);

  const paused = await json(
    await agentApi.request(
      '/api/agent/auth/status',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'busy' }),
      },
      env,
    ),
  );
  assert.equal(paused.availability, 'busy');
  const heartbeatResult = await json(
    await agentApi.request(
      '/api/agent/auth/heartbeat',
      { method: 'POST', headers: { cookie } },
      env,
    ),
  );
  assert.equal(heartbeatResult.availability, 'busy');
  assert.equal(
    database.prepare('SELECT status FROM agents WHERE id = ?').get('agent-e2e')
      .status,
    'busy',
  );
  const resumed = await json(
    await agentApi.request(
      '/api/agent/auth/status',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'online' }),
      },
      env,
    ),
  );
  assert.equal(resumed.availability, 'online');

  database
    .prepare(
      `INSERT INTO agents (
         id, site_id, name, username, password_hash, password_salt,
         status, is_enabled, last_seen_at
       ) VALUES (?, 'default', ?, ?, ?, ?, 'online', 1, CURRENT_TIMESTAMP)`,
    )
    .run('agent-standby', 'Agent Standby', 'agent-standby', 'hash', 'salt');
  database
    .prepare(
      `INSERT INTO agent_routing_scopes (
         site_id, agent_id, scope_type, section_id, category_id, product_id, is_enabled
       ) VALUES ('default', 'agent-standby', 'section', 'west', '', '', 1)`,
    )
    .run();

  const adminPassword = 'admin-password';
  const disableResponse = await adminConfigApi.request(
    '/api/admin/agents/agent-e2e',
    {
      method: 'PATCH',
      headers: {
        cookie: adminCookie(adminPassword),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ isEnabled: false }),
    },
    { ...env, ADMIN_PASSWORD: adminPassword },
  );
  await json(disableResponse);

  const disabledAgent = database
    .prepare('SELECT status, is_enabled FROM agents WHERE id = ?')
    .get('agent-e2e');
  assert.equal(disabledAgent.status, 'online');
  assert.equal(disabledAgent.is_enabled, 0);
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM agent_sessions WHERE agent_id = ?',
      )
      .get('agent-e2e').count,
    1,
  );
  assert.equal(
    database
      .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
      .get(conversationId).assigned_agent,
    'agent-e2e',
  );
  const disabledStatus = await json(
    await agentApi.request(
      '/api/agent/auth/status',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'busy' }),
      },
      env,
    ),
  );
  assert.equal(disabledStatus.availability, 'busy');

  const disabledLoginResponse = await agentApi.request(
    '/api/agent/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'agent-e2e', password: agentPassword }),
    },
    env,
  );
  const disabledLogin = await json(disabledLoginResponse);
  assert.equal(disabledLogin.agent.status, 'online');
  const disabledCookie =
    disabledLoginResponse.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  assert.ok(disabledCookie.startsWith('cs_agent_session='));
  const disabledSession = await json(
    await agentApi.request(
      '/api/agent/auth/session',
      { headers: { cookie: disabledCookie } },
      env,
    ),
  );
  assert.equal(disabledSession.authenticated, true);

  const postDisableConversation = await json(
    await clientApi.request(
      '/client/v1/conversations',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          visitorId: 'NEW456',
          sourceHandoffId: '018f47c2-6c72-4d8a-9f11-4b0db21c7999',
          clientMessageId: 'client-message-after-disable',
          message: 'Route only to an enabled online seat',
          product: {
            id: 'product-after-disable',
            sectionId: 'west',
            sectionName: 'West',
            categoryId: 'massage',
            categoryName: 'Massage',
            title: 'Product After Disable',
            href: '/sections/west/products/product-after-disable/',
            coverUrl: null,
          },
        }),
      },
      env,
    ),
  );
  assert.equal(postDisableConversation.conversation.agentName, 'Agent Standby');

  database.close();
});

test('consultation quota commercial lifecycle remains consistent end to end', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const adminPassword = 'admin-password';
  const rooms = fakeRooms();
  const env = {
    DB: d1(database),
    CONVERSATION_ROOMS: rooms.namespace,
    ADMIN_PASSWORD: adminPassword,
  };
  const executionCtx = {
    waitUntil() {},
    passThroughOnException() {},
  };

  database.exec(`
  INSERT INTO product_catalog (
    site_id, id, title, section_id, section_name, category_id,
    category_name, is_enabled
  ) VALUES
    ('default', 'quota-product-west', 'Quota West', 'west', 'West',
     'quota-test', 'Quota test', 1),
    ('default', 'quota-product-east', 'Quota East', 'east', 'East',
     'quota-test', 'Quota test', 1);
`);

  async function createSeat({
    name,
    username,
    sectionIds,
    quota,
    dailyLimit,
    requestId,
  }) {
    const response = await adminConfigApi.request(
      '/api/admin/agents',
      {
        method: 'POST',
        headers: {
          cookie: adminCookie(adminPassword),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name,
          username,
          password: 'pass',
          routingScope: { type: 'section', sectionIds },
          dailyConversationLimit: dailyLimit,
          trafficQuotaEnabled: true,
          trafficQuotaTopUp: quota,
          trafficQuotaRequestId: requestId,
          isEnabled: true,
        }),
      },
      env,
    );
    const created = await json(response);
    return created.id;
  }

  const agentA = await createSeat({
    name: 'Quota Agent A',
    username: 'quota-agent-a',
    sectionIds: ['west'],
    quota: 2,
    dailyLimit: 3,
    requestId: 'quota-final-create-a',
  });
  const agentB = await createSeat({
    name: 'Quota Agent B',
    username: 'quota-agent-b',
    sectionIds: ['east', 'west'],
    quota: 1,
    dailyLimit: 1,
    requestId: 'quota-final-create-b',
  });

  const tokenA = 'quota-final-session-a';
  const tokenB = 'quota-final-session-b';
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  database
    .prepare(
      `UPDATE agents
       SET status = 'online', last_seen_at = CURRENT_TIMESTAMP
       WHERE id IN (?, ?)`,
    )
    .run(agentA, agentB);
  database
    .prepare(
      `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?), (?, ?, ?, ?)`,
    )
    .run(
      'quota-final-session-row-a',
      agentA,
      sha256(tokenA),
      expiresAt,
      'quota-final-session-row-b',
      agentB,
      sha256(tokenB),
      expiresAt,
    );

  let handoffIndex = 0;
  async function createConversation(sectionId) {
    handoffIndex += 1;
    const visitorId = `QTA00${handoffIndex}`;
    const response = await clientApi.request(
      '/client/v1/conversations',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          visitorId,
          sourceHandoffId: `00000000-0000-4000-8000-${String(handoffIndex).padStart(12, '0')}`,
          clientMessageId: `quota-final-message-${handoffIndex}`,
          message: `Quota acceptance ${handoffIndex}`,
          product: {
            id: `quota-final-product-${sectionId}-${handoffIndex}`,
            sectionId,
            sectionName: sectionId,
            categoryId: 'quota-test',
            categoryName: 'Quota test',
            title: `Quota ${sectionId} ${handoffIndex}`,
            href: `/quota/${sectionId}/${handoffIndex}`,
            coverUrl: null,
          },
        }),
      },
      env,
    );
    const payload = await json(response, { allowError: true });
    return response.ok ? payload : { response, ...payload };
  }

  const east = await createConversation('east');
  const eastId = east.conversation.id;
  assert.equal(
    database
      .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
      .get(eastId).assigned_agent,
    agentB,
  );
  assert.deepEqual(
    database
      .prepare(
        `SELECT traffic_quota_total AS total,
           traffic_quota_used AS used
         FROM agents WHERE id = ?`,
      )
      .get(agentB),
    Object.assign(Object.create(null), { total: 1, used: 1 }),
  );

  const westOne = await createConversation('west');
  const westTwo = await createConversation('west');
  const westThree = await createConversation('west');
  const westOneId = westOne.conversation.id;
  const westTwoId = westTwo.conversation.id;
  assert.equal(
    database
      .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
      .get(westOneId).assigned_agent,
    agentA,
  );
  assert.equal(
    database
      .prepare('SELECT assigned_agent FROM conversations WHERE id = ?')
      .get(westTwoId).assigned_agent,
    agentA,
  );
  assert.equal(westThree.response.status, 503);
  assert.equal(westThree.error.code, 'NO_AGENT_AVAILABLE');
  assert.equal(
    database
      .prepare(
        `SELECT COUNT(*) AS count
         FROM conversations
         WHERE visitor_id IN (
           SELECT id FROM visitors WHERE external_id = ?
         )`,
      )
      .get('QTA004').count,
    0,
    'fresh traffic must not create a waiting conversation when no seat is eligible',
  );
  assert.deepEqual(
    database
      .prepare(
        `SELECT traffic_quota_total AS total,
           traffic_quota_used AS used
         FROM agents WHERE id = ?`,
      )
      .get(agentA),
    Object.assign(Object.create(null), { total: 2, used: 2 }),
  );

  const beforeDisableB = database
    .prepare(
      `SELECT a.traffic_quota_used AS used,
         COALESCE(SUM(s.conversation_count), 0) AS daily
       FROM agents a
       LEFT JOIN agent_daily_stats s ON s.agent_id = a.id
       WHERE a.id = ?
       GROUP BY a.id`,
    )
    .get(agentB);
  const topUpResponse = await adminConfigApi.request(
    `/api/admin/agents/${encodeURIComponent(agentA)}`,
    {
      method: 'PATCH',
      headers: {
        cookie: adminCookie(adminPassword),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        trafficQuotaTopUp: 1,
        trafficQuotaRequestId: 'quota-final-topup-a',
      }),
    },
    env,
    executionCtx,
  );
  const toppedUp = await json(topUpResponse);
  assert.equal(toppedUp.quotaApplied, true);
  assert.equal(
    Object.hasOwn(toppedUp, 'assignedWaitingCount'),
    false,
    'quota changes must not recover a waiting queue',
  );
  assert.deepEqual(
    database
      .prepare(
        `SELECT traffic_quota_total AS total,
           traffic_quota_used AS used
         FROM agents WHERE id = ?`,
      )
      .get(agentA),
    Object.assign(Object.create(null), { total: 3, used: 2 }),
  );

  const disableResponse = await adminConfigApi.request(
    `/api/admin/agents/${encodeURIComponent(agentA)}`,
    {
      method: 'PATCH',
      headers: {
        cookie: adminCookie(adminPassword),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ isEnabled: false }),
    },
    env,
  );
  await json(disableResponse);
  assert.deepEqual(
    database
      .prepare(
        `SELECT id, assigned_agent
         FROM conversations
         WHERE id IN (?, ?)
         ORDER BY id`,
      )
      .all(westOneId, westTwoId)
      .map((row) => row.assigned_agent),
    [agentA, agentA],
    'disabling a seat must preserve its existing active conversations',
  );
  assert.deepEqual(
    database
      .prepare(
        `SELECT a.traffic_quota_used AS used,
           COALESCE(SUM(s.conversation_count), 0) AS daily
         FROM agents a
         LEFT JOIN agent_daily_stats s ON s.agent_id = a.id
         WHERE a.id = ?
         GROUP BY a.id`,
      )
      .get(agentB),
    beforeDisableB,
    'disabling another seat must not alter this seat quota or daily count',
  );

  assert.deepEqual(
    database
      .prepare(
        `SELECT agent_id, COUNT(*) AS count
         FROM agent_traffic_receipts
         WHERE conversation_id IN (?, ?, ?)
         GROUP BY agent_id
         ORDER BY agent_id`,
      )
      .all(eastId, westOneId, westTwoId)
      .map((row) => ({ agentId: row.agent_id, count: row.count })),
    [
      { agentId: agentA, count: 2 },
      { agentId: agentB, count: 1 },
    ].sort((left, right) => left.agentId.localeCompare(right.agentId)),
    'immutable first-reception receipts must remain the billing source of truth after disable',
  );

  function readQuotaLedger(agentId) {
    const row = database
      .prepare(
        `SELECT
         agent.traffic_quota_total AS total,
         agent.traffic_quota_used AS used,
         agent.traffic_quota_total_baseline + COALESCE((
           SELECT SUM(adjustment.amount)
           FROM agent_quota_adjustments adjustment
           WHERE adjustment.site_id = agent.site_id
             AND adjustment.agent_id = agent.id
             AND adjustment.applied_at IS NOT NULL
         ), 0) AS expectedTotal,
         agent.traffic_quota_archived_used + COALESCE((
           SELECT COUNT(*)
           FROM agent_traffic_receipts receipt
           WHERE receipt.site_id = agent.site_id
             AND receipt.agent_id = agent.id
             AND receipt.quota_consumed = 1
         ), 0) AS expectedUsed
       FROM agents agent
       WHERE agent.site_id = 'default'
         AND agent.id = ?`,
      )
      .get(agentId);
    return {
      ...row,
      consistent:
        row.total === row.expectedTotal && row.used === row.expectedUsed,
    };
  }

  assert.deepEqual(readQuotaLedger(agentA), {
    total: 3,
    used: 2,
    expectedTotal: 3,
    expectedUsed: 2,
    consistent: true,
  });
  assert.deepEqual(readQuotaLedger(agentB), {
    total: 1,
    used: 1,
    expectedTotal: 1,
    expectedUsed: 1,
    consistent: true,
  });

  database.close();
});

test('admin permanently deletes an agent while preserving historical records', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const adminPassword = 'admin-password';
  const rooms = fakeRooms();
  const env = {
    DB: d1(database),
    CONVERSATION_ROOMS: rooms.namespace,
    ADMIN_PASSWORD: adminPassword,
  };

  const createResponse = await adminConfigApi.request(
    '/api/admin/agents',
    {
      method: 'POST',
      headers: {
        cookie: adminCookie(adminPassword),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Delete Me',
        username: 'delete-me',
        password: 'pass',
        routingScope: { type: 'none' },
        dailyConversationLimit: 0,
        trafficQuotaEnabled: true,
        trafficQuotaTopUp: 10,
        trafficQuotaRequestId: 'delete-agent-quota-001',
        isEnabled: true,
      }),
    },
    env,
  );
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  const agentId = created.id;

  database
    .prepare(
      `INSERT INTO agent_sessions (id, agent_id, token_hash, expires_at)
       VALUES (?, ?, ?, datetime('now', '+1 hour'))`,
    )
    .run('delete-agent-session', agentId, 'delete-agent-session-token');
  database
    .prepare(
      `INSERT INTO agent_routing_scopes (
         site_id, agent_id, scope_type, section_id, category_id, product_id
       ) VALUES ('default', ?, 'section', 'west', '', '')`,
    )
    .run(agentId);
  database
    .prepare(
      `INSERT INTO agent_daily_stats (
         site_id, agent_id, business_date, conversation_count
       ) VALUES ('default', ?, '2026-08-26', 3)`,
    )
    .run(agentId);
  database.exec(`
    INSERT INTO visitors (id, site_id, token_hash)
    VALUES
      ('delete-active-visitor', 'default', 'delete-active-token'),
      ('delete-history-visitor', 'default', 'delete-history-token');
  `);
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, visitor_id, status, assigned_agent, assigned_at,
         assigned_business_date, expires_at, cta_affinity_agent_id,
         cta_affinity_expires_at
       ) VALUES (
         'delete-active-conversation', 'default', 'delete-active-visitor',
         'pending', ?, CURRENT_TIMESTAMP, '2026-08-26',
         datetime('now', '+1 hour'), ?, datetime('now', '+2 hours')
       )`,
    )
    .run(agentId, agentId);
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, visitor_id, status, assigned_agent, assigned_at,
         assigned_business_date, expires_at, cta_affinity_agent_id,
         cta_affinity_expires_at
       ) VALUES (
         'delete-history-conversation', 'default', 'delete-history-visitor',
         'closed', ?, CURRENT_TIMESTAMP, '2026-08-26',
         datetime('now', '+1 hour'), ?, datetime('now', '+2 hours')
       )`,
    )
    .run(agentId, agentId);
  database
    .prepare(
      `INSERT INTO messages (
         id, conversation_id, sender_type, sender_id, body
       ) VALUES (
         'delete-history-message', 'delete-history-conversation',
         'agent', ?, 'historical reply'
       )`,
    )
    .run(agentId);

  const deleteResponse = await adminConfigApi.request(
    `/api/admin/agents/${encodeURIComponent(agentId)}`,
    {
      method: 'DELETE',
      headers: { cookie: adminCookie(adminPassword) },
    },
    env,
  );
  const deleted = await deleteResponse.json();
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleted.reassignedConversationCount, 1);
  assert.equal(
    database
      .prepare('SELECT COUNT(*) AS count FROM agents WHERE id = ?')
      .get(agentId).count,
    0,
  );
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM agent_sessions WHERE agent_id = ?',
      )
      .get(agentId).count,
    0,
  );
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM agent_routing_scopes WHERE agent_id = ?',
      )
      .get(agentId).count,
    0,
  );
  assert.equal(
    database
      .prepare(
        'SELECT COUNT(*) AS count FROM agent_quota_adjustments WHERE agent_id = ?',
      )
      .get(agentId).count,
    0,
  );

  const active = database
    .prepare(
      `SELECT status, assigned_agent, cta_affinity_agent_id
       FROM conversations WHERE id = 'delete-active-conversation'`,
    )
    .get();
  assert.equal(active.status, 'open');
  assert.equal(active.assigned_agent, null);
  assert.equal(active.cta_affinity_agent_id, null);

  const historical = database
    .prepare(
      `SELECT status, assigned_agent, cta_affinity_agent_id
       FROM conversations WHERE id = 'delete-history-conversation'`,
    )
    .get();
  assert.equal(historical.status, 'closed');
  assert.equal(historical.assigned_agent, agentId);
  assert.equal(historical.cta_affinity_agent_id, null);
  assert.equal(
    database
      .prepare(
        "SELECT sender_id FROM messages WHERE id = 'delete-history-message'",
      )
      .get().sender_id,
    agentId,
  );
  assert.equal(
    database
      .prepare(
        `SELECT conversation_count
         FROM agent_daily_stats
         WHERE site_id = 'default' AND agent_id = ? AND business_date = '2026-08-26'`,
      )
      .get(agentId).conversation_count,
    3,
  );
});

test('admin can configure the no-agent response as plain text or Markdown', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const env = {
    DB: d1(database),
    CONVERSATION_ROOMS: fakeRooms().namespace,
    ADMIN_PASSWORD: 'admin-password',
  };
  const headers = {
    cookie: adminCookie('admin-password'),
    'content-type': 'application/json',
  };

  const initial = await json(
    await adminConfigApi.request(
      '/api/admin/no-agent-message',
      { headers },
      env,
    ),
  );
  assert.equal(initial.noAgentMessage.format, 'plain');
  assert.equal(initial.noAgentMessage.message.length > 0, true);

  const saved = await json(
    await adminConfigApi.request(
      '/api/admin/no-agent-message',
      {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          message: '  **暂时没有客服**\\n\\n请稍后再试。  ',
          format: 'markdown',
        }),
      },
      env,
    ),
  );
  assert.deepEqual(saved.noAgentMessage, {
    message: '**暂时没有客服**\\n\\n请稍后再试。',
    format: 'markdown',
  });
  assert.deepEqual(
    Object.assign(
      {},
      database
        .prepare(
          'SELECT no_agent_message, no_agent_message_format FROM sites WHERE id = ?',
        )
        .get('default'),
    ),
    {
      no_agent_message: '**暂时没有客服**\\n\\n请稍后再试。',
      no_agent_message_format: 'markdown',
    },
  );
  database.close();
});

test('visitor APIs never expose an unassigned legacy conversation as waiting', async () => {
  const database = new DatabaseSync(':memory:');
  applyMigrations(database);
  const rooms = fakeRooms();
  const env = {
    DB: d1(database),
    CONVERSATION_ROOMS: rooms.namespace,
  };
  const visitorId = 'NOWAIT1';
  const visitorRowId = 'visitor-no-wait';
  const conversationId = 'conversation-no-wait';
  const sourceHandoffId = '00000000-0000-4000-8000-000000009999';
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  database
    .prepare(
      `INSERT INTO visitors (
         id, site_id, token_hash, external_id, expires_at
       ) VALUES (?, 'default', ?, ?, ?)`,
    )
    .run(visitorRowId, 'token-no-wait', visitorId, expiresAt);
  database
    .prepare(
      `INSERT INTO conversations (
         id, site_id, visitor_id, status, product_id, section_id,
         section_name, product_title, product_href, source_handoff_id,
         expires_at
       ) VALUES (?, 'default', ?, 'open', 'product-no-wait', 'west',
         'West', 'No-wait product', '/products/no-wait', ?, ?)`,
    )
    .run(conversationId, visitorRowId, sourceHandoffId, expiresAt);
  database
    .prepare(
      `INSERT INTO messages (
         id, conversation_id, sender_type, sender_id, body, client_message_id
       ) VALUES (
         'message-no-wait', ?, 'visitor', ?, 'legacy message', 'legacy-replay'
       )`,
    )
    .run(conversationId, visitorRowId);

  const listResponse = await clientApi.request(
    `/client/v1/conversations?visitorId=${encodeURIComponent(visitorId)}`,
    undefined,
    env,
  );
  assert.equal(listResponse.status, 200);
  assert.deepEqual((await json(listResponse)).conversations, []);

  const replayResponse = await clientApi.request(
    '/client/v1/conversations',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        visitorId,
        sourceHandoffId: '00000000-0000-4000-8000-000000008888',
        clientMessageId: 'legacy-replay',
        message: 'legacy message',
        product: {
          id: 'product-no-wait',
          sectionId: 'west',
          sectionName: 'West',
          categoryId: null,
          categoryName: null,
          title: 'No-wait product',
          href: '/products/no-wait',
          coverUrl: null,
        },
      }),
    },
    env,
  );
  assert.equal(replayResponse.status, 503);
  assert.deepEqual(await json(replayResponse, { allowError: true }), {
    error: {
      code: 'NO_AGENT_AVAILABLE',
      message: '当前暂无可用客服，请稍后再试。',
      format: 'plain',
    },
  });

  database.close();
});
