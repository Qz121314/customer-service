import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminEntry = readFileSync('src/dashboard/admin-entry.tsx', 'utf8');
const adminPortal = readFileSync('src/dashboard/AdminPortal.tsx', 'utf8');
const adminShell = readFileSync('src/dashboard/AdminShell.tsx', 'utf8');
const routingDiagnose = readFileSync(
  'src/dashboard/AdminRoutingDiagnoseDock.tsx',
  'utf8',
);

function callCount(source, functionName) {
  const matches = source.match(new RegExp(`\\b${functionName}\\(\\)`, 'gu'));
  return matches?.length ?? 0;
}

test('Routing Diagnostics is composed through Admin contextual navigation', () => {
  assert.match(
    adminShell,
    /contextNavigation\?: AdminContextNavigation \| null;/u,
    'AdminShell should expose controlled contextual navigation composition',
  );
  assert.match(
    adminPortal,
    /label: '分流诊断'[\s\S]*?onSelect: \(\) => setAgentsView\('diagnostics'\)/u,
    'AdminCenter should expose Routing Diagnostics through 客服坐席 contextual navigation',
  );
  assert.match(
    adminPortal,
    /<AdminRoutingDiagnoseWorkspace products=\{products\} \/>/u,
    'AdminCenter should compose Routing Diagnostics as an inline workspace',
  );
  assert.doesNotMatch(
    adminEntry,
    /AdminRoutingDiagnoseDock/u,
    'Routing Diagnostics must not remain an AdminPortal sibling at the route entry',
  );

  for (const forbidden of [
    /MutationObserver/u,
    /document\.querySelector/u,
    /document\.createElement/u,
    /insertBefore/u,
    /appendChild/u,
    /routing-diagnose-trigger-host/u,
    /createPortal/u,
  ]) {
    assert.doesNotMatch(
      routingDiagnose,
      forbidden,
      `Routing Diagnostics must not use retired trigger injection path: ${forbidden}`,
    );
  }
});

test('Routing Diagnostics reuses the shared Admin product catalog', () => {
  assert.equal(
    callCount(adminPortal, 'getAgents'),
    1,
    'Admin bootstrap should request agents once',
  );
  assert.equal(
    callCount(adminPortal, 'getProductCatalog'),
    1,
    'Admin bootstrap should request the product catalog once',
  );
  assert.equal(
    callCount(adminPortal, 'getNoAgentMessage'),
    1,
    'Admin bootstrap should request the no-agent message once',
  );
  assert.match(
    adminPortal,
    /<AdminRoutingDiagnoseWorkspace[\s\S]*?products=\{products\}/u,
    'AdminCenter should pass shared products into Routing Diagnostics',
  );
  assert.doesNotMatch(
    routingDiagnose,
    /getProductCatalog/u,
    'opening Routing Diagnostics must not request the product catalog again',
  );
});

test('Routing Diagnostics keeps its diagnostic request boundary unchanged', () => {
  assert.match(
    routingDiagnose,
    /fetch\(\s*`\/api\/admin\/routing-diagnose\?productId=\$\{encodeURIComponent\(productId\)\}`,[\s\S]*?credentials: 'same-origin'/u,
    'diagnostics should remain an explicit user-driven GET to the existing endpoint',
  );
});
