import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent startup collapses session and inbox into one external bootstrap request', async () => {
  const [bootstrap, entry, api] = await Promise.all([
    read('../src/worker/agent-bootstrap-api.ts'),
    read('../src/worker/entry.ts'),
    read('../src/dashboard/api.ts'),
  ]);

  assert.match(
    bootstrap,
    /agentBootstrapApi\.get\('\/api\/agent\/bootstrap'/u,
  );
  assert.match(bootstrap, /'\/api\/agent\/auth\/session'/u);
  assert.match(bootstrap, /'\/api\/agent\/conversations'/u);
  assert.ok(
    bootstrap.indexOf('!session.authenticated || !session.agent') <
      bootstrap.indexOf("'/api/agent/conversations'"),
    'signed-out bootstrap must stop before the inbox lookup',
  );
  assert.match(entry, /app\.route\('\/', agentBootstrapApi\)/u);

  assert.match(
    api,
    /request<AgentBootstrapPayload>\('\/api\/agent\/bootstrap'\)/u,
  );
  assert.match(
    api,
    /agentBootstrapInbox = response\.authenticated \? response\.inbox : null/u,
  );
  assert.match(api, /if \(agentBootstrapInbox\)/u);
  assert.match(
    api,
    /return request<AgentInbox>\('\/api\/agent\/conversations'\)/u,
  );
});
