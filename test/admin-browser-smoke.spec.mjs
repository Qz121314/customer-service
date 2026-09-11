import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword = process.env.UI_SMOKE_ADMIN_PASSWORD;
if (!adminPassword) {
  throw new Error(
    'UI_SMOKE_ADMIN_PASSWORD is required for admin browser smoke',
  );
}
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

async function loginAdmin(page) {
  const login = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(login.ok()).toBeTruthy();
}

async function loginAndSeed(page, username, name) {
  await loginAdmin(page);
  await seedAgent(page, username, name);
}

async function seedAgent(page, username, name) {
  const create = await page.request.post(url('/api/admin/agents'), {
    data: {
      name,
      adminLabel: '1号',
      username,
      password: adminPassword,
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
  const target =
    heading === '客服账号'
      ? page.locator('.admin-table-card')
      : heading === '品牌' || heading === '客服可用性'
        ? page.locator('.site-settings-page')
        : page.locator('.admin-content');
  await expect(target).toBeVisible();
}

async function openBranding(page) {
  await expect(
    page.getByRole('button', { name: '上传品牌 Logo' }),
  ).toBeVisible();
  const input = page.locator('.site-logo-file-input');
  await expect(input).toHaveCount(1);
  return input;
}

async function expectNoHorizontalOverflow(page) {
  const geometry = await page.evaluate(() => {
    const root = globalThis.document.scrollingElement;
    return root ? [root.clientWidth, root.scrollWidth] : [0, 1];
  });
  expect(geometry[1]).toBeLessThanOrEqual(geometry[0] + 1);
}

async function dashboardGeometry(page) {
  return page.evaluate(() => {
    const summary = globalThis.document.querySelector('.traffic-summary-strip');
    const grid = globalThis.document.querySelector(
      '.traffic-distribution-grid',
    );
    const cards = [
      ...globalThis.document.querySelectorAll('.traffic-distribution-card'),
    ];
    if (!summary || !grid || cards.length !== 2) return null;
    const lists = cards.map((card) =>
      card.querySelector('.traffic-distribution-list'),
    );
    if (lists.some((list) => !list)) return null;
    const summaryRect = summary.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    return {
      summaryHeight: summaryRect.height,
      summaryBottom: summaryRect.bottom,
      distributionsTop: gridRect.top,
      cardHeights: cards.map((card) => card.getBoundingClientRect().height),
      listClientHeights: lists.map((list) => list.clientHeight),
      listScrollHeights: lists.map((list) => list.scrollHeight),
    };
  });
}

async function agentsGeometry(page) {
  return page.evaluate(() => {
    const overview = globalThis.document.querySelector('.admin-overview-strip');
    const table = globalThis.document.querySelector('.admin-table-card');
    const toolbar = globalThis.document.querySelector('.admin-list-toolbar');
    const content = globalThis.document.querySelector('.admin-content');
    const context = globalThis.document.querySelector(
      '.admin-context-navigation',
    );
    if (!overview || !table || !toolbar || !content || !context) return null;
    const a = overview.getBoundingClientRect();
    const b = table.getBoundingClientRect();
    const c = toolbar.getBoundingClientRect();
    return {
      summaryHeight: a.height,
      summaryWidth: a.width,
      tableWidth: b.width,
      tableHeight: b.height,
      toolbarHeight: c.height,
      tableTop: b.top,
      summaryBottom: a.bottom,
      contentOverflowY: globalThis.getComputedStyle(content).overflowY,
      contextPosition: globalThis.getComputedStyle(context).position,
    };
  });
}

async function contextNavigationGeometry(page) {
  return page.evaluate(() => {
    const shell = globalThis.document.querySelector('.admin-console');
    const sidebar = globalThis.document.querySelector('.admin-sidebar');
    const context = globalThis.document.querySelector(
      '.admin-context-navigation',
    );
    const nav = context?.querySelector('nav');
    if (!shell || !sidebar || !context || !nav) return null;
    return {
      shellDisplay: globalThis.getComputedStyle(shell).display,
      sidebarPosition: globalThis.getComputedStyle(sidebar).position,
      contextPosition: globalThis.getComputedStyle(context).position,
      contextNavDisplay: globalThis.getComputedStyle(nav).display,
      contextHeight: context.getBoundingClientRect().height,
      contextWidth: context.getBoundingClientRect().width,
    };
  });
}

async function editorGeometry(dialog) {
  return dialog.evaluate((element) => {
    const layout = element.querySelector('.agent-editor-layout');
    const primary = element.querySelector('.agent-editor-primary-grid');
    const account = element.querySelector('.agent-editor-account-pane');
    const operations = element.querySelector('.agent-editor-operations-pane');
    const routing = element.querySelector('.agent-editor-routing-pane');
    const footer = element.querySelector('.agent-editor-footer');
    if (!layout || !primary || !account || !operations || !routing || !footer) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    const primaryRect = primary.getBoundingClientRect();
    const routingRect = routing.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      columns: globalThis
        .getComputedStyle(primary)
        .gridTemplateColumns.split(' ').length,
      accountHeight: account.getBoundingClientRect().height,
      operationsHeight: operations.getBoundingClientRect().height,
      routingHeight: routingRect.height,
      routingTop: routingRect.top,
      primaryBottom: primaryRect.bottom,
      footerBottom: footer.getBoundingClientRect().bottom,
      scrollCapacity: layout.scrollHeight - layout.clientHeight,
    };
  });
}

async function generatedPng(page, width, height, fill) {
  const encoded = await page.evaluate(
    async ({ width: w, height: h, fill: color }) => {
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas unavailable');
      context.fillStyle = color;
      context.fillRect(0, 0, w, h);
      context.clearRect(Math.floor(w / 4), Math.floor(h / 4), 8, 8);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error('png failed')),
          'image/png',
        );
      });
      return await new Promise((resolve, reject) => {
        const reader = new globalThis.FileReader();
        reader.onerror = () => reject(new Error('read failed'));
        reader.onload = () => resolve(String(reader.result).split(',')[1]);
        reader.readAsDataURL(blob);
      });
    },
    { width, height, fill },
  );
  return Buffer.from(encoded, 'base64');
}

