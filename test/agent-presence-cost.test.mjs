import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('agent websocket presence avoids one D1 write per ping', async () => {
  const [core, routing, waiting, dashboardApi] = await Promise.all([
    read('../src/worker/core.ts'),
    read('../src/worker/routing.ts'),
    read('../src/worker/waiting-assignment.ts'),
    read('../src/dashboard/api.ts'),
  ]);

  assert.match(
    core,
    /datetime\(last_seen_at\) <= datetime\('now', '-90 seconds'\)/u,
  );
  assert.match(
    routing,
    /datetime\(a\.last_seen_at\) >= datetime\('now', '-3 minutes'\)/u,
  );
  assert.match(
    waiting,
    /datetime\(a\.last_seen_at\) >= datetime\('now', '-3 minutes'\)/u,
  );
  assert.match(dashboardApi, /window\.setInterval\(ping, 60_000\)/u);
});
