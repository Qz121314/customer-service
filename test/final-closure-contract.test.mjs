import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('Cloudflare closure keeps static assets asset-first and protocol fallback explicit', () => {
  const wrangler = source('../wrangler.jsonc');
  const entry = source('../src/worker/entry.ts');

  assert.ok(!wrangler.includes('"run_worker_first": true'));
  assert.ok(wrangler.includes('"run_worker_first": ['));
  assert.ok(wrangler.includes('"/api/*"'));
  assert.ok(wrangler.includes('"/client/*"'));
  assert.ok(wrangler.includes('"/integration/*"'));
  assert.ok(wrangler.includes('"/management/v1"'));
  assert.ok(wrangler.includes('"/management/v1/*"'));
  assert.ok(wrangler.includes('"not_found_handling": "none"'));
  assert.ok(!wrangler.includes('"single-page-application"'));
  assert.ok(entry.includes('PROTOCOL_NAMESPACE_PREFIXES'));
  assert.ok(entry.includes('isProtocolNamespacePath(pathname)'));
  assert.ok(entry.includes('!isSpaNavigationRequest(request)'));
  assert.ok(entry.includes("new URL('/index.html', request.url)"));
  assert.ok(wrangler.includes('"AUTH_BURST_LIMITER"'));
  assert.ok(entry.includes('AUTH_BURST_LIMITER?: RateLimit'));
  assert.ok(entry.includes("'/api/auth/login'"));
  assert.ok(entry.includes("'/api/agent/auth/login'"));
  assert.ok(entry.includes("requestSourceHash(c.req.raw, 'auth-login')"));
  assert.ok(entry.includes("{ error: 'AUTH_RATE_LIMITED' }"));
});

test('routing contract has one canonical request and response shape', () => {
  const admin = source('../src/worker/admin-config-api.ts');
  const dashboard = source('../src/dashboard/api.ts');
  const client = source('../src/worker/client-api.ts');
  const agent = source('../src/worker/agent-api.ts');

  assert.ok(admin.includes('routingScope?: unknown'));
  assert.ok(!admin.includes('legacyProductIds'));
  assert.ok(!admin.includes('body?.productIds'));
  assert.ok(!admin.includes('body.productIds'));
  assert.ok(!admin.includes('productIds:\n        routingScope.type'));
  assert.ok(!dashboard.includes('fallbackProductIds'));
  assert.ok(!dashboard.includes('AdminBootstrapAgent'));
  assert.ok(!dashboard.includes('group_id:'));
  assert.ok(!client.includes('c.group_id'));
  assert.ok(!agent.includes('c.group_id'));
});

test('conversation hot paths use authoritative indexed expiry', () => {
  const files = [
    '../src/worker/admin-config-api.ts',
    '../src/worker/agent-api.ts',
    '../src/worker/client-api.ts',
    '../src/worker/conversation-retention.ts',
    '../src/worker/routing.ts',
    '../src/worker/waiting-assignment.ts',
  ].map(source);
  const runtime = files.join('\n');
  const compatibilityExpressions = [
    "COALESCE(expires_at, datetime(created_at, '+1 day'))",
    "COALESCE(c.expires_at, datetime(c.created_at, '+1 day'))",
    "COALESCE(load.expires_at, datetime(load.created_at, '+1 day'))",
    "COALESCE(active.expires_at, datetime(active.created_at, '+1 day'))",
  ];

  for (const expression of compatibilityExpressions) {
    assert.ok(!runtime.includes(expression), expression);
  }

  const migration = source(
    '../migrations/0037_finalize_conversation_expiry.sql',
  );
  assert.ok(migration.includes('WHERE expires_at IS NULL'));
  assert.ok(migration.includes('idx_conversations_expiry'));
});

test('admin final style layer and static headers remain closure-safe', () => {
  const adminStyles = source('../src/dashboard/admin-commercial.css');
  const headers = source('../public/_headers');

  assert.ok(adminStyles.includes('Final admin console layer'));
  assert.ok(!adminStyles.includes('.workspace-shell'));
  assert.ok(!adminStyles.includes('.thread-head'));
  assert.ok(!adminStyles.includes('.conversation-row'));
  assert.ok(!adminStyles.includes('.composer'));
  assert.ok(headers.includes('X-Content-Type-Options: nosniff'));
  assert.ok(
    headers.includes('Referrer-Policy: strict-origin-when-cross-origin'),
  );
  assert.ok(headers.includes('X-Frame-Options: SAMEORIGIN'));
  assert.ok(headers.includes('Permissions-Policy:'));
});
