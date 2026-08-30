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

async function seedAdminStatistics(
  page,
  { name = 'UI Admin Smoke Agent', username = agentUsername } = {},
) {
  const adminLogin = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(adminLogin.ok()).toBeTruthy();

  const createAgent = await page.request.post(url('/api/admin/agents'), {
    data: {
      name,
      adminLabel: '1号',
      username,
      password: agentPassword,
      routingScope: { type: 'none' },
      dailyConversationLimit: 0,
      trafficQuotaEnabled: false,
      trafficQuotaTopUp: 0,
      trafficQuotaRequestId: '',
      isEnabled: true,
    },
  });
  expect(createAgent.ok()).toBeTruthy();
}

test('admin mobile viewport keeps monitoring and utilities touch-friendly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAdminStatistics(page, {
    name: 'UI Admin Mobile Agent',
    username: 'ui-admin-mobile-agent',
  });
  await page.goto(url('/'));

  await expect(page.getByRole('heading', { name: '客服坐席' })).toBeVisible();
  await expect(page.getByRole('link', { name: '坐席工作台' })).toBeVisible();
  await expect(page.getByRole('button', { name: '退出管理' })).toBeVisible();

  const agentRow = page
    .getByRole('row')
    .filter({ hasText: 'UI Admin Mobile Agent' })
    .first();
  await expect(agentRow).toBeVisible();
  const agentMarker = agentRow.getByText('1号', { exact: true });
  await expect(agentMarker).toBeVisible();
  await expect(agentMarker).toHaveCSS('color', 'rgb(217, 45, 32)');

  const agentsGeometry = await page.evaluate(() => {
    const browser = globalThis;
    const root = browser.document.scrollingElement;
    const sidebar = browser.document.querySelector('.admin-sidebar');
    const nav = browser.document.querySelector('.admin-nav');
    const utilities = browser.document.querySelectorAll(
      '.admin-sidebar-foot > a, .admin-sidebar-foot > button',
    );
    const overviewCards = browser.document.querySelectorAll(
      '.admin-overview-strip > div',
    );
    const overview = browser.document.querySelector('.admin-overview-strip');
    const row = [...browser.document.querySelectorAll('tbody tr')].find(
      (element) => element.textContent?.includes('UI Admin Mobile Agent'),
    );
    const actions = row?.querySelector('.admin-agent-actions');

    if (
      !root ||
      !(sidebar instanceof browser.HTMLElement) ||
      !(nav instanceof browser.HTMLElement) ||
      !(overview instanceof browser.HTMLElement) ||
      !(row instanceof browser.HTMLElement) ||
      !(actions instanceof browser.HTMLElement)
    ) {
      return null;
    }

    return {
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      sidebarPosition: browser.getComputedStyle(sidebar).position,
      navColumns: browser.getComputedStyle(nav).gridTemplateColumns,
      utilitySizes: [...utilities].map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
      overviewCount: overviewCards.length,
      overviewColumns: browser.getComputedStyle(overview).gridTemplateColumns,
      rowWidth: row.getBoundingClientRect().width,
      viewportWidth: browser.innerWidth,
      actionsDisplay: browser.getComputedStyle(actions).display,
      actionHeights: [...actions.querySelectorAll('button')].map(
        (button) => button.getBoundingClientRect().height,
      ),
    };
  });

  expect(agentsGeometry).not.toBeNull();
  if (agentsGeometry) {
    expect(agentsGeometry.rootScrollWidth).toBeLessThanOrEqual(
      agentsGeometry.rootClientWidth + 1,
    );
    expect(agentsGeometry.sidebarPosition).toBe('sticky');
    expect(agentsGeometry.navColumns.split(' ')).toHaveLength(2);
    expect(agentsGeometry.utilitySizes).toHaveLength(2);
    for (const utility of agentsGeometry.utilitySizes) {
      expect(utility.width).toBeGreaterThanOrEqual(40);
      expect(utility.height).toBeGreaterThanOrEqual(40);
    }
    expect(agentsGeometry.overviewCount).toBe(4);
    expect(agentsGeometry.overviewColumns.split(' ')).toHaveLength(2);
    expect(agentsGeometry.rowWidth).toBeLessThanOrEqual(
      agentsGeometry.viewportWidth,
    );
    expect(agentsGeometry.actionsDisplay).toBe('grid');
    for (const height of agentsGeometry.actionHeights) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
  }

  await page.getByRole('button', { name: /流量统计/u }).click();
  await expect(page.getByText('会话流量分布', { exact: true })).toBeVisible();
  const statisticsGeometry = await page.evaluate(() => {
    const browser = globalThis;
    const total = browser.document.querySelector('.traffic-total-card');
    const distribution = browser.document.querySelector(
      '.traffic-distribution-card',
    );
    const rangeButton = browser.document.querySelector(
      '.traffic-range-switcher button',
    );
    if (
      !(total instanceof browser.HTMLElement) ||
      !(distribution instanceof browser.HTMLElement) ||
      !(rangeButton instanceof browser.HTMLElement)
    ) {
      return null;
    }
    return {
      totalHeight: total.getBoundingClientRect().height,
      distributionHeight: distribution.getBoundingClientRect().height,
      rangeButtonHeight: rangeButton.getBoundingClientRect().height,
      scrollWidth: browser.document.scrollingElement?.scrollWidth ?? 0,
      clientWidth: browser.document.scrollingElement?.clientWidth ?? 0,
    };
  });
  expect(statisticsGeometry).not.toBeNull();
  if (statisticsGeometry) {
    expect(statisticsGeometry.totalHeight).toBeLessThanOrEqual(300);
    expect(statisticsGeometry.distributionHeight).toBeLessThanOrEqual(430);
    expect(statisticsGeometry.rangeButtonHeight).toBeGreaterThanOrEqual(40);
    expect(statisticsGeometry.scrollWidth).toBeLessThanOrEqual(
      statisticsGeometry.clientWidth + 1,
    );
  }

  await page.getByRole('button', { name: /客服账号/u }).click();
  await agentRow.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑客服' });
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel(/客服标记/u)).toHaveValue('1号');
  const editorGeometry = await editor.evaluate((element) => {
    const browser = globalThis;
    const input = element.querySelector('input');
    const footerButton = element.querySelector(
      '.agent-editor-footer .primary-button',
    );
    const rect = element.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      viewportWidth: browser.innerWidth,
      viewportHeight: browser.innerHeight,
      radius: Number.parseFloat(browser.getComputedStyle(element).borderRadius),
      inputFontSize:
        input instanceof browser.HTMLElement
          ? Number.parseFloat(browser.getComputedStyle(input).fontSize)
          : 0,
      footerButtonHeight:
        footerButton instanceof browser.HTMLElement
          ? footerButton.getBoundingClientRect().height
          : 0,
    };
  });
  expect(editorGeometry.width).toBeGreaterThanOrEqual(
    editorGeometry.viewportWidth - 1,
  );
  expect(editorGeometry.height).toBeGreaterThanOrEqual(
    editorGeometry.viewportHeight - 1,
  );
  expect(editorGeometry.radius).toBe(0);
  expect(editorGeometry.inputFontSize).toBeGreaterThanOrEqual(16);
  expect(editorGeometry.footerButtonHeight).toBeGreaterThanOrEqual(48);
});

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
  await expect(agentRow).toBeVisible();

  await page.evaluate(() => {
    const body = globalThis.document.querySelector('.admin-agent-table tbody');
    const row = body?.querySelector('tr');
    if (!body || !row) return;
    for (let index = 0; index < 12; index += 1) {
      body.append(row.cloneNode(true));
    }
  });
  await agentRow.hover();
  const scrollBefore = await page
    .locator('.admin-content')
    .evaluate((element) => element.scrollTop);
  await page.mouse.wheel(0, 520);
  await expect
    .poll(() =>
      page.locator('.admin-content').evaluate((element) => element.scrollTop),
    )
    .toBeGreaterThan(scrollBefore);
  await page
    .locator('.admin-content')
    .evaluate((element) => element.scrollTo({ top: 0 }));
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
  expect(actionGeometry.buttons).toHaveLength(2);
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

  await agentRow.getByRole('button', { name: '编辑', exact: true }).click();
  const editor = page.getByRole('dialog', { name: '编辑客服' });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: '保存修改' })).toBeVisible();
  await expect(editor.getByRole('button', { name: '删除客服' })).toBeVisible();
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

test('admin create modal remains usable when no deletion is active', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  const adminLogin = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(adminLogin.ok()).toBeTruthy();

  await page.goto(url('/'));
  await page
    .getByRole('button', { name: '新增客服', exact: true })
    .first()
    .click();

  const editor = page.getByRole('dialog', { name: '新增客服' });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: '关闭' })).toBeEnabled();

  const createButton = editor.getByRole('button', { name: '创建客服' });
  await expect(createButton).toBeDisabled();

  const username = 'ui-create-smoke-agent';
  await editor.getByLabel('账号', { exact: true }).fill(username);
  await editor
    .getByLabel('登录密码', { exact: true })
    .fill('ui-create-smoke-pass');
  await expect(createButton).toBeEnabled();

  await createButton.click();
  await expect(editor).toBeHidden();
  await expect(
    page.getByRole('row').filter({ hasText: username }).first(),
  ).toBeVisible();
});
