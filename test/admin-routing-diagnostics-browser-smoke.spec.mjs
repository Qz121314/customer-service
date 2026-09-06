import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';
const evidencePath = '/tmp/admin-viewport-geometry.json';

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

function loadEvidence() {
  if (!existsSync(evidencePath)) return { screenshots: {}, geometry: [] };
  try {
    return JSON.parse(readFileSync(evidencePath, 'utf8'));
  } catch {
    return { screenshots: {}, geometry: [] };
  }
}

async function capture(page, name, geometry) {
  const evidence = loadEvidence();
  evidence.screenshots[name] = (
    await page.screenshot({ animations: 'disabled' })
  ).toString('base64');
  if (geometry) evidence.geometry.push({ name, ...geometry });
  writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
}

async function seedDiagnostics(page) {
  const login = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(login.ok()).toBeTruthy();
  const bootstrap = await page.request.get(url('/api/admin/bootstrap'));
  expect(bootstrap.ok()).toBeTruthy();
  const payload = await bootstrap.json();
  const product = payload.products.find((item) => item.isEnabled);
  expect(product).toBeTruthy();

  const agents = [
    ['diag-online-a', '诊断 A', true],
    ['diag-online-b', '诊断 B', true],
    ['diag-offline-c', '诊断 C', false],
    ['diag-offline-d', '诊断 D', false],
  ];
  for (const [username, name, online] of agents) {
    const created = await page.request.post(url('/api/admin/agents'), {
      data: {
        name,
        adminLabel: name,
        username,
        password: 'routing-smoke-pass',
        routingScope: { type: 'product', productIds: [product.id] },
        dailyConversationLimit: 0,
        trafficQuotaEnabled: false,
        trafficQuotaTopUp: 0,
        trafficQuotaRequestId: '',
        isEnabled: true,
      },
    });
    expect(created.ok()).toBeTruthy();
    if (online) {
      const agentLogin = await page.request.post(url('/api/agent/auth/login'), {
        data: { username, password: 'routing-smoke-pass' },
      });
      expect(agentLogin.ok()).toBeTruthy();
    }
  }
  return product;
}

async function openDiagnostics(page) {
  await page.getByRole('button', { name: /客服坐席/u }).click();
  await expect(page.getByRole('heading', { name: '客服账号' })).toBeVisible();
  const context = page.locator('.admin-context-navigation');
  await expect(context).toBeVisible();
  await context.getByRole('button', { name: /分流诊断/u }).click();
  await expect(page.getByRole('heading', { name: '分流诊断' })).toBeVisible();
  const workspace = page.locator('.routing-diagnose-workspace');
  await expect(workspace).toBeVisible();
  await expect(workspace.locator('.routing-diagnose-table')).toBeVisible();
  return workspace;
}

async function readGeometry(workspace) {
  return workspace.evaluate((element) => {
    const context = element.querySelector('.routing-diagnose-context');
    const funnel = element.querySelector('.routing-diagnose-funnel');
    const tableWrap = element.querySelector('.routing-diagnose-table-wrap');
    const table = element.querySelector('.routing-diagnose-table');
    const head = element.querySelector('.routing-diagnose-head');
    const content = globalThis.document.querySelector('.admin-content');
    if (!context || !funnel || !tableWrap || !table || !head || !content) {
      return null;
    }
    const rect = element.getBoundingClientRect();
    const tableStyle = globalThis.getComputedStyle(tableWrap);
    return {
      width: rect.width,
      height: rect.height,
      top: rect.top,
      headerHeight: head.getBoundingClientRect().height,
      contextHeight: context.getBoundingClientRect().height,
      funnelHeight: funnel.getBoundingClientRect().height,
      tableHeight: table.getBoundingClientRect().height,
      tableViewportHeight: tableWrap.getBoundingClientRect().height,
      workspacePosition: globalThis.getComputedStyle(element).position,
      contentOverflowY: globalThis.getComputedStyle(content).overflowY,
      tableMaxHeight: tableStyle.maxHeight,
      tableOverflowX: tableStyle.overflowX,
      tableOverflowY: tableStyle.overflowY,
    };
  });
}

async function expectNoDocumentOverflow(page) {
  const widths = await page.evaluate(() => {
    const root = globalThis.document.scrollingElement;
    return root ? [root.clientWidth, root.scrollWidth] : [0, 1];
  });
  expect(widths[1]).toBeLessThanOrEqual(widths[0] + 1);
}

test('routing diagnostics is an inline table-first context workspace', async ({
  page,
}) => {
  await seedDiagnostics(page);
  let bootstrapRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/admin/bootstrap') {
      bootstrapRequests += 1;
    }
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    const key = `${viewport.width}x${viewport.height}-routing-diagnose`;
    await page.setViewportSize(viewport);
    await page.goto(url('/'));
    await expect(page.getByRole('heading', { name: '仪表板' })).toBeVisible();
    await expect(page.locator('.admin-context-navigation')).toHaveCount(0);
    const beforeOpen = bootstrapRequests;
    const workspace = await openDiagnostics(page);
    await expect.poll(() => bootstrapRequests).toBe(beforeOpen);
    await expect(
      workspace.getByText('下一棒', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      workspace.getByText('可分配', { exact: true }).first(),
    ).toBeVisible();
    await expect(
      workspace.getByText('当前不在线', { exact: true }).first(),
    ).toBeVisible();
    await expect(workspace.getByLabel('诊断产品')).toBeVisible();
    await expect(
      workspace.getByRole('button', { name: '刷新', exact: true }),
    ).toBeVisible();

    const geometry = await readGeometry(workspace);
    expect(geometry).not.toBeNull();
    expect(geometry.workspacePosition).not.toBe('fixed');
    expect(geometry.contentOverflowY).toBe('visible');
    expect(geometry.tableMaxHeight).toBe('none');
    expect(geometry.tableOverflowX).toBe('auto');
    expect(['visible', 'auto']).toContain(geometry.tableOverflowY);
    expect(geometry.contextHeight).toBeLessThanOrEqual(
      viewport.width <= 900 ? 190 : 72,
    );
    expect(geometry.funnelHeight).toBeLessThanOrEqual(
      viewport.width <= 900 ? 130 : 64,
    );
    expect(geometry.headerHeight).toBeLessThanOrEqual(
      viewport.width <= 900 ? 116 : 64,
    );
    if (viewport.width >= 1000) {
      expect(geometry.width).toBeGreaterThan(700);
      expect(geometry.tableHeight).toBeGreaterThan(geometry.funnelHeight * 2);
    }
    await expectNoDocumentOverflow(page);
    await capture(page, key, geometry);

    await page
      .locator('.admin-context-navigation')
      .getByRole('button', { name: /客服账号/u })
      .click();
    await expect(workspace).toBeHidden();
    await expect(page.getByRole('heading', { name: '客服账号' })).toBeVisible();
  }

  expect(bootstrapRequests).toBe(4);
});
