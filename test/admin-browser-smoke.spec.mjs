import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';
const evidence = { screenshots: {}, geometry: [] };

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

function saveEvidence() {
  writeFileSync(
    '/tmp/admin-viewport-geometry.json',
    `${JSON.stringify(evidence)}\n`,
  );
}

async function capture(page, name) {
  evidence.screenshots[name] = (
    await page.screenshot({ animations: 'disabled' })
  ).toString('base64');
  saveEvidence();
}

async function loginAndSeed(page, username, name) {
  const login = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(login.ok()).toBeTruthy();
  const create = await page.request.post(url('/api/admin/agents'), {
    data: {
      name,
      adminLabel: '1号',
      username,
      password: 'ui-admin-smoke-pass',
      routingScope: { type: 'none' },
      dailyConversationLimit: 0,
      trafficQuotaEnabled: false,
      trafficQuotaTopUp: 0,
      trafficQuotaRequestId: '',
      isEnabled: true,
    },
  });
  expect(create.ok()).toBeTruthy();
}

async function openSection(page, name, heading = name) {
  await page.getByRole('button', { name: new RegExp(name, 'u') }).click();
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

async function noHorizontalOverflow(page) {
  const [clientWidth, scrollWidth] = await page.evaluate(() => {
    const root = globalThis.document.scrollingElement;
    return root ? [root.clientWidth, root.scrollWidth] : [0, 1];
  });
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
}

async function readAgentsGeometry(page) {
  return page.evaluate(() => {
    const browser = globalThis;
    const root = browser.document.scrollingElement;
    const overview = browser.document.querySelector('.admin-overview-strip');
    const table = browser.document.querySelector('.admin-table-card');
    const metrics = [
      ...browser.document.querySelectorAll('.admin-overview-metric'),
    ];
    if (!root || !overview || !table) return null;
    const overviewRect = overview.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    return {
      xOverflow: root.scrollWidth - root.clientWidth,
      overviewWidth: overviewRect.width,
      overviewHeight: overviewRect.height,
      overviewBottom: overviewRect.bottom,
      tableWidth: tableRect.width,
      tableHeight: tableRect.height,
      tableTop: tableRect.top,
      metrics: metrics.map((metric) => {
        const label = metric.querySelector('.admin-overview-label');
        const value = metric.querySelector('strong');
        const a = label?.getBoundingClientRect();
        const b = value?.getBoundingClientRect();
        return {
          display: browser.getComputedStyle(metric).display,
          whiteSpace: label ? browser.getComputedStyle(label).whiteSpace : '',
          centerDelta:
            a && b ? Math.abs(a.top + a.height / 2 - b.top - b.height / 2) : 99,
        };
      }),
    };
  });
}

async function readEditorGeometry(page) {
  return page.getByRole('dialog', { name: '新增客服' }).evaluate((element) => {
    const browser = globalThis;
    const layout = element.querySelector('.agent-editor-layout');
    const primary = element.querySelector('.agent-editor-primary-grid');
    const routing = element.querySelector('.agent-editor-routing-pane');
    const footer = element.querySelector('.agent-editor-footer');
    if (!layout || !primary || !routing || !footer) return null;
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      columns: browser.getComputedStyle(primary).gridTemplateColumns.split(' ')
        .length,
      routingHeight: routing.getBoundingClientRect().height,
      footerBottom: footer.getBoundingClientRect().bottom,
      scrollCapacity: layout.scrollHeight - layout.clientHeight,
      documentScrollCapacity:
        browser.document.documentElement.scrollHeight - browser.innerHeight,
    };
  });
}

async function captureSurfaceSet(page, key) {
  await capture(page, `${key}-dashboard`);
  await openSection(page, '客服坐席');
  await capture(page, `${key}-agents`);
  await page.getByRole('button', { name: '新增客服', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '新增客服' })).toBeVisible();
  await capture(page, `${key}-new-agent-editor`);
  await page
    .getByRole('dialog', { name: '新增客服' })
    .getByRole('button', { name: '关闭' })
    .click();
  await openSection(page, '站点设置');
  await capture(page, `${key}-site-settings`);
  await openSection(page, '客服坐席');
  await page.getByRole('button', { name: '分流诊断', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '分流诊断' })).toBeVisible();
  await capture(page, `${key}-routing-diagnose`);
  await page.getByRole('button', { name: '关闭' }).last().click();
}

