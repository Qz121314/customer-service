import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import test from 'node:test';

function source(path) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

test('mobile agent thread keeps commercial hierarchy and touch targets', () => {
  const mobile = source('../src/dashboard/agent-mobile.css');
  const workspace = source('../src/dashboard/agent-workspace.css');
  const narrow = mobile.slice(mobile.indexOf('@media (max-width: 390px)'));

  assert.match(
    mobile,
    /\.thread-actions \{[^}]*grid-template-columns: auto auto 38px;[^}]*gap: 4px;[^}]*padding: 0;[^}]*border: 0;[^}]*background: transparent;/s,
  );
  assert.match(
    mobile,
    /\.thread-status \{[^}]*height: 28px;[^}]*min-height: 28px;/s,
  );
  assert.match(
    mobile,
    /\.thread-status-action \{[^}]*height: 38px;[^}]*min-height: 38px;/s,
  );
  assert.match(
    mobile,
    /\.transfer-menu > summary \{[^}]*width: 38px;[^}]*height: 38px;[^}]*border: 1px solid var\(--mobile-line\);/s,
  );
  assert.match(
    mobile,
    /\.conversation-context-card \{[^}]*margin: 0;[^}]*grid-template-columns: 38px minmax\(0, 1fr\) 36px;[^}]*border-bottom: 1px solid var\(--mobile-line\);[^}]*box-shadow: none;/s,
  );
  assert.match(
    mobile,
    /\.message > div \{[^}]*max-width: 80%;[^}]*border: 0;[^}]*border-radius: 16px;/s,
  );
  assert.match(
    mobile,
    /\.composer > textarea \{[^}]*height: auto;[^}]*min-height: 42px;[^}]*max-height: 112px;[^}]*border: 0;/s,
  );
  assert.ok(workspace.includes('field-sizing: content;'));
  assert.match(
    narrow,
    /\.thread-actions \{[^}]*grid-template-columns: auto auto 38px;/s,
  );
  assert.match(
    narrow,
    /\.transfer-menu \{[^}]*width: 38px;[^}]*min-width: 38px;/s,
  );
  assert.match(narrow, /\.message > div \{[^}]*max-width: 84%;/s);
});
