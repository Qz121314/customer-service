import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('push delivery removes only terminal or explicitly expired subscriptions in one batch', async () => {
  const [agentDelivery, visitorDelivery] = await Promise.all([
    read('../src/worker/agent-push.ts'),
    read('../src/worker/visitor-push.ts'),
  ]);

  for (const source of [agentDelivery, visitorDelivery]) {
    assert.match(source, /subscription\.expiration_time/u);
    assert.match(source, /subscription\.expiration_time <= now/u);
    assert.match(source, /response\.status === 404 \|\| response\.status === 410/u);
    assert.match(source, /const staleEndpoints = new Set<string>\(\)/u);
    assert.match(source, /SELECT CAST\(value AS TEXT\) FROM json_each\(\?1\)/u);
    assert.match(source, /\.bind\(JSON\.stringify\(endpoints\)\)/u);
    assert.match(source, /if \(!response\.ok\) \{/u);
    assert.doesNotMatch(
      source,
      /if \(!response\.ok\)[\s\S]{0,220}DELETE FROM .*_push_subscriptions/u,
      'transient push failures must not delete a subscription',
    );
  }
});

test('push registration rejects invalid or already-expired expiration metadata', async () => {
  const [agentApi, visitorApi] = await Promise.all([
    read('../src/worker/agent-push-api.ts'),
    read('../src/worker/push-api.ts'),
  ]);

  for (const source of [agentApi, visitorApi]) {
    assert.match(source, /expirationTime === undefined/u);
    assert.match(source, /value <= Date\.now\(\)/u);
    assert.match(source, /return undefined/u);
  }
});
