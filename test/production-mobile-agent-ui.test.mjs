import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'https://customer-service-app.fcqz121314.workers.dev';

function assetUrls(text, extension) {
  const matches = new Set();
  const pattern = new RegExp(
    String.raw`(?:["'\x60(])((?:https?:\\/\\/[^"'\x60)]+|\\/)?assets\\/[^"'\x60)]+\\.${extension}(?:\\?[^"'\x60)]*)?)`,
    'g',
  );
  for (const match of text.matchAll(pattern)) matches.add(match[1]);
  return [...matches];
}

function absoluteUrl(value) {
  return new URL(value.replaceAll('\\/', '/'), `${BASE_URL}/`).href;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { 'cache-control': 'no-cache' },
  });
  assert.equal(response.ok, true, `${url} returned ${response.status}`);
  return response.text();
}

test(
  'production agent serves the unified mobile UI architecture',
  { timeout: 30_000 },
  async () => {
    const health = await fetch(`${BASE_URL}/api/health`, {
      headers: { 'cache-control': 'no-cache' },
    });
    assert.equal(health.ok, true, `health returned ${health.status}`);

    const html = await fetchText(`${BASE_URL}/agent`);
    const pendingJs = assetUrls(html, 'js').map(absoluteUrl);
    const seenJs = new Set();
    const cssUrls = new Set(assetUrls(html, 'css').map(absoluteUrl));

    while (pendingJs.length > 0 && seenJs.size < 40) {
      const url = pendingJs.shift();
      if (!url || seenJs.has(url)) continue;
      seenJs.add(url);
      const source = await fetchText(url);
      for (const css of assetUrls(source, 'css')) cssUrls.add(absoluteUrl(css));
      for (const js of assetUrls(source, 'js')) {
        const next = absoluteUrl(js);
        if (!seenJs.has(next)) pendingJs.push(next);
      }
    }

    assert.ok(seenJs.size > 0, 'production agent did not expose a JS bundle');
    assert.ok(cssUrls.size > 0, 'production agent did not expose CSS assets');

    const css = (
      await Promise.all([...cssUrls].map((url) => fetchText(url)))
    ).join('\n');

    for (const marker of [
      '--agent-tech-panel:#111a2b',
      'grid-template-columns:repeat(2,minmax(0,1fr))',
      '.workspace-sidebar,.thread-head{box-sizing:border-box',
      '.thread-head{display:grid;z-index:40;height:60px',
    ]) {
      assert.ok(css.includes(marker), `production CSS missing ${marker}`);
    }
  },
);
