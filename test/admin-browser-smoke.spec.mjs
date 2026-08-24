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
  await expect(page.getByText('月度流量对账', { exact: true })).toBeVisible();
  await expect(page.locator('.statistics-seat-layout')).toBeVisible();

  const geometry = await page.evaluate(() => {
    const browser = globalThis;
    const root = browser.document.scrollingElement;
    const content = browser.document.querySelector('.admin-content');
    const summary = browser.document.querySelector('.statistics-global-summary');
    const kpiCards = [
      ...browser.document.querySelectorAll('.statistics-kpi-card'),
    ];
    const layout = browser.document.querySelector('.statistics-seat-layout');
    const seatSelector = browser.document.querySelector(
      '.statistics-seat-sidebar',
    );

    if (
      !root ||
      !(content instanceof browser.HTMLElement) ||
      !(summary instanceof browser.HTMLElement) ||
      kpiCards.length !== 4 ||
      kpiCards.some((card) => !(card instanceof browser.HTMLElement)) ||
      !(layout instanceof browser.HTMLElement) ||
      !(seatSelector instanceof browser.HTMLElement)
    ) {
      return null;
    }

    const contentRect = content.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    const cardRects = kpiCards.map((card) => card.getBoundingClientRect());
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
      summaryLeft: summaryRect.left,
      summaryRight: summaryRect.right,
      summaryWidth: summaryRect.width,
      summaryHeight: summaryRect.height,
      cardRects: cardRects.map((rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      })),
      layoutLeft: layoutRect.left,
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
  const [firstCard, secondCard, thirdCard, fourthCard] = geometry.cardRects;

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
  if (!(geometry.summaryWidth < 260)) {
    violations.push('global KPI rail is too wide');
  }
  if (!(geometry.summaryHeight > geometry.summaryWidth * 1.8)) {
    violations.push('global KPI summary is not a vertical rail');
  }
  if (
    !firstCard ||
    !secondCard ||
    !thirdCard ||
    !fourthCard ||
    !(secondCard.top > firstCard.bottom) ||
    !(thirdCard.top > secondCard.bottom) ||
    !(fourthCard.top > thirdCard.bottom)
  ) {
    violations.push('global KPI cards are not vertically stacked');
  }
  if (
    firstCard &&
    secondCard &&
    Math.abs(firstCard.left - secondCard.left) > 1
  ) {
    violations.push('global KPI cards do not share one vertical rail');
  }
  if (!(geometry.layoutLeft > geometry.summaryRight)) {
    violations.push('operational canvas does not sit beside KPI rail');
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

  writeFileSync(
    '/tmp/admin-viewport-geometry.json',
    `${JSON.stringify({ geometry, violations }, null, 2)}\n`,
  );

  expect(
    violations,
    `ADMIN_VIEWPORT_GEOMETRY ${JSON.stringify(geometry)}`,
  ).toEqual([]);
});