test('mobile corrective IA remains touch-safe', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAndSeed(page, 'ui-admin-mobile-agent', 'UI Admin Mobile Agent');
  let bootstrap = 0;
  let stats = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/admin/bootstrap') bootstrap += 1;
    if (path === '/api/admin/traffic-stats') stats += 1;
  });
  await page.goto(url('/'));
  await expect(page.getByRole('heading', { name: '仪表板' })).toBeVisible();
  await expect(page.getByRole('button', { name: /访客体验/u })).toHaveCount(0);
  await expect.poll(() => bootstrap).toBe(1);
  await expect.poll(() => stats).toBe(1);
  await noHorizontalOverflow(page);
  await capture(page, '390x844-dashboard');

  await openSection(page, '客服坐席');
  const agents = await readAgentsGeometry(page);
  expect(agents).not.toBeNull();
  if (agents) {
    expect(agents.xOverflow).toBeLessThanOrEqual(1);
    expect(agents.metrics).toHaveLength(4);
    for (const metric of agents.metrics) {
      expect(metric.whiteSpace).toBe('nowrap');
      expect(metric.centerDelta).toBeLessThan(8);
    }
  }
  const row = page
    .getByRole('row')
    .filter({ hasText: 'UI Admin Mobile Agent' });
  for (const button of await row.locator('.admin-agent-actions button').all()) {
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(
      44,
    );
  }
  await capture(page, '390x844-agents');

  await openSection(page, '站点设置');
  await noHorizontalOverflow(page);
  const textareaFont = await page
    .locator('.no-agent-message-field textarea')
    .evaluate((element) => globalThis.getComputedStyle(element).fontSize);
  expect(Number.parseFloat(textareaFont)).toBeGreaterThanOrEqual(16);
  await capture(page, '390x844-site-settings');

  await openSection(page, '客服坐席');
  await page.getByRole('button', { name: '新增客服', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '新增客服' });
  const mobileEditor = await editor.evaluate((element) => {
    const browser = globalThis;
    const rect = element.getBoundingClientRect();
    const input = element.querySelector('input');
    const primary = element.querySelector(
      '.agent-editor-footer .primary-button',
    );
    return {
      width: rect.width,
      height: rect.height,
      radius: Number.parseFloat(browser.getComputedStyle(element).borderRadius),
      inputSize: input
        ? Number.parseFloat(browser.getComputedStyle(input).fontSize)
        : 0,
      primaryHeight: primary?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(mobileEditor.width).toBeGreaterThanOrEqual(389);
  expect(mobileEditor.height).toBeGreaterThanOrEqual(843);
  expect(mobileEditor.radius).toBe(0);
  expect(mobileEditor.inputSize).toBeGreaterThanOrEqual(16);
  expect(mobileEditor.primaryHeight).toBeGreaterThanOrEqual(48);
  await capture(page, '390x844-new-agent-editor');
  await editor.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: '分流诊断', exact: true }).click();
  await capture(page, '390x844-routing-diagnose');
});

test('desktop corrective geometry holds at required viewports', async ({
  page,
}) => {
  await loginAndSeed(page, 'ui-corrective-agent', 'UI Corrective Agent');
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
  ]) {
    const key = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await page.goto(url('/'));
    await noHorizontalOverflow(page);
    await openSection(page, '客服坐席');
    const agents = await readAgentsGeometry(page);
    expect(agents).not.toBeNull();
    if (agents) {
      expect(agents.overviewWidth).toBeGreaterThanOrEqual(
        agents.tableWidth * 0.95,
      );
      expect(agents.overviewHeight).toBeLessThanOrEqual(72);
      expect(agents.tableTop).toBeGreaterThanOrEqual(agents.overviewBottom);
      expect(agents.tableHeight).toBeGreaterThan(agents.overviewHeight * 2);
      for (const metric of agents.metrics) {
        expect(metric.display).toBe('flex');
        expect(metric.whiteSpace).toBe('nowrap');
        expect(metric.centerDelta).toBeLessThan(8);
      }
      evidence.geometry.push({ name: `${key}-agents`, ...agents });
    }
    await page.getByRole('button', { name: '新增客服', exact: true }).click();
    const editor = await readEditorGeometry(page);
    expect(editor).not.toBeNull();
    if (editor) {
      expect(editor.top).toBeGreaterThanOrEqual(0);
      expect(editor.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(editor.footerBottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(editor.columns).toBe(2);
      expect(editor.routingHeight).toBeLessThan(editor.height * 0.48);
      expect(editor.scrollCapacity).toBeLessThanOrEqual(80);
      expect(editor.documentScrollCapacity).toBeLessThanOrEqual(1);
      evidence.geometry.push({ name: `${key}-editor`, ...editor });
    }
    await page
      .getByRole('dialog', { name: '新增客服' })
      .getByRole('button', { name: '关闭' })
      .click();
    await page.goto(url('/'));
    await captureSurfaceSet(page, key);
  }
});

test('site logo uses explicit R2 upload/delete and management flows remain intact', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAndSeed(page, 'ui-admin-smoke-agent', 'UI Admin Smoke Agent');
  await page.goto(url('/'));
  await openSection(page, '站点设置');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  await page.locator('.site-logo-file-input').setInputFiles({
    name: 'site-logo.png',
    mimeType: 'image/png',
    buffer: png,
  });
  const logoGet = await page.request.get(url('/client/v1/site-logo'));
  expect(logoGet.status()).toBe(200);
  expect(logoGet.headers()['content-type']).toContain('image/png');
  await expect(page.locator('.admin-brand-mark img')).toBeVisible();
  await page.getByRole('button', { name: '恢复默认' }).click();
  expect((await page.request.get(url('/client/v1/site-logo'))).status()).toBe(
    404,
  );
  await expect(page.locator('.admin-brand-mark')).toContainText('CS');

  await openSection(page, '客服坐席');
  const row = page.getByRole('row').filter({ hasText: 'UI Admin Smoke Agent' });
  await expect(row.getByText('1号', { exact: true })).toHaveCSS(
    'color',
    'rgb(180, 35, 24)',
  );
  await row.getByRole('button', { name: '统计', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: /UI Admin Smoke Agent · 接待统计/u }),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭客服统计' }).click();
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '编辑客服' }).getByLabel(/客服标记/u),
  ).toHaveValue('1号');
});
