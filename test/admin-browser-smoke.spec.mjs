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

async function openSection(page, name) {
  await page.getByRole('button', { name: new RegExp(name, 'u') }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function expectNoHorizontalOverflow(page) {
  const geometry = await page.evaluate(() => {
    const root = globalThis.document.scrollingElement;
    return root ? [root.clientWidth, root.scrollWidth] : [0, 1];
  });
  expect(geometry[1]).toBeLessThanOrEqual(geometry[0] + 1);
}

async function agentsGeometry(page) {
  return page.evaluate(() => {
    const overview = globalThis.document.querySelector('.admin-overview-strip');
    const table = globalThis.document.querySelector('.admin-table-card');
    const toolbar = globalThis.document.querySelector('.admin-list-toolbar');
    if (!overview || !table || !toolbar) return null;
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
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      columns: globalThis.getComputedStyle(primary).gridTemplateColumns.split(' ')
        .length,
      accountHeight: account.getBoundingClientRect().height,
      operationsHeight: operations.getBoundingClientRect().height,
      routingHeight: routing.getBoundingClientRect().height,
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
          (result) => (result ? resolve(result) : reject(new Error('png failed'))),
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

async function captureCoreSurfaces(page, key, seedName) {
  await expect(page.getByText('运营数据', { exact: true })).toBeVisible();
  await capture(page, `${key}-dashboard`);

  await openSection(page, '客服坐席');
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

  await openSection(page, '站点设置');
  await expect(page.getByText('无客服提示语', { exact: true })).toBeVisible();
  await capture(page, `${key}-site-settings`);
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
    await openSection(page, '客服坐席');

    const agents = await agentsGeometry(page);
    expect(agents).not.toBeNull();
    expect(agents.summaryHeight).toBeLessThanOrEqual(60);
    expect(agents.summaryWidth).toBeGreaterThanOrEqual(agents.tableWidth * 0.98);
    expect(agents.tableHeight).toBeGreaterThan(agents.summaryHeight * 2);
    expect(agents.tableTop).toBeGreaterThanOrEqual(agents.summaryBottom);
    expect(agents.toolbarHeight).toBeLessThanOrEqual(58);
    evidence.geometry.push({ name: `${key}-agents`, ...agents });

    await page.getByRole('button', { name: '新增客服', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新增客服' });
    const editor = await editorGeometry(dialog);
    expect(editor).not.toBeNull();
    expect(editor.top).toBeGreaterThanOrEqual(0);
    expect(editor.bottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(editor.footerBottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(editor.columns).toBe(2);
    expect(editor.operationsHeight).toBeGreaterThan(editor.accountHeight + 12);
    expect(editor.routingHeight).toBeLessThan(editor.height * 0.4);
    expect(editor.scrollCapacity).toBeLessThanOrEqual(48);
    evidence.geometry.push({ name: `${key}-editor`, ...editor });
    await dialog.getByRole('button', { name: '关闭' }).click();

    await page.goto(url('/'));
    await captureCoreSurfaces(page, key, seedName);
  }
});

test('mobile workbench remains touch-safe', async ({ page }) => {
  const seedName = 'UI Mobile Workbench Agent';
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAndSeed(page, 'ui-mobile-workbench-agent', seedName);
  await page.goto(url('/'));
  await expect(page.getByRole('heading', { name: '仪表板' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await captureCoreSurfaces(page, '390x844', seedName);
  await expectNoHorizontalOverflow(page);

  await openSection(page, '客服坐席');
  await page.getByRole('button', { name: '新增客服', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增客服' });
  const geometry = await dialog.evaluate((element) => {
    const input = element.querySelector('input');
    const primary = element.querySelector('.agent-editor-footer .primary-button');
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      radius: Number.parseFloat(globalThis.getComputedStyle(element).borderRadius),
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
  await openSection(page, '站点设置');

  const first = await generatedPng(page, 1024, 256, '#5145cd');
  await page.locator('.site-logo-file-input').setInputFiles({
    name: 'wide-logo.png',
    mimeType: 'image/png',
    buffer: first,
  });
  await expect(page.getByText('压缩预览', { exact: true })).toBeVisible();
  await expect(page.locator('.site-logo-meta')).toContainText('512 × 128');
  await expect(page.locator('.site-logo-meta')).toContainText('WEBP');
  await page.getByRole('button', { name: '上传 Logo', exact: true }).click();
  await expect(page.getByText('当前 Logo', { exact: true })).toBeVisible();
  const firstUrl = await page.locator('.admin-brand-mark img').getAttribute('src');
  expect(firstUrl).toMatch(/^\/client\/v1\/site-logo\/[0-9a-f-]+$/u);

  const second = await generatedPng(page, 900, 900, '#3730a3');
  await page.getByRole('button', { name: '替换图片', exact: true }).click();
  await page.locator('.site-logo-file-input').setInputFiles({
    name: 'square-logo.png',
    mimeType: 'image/png',
    buffer: second,
  });
  await page.getByRole('button', { name: '上传 Logo', exact: true }).click();
  await expect(page.getByText('当前 Logo', { exact: true })).toBeVisible();
  const secondUrl = await page.locator('.admin-brand-mark img').getAttribute('src');
  expect(secondUrl).not.toBe(firstUrl);
  expect((await page.request.get(url(firstUrl))).status()).toBe(404);

  await page.getByRole('button', { name: '移除', exact: true }).click();
  await expect(page.locator('.admin-brand-mark')).toContainText('CS');
  expect((await page.request.get(url(secondUrl))).status()).toBe(404);

  await page.locator('.site-logo-file-input').setInputFiles({
    name: 'not-image.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not an image'),
  });
  await expect(page.getByRole('alert')).toContainText('仅支持 PNG、JPG 或 WebP');
});