function distributedCounts(count, total = 100) {
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) =>
    index < remainder ? base + 1 : base,
  );
}

function statisticsFixture(agentCount, productCount) {
  return {
    from: '2026-09-01',
    to: '2026-09-05',
    total: 100,
    retainedFrom: '2026-06-08',
    agents: distributedCounts(agentCount).map((count, index) => ({
      agentId: `fixture-agent-${index}`,
      agentName: `Fixture Agent ${index + 1}`,
      count,
    })),
    products: distributedCounts(productCount).map((count, index) => ({
      productId: `fixture-product-${index}`,
      productTitle: `Fixture Product ${index + 1}`,
      count,
    })),
  };
}

async function captureCoreSurfaces(page, key, seedName) {
  await expect(page.locator('.traffic-summary-strip')).toBeVisible();
  await expect(page.getByText('客服接待分布', { exact: true })).toBeVisible();
  await expect(page.getByText('产品会话分布', { exact: true })).toBeVisible();
  await expect(page.getByText('运营数据', { exact: true })).toHaveCount(0);
  await expect(page.getByText('SUMMARY', { exact: true })).toHaveCount(0);
  await expect(page.getByText('AGENTS', { exact: true })).toHaveCount(0);
  await expect(page.getByText('PRODUCTS', { exact: true })).toHaveCount(0);
  await expect(page.locator('.admin-context-navigation')).toHaveCount(0);
  await capture(page, `${key}-dashboard`);

  await openSection(page, '客服坐席', '客服账号');
  const context = page.locator('.admin-context-navigation');
  await expect(context).toBeVisible();
  await expect(
    context.getByRole('button', { name: /客服账号/u }),
  ).toBeVisible();
  await expect(
    context.getByRole('button', { name: /分流诊断/u }),
  ).toBeVisible();
  await capture(page, `${key}-agents`);

  await page.getByRole('button', { name: '新增客服', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: '新增客服' });
  await expect(createDialog).toBeVisible();
  await capture(page, `${key}-new-agent`);
  await createDialog.getByRole('button', { name: '关闭' }).click();

  const row = page.getByRole('row').filter({ hasText: seedName });
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: '编辑客服' });
  await expect(editDialog).toBeVisible();
  await capture(page, `${key}-edit-agent`);
  await editDialog.getByRole('button', { name: '关闭' }).click();

  await openBranding(page);
  await capture(page, `${key}-site-settings-brand`);
  await page.getByRole('button', { name: '站点设置', exact: true }).click();
  await page
    .locator('.admin-context-navigation')
    .getByRole('button', { name: /客服可用性/u })
    .click();
  await expect(page.locator('.site-settings-page')).toBeVisible();
  await expect(page.getByText('无客服提示语', { exact: true })).toBeVisible();
  await capture(page, `${key}-site-settings-availability`);
}

