import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const adminRoutePath = fileURLToPath(
  new URL('../src/dashboard/admin-route.css', import.meta.url),
);
const legacyStylesPath = fileURLToPath(
  new URL('../src/dashboard/styles.css', import.meta.url),
);

test('admin route composes explicit CSS owners without the legacy foundation', () => {
  const adminRoute = readFileSync(adminRoutePath, 'utf8');

  assert.match(
    adminRoute,
    /@import ['"]\.\/admin-auth\.css['"];/u,
    'admin-route.css should compose the explicit Admin auth owner',
  );
  assert.doesNotMatch(
    adminRoute,
    /@import ['"]\.\/styles\.css['"];/u,
    'admin-route.css must not depend on the retired legacy stylesheet',
  );
  assert.equal(
    existsSync(legacyStylesPath),
    false,
    'styles.css should remain retired once Admin ownership is explicit',
  );
});
