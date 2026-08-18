import assert from 'node:assert/strict';
import test from 'node:test';

const BASE_URL = 'https://customer-service-app.fcqz121314.workers.dev';

function absoluteUrl(value) {
  return new URL(value, `${BASE_URL}/`).href;
}

function htmlAssetUrls(html) {
  const urls = new Set();
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)) {
    urls.add(absoluteUrl(match[1]));
  }
  return [...urls];
}

function bundledAssetUrls(source) {
  const urls = new Set();
  for (const match of source.matchAll(/["'`](\/?assets\/[^"'`\s)]+\.(?:js|css)(?:\?[^"'`\s)]*)?)["'`]/g)) {
    urls.add(absoluteUrl(match[1]));
  }
  return [...urls];
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
    const htmlAssets = htmlAssetUrls(html);
    console.log('production HTML assets', htmlAssets);

    const pendingJs = htmlAssets.filter((url) => /\.js(?:\?|$)/.test(url));
    const cssUrls = new Set(
      htmlAssets.filter((url) => /\.css(?:\?|$)/.test(url)),
    );
    const seenJs = new Set();

    while (pendingJs.length > 0 && seenJs.size < 50) {
      const url = pendingJs.shift();
      if (!url || seenJs.has(url)) continue;
      seenJs.add(url);
      const source = await fetchText(url);
      for (const asset of bundledAssetUrls(source)) {
        if (/\.css(?:\?|$)/.test(asset)) cssUrls.add(asset);
        if (/\.js(?:\?|$)/.test(asset) && !seenJs.has(asset)) pendingJs.push(asset);
      }
    }

    console.log('production JS assets', [...seenJs]);
    console.log('production CSS assets', [...cssUrls]);

    assert.ok(seenJs.size > 0, `production agent did not expose a JS bundle: ${html.slice(0, 800)}`);
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