test('desktop workbench is compact at required viewports', async ({ page }) => {
  const seedName = 'UI Workbench Agent';
  await loginAndSeed(page, 'ui-workbench-agent', seedName);

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
  ]) {
    const key = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await page.goto(url('/'));
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('.traffic-summary-strip')).toBeVisible();
    await expect(page.locator('.traffic-distribution-card')).toHaveCount(2);
    await expect(page.locator('.admin-context-navigation')).toHaveCount(0);

    const dashboard = await dashboardGeometry(page);
    expect(dashboard).not.toBeNull();
    expect(dashboard.summaryHeight).toBeLessThanOrEqual(72);
    expect(dashboard.distributionsTop).toBeGreaterThanOrEqual(
      dashboard.summaryBottom,
    );
    evidence.geometry.push({ name: `${key}-dashboard`, ...dashboard });

    await openSection(page, '客服坐席', '客服账号');
    const agents = await agentsGeometry(page);
    expect(agents).not.toBeNull();
    expect(agents.summaryHeight).toBeLessThanOrEqual(60);
    expect(agents.summaryWidth).toBeGreaterThanOrEqual(
      agents.tableWidth * 0.98,
    );
    expect(agents.tableHeight).toBeGreaterThan(agents.summaryHeight * 2);
    expect(agents.tableTop).toBeGreaterThanOrEqual(agents.summaryBottom);
    expect(agents.toolbarHeight).toBeLessThanOrEqual(58);
    expect(agents.contentOverflowY).toBe('visible');
    expect(agents.contextPosition).toBe('static');
    evidence.geometry.push({ name: `${key}-agents`, ...agents });

    await page.getByRole('button', { name: '新增客服', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新增客服' });
    const editor = await editorGeometry(dialog);
    expect(editor).not.toBeNull();
    expect(editor.top).toBeGreaterThanOrEqual(0);
    expect(editor.bottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(editor.footerBottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(editor.columns).toBe(2);
    expect(editor.accountHeight).toBeGreaterThan(0);
    expect(editor.operationsHeight).toBeGreaterThan(0);
    expect(editor.routingTop).toBeGreaterThanOrEqual(editor.primaryBottom);
    expect(editor.routingHeight).toBeLessThan(editor.height * 0.4);
    expect(editor.scrollCapacity).toBeLessThanOrEqual(48);
    evidence.geometry.push({ name: `${key}-editor`, ...editor });
    await dialog.getByRole('button', { name: '关闭' }).click();

    await openBranding(page);
    const logoWidth = await page
      .getByRole('button', { name: '上传品牌 Logo' })
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(logoWidth).toBeGreaterThanOrEqual(40);
    await expectNoHorizontalOverflow(page);

    await page.goto(url('/'));
    await captureCoreSurfaces(page, key, seedName);
  }
});

test('context navigation stays inside the primary sidebar across breakpoints', async ({
  page,
}) => {
  await loginAndSeed(page, 'ui-tablet-workbench-agent', 'UI Tablet Agent');

  await page.setViewportSize({ width: 1025, height: 768 });
  await page.goto(url('/'));
  await openSection(page, '客服坐席', '客服账号');
  let geometry = await contextNavigationGeometry(page);
  expect(geometry).not.toBeNull();
  expect(geometry.shellDisplay).toBe('grid');
  expect(geometry.contextPosition).toBe('static');
  expect(geometry.contextNavDisplay).toBe('grid');

  await page.setViewportSize({ width: 1024, height: 768 });
  geometry = await contextNavigationGeometry(page);
  expect(geometry).not.toBeNull();
  expect(geometry.shellDisplay).toBe('block');
  expect(geometry.sidebarPosition).toBe('sticky');
  expect(geometry.contextPosition).toBe('static');
  expect(geometry.contextNavDisplay).toBe('flex');
  expect(geometry.contextWidth).toBeGreaterThanOrEqual(980);
  expect(geometry.contextHeight).toBeLessThanOrEqual(90);
  await expectNoHorizontalOverflow(page);
  evidence.geometry.push({
    name: '1024x768-tablet-context-navigation',
    ...geometry,
  });
  await capture(page, '1024x768-tablet-context-navigation');
});

test('H5 control plane supports navigation, settings, pools and page creation', async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto(url('/'));
  const slug = `h5-ui-${Date.now().toString(36)}`;

  await page.getByRole('button', { name: 'H5', exact: true }).click();
  const context = page.locator('.admin-context-navigation');
  await expect(context).toBeVisible();
  await expect(context.getByRole('button', { name: /H5 页面/u })).toBeVisible();
  await expect(context.getByRole('button', { name: /转化池/u })).toBeVisible();
  await expect(context.getByRole('button', { name: /H5 设置/u })).toBeVisible();

  await context.getByRole('button', { name: /H5 设置/u }).click();
  await page.getByLabel('H5 公网域名').fill('https://h5.example.com/');
  await page.getByRole('button', { name: '保存公网域名' }).click();
  await expect(
    page.getByText('当前：https://h5.example.com', { exact: true }),
  ).toBeVisible();

  await context.getByRole('button', { name: /转化池/u }).click();
  await page.getByRole('button', { name: '新建转化池' }).click();
  const poolDialog = page.getByRole('dialog', { name: '新建转化池' });
  await poolDialog.getByLabel('名称').fill('Smoke Chat Pool');
  await poolDialog.getByLabel('CTA 文案').fill('立即咨询');
  await poolDialog.getByRole('button', { name: '保存' }).click();
  await expect(
    page.getByText('Smoke Chat Pool', { exact: true }),
  ).toBeVisible();

  await context.getByRole('button', { name: /H5 页面/u }).click();
  await page.getByRole('button', { name: '新建 H5 页面' }).click();
  const pageDialog = page.getByRole('dialog', { name: '新建 H5 页面' });
  await pageDialog.getByLabel('名称 / Title').fill('Smoke H5 Page');
  await pageDialog.getByLabel('Slug').fill(slug);
  await pageDialog
    .getByLabel('Conversion Pool')
    .selectOption({ label: 'Smoke Chat Pool' });
  await pageDialog.getByRole('button', { name: '保存' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Smoke H5 Page' });
  await expect(row).toBeVisible();
  await expect(row).toContainText(`https://h5.example.com/${slug}/`);
  await row.getByRole('button', { name: '上传 HTML' }).click();
  const htmlDialog = page.getByRole('dialog', { name: '上传 HTML' });
  await htmlDialog.getByLabel('HTML 文件').setInputFiles({
    name: 'index.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<!doctype html><html><body>Smoke H5</body></html>'),
  });
  await htmlDialog.getByRole('button', { name: '上传 HTML' }).click();
  await expect(row).toContainText('待发布');
  await row.getByRole('button', { name: '发布' }).click();
  await expect(row).toContainText('已发布');
  const liveUrl = row.getByRole('link', { name: '打开公网 URL' });
  await expect(liveUrl).toHaveAttribute(
    'href',
    `https://h5.example.com/${slug}/`,
  );
  await expect(liveUrl).not.toHaveAttribute('aria-disabled', 'true');

  await row.getByRole('button', { name: '替换 HTML' }).click();
  const replacementDialog = page.getByRole('dialog', { name: '替换 HTML' });
  await replacementDialog.getByLabel('HTML 文件').setInputFiles({
    name: 'index-v2.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<!doctype html><html><body>Smoke H5 V2</body></html>'),
  });
  await replacementDialog.getByRole('button', { name: '上传 HTML' }).click();
  await expect(row).toContainText('有未发布更新');
  await expect(liveUrl).toHaveAttribute(
    'href',
    `https://h5.example.com/${slug}/`,
  );
  await expect(liveUrl).not.toHaveAttribute('aria-disabled', 'true');
  await expectNoHorizontalOverflow(page);
});

