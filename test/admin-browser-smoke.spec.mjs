import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword = process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';
const evidence = { screenshots: {}, geometry: [] };

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

function saveEvidence() {
  writeFileSync('/tmp/admin-viewport-geometry.json', `${JSON.stringify(evidence)}\n`);
}

async function capture(page, name) {
  const image = await page.screenshot({ animations: 'disabled' });
  evidence.screenshots[name] = image.toString('base64');
  saveEvidence();
}

async function loginAndSeed(page, username, name) {
  expect(
    (await page.request.post(url('/api/auth/login'), {
      data: { password: adminPassword },
    })).ok(),
  ).toBeTruthy();
  expect(
    (await page.request.post(url('/api/admin/agents'), {
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
    })).ok(),
  ).toBeTruthy();
}

async function openAgents(page) {
  await page.getByRole('button', { name: /客服坐席/u }).click();
  await expect(page.getByRole('heading', { name: '客服坐席' })).toBeVisible();
}

async function openSettings(page) {
  await page.getByRole('button', { name: /站点设置/u }).click();
  await expect(page.getByRole('heading', { name: '站点设置' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '站点品牌' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '访客侧客服体验' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '无客服提示语' })).toBeVisible();
}

async function noXOverflow(page) {
  const width = await page.evaluate(() => {
    const root = document.scrollingElement;
    return root ? [root.clientWidth, root.scrollWidth] : [0, 1];
  });
  expect(width[1]).toBeLessThanOrEqual(width[0] + 1);
}

async function agentsGeometry(page) {
  return page.evaluate(() => {
    const root = document.scrollingElement;
    const overview = document.querySelector('.admin-overview-strip');
    const table = document.querySelector('.admin-table-card');
    const toolbar = document.querySelector('.admin-list-toolbar');
    const metrics = [...document.querySelectorAll('.admin-overview-metric')];
    if (!root || !overview || !table || !toolbar) return null;
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
      toolbarRight: toolbar.getBoundingClientRect().right,
      viewportWidth: innerWidth,
      metrics: metrics.map((metric) => {
        const label = metric.querySelector('.admin-overview-label');
        const value = metric.querySelector('strong');
        const a = label?.getBoundingClientRect();
        const b = value?.getBoundingClientRect();
        return {
          display: getComputedStyle(metric).display,
          whiteSpace: label ? getComputedStyle(label).whiteSpace : '',
          labelHeight: a?.height ?? 0,
          centerDelta: a && b ? Math.abs(a.top + a.height / 2 - b.top - b.height / 2) : 99,
        };
      }),
    };
  });
}

async function editorGeometry(page) {
  const editor = page.getByRole('dialog', { name: '新增客服' });
  return editor.evaluate((element) => {
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
      viewportHeight: innerHeight,
      columns: getComputedStyle(primary).gridTemplateColumns.split(' ').length,
      routingHeight: routing.getBoundingClientRect().height,
      footerBottom: footer.getBoundingClientRect().bottom,
      scrollCapacity: layout.scrollHeight - layout.clientHeight,
      scrollTop: layout.scrollTop,
      documentScrollCapacity: document.documentElement.scrollHeight - innerHeight,
    };
  });
}

async function captureSurfaceSet(page, key) {
  await capture(page, `${key}-dashboard`);
  await openAgents(page);
  await capture(page, `${key}-agents`);
  await page.getByRole('button', { name: '新增客服', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: '新增客服' })).toBeVisible();
  await capture(page, `${key}-new-agent-editor`);
  await page.getByRole('dialog', { name: '新增客服' }).getByRole('button', { name: '关闭' }).click();
  await openSettings(page);
  await capture(page, `${key}-site-settings`);
  await openAgents(page);
  await page.getByRole('button', { name: '分流诊断', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '分流诊断' })).toBeVisible();
  await capture(page, `${key}-routing-diagnose`);
  await page.getByRole('button', { name: '关闭' }).last().click();
}

