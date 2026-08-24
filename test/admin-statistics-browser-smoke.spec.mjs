import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

async function loginAndSeedAgents(page) {
  const login = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(login.ok()).toBeTruthy();

  for (let index = 1; index <= 5; index += 1) {
    const response = await page.request.post(url('/api/admin/agents'), {
      data: {
        name: `Statistics Smoke ${index}`,
        username: `statistics-smoke-${index}`,
        password: 'statistics-smoke-pass',
        routingScope: { type: 'all' },
        maxActiveConversations: 5,
        dailyConversationLimit: 0,
        trafficQuotaEnabled: false,
        trafficQuotaTopUp: 0,
        trafficQuotaRequestId: '',
        isEnabled: true,
      },
    });
    expect(response.ok()).toBeTruthy();
  }
}

async function statisticsGeometry(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const panel = document.querySelector('.admin-statistics-page');
    const workspace = document.querySelector('.admin-statistics-workspace');
    const panelRect = panel?.getBoundingClientRect() ?? null;
    const workspaceRect = workspace?.getBoundingClientRect() ?? null;

    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      documentClientWidth: root.clientWidth,
      documentClientHeight: root.clientHeight,
      documentScrollWidth: root.scrollWidth,
      documentScrollHeight: root.scrollHeight,
      bodyScrollWidth: body.scrollWidth,
      bodyScrollHeight: body.scrollHeight,
      panelRect,
      workspaceRect,
    };
  });
}

async function expectSingleScreenStatistics(page, width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(url('/'));
  await page.getByRole('button', { name: /流量统计/u }).click();
  await expect(page.getByRole('heading', { name: '流量统计' })).toBeVisible();
  await expect(page.getByText('月度流量对账')).toBeVisible();

  const geometry = await statisticsGeometry(page);
  expect(
    geometry.documentScrollWidth,
    JSON.stringify(geometry),
  ).toBeLessThanOrEqual(geometry.documentClientWidth + 1);
  expect(
    geometry.bodyScrollWidth,
    JSON.stringify(geometry),
  ).toBeLessThanOrEqual(geometry.innerWidth + 1);
  expect(
    geometry.documentScrollHeight,
    JSON.stringify(geometry),
  ).toBeLessThanOrEqual(geometry.documentClientHeight + 1);
  expect(
    geometry.bodyScrollHeight,
    JSON.stringify(geometry),
  ).toBeLessThanOrEqual(geometry.innerHeight + 1);

  expect(geometry.panelRect).not.toBeNull();
  expect(geometry.workspaceRect).not.toBeNull();
  if (geometry.panelRect) {
    expect(geometry.panelRect.left).toBeGreaterThanOrEqual(-1);
    expect(geometry.panelRect.right).toBeLessThanOrEqual(
      geometry.innerWidth + 1,
    );
    expect(geometry.panelRect.bottom).toBeLessThanOrEqual(
      geometry.innerHeight + 1,
    );
  }
  if (geometry.workspaceRect) {
    expect(geometry.workspaceRect.right).toBeLessThanOrEqual(
      geometry.innerWidth + 1,
    );
    expect(geometry.workspaceRect.bottom).toBeLessThanOrEqual(
      geometry.innerHeight + 1,
    );
  }
}

test('admin traffic statistics stays within one desktop viewport', async ({
  page,
}) => {
  await loginAndSeedAgents(page);
  await expectSingleScreenStatistics(page, 1614, 870);
  await expectSingleScreenStatistics(page, 1366, 768);
  await expectSingleScreenStatistics(page, 1024, 720);
});
