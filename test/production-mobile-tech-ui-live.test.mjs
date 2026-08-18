import assert from 'node:assert/strict';
import test from 'node:test';

const origin = 'https://customer-service-app.fcqz121314.workers.dev';

test('production agent bundle contains the mobile telemetry and command UI', async () => {
  const pageResponse = await fetch(`${origin}/agent`);
  assert.equal(pageResponse.ok, true, `agent page returned ${pageResponse.status}`);

  const html = await pageResponse.text();
  const cssPaths = [...html.matchAll(/href="([^"]+\.css(?:\?[^"]*)?)"/g)].map(
    (match) => match[1],
  );
  assert.ok(cssPaths.length > 0, 'production agent page did not expose a CSS asset');

  const styles = (
    await Promise.all(
      cssPaths.map(async (path) => {
        const response = await fetch(new URL(path, origin));
        assert.equal(response.ok, true, `CSS asset returned ${response.status}`);
        return response.text();
      }),
    )
  ).join('\n');

  assert.match(styles, /#111a2b/i);
  assert.match(styles, /repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /grid-template-columns:72px 38px/);
});
