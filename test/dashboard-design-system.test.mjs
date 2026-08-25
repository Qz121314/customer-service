import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardDirectory = 'src/dashboard';
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const vite = readFileSync('vite.config.ts', 'utf8');
const main = readFileSync(`${dashboardDirectory}/main.tsx`, 'utf8');
const uiSystem = readFileSync(`${dashboardDirectory}/ui-system.css`, 'utf8');
const componentConfig = JSON.parse(readFileSync('components.json', 'utf8'));

test('dashboard design system keeps the approved shadcn stack explicit', () => {
  for (const dependency of [
    '@radix-ui/react-slot',
    'class-variance-authority',
    'clsx',
    'lucide-react',
    'tailwind-merge',
  ]) {
    assert.equal(typeof packageJson.dependencies[dependency], 'string');
  }

  for (const dependency of ['@tailwindcss/vite', 'tailwindcss']) {
    assert.equal(typeof packageJson.devDependencies[dependency], 'string');
  }

  assert.match(vite, /tailwindcss from '@tailwindcss\/vite'/u);
  assert.match(vite, /plugins: \[react\(\), tailwindcss\(\)\]/u);
  assert.equal(componentConfig.style, 'new-york');
  assert.equal(componentConfig.iconLibrary, 'lucide');
  assert.equal(componentConfig.tailwind.cssVariables, true);
  assert.match(uiSystem, /@import 'tailwindcss'/u);
  assert.match(uiSystem, /--color-primary: var\(--primary\)/u);
});

test('shared controls are source-owned components instead of raw legacy classes', () => {
  const sourceFiles = readdirSync(dashboardDirectory)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => readFileSync(`${dashboardDirectory}/${file}`, 'utf8'));

  for (const source of sourceFiles) {
    assert.doesNotMatch(
      source,
      /className="(?:primary-button|secondary-button|ghost-button)/u,
    );
  }

  const button = readFileSync(`${dashboardDirectory}/ui/button.tsx`, 'utf8');
  assert.match(button, /data-ui="button"/u);
  assert.match(button, /buttonVariants/u);
  assert.match(button, /Slot/u);
});

test('route CSS stays consolidated behind stable ownership files', () => {
  const cssFiles = readdirSync(dashboardDirectory).filter((file) =>
    file.endsWith('.css'),
  );
  assert.ok(
    cssFiles.length <= 22,
    `dashboard CSS file count regressed to ${cssFiles.length}`,
  );
  assert.match(main, /import '\.\/ui-system\.css'/u);

  for (const removedFile of [
    'admin-agent-directory.css',
    'admin-agent-editor.css',
    'admin-scroll-ownership.css',
    'admin-viewport-geometry.css',
    'agent-auto-reply.css',
    'agent-desktop-composer.css',
    'agent-desktop.css',
    'agent-mobile-settings.css',
    'agent-mobile.css',
    'agent-overlay-motion.css',
    'media-view.css',
  ]) {
    assert.equal(cssFiles.includes(removedFile), false, removedFile);
    assert.equal(main.includes(removedFile), false, removedFile);
  }
});