test('mobile corrective IA and touch geometry remain usable', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: /流量统计/u })).toHaveCount(0);
  await expect.poll(() => bootstrap).toBe(1);
  await expect.poll(() => stats).toBe(1);
  await noXOverflow(page);
  await capture(page, '390x844-dashboard');

  await openAgents(page);
  const geometry = await agentsGeometry(page);
  expect(geometry).not.toBeNull();
  if (geometry) {
    expect(geometry.xOverflow).toBeLessThanOrEqual(1);
    expect(geometry.metrics).toHaveLength(4);
    for (const metric of geometry.metrics) {
      expect(metric.whiteSpace).toBe('nowrap');
      expect(metric.labelHeight).toBeLessThanOrEqual(22);
      expect(metric.centerDelta).toBeLessThan(8);
    }
  }
  const row = page.getByRole('row').filter({ hasText: 'UI Admin Mobile Agent' }).first();
  for (const button of await row.locator('.admin-agent-actions button').all()) {
    expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await capture(page, '390x844-agents');

  await openSettings(page);
  await noXOverflow(page);
  expect(Number.parseFloat(await page.locator('.no-agent-message-field textarea').evaluate((el) => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  expect((await page.locator('.no-agent-settings-actions .primary-button').boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  await capture(page, '390x844-site-settings');

  await openAgents(page);
  await page.getByRole('button', { name: '新增客服', exact: true }).first().click();
  const editor = page.getByRole('dialog', { name: '新增客服' });
  const mobileEditor = await editor.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const input = el.querySelector('input');
    const primary = el.querySelector('.agent-editor-footer .primary-button');
    return {
      width: rect.width,
      height: rect.height,
      radius: Number.parseFloat(getComputedStyle(el).borderRadius),
      inputSize: input ? Number.parseFloat(getComputedStyle(input).fontSize) : 0,
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
  await page.getByRole('button', { name: '关闭' }).last().click();
});

test('required desktop viewports keep Agents list-first and Editor first-screen usable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAndSeed(page, 'ui-corrective-visual-agent', 'UI Corrective Visual Agent');
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1280, height: 800 },
  ]) {
    const key = `${viewport.width}x${viewport.height}`;
    await page.setViewportSize(viewport);
    await page.goto(url('/'));
    await expect(page.getByRole('heading', { name: '仪表板' })).toBeVisible();
    await noXOverflow(page);
    await openAgents(page);
    const agents = await agentsGeometry(page);
    expect(agents).not.toBeNull();
    if (agents) {
      expect(agents.xOverflow).toBeLessThanOrEqual(1);
      expect(agents.overviewWidth).toBeGreaterThanOrEqual(agents.tableWidth * 0.95);
      expect(agents.overviewHeight).toBeLessThanOrEqual(72);
      expect(agents.tableTop).toBeGreaterThanOrEqual(agents.overviewBottom);
      expect(agents.tableHeight).toBeGreaterThan(agents.overviewHeight * 2);
      expect(agents.toolbarRight).toBeLessThanOrEqual(agents.viewportWidth + 1);
      expect(agents.metrics).toHaveLength(4);
      for (const metric of agents.metrics) {
        expect(metric.display).toBe('flex');
        expect(metric.whiteSpace).toBe('nowrap');
        expect(metric.labelHeight).toBeLessThanOrEqual(22);
        expect(metric.centerDelta).toBeLessThan(8);
      }
      evidence.geometry.push({ name: `${key}-agents`, ...agents });
    }
    await page.getByRole('button', { name: '新增客服', exact: true }).first().click();
    const editor = await editorGeometry(page);
    expect(editor).not.toBeNull();
    if (editor) {
      expect(editor.top).toBeGreaterThanOrEqual(0);
      expect(editor.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(editor.footerBottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(editor.columns).toBe(2);
      expect(editor.routingHeight).toBeLessThan(editor.height * 0.48);
      expect(editor.scrollCapacity).toBeLessThanOrEqual(80);
      expect(editor.scrollTop).toBe(0);
      expect(editor.documentScrollCapacity).toBeLessThanOrEqual(1);
      evidence.geometry.push({ name: `${key}-editor`, ...editor });
    }
    await page.getByRole('dialog', { name: '新增客服' }).getByRole('button', { name: '关闭' }).click();
    await page.goto(url('/'));
    await captureSurfaceSet(page, key);
  }
  saveEvidence();
});

test('site logo explicit upload/delete and management behavior remain intact', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAndSeed(page, 'ui-admin-smoke-agent', 'UI Admin Smoke Agent');
  await page.goto(url('/'));
  await openSettings(page);
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,4,0,0,0,181,28,12,2,0,0,0,11,73,68,65,84,120,218,99,100,248,15,0,1,5,1,1,39,24,227,102,0,0,0,0,73,69,78,68,174,66,96,130]);
  await page.locator('.site-logo-file-input').setInputFiles({ name: 'site-logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.locator('.admin-brand-mark img')).toBeVisible();
  await expect(page.getByRole('button', { name: '替换 Logo' })).toBeVisible();
  await page.getByRole('button', { name: '恢复默认' }).click();
  await expect(page.locator('.admin-brand-mark img')).toHaveCount(0);
  await expect(page.locator('.admin-brand-mark')).toContainText('CS');

  await openAgents(page);
  const row = page.getByRole('row').filter({ hasText: 'UI Admin Smoke Agent' }).first();
  await expect(row.getByText('1号', { exact: true })).toHaveCSS('color', 'rgb(180, 35, 24)');
  await row.getByRole('button', { name: '统计', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /UI Admin Smoke Agent · 接待统计/u })).toBeVisible();
  await page.getByRole('button', { name: '关闭客服统计' }).click();
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '编辑客服' }).getByLabel(/客服标记/u)).toHaveValue('1号');
});
