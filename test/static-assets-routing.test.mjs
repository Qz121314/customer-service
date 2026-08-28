import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { URL } from 'node:url';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test(
  'SPA navigation stays on free static assets while protocols run Worker first',
  async () => {
    const wrangler = await read('../wrangler.jsonc');
    const workerFirst = wrangler.match(
      /"run_worker_first": \[([\s\S]*?)\n    \]/u,
    )?.[1];

    assert.match(
      wrangler,
      /"not_found_handling": "single-page-application"/u,
    );
    assert.ok(workerFirst, 'run_worker_first routing must remain explicit');
    assert.match(workerFirst, /"\/api\/\*"/u);
    assert.match(workerFirst, /"\/client\/\*"/u);
    assert.match(workerFirst, /"\/integration\/\*"/u);
    assert.match(workerFirst, /"\/management\/v1\/\*"/u);
    assert.doesNotMatch(workerFirst, /"\/agent/u);
    assert.doesNotMatch(workerFirst, /"\/admin/u);
  },
);