test('agent directory lets the document own long-list vertical scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await loginAdmin(page);
  const runId = Date.now().toString(36);
  const seedPrefix = `UI Scroll ${runId} Agent`;
  for (let index = 0; index < 100; index += 1) {
    await seedAgent(
      page,
      `ui-scroll-${runId}-${index}`,
      `${seedPrefix} ${index + 1}`,
    );
  }
  await page.goto(url('/'));
  await openSection(page, '客服坐席', '客服账号');
  const seededRows = page.getByRole('row').filter({ hasText: seedPrefix });
  await expect(seededRows).toHaveCount(100);
  const lastSeededRow = page
    .getByRole('row')
    .filter({ hasText: `${seedPrefix} 100` });
  await lastSeededRow.scrollIntoViewIfNeeded();
  await expect(lastSeededRow).toBeVisible();

  const geometry = await page.evaluate(() => {
    const root = globalThis.document.scrollingElement;
    const content = globalThis.document.querySelector('.admin-content');
    const tableWrap = globalThis.document.querySelector('.admin-table-wrap');
    if (!root || !content || !tableWrap) return null;
    const style = globalThis.getComputedStyle(content);
    const tableStyle = globalThis.getComputedStyle(tableWrap);
    return {
      rootClientHeight: root.clientHeight,
      rootScrollHeight: root.scrollHeight,
      contentOverflowY: style.overflowY,
      tableMaxHeight: tableStyle.maxHeight,
      tableOverflowY: tableStyle.overflowY,
    };
  });
  expect(geometry).not.toBeNull();
  expect(geometry.rootScrollHeight).toBeGreaterThan(geometry.rootClientHeight);
  expect(geometry.contentOverflowY).toBe('visible');
  expect(geometry.tableMaxHeight).toBe('none');
  expect(['visible', 'auto']).toContain(geometry.tableOverflowY);
  await expectNoHorizontalOverflow(page);
  evidence.geometry.push({
    name: '1366x768-long-agent-directory',
    ...geometry,
  });
  await capture(page, '1366x768-long-agent-directory');
});

