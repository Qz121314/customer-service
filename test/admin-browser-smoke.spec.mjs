import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';
const agentUsername = 'ui-admin-smoke-agent';
const agentPassword = 'ui-admin-smoke-pass';
const productId = 'ui-admin-smoke-product';

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

async function seedAdminStatistics(page) {
  const conversation = await page.request.post(
    url('/client/v1/conversations'),
    {
      data: {
        visitorId: 'UIADMIN001',
        sourceHandoffId: '22222222-2222-4222-8222-222222222222',
        clientMessageId: 'ui-admin-smoke-message-1',
        message: '管理员统计页布局 smoke 数据',
        product: {
          id: productId,
          sectionId: 'ui-admin-smoke-section',
          sectionName: 'Admin Smoke Section',
          categoryId: 'ui-admin-smoke-category',
          categoryName: 'Admin Smoke Category',
          title: 'Admin Smoke Product',
          href: 'https://example.com/ui-admin-smoke-product',
          coverUrl: null,
        },
      },
    },
  );
  expect(conversation.ok()).toBeTruthy();

  const adminLogin = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(adminLogin.ok()).toBeTruthy();

  const createAgent = await page.request.post(url('/api/admin/agents'), {
    data: {
      name: 'UI Admin Smoke Agent',
      username: agentUsername,
      password: agentPassword,
      routingScope: { type: 'product', productIds: [productId] },
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
  await expect(page.getByText('月度流量对账', { exact: true })).toBeVisible();
  await expect(page.locator('.statistics-seat-layout')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const browser = globalThis;
    const root = browser.document.scrollingElement;
    const content = browser.document.querySelector('.admin-content');
    const layout = browser.document.querySelector('.statistics-seat-layout');
    const seatSelector = browser.document.querySelector(
      '.statistics-seat-sidebar',
    );

    if (
      !root ||
      !(content instanceof browser.HTMLElement) ||
      !(layout instanceof browser.HTMLElement) ||
      !(seatSelector instanceof browser.HTMLElement)
    ) {
      return null;
    }

    const contentRect = content.getBoundingClientRect();
    const layoutRect = layout.getBoundingClientRect();
    const seatRect = seatSelector.getBoundingClientRect();

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
      seatWidth: seatRect.width,
      seatHeight: seatRect.height,
      seatOverflowX: browser.getComputedStyle(seatSelector).overflowX,
      seatOverflowY: browser.getComputedStyle(seatSelector).overflowY,
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
  if (!(geometry.seatWidth > geometry.layoutWidth * 0.95)) {
    violations.push('seat selector is not full width');
  }
  if (!(geometry.seatHeight < 100)) {
    violations.push('seat selector is not horizontal/compact');
  }
  if (geometry.seatOverflowX !== 'hidden') {
    violations.push(`seat overflow-x=${geometry.seatOverflowX}`);
  }
  if (geometry.seatOverflowY !== 'hidden') {
    violations.push(`seat overflow-y=${geometry.seatOverflowY}`);
  }

  expect(
    violations,
    `ADMIN_VIEWPORT_GEOMETRY ${JSON.stringify(geometry)}`,
  ).toEqual([]);
});
