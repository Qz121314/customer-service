import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('admin dashboard stores and submits routing scopes without expanded product arrays', () => {
  const api = source('../src/dashboard/api.ts');
  const picker = source('../src/dashboard/ProductAssignmentPicker.tsx');
  const portal = source('../src/dashboard/AdminPortal.tsx');
  const editor = source('../src/dashboard/AgentEditorModal.tsx');
  const admin = `${portal}\n${editor}`;
  const runtime = source('../src/dashboard/dashboard-runtime.ts');

  assert.ok(!api.includes('attachProductSelectionScope'));
  assert.ok(!api.includes('getProductSelectionScope'));
  assert.ok(!api.includes('expandRoutingScopeProductIds'));
  assert.ok(!api.includes('scopeForRequest'));
  assert.ok(api.includes('routingScope: AgentRoutingScope'));
  assert.ok(api.includes('body: JSON.stringify(input)'));

  assert.ok(picker.includes('scope: AgentRoutingScope'));
  assert.ok(picker.includes('onChange: (scope: AgentRoutingScope) => void'));
  assert.ok(picker.includes("{ type: 'section', sectionIds }"));
  assert.ok(picker.includes('toggleSection(section.id'));
  assert.ok(picker.includes('可同时选择多个分区'));
  assert.ok(api.includes("{ type: 'section'; sectionIds: string[] }"));
  assert.ok(!picker.includes('attachProductSelectionScope'));
  assert.ok(!picker.includes('.map((product) => product.id)'));

  assert.ok(runtime.includes('routingScope: AgentRoutingScope'));
  assert.ok(admin.includes('routingScope: agent.routingScope'));
  assert.ok(admin.includes('scope={draft.routingScope}'));
  assert.ok(!admin.includes('productIds: draft.productIds'));
});
