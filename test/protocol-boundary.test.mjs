import assert from 'node:assert/strict';
import test from 'node:test';
import { isRemovedProtocolPath } from '../src/worker/protocol-boundary.ts';

test('removed protocol prefixes are blocked before routing or assets', () => {
  for (const pathname of [
    '/api/public',
    '/api/public/sites/pk_default',
    '/api/public/conversations/abc/messages',
    '/management/v1',
    '/management/v1/groups',
    '/api/admin/conversations',
    '/api/admin/conversations/abc/messages',
    '/api/admin/realtime/abc',
  ]) {
    assert.equal(isRemovedProtocolPath(pathname), true, pathname);
  }
});

test('current application protocols are not blocked', () => {
  for (const pathname of [
    '/api/health',
    '/api/auth/session',
    '/api/admin/agents',
    '/api/agent/conversations',
    '/api/agent/conversations/abc/messages',
    '/api/agent/conversations/abc/status',
    '/client/v1/conversations',
    '/integration/v1/status',
    '/agent',
    '/',
  ]) {
    assert.equal(isRemovedProtocolPath(pathname), false, pathname);
  }
});
