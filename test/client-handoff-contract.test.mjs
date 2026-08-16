import assert from 'node:assert/strict';
import { existsSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const workerDirectory = fileURLToPath(
  new URL('../src/worker/', import.meta.url),
);
const shims = [];
for (const name of [
  'conversation-retention.ts',
  'routing.ts',
  'abuse-control.ts',
]) {
  const shimPath = join(workerDirectory, name.slice(0, -3));
  if (existsSync(shimPath)) continue;
  symlinkSync(name, shimPath);
  shims.push(shimPath);
}

let clientApi;
try {
  ({ clientApi } = await import('../src/worker/client-api.ts'));
} finally {
  for (const shimPath of shims) unlinkSync(shimPath);
}

const otherwiseValidBody = {
  visitorId: 'ABC123',
  clientMessageId: 'message-1',
  message: 'Hello',
  product: {
    id: 'product-1',
    sectionId: 'west',
    sectionName: 'West',
    categoryId: 'category-1',
    categoryName: 'Category 1',
    title: 'Product 1',
    href: '/sections/west/products/product-1/',
    coverUrl: null,
  },
};

test('new conversations require a UUID v4 source handoff id before any D1 work', async () => {
  for (const sourceHandoffId of [undefined, '', 'not-a-handoff-id']) {
    const response = await clientApi.request('/client/v1/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...otherwiseValidBody, sourceHandoffId }),
    });
    const value = await response.json();
    assert.equal(response.status, 400);
    assert.equal(value.error.code, 'INVALID_SOURCE_HANDOFF_ID');
  }
});
