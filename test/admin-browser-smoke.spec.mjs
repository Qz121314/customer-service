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
  await expect(page.getByText('产品流量分布', { exact: true })).toBeVisible();
  await expect(page.locator('.product-traffic-analysis')).toBeVisible();

  const monthPicker = page.getByRole('button', {
    name: /选择统计月份/u,
  });
  await monthPicker.click();
  const monthDialog = page.getByRole('dialog', { name: '选择统计月份' });
  await expect(monthDialog).toBeVisible();
  const monthPickerGeometry = await monthDialog.evaluate((element) => {
    const browser = globalThis;
    const style = browser.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      background: style.backgroundColor,
      borderRadius: Number.parseFloat(style.borderRadius),
      width: rect.width,
      withinViewport:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= browser.innerWidth &&
        rect.bottom <= browser.innerHeight,
    };
  });
  expect(monthPickerGeometry.background).toBe('rgb(255, 255, 255)');
  expect(monthPickerGeometry.borderRadius).toBeGreaterThanOrEqual(18);
  expect(monthPickerGeometry.width).toBeGreaterThanOrEqual(280);
  expect(monthPickerGeometry.withinViewport).toBeTruthy();
  await expect(monthDialog.getByRole('button', { name: '8月' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(monthDialog).toBeHidden();

  const geometry = await page.evaluate(() => {
    const browser = globalThis;
    const root = browser.document.scrollingElement;
    const content = browser.document.querySelector('.admin-content');
    const workspace = browser.document.querySelector(
      '.product-traffic-workspace',
    );
    const layout = browser.document.querySelector('.product-traffic-analysis');
    const hero = browser.document.querySelector('.product-traffic-hero');
    const productKpi = browser.document.querySelector(
      '.product-kpi-card.is-products',
    );
    const distribution = browser.document.querySelector(
      '.product-distribution-card',
    );
    const ranking = browser.document.querySelector('.product-ranking-card');
    const trend = browser.document.querySelector('.product-trend-card');
    const quality = browser.document.querySelector('.product-quality-card');

    if (
      !root ||
      !(content instanceof browser.HTMLElement) ||
      !(workspace instanceof browser.HTMLElement) ||
      !(layout instanceof browser.HTMLElement) ||
      !(hero instanceof browser.HTMLElement) ||
      !(productKpi instanceof browser.HTMLElement) ||
      !(distribution instanceof browser.HTMLElement) ||
      !(ranking instanceof browser.HTMLElement) ||
      !(trend instanceof browser.HTMLElement) ||
      !(quality instanceof browser.HTMLElement)
    ) {
      return null;
    }

    const contentRect = content.getBoundingClientRect();
    const workspaceRect = workspace.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();
    const heroRect = hero.getBoundingClientRect();
    const productKpiRect = productKpi.getBoundingClientRect();
    const distributionRect = distribution.getBoundingClientRect();
    const rankingRect = ranking.getBoundingClientRect();
    const trendRect = trend.getBoundingClientRect();
    const qualityRect = quality.getBoundingClientRect();

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
      heroWidth: heroRect.width,
      productKpiWidth: productKpiRect.width,
      distributionHeight: distributionRect.height,
      distributionWidth: distributionRect.width,
      rankingHeight: rankingRect.height,
      rankingWidth: rankingRect.width,
      trendHeight: trendRect.height,
      trendWidth: trendRect.width,
      trendBottom: trendRect.bottom,
      qualityWidth: qualityRect.width,
      cardRadius: Number.parseFloat(
        browser.getComputedStyle(hero).borderRadius,
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
    violations.push('product traffic workspace is clipped below content');
  }
  if (!(geometry.layoutWidth > 900 && geometry.layoutHeight > 250)) {
    violations.push('product traffic analysis is not the primary workspace');
  }
  if (geometry.layoutOverflowX !== 'hidden') {
    violations.push(`analysis overflow-x=${geometry.layoutOverflowX}`);
  }
  if (geometry.cardRadius < 18) {
    violations.push('bento cards lack high-fidelity rounded geometry');
  }
  if (geometry.heroWidth <= geometry.productKpiWidth * 1.8) {
    violations.push('hero and KPI cards lack bento size contrast');
  }
  if (Math.abs(geometry.distributionHeight - geometry.rankingHeight) > 1) {
    violations.push('product distribution and ranking heights diverge');
  }
  if (geometry.distributionHeight > 220) {
    violations.push('product summary cards waste vertical space');
  }
  if (geometry.rankingWidth <= geometry.distributionWidth * 1.5) {
    violations.push('distribution and ranking lack bento width contrast');
  }
  if (geometry.trendHeight < 150) {
    violations.push('daily trend is not readable');
  }
  if (geometry.trendBottom > geometry.contentBottom + 1) {
    violations.push('daily trend is clipped below content');
  }
  if (geometry.trendWidth <= geometry.qualityWidth * 2.4) {
    violations.push('trend and quality cards lack bento width contrast');
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
});