test('dashboard regular distributions up to 10 rows do not scroll internally', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await loginAdmin(page);
  const fixture = statisticsFixture(10, 10);
  await page.route('**/api/admin/traffic-stats?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    });
  });

  await page.goto(url('/'));
  await expect(page.getByText('客服接待分布', { exact: true })).toBeVisible();
  const geometry = await dashboardGeometry(page);
  expect(geometry).not.toBeNull();
  expect(geometry.listScrollHeights[0]).toBeLessThanOrEqual(
    geometry.listClientHeights[0] + 1,
  );
  expect(geometry.listScrollHeights[1]).toBeLessThanOrEqual(
    geometry.listClientHeights[1] + 1,
  );
  expect(geometry.cardHeights[0]).toBeGreaterThan(430);
  expect(geometry.cardHeights[1]).toBeGreaterThan(430);
  await expectNoHorizontalOverflow(page);
  evidence.geometry.push({
    name: '1366x768-dashboard-regular-10-items',
    ...geometry,
  });
  await capture(page, '1366x768-dashboard-regular-10-items');
});

test('dashboard long distributions scroll independently without equal-height coupling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await loginAdmin(page);
  let fixture = statisticsFixture(18, 2);
  await page.route('**/api/admin/traffic-stats?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(fixture),
    });
  });

  await page.goto(url('/'));
  await expect(page.getByText('客服接待分布', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await dashboardGeometry(page))?.cardHeights[0])
    .toBeGreaterThan(500);
  let geometry = await dashboardGeometry(page);
  expect(geometry).not.toBeNull();
  expect(geometry.listScrollHeights[0]).toBeGreaterThan(
    geometry.listClientHeights[0] + 40,
  );
  expect(geometry.listScrollHeights[1]).toBeLessThanOrEqual(
    geometry.listClientHeights[1] + 1,
  );
  expect(geometry.cardHeights[0]).toBeGreaterThan(
    geometry.cardHeights[1] + 100,
  );
  expect(geometry.cardHeights[0]).toBeLessThanOrEqual(630);
  await expectNoHorizontalOverflow(page);
  evidence.geometry.push({
    name: '1366x768-dashboard-long-agents',
    ...geometry,
  });
  await capture(page, '1366x768-dashboard-long-agents');

  fixture = statisticsFixture(2, 18);
  await page.reload();
  await expect(page.getByText('产品会话分布', { exact: true })).toBeVisible();
  await expect
    .poll(async () => (await dashboardGeometry(page))?.cardHeights[1])
    .toBeGreaterThan(500);
  geometry = await dashboardGeometry(page);
  expect(geometry).not.toBeNull();
  expect(geometry.listScrollHeights[0]).toBeLessThanOrEqual(
    geometry.listClientHeights[0] + 1,
  );
  expect(geometry.listScrollHeights[1]).toBeGreaterThan(
    geometry.listClientHeights[1] + 40,
  );
  expect(geometry.cardHeights[1]).toBeGreaterThan(
    geometry.cardHeights[0] + 100,
  );
  expect(geometry.cardHeights[1]).toBeLessThanOrEqual(630);
  await expectNoHorizontalOverflow(page);
  evidence.geometry.push({
    name: '1366x768-dashboard-long-products',
    ...geometry,
  });
  await capture(page, '1366x768-dashboard-long-products');
});

