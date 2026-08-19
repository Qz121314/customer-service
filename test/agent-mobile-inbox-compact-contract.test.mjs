import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('agent mobile inbox keeps the header and metrics compact', () => {
  const mobile = source('../src/dashboard/agent-mobile.css');
  const narrow = mobile.slice(mobile.indexOf('@media (max-width: 390px)'));

  assert.match(
    mobile,
    /\.workspace-sidebar \{[^}]*height: 52px;[^}]*min-height: 52px;/s,
  );
  assert.match(
    mobile,
    /\.workspace-sidebar-actions \{[^}]*grid-template-columns: repeat\(5, 34px\);[^}]*border: 0;[^}]*background: transparent;/s,
  );
  assert.match(
    narrow,
    /\.workspace-sidebar-actions \{[^}]*grid-template-columns: repeat\(5, 34px\);/s,
  );
  assert.match(
    narrow,
    /\.agent-profile \.agent-avatar-button \{[^}]*width: 34px;[^}]*min-width: 34px;[^}]*height: 34px;[^}]*min-height: 34px;/s,
  );
  assert.match(
    mobile,
    /\.conversation-head \{[^}]*min-height: 42px;[^}]*padding: 6px 12px 4px;/s,
  );
  assert.match(
    mobile,
    /\.inbox-overview \{[^}]*min-height: 44px;[^}]*border: 0;[^}]*background: transparent;[^}]*box-shadow: none;/s,
  );
  assert.match(
    mobile,
    /\.inbox-overview \.metric \{[^}]*min-height: 44px;[^}]*padding: 4px 4px;/s,
  );
  assert.match(
    mobile,
    /\.inbox-tools \{[^}]*min-height: 44px;[^}]*padding: 0 10px 7px;/s,
  );

  assert.equal(
    mobile.includes('grid-template-columns: repeat(4, 34px);'),
    false,
  );
  assert.equal(
    narrow.includes('grid-template-columns: repeat(4, 32px);'),
    false,
  );
});
