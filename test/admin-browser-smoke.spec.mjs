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

  const geometry = await page.evaluate(() => {
    const browser = globalThis;
    const root = browser.document.scrollingElement;
    const content = browser.document.querySelector('.admin-content');
    const layout = browser.document.querySelector('.product-traffic-analysis');

    if (
      !root ||
      !(content instanceof browser.HTMLElement) ||
      !(layout instanceof browser.HTMLElement)
    ) {
      return null;
    }

    const contentRect = content.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();

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
      layoutWidth: layoutRect.width,
      layoutHeight: layoutRect.height,
      layoutOverflowX: browser.getComputedStyle(layout).overflowX,
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
  if (!(geometry.layoutWidth > 900 && geometry.layoutHeight > 250)) {
    violations.push('product traffic analysis is not the primary workspace');
  }
  if (geometry.layoutOverflowX !== 'hidden') {
    violations.push(`analysis overflow-x=${geometry.layoutOverflowX}`);
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
  await page.getByRole('button', { name: '统计' }).click();
  await expect(
    page.getByRole('dialog', { name: /UI Admin Smoke Agent · 接待统计/u }),
  ).toBeVisible();
  await expect(page.getByText('每日接待', { exact: true })).toBeVisible();
});