test('mobile workbench remains touch-safe', async ({ page }) => {
  const seedName = 'UI Mobile Workbench Agent';
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAndSeed(page, 'ui-mobile-workbench-agent', seedName);
  await page.goto(url('/'));
  await expect(page.getByRole('region', { name: '会话情况' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await captureCoreSurfaces(page, '390x844', seedName);
  await expectNoHorizontalOverflow(page);

  await openSection(page, '客服坐席', '客服账号');
  const contextButtons = page.locator('.admin-context-navigation nav button');
  await expect(contextButtons).toHaveCount(2);
  for (const button of await contextButtons.all()) {
    expect(
      await button.evaluate(
        (element) => element.getBoundingClientRect().height,
      ),
    ).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: '新增客服', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增客服' });
  const geometry = await dialog.evaluate((element) => {
    const input = element.querySelector('input');
    const primary = element.querySelector(
      '.agent-editor-footer .primary-button',
    );
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      radius: Number.parseFloat(
        globalThis.getComputedStyle(element).borderRadius,
      ),
      inputSize: input
        ? Number.parseFloat(globalThis.getComputedStyle(input).fontSize)
        : 0,
      primaryHeight: primary?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(389);
  expect(geometry.height).toBeGreaterThanOrEqual(843);
  expect(geometry.radius).toBe(0);
  expect(geometry.inputSize).toBeGreaterThanOrEqual(16);
  expect(geometry.primaryHeight).toBeGreaterThanOrEqual(48);
});

test('site logo is compressed in browser before unique R2 replacement', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAndSeed(page, 'ui-logo-agent', 'UI Logo Agent');
  await page.goto(url('/'));
  const logoInput = await openBranding(page);

  const first = await generatedPng(page, 1024, 256, '#5145cd');
  await logoInput.setInputFiles({
    name: 'wide-logo.png',
    mimeType: 'image/png',
    buffer: first,
  });
  await expect(page.locator('.admin-brand-mark img').first()).toHaveAttribute(
    'src',
    /^\/client\/v1\/site-logo\/[0-9a-f-]+$/u,
  );
  const firstUrl = await page
    .locator('.admin-brand-mark img')
    .getAttribute('src');
  expect(firstUrl).toMatch(/^\/client\/v1\/site-logo\/[0-9a-f-]+$/u);

  const second = await generatedPng(page, 900, 900, '#3730a3');
  await logoInput.setInputFiles({
    name: 'square-logo.png',
    mimeType: 'image/png',
    buffer: second,
  });
  await expect(
    page.locator('.admin-brand-mark img').first(),
  ).not.toHaveAttribute('src', firstUrl);
  const secondUrl = await page
    .locator('.admin-brand-mark img')
    .getAttribute('src');
  expect(secondUrl).not.toBe(firstUrl);
  expect((await page.request.get(url(firstUrl))).status()).toBe(404);

  await logoInput.setInputFiles({
    name: 'not-image.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByRole('alert')).toContainText(
    '仅支持 PNG、JPG 或 WebP',
  );
});
