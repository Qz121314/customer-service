import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';
const agentUsername = 'ui-admin-smoke-agent';
const agentPassword = 'ui-admin-smoke-pass';

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

async function seedAdminStatistics(page) {
  const adminLogin = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(adminLogin.ok()).toBeTruthy();

  const createAgent = await page.request.post(url('/api/admin/agents'), {
    data: {
      name: 'UI Admin Smoke Agent',
      username: agentUsername,
      password: agentPassword,
      routingScope: { type: 'none' },
      maxActiveConversations: 5,
      dailyConversationLimit: 0,
      trafficQuotaEnabled: false,
      trafficQuotaTopUp: 0,
      trafficQuotaRequestId: '',
      isEnabled: true,
    },
  });
  expect(createAgent.ok()).toBeTruthy();
}

test('admin traffic statistics owns one desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 650 });
  await seedAdminStatistics(page);
  await page.goto(url('/'));

  await expect(page.getByRole('button', { name: /流量统计/u })).toBeVisible();
  await page.getByRole('button', { name: /流量统计/u }).click();
  await expect(page.getByText('会话流量分布', { exact: true })).toBeVisible();
  await expect(page.getByText('会话总数', { exact: true })).toBeVisible();
  await expect(page.getByText('客服接待分布', { exact: true })).toBeVisible();
  await expect(page.getByText('产品会话分布', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '近 7 天', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '近 7 天', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  const geometry = await page.evaluate(() => {
    const browser = globalThis;
    const root = browser.document.scrollingElement;
    const content = browser.document.querySelector('.admin-content');
    const workspace = browser.document.querySelector('.traffic-overview');
    const layout = browser.document.querySelector('.traffic-overview-grid');
    const total = browser.document.querySelector('.traffic-total-card');
    const distributions = browser.document.querySelectorAll(
      '.traffic-distribution-card',
    );

    if (
      !root ||
      !(content instanceof browser.HTMLElement) ||
      !(workspace instanceof browser.HTMLElement) ||
      !(layout instanceof browser.HTMLElement) ||
      !(total instanceof browser.HTMLElement) ||
      distributions.length !== 2 ||
      !(distributions[0] instanceof browser.HTMLElement) ||
      !(distributions[1] instanceof browser.HTMLElement)
    ) {
      return null;
    }

    const contentRect = content.getBoundingClientRect();
    const workspaceRect = workspace.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();
    const totalRect = total.getBoundingClientRect();
    const agentRect = distributions[0].getBoundingClientRect();
    const productRect = distributions[1].getBoundingClientRect();

    return {
      innerWidth: browser.innerWidth,
      innerHeight: browser.innerHeight,
      rootClientWidth: root.clientWidth,
      rootClientHeight: root.clientHeight,
      rootScrollWidth: root.scrollWidth,
      rootScrollHeight: root.scrollHeight,
      htmlOverflowX: browser.getComputedStyle(browser.document.documentElement)
        .overflowX,
      htmlOverflowY: browser.getComputedStyle(browser.document.documentElement)
        .overflowY,
      contentRight: contentRect.right,
      contentBottom: contentRect.bottom,
      workspaceBottom: workspaceRect.bottom,
      layoutWidth: layoutRect.width,
      layoutHeight: layoutRect.height,
      layoutOverflowX: browser.getComputedStyle(layout).overflowX,
      totalWidth: totalRect.width,
      totalHeight: totalRect.height,
      agentWidth: agentRect.width,
      agentHeight: agentRect.height,
      productWidth: productRect.width,
      productHeight: productRect.height,
      cardsBottom: Math.max(
        totalRect.bottom,
        agentRect.bottom,
        productRect.bottom,
      ),
      cardRadius: Number.parseFloat(
        browser.getComputedStyle(total).borderRadius,
      ),
    };
  });

  expect(geometry).not.toBeNull();
  if (!geometry) return;

  const violations = [];

  if (geometry.rootScrollWidth > geometry.rootClientWidth + 1) {
    violations.push('document horizontal overflow');
  }
  if (geometry.rootScrollHeight > geometry.rootClientHeight + 1) {
    violations.push('document vertical overflow');
  }
  if (geometry.htmlOverflowX !== 'hidden') {
    violations.push(`html overflow-x=${geometry.htmlOverflowX}`);
  }
  if (geometry.htmlOverflowY !== 'hidden') {
    violations.push(`html overflow-y=${geometry.htmlOverflowY}`);
  }
  if (geometry.contentRight > geometry.innerWidth + 1) {
    violations.push('admin content exceeds viewport width');
  }
  if (geometry.contentBottom > geometry.innerHeight + 1) {
    violations.push('admin content exceeds viewport height');
  }
  if (geometry.workspaceBottom > geometry.contentBottom + 1) {
    violations.push('traffic workspace is clipped below content');
  }
  if (!(geometry.layoutWidth > 900 && geometry.layoutHeight > 250)) {
    violations.push('traffic overview is not the primary workspace');
  }
  if (geometry.layoutOverflowX !== 'hidden') {
    violations.push(`analysis overflow-x=${geometry.layoutOverflowX}`);
  }
  if (geometry.cardRadius < 18) {
    violations.push('bento cards lack high-fidelity rounded geometry');
  }
  if (geometry.totalWidth >= geometry.agentWidth) {
    violations.push('total card should stay narrower than a distribution card');
  }
  if (Math.abs(geometry.agentHeight - geometry.productHeight) > 1) {
    violations.push('agent and product distribution heights diverge');
  }
  if (geometry.totalHeight < 300 || geometry.agentHeight < 300) {
    violations.push('traffic distribution cards are not readable');
  }
  if (geometry.cardsBottom > geometry.contentBottom + 1) {
    violations.push('traffic cards are clipped below content');
  }

  writeFileSync(
    '/tmp/admin-viewport-geometry.json',
    `${JSON.stringify({ geometry, violations }, null, 2)}\n`,
  );

  expect(
    violations,
    `ADMIN_VIEWPORT_GEOMETRY ${JSON.stringify(geometry)}`,
  ).toEqual([]);

  await page.getByRole('button', { name: /客服账号/u }).click();
  const agentRow = page
    .getByRole('row')
    .filter({ hasText: 'UI Admin Smoke Agent' })
    .first();
  const rowActions = agentRow.locator('.admin-agent-actions');
  await expect(rowActions).toBeVisible();
  const actionGeometry = await rowActions.evaluate((element) => {
    const browser = globalThis;
    const buttons = [...element.querySelectorAll('button')];
    return {
      direction: browser.getComputedStyle(element).flexDirection,
      buttons: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          whiteSpace: browser.getComputedStyle(button).whiteSpace,
        };
      }),
    };
  });
  expect(actionGeometry.direction).toBe('row');
  expect(actionGeometry.buttons).toHaveLength(3);
  for (const button of actionGeometry.buttons) {
    expect(button.width).toBeGreaterThanOrEqual(44);
    expect(button.height).toBeGreaterThanOrEqual(30);
    expect(button.whiteSpace).toBe('nowrap');
  }
  await agentRow
    .getByRole('button', { name: '统计', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('dialog', { name: /UI Admin Smoke Agent · 接待统计/u }),
  ).toBeVisible();
  await expect(page.getByText('每日接待', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: /选择统计月份/u })
    .last()
    .click();
  await expect(
    page.getByRole('dialog', { name: '选择统计月份' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '选择统计月份' })).toBeHidden();
  await page.getByRole('button', { name: '关闭客服统计' }).click();

  await agentRow.getByRole('button', { name: '删除', exact: true }).click();
  const deleteDialog = page.getByRole('alertdialog', {
    name: /删除“UI Admin Smoke Agent”/u,
  });
  await expect(deleteDialog).toBeVisible();
  await expect(
    deleteDialog.getByText(/历史会话与流量统计继续保留/u),
  ).toBeVisible();
  await deleteDialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(deleteDialog).toBeHidden();

  await agentRow.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑客服' });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: '保存修改' })).toBeVisible();
  const editorGeometry = await editor.evaluate((element) => {
    const browser = globalThis;
    const layout = element.querySelector('.agent-editor-layout');
    const footer = element.querySelector('.agent-editor-footer');
    if (
      !(layout instanceof browser.HTMLElement) ||
      !(footer instanceof browser.HTMLElement)
    ) {
      return null;
    }
    const dialogRect = element.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    return {
      dialogTop: dialogRect.top,
      dialogBottom: dialogRect.bottom,
      footerBottom: footerRect.bottom,
      innerHeight: browser.innerHeight,
      scrollbarWidth: browser.getComputedStyle(layout, '::-webkit-scrollbar')
        .width,
      layoutOverflowY: browser.getComputedStyle(layout).overflowY,
      radius: Number.parseFloat(browser.getComputedStyle(element).borderRadius),
    };
  });
  expect(editorGeometry).not.toBeNull();
  if (editorGeometry) {
    expect(editorGeometry.dialogTop).toBeGreaterThanOrEqual(0);
    expect(editorGeometry.dialogBottom).toBeLessThanOrEqual(
      editorGeometry.innerHeight + 1,
    );
    expect(editorGeometry.footerBottom).toBeLessThanOrEqual(
      editorGeometry.innerHeight + 1,
    );
    expect(editorGeometry.scrollbarWidth).toBe('8px');
    expect(editorGeometry.layoutOverflowY).toBe('auto');
    expect(editorGeometry.radius).toBeGreaterThanOrEqual(20);
  }
});
