import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import test from 'node:test';

const adminRoutePath = fileURLToPath(
  new URL('../src/dashboard/admin-route.css', import.meta.url),
);
const routingDiagnosePath = fileURLToPath(
  new URL('../src/dashboard/admin-routing-diagnose.css', import.meta.url),
);
const legacyStylesPath = fileURLToPath(
  new URL('../src/dashboard/styles.css', import.meta.url),
);

test('admin route composes explicit CSS owners without the legacy foundation', () => {
  const adminRoute = readFileSync(adminRoutePath, 'utf8');
  const routingDiagnose = readFileSync(routingDiagnosePath, 'utf8');

  assert.match(
    adminRoute,
    /@import ['"]\.\/admin-auth\.css['"];/u,
    'admin-route.css should compose the explicit Admin auth owner',
  );
  assert.match(
    adminRoute,
    /@import ['"]\.\/admin-routing-diagnose\.css['"];/u,
    'admin-route.css should compose the explicit Routing Diagnostics owner',
  );
  assert.doesNotMatch(
    adminRoute,
    /\.routing-diagnose-/u,
    'admin-route.css must not implement Routing Diagnostics feature rules',
  );
  assert.match(
    routingDiagnose,
    /\.routing-diagnose-layer\s*\{/u,
    'Routing Diagnostics should own its overlay presentation',
  );
  assert.doesNotMatch(
    routingDiagnose,
    /routing-diagnose-trigger-host/u,
    'the retired dynamic trigger host must not survive in the feature stylesheet',
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
