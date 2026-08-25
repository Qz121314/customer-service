import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardDirectory = 'src/dashboard';
const iconSource = readFileSync(`${dashboardDirectory}/icons.tsx`, 'utf8');
const toolbarSource = readFileSync(
  `${dashboardDirectory}/AgentWorkspaceChrome.tsx`,
  'utf8',
);
const dashboardSources = readdirSync(dashboardDirectory)
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => ({
    file,
    source: readFileSync(`${dashboardDirectory}/${file}`, 'utf8'),
  }));
const dashboardStyles = readdirSync(dashboardDirectory)
  .filter((file) => file.endsWith('.css'))
  .map((file) => ({
    file,
    source: readFileSync(`${dashboardDirectory}/${file}`, 'utf8'),
  }));

test('dashboard functional icons share one accessible SVG component', () => {
  assert.match(iconSource, /export type UiIconName/u);
  assert.match(iconSource, /viewBox="0 0 24 24"/u);
  assert.match(iconSource, /stroke="currentColor"/u);
  assert.match(iconSource, /aria-hidden="true"/u);
  assert.match(iconSource, /focusable="false"/u);

  for (const { file, source } of dashboardSources) {
    if (file === 'icons.tsx') continue;
    assert.doesNotMatch(source, /<svg\b/u, `${file} contains a local SVG`);
  }
});

test('mobile settings uses a recognizable gear in a dedicated touch target', () => {
  assert.match(toolbarSource, /<UiIcon name="settings" \/>/u);
  assert.match(
    iconSource,
    /settings:[\s\S]*<circle cx="12" cy="12" r="3" \/>/u,
  );

  const mobileStyles = readFileSync(
    `${dashboardDirectory}/agent-mobile.css`,
    'utf8',
  );
  assert.match(
    mobileStyles,
    /\.mobile-settings-trigger\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;/u,
  );
  assert.match(
    mobileStyles,
    /\.mobile-settings-trigger \.ui-icon\s*\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px;/u,
  );
});

test('dashboard does not fall back to character or data URI action icons', () => {
  const functionalCharacters = />\s*[×＋✓‹]\s*</u;

  for (const { file, source } of dashboardSources) {
    assert.doesNotMatch(
      source,
      functionalCharacters,
      `${file} contains a character action icon`,
    );
  }

  for (const { file, source } of dashboardStyles) {
    assert.doesNotMatch(
      source,
      /data:image\/svg\+xml|content:\s*['"][↗➤‹＋✓×]['"]/u,
      `${file} contains an embedded or character action icon`,
    );
  }
});
