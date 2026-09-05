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

test('admin mobile defaults to Dashboard and keeps management flows touch-friendly', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAdminStatistics(page, {
    name: 'UI Admin Mobile Agent',
    username: 'ui-admin-mobile-agent',
  });

  let adminBootstrapRequests = 0;
  let trafficStatsRequests = 0;
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/admin/bootstrap') adminBootstrapRequests += 1;
    if (pathname === '/api/admin/traffic-stats') trafficStatsRequests += 1;
  });

  await page.goto(url('/'));

  await expect(page.getByRole('heading', { name: '仪表板' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /仪表板/u }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('button', { name: /流量统计/u })).toHaveCount(0);
  await expect(page.getByText('运营数据', { exact: true })).toBeVisible();
  await expect(page.getByText('会话总览', { exact: true })).toBeVisible();
  await expect(page.getByText('客服接待分布', { exact: true })).toBeVisible();
  await expect(page.getByText('产品会话分布', { exact: true })).toBeVisible();
  await expect.poll(() => adminBootstrapRequests).toBe(1);
  await expect.poll(() => trafficStatsRequests).toBe(1);

  const dashboardGeometry = await page.evaluate(() => {
    const browser = globalThis;
    const root = browser.document.scrollingElement;
    const sidebar = browser.document.querySelector('.admin-sidebar');
    const nav = browser.document.querySelector('.admin-nav');
    const utilities = browser.document.querySelectorAll(
      '.admin-sidebar-foot > a, .admin-sidebar-foot > button',
    );
    const rangeButtons = browser.document.querySelectorAll(
      '.traffic-range-switcher button',
    );
    const totalCard = browser.document.querySelector('.traffic-total-card');
    if (
      !root ||
      !(sidebar instanceof browser.HTMLElement) ||
      !(nav instanceof browser.HTMLElement) ||
      !(totalCard instanceof browser.HTMLElement)
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
      rangeButtonHeights: [...rangeButtons].map(
        (button) => button.getBoundingClientRect().height,
      ),
      totalRadius: Number.parseFloat(
        browser.getComputedStyle(totalCard).borderRadius,
      ),
      fakeVisualCount: browser.document.querySelectorAll(
        '.traffic-total-visual',
      ).length,
    };
  });

  expect(dashboardGeometry).not.toBeNull();
  if (dashboardGeometry) {
    expect(dashboardGeometry.rootScrollWidth).toBeLessThanOrEqual(
      dashboardGeometry.rootClientWidth + 1,
    );
    expect(dashboardGeometry.sidebarPosition).toBe('sticky');
    expect(dashboardGeometry.navColumns.split(' ')).toHaveLength(3);
    expect(dashboardGeometry.utilitySizes).toHaveLength(2);
    for (const utility of dashboardGeometry.utilitySizes) {
      expect(utility.width).toBeGreaterThanOrEqual(40);
      expect(utility.height).toBeGreaterThanOrEqual(40);
    }
    for (const height of dashboardGeometry.rangeButtonHeights) {
      expect(height).toBeGreaterThanOrEqual(40);
    }
    expect(dashboardGeometry.totalRadius).toBeLessThanOrEqual(12);
    expect(dashboardGeometry.fakeVisualCount).toBe(0);
  }

  await page.getByRole('button', { name: /客服坐席/u }).click();
  await expect(page.getByRole('heading', { name: '客服坐席' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '分流诊断', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '新增客服', exact: true }),
  ).toBeVisible();
  await expect.poll(() => trafficStatsRequests).toBe(1);

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
      !(overview instanceof browser.HTMLElement) ||
      !(row instanceof browser.HTMLElement) ||
      !(actions instanceof browser.HTMLElement)
    ) {
      return null;
    }
    return {
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
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

  await page.getByRole('button', { name: /访客体验/u }).click();
  await expect(
    page.getByRole('heading', { name: '无客服提示语' }),
  ).toBeVisible();
  const mobileSettingsGeometry = await page.evaluate(() => {
    const browser = globalThis;
    const root = browser.document.scrollingElement;
    const card = browser.document.querySelector('.no-agent-settings-card');
    const textarea = card?.querySelector('textarea');
    const formatButtons = card?.querySelectorAll(
      '.no-agent-format-switch button',
    );
    const actions = card?.querySelector('.no-agent-settings-actions');
    const saveButton = actions?.querySelector('.primary-button');
    if (
      !root ||
      !(card instanceof browser.HTMLElement) ||
      !(textarea instanceof browser.HTMLElement) ||
      !formatButtons ||
      !(actions instanceof browser.HTMLElement) ||
      !(saveButton instanceof browser.HTMLElement)
    ) {
      return null;
    }
    return {
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      cardWidth: card.getBoundingClientRect().width,
      viewportWidth: browser.innerWidth,
      textareaFontSize: Number.parseFloat(
        browser.getComputedStyle(textarea).fontSize,
      ),
      textareaHeight: textarea.getBoundingClientRect().height,
      formatButtonHeights: [...formatButtons].map(
        (button) => button.getBoundingClientRect().height,
      ),
      saveButtonHeight: saveButton.getBoundingClientRect().height,
      actionsPosition: browser.getComputedStyle(actions).position,
    };
  });
  expect(mobileSettingsGeometry).not.toBeNull();
  if (mobileSettingsGeometry) {
    expect(mobileSettingsGeometry.rootScrollWidth).toBeLessThanOrEqual(
      mobileSettingsGeometry.rootClientWidth + 1,
    );
    expect(mobileSettingsGeometry.cardWidth).toBeLessThanOrEqual(
      mobileSettingsGeometry.viewportWidth + 1,
    );
    expect(mobileSettingsGeometry.textareaFontSize).toBeGreaterThanOrEqual(16);
    expect(mobileSettingsGeometry.textareaHeight).toBeLessThanOrEqual(460);
    for (const height of mobileSettingsGeometry.formatButtonHeights) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
    expect(mobileSettingsGeometry.saveButtonHeight).toBeGreaterThanOrEqual(48);
    expect(mobileSettingsGeometry.actionsPosition).toBe('sticky');
  }

  await page.getByRole('button', { name: /客服坐席/u }).click();
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

test('admin desktop Dashboard is data-first and management sections remain operational', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  await seedAdminStatistics(page);

  let adminBootstrapRequests = 0;
  let trafficStatsRequests = 0;
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/admin/bootstrap') adminBootstrapRequests += 1;
    if (pathname === '/api/admin/traffic-stats') trafficStatsRequests += 1;
  });

  await page.goto(url('/'));

  await expect(page.getByRole('heading', { name: '仪表板' })).toBeVisible();
  await expect(page.getByRole('button', { name: /流量统计/u })).toHaveCount(0);
  await expect(page.getByText('运营数据', { exact: true })).toBeVisible();
  await expect(page.getByText('会话总览', { exact: true })).toBeVisible();
  await expect(page.getByText('客服接待分布', { exact: true })).toBeVisible();
  await expect(page.getByText('产品会话分布', { exact: true })).toBeVisible();
  await expect.poll(() => adminBootstrapRequests).toBe(1);
  await expect.poll(() => trafficStatsRequests).toBe(1);

  await page.getByRole('button', { name: '近 7 天', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '近 7 天', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => trafficStatsRequests).toBe(2);

  const geometry = await page.evaluate(() => {
    const browser = globalThis;
    const root = browser.document.scrollingElement;
    const content = browser.document.querySelector('.admin-content');
    const sidebar = browser.document.querySelector('.admin-sidebar');
    const nav = browser.document.querySelector('.admin-nav');
    const workspace = browser.document.querySelector('.traffic-overview');
    const layout = browser.document.querySelector('.traffic-overview-grid');
    const total = browser.document.querySelector('.traffic-total-card');
    const distributions = browser.document.querySelectorAll(
      '.traffic-distribution-card',
    );
    if (
      !root ||
      !(content instanceof browser.HTMLElement) ||
      !(sidebar instanceof browser.HTMLElement) ||
      !(nav instanceof browser.HTMLElement) ||
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
    const layoutRect = layout.getBoundingClientRect();
    const totalRect = total.getBoundingClientRect();
    const agentRect = distributions[0].getBoundingClientRect();
    const productRect = distributions[1].getBoundingClientRect();
    return {
      rootClientWidth: root.clientWidth,
      rootScrollWidth: root.scrollWidth,
      contentRight: contentRect.right,
      contentOverflowY: browser.getComputedStyle(content).overflowY,
      sidebarWidth: sidebar.getBoundingClientRect().width,
      navCount: nav.querySelectorAll('button').length,
      layoutWidth: layoutRect.width,
      totalWidth: totalRect.width,
      agentWidth: agentRect.width,
      productWidth: productRect.width,
      totalRadius: Number.parseFloat(
        browser.getComputedStyle(total).borderRadius,
      ),
      distributionRadius: Number.parseFloat(
        browser.getComputedStyle(distributions[0]).borderRadius,
      ),
      fakeVisualCount: browser.document.querySelectorAll(
        '.traffic-total-visual',
      ).length,
    };
  });

  expect(geometry).not.toBeNull();
  if (!geometry) return;
  const violations = [];
  if (geometry.rootScrollWidth > geometry.rootClientWidth + 1) {
    violations.push('document horizontal overflow');
  }
  if (geometry.contentRight > 1440 + 1) {
    violations.push('admin content exceeds viewport width');
  }
  if (geometry.contentOverflowY !== 'auto') {
    violations.push(`admin content overflow-y=${geometry.contentOverflowY}`);
  }
  if (!(geometry.sidebarWidth >= 190 && geometry.sidebarWidth <= 230)) {
    violations.push('sidebar is not compact');
  }
  if (geometry.navCount !== 3) {
    violations.push('sidebar navigation should contain exactly three sections');
  }
  if (geometry.layoutWidth < 900) {
    violations.push('dashboard data workspace is too narrow');
  }
  if (
    geometry.totalWidth <= 0 ||
    geometry.agentWidth <= 0 ||
    geometry.productWidth <= 0
  ) {
    violations.push('dashboard cards are not visible');
  }
  if (geometry.totalRadius > 12 || geometry.distributionRadius > 12) {
    violations.push('dashboard surfaces are excessively rounded');
  }
  if (geometry.fakeVisualCount !== 0) {
    violations.push('dashboard contains decorative fake trend visualization');
  }

  writeFileSync(
    '/tmp/admin-viewport-geometry.json',
    `${JSON.stringify({ geometry, violations }, null, 2)}\n`,
  );
  expect(
    violations,
    `ADMIN_VIEWPORT_GEOMETRY ${JSON.stringify(geometry)}`,
  ).toEqual([]);

  await page.getByRole('button', { name: /访客体验/u }).click();
  await expect(
    page.getByRole('heading', { name: '无客服提示语' }),
  ).toBeVisible();
  const desktopSettingsGeometry = await page.evaluate(() => {
    const browser = globalThis;
    const root = browser.document.scrollingElement;
    const content = browser.document.querySelector('.admin-content');
    const card = browser.document.querySelector('.no-agent-settings-card');
    const textarea = card?.querySelector('textarea');
    const actions = card?.querySelector('.no-agent-settings-actions');
    if (
      !root ||
      !(content instanceof browser.HTMLElement) ||
      !(card instanceof browser.HTMLElement) ||
      !(textarea instanceof browser.HTMLElement) ||
      !(actions instanceof browser.HTMLElement)
    ) {
      return null;
    }
    const contentRect = content.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const actionsRect = actions.getBoundingClientRect();
    return {
      rootScrollWidth: root.scrollWidth,
      rootClientWidth: root.clientWidth,
      contentOverflowY: browser.getComputedStyle(content).overflowY,
      contentBottom: contentRect.bottom,
      cardRight: cardRect.right,
      cardWidth: cardRect.width,
      cardRadius: Number.parseFloat(browser.getComputedStyle(card).borderRadius),
      textareaHeight: textarea.getBoundingClientRect().height,
      actionsBottom: actionsRect.bottom,
    };
  });
  expect(desktopSettingsGeometry).not.toBeNull();
  if (desktopSettingsGeometry) {
    expect(desktopSettingsGeometry.rootScrollWidth).toBeLessThanOrEqual(
      desktopSettingsGeometry.rootClientWidth + 1,
    );
    expect(desktopSettingsGeometry.contentOverflowY).toBe('auto');
    expect(desktopSettingsGeometry.cardWidth).toBeLessThanOrEqual(760);
    expect(desktopSettingsGeometry.cardRight).toBeLessThanOrEqual(1440);
    expect(desktopSettingsGeometry.cardRadius).toBeLessThanOrEqual(12);
    expect(desktopSettingsGeometry.textareaHeight).toBeLessThanOrEqual(220);
    expect(desktopSettingsGeometry.actionsBottom).toBeLessThanOrEqual(
      desktopSettingsGeometry.contentBottom + 1,
    );
  }

  await page.getByRole('button', { name: /客服坐席/u }).click();
  const agentRow = page
    .getByRole('row')
    .filter({ hasText: 'UI Admin Smoke Agent' })
    .first();
  await expect(agentRow).toBeVisible();
  await expect(
    page.getByRole('button', { name: '分流诊断', exact: true }),
  ).toBeVisible();

  await page.evaluate(() => {
    const body = globalThis.document.querySelector('.admin-agent-table tbody');
    const row = body?.querySelector('tr');
    if (!body || !row) return;
    for (let index = 0; index < 12; index += 1) {
      body.append(row.cloneNode(true));
    }
  });
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
    expect(editorGeometry.radius).toBeGreaterThanOrEqual(8);
    expect(editorGeometry.radius).toBeLessThanOrEqual(14);
  }
});

test('admin create modal remains usable from the Agents workspace', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 760 });
  const adminLogin = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(adminLogin.ok()).toBeTruthy();

  await page.goto(url('/'));
  await expect(page.getByRole('heading', { name: '仪表板' })).toBeVisible();
  await page.getByRole('button', { name: /客服坐席/u }).click();
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
