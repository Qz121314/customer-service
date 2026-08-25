import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';
const agentUsername = 'ui-mobile-menu-agent';
const agentPassword = 'ui-mobile-menu-pass';
const productId = 'ui-mobile-menu-product';

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

async function seedWorkspace(page) {
  const conversation = await page.request.post(
    url('/client/v1/conversations'),
    {
      data: {
        visitorId: 'MOBILEMENU001',
        sourceHandoffId: '22222222-2222-4222-8222-222222222222',
        clientMessageId: 'ui-mobile-menu-message-1',
        message: '移动端功能菜单回归测试',
        product: {
          id: productId,
          sectionId: 'mobile-menu-section',
          sectionName: 'Mobile Menu Section',
          categoryId: 'mobile-menu-category',
          categoryName: 'Mobile Menu Category',
          title: 'Mobile Menu Product',
          href: 'https://example.com/mobile-menu-product',
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
      name: 'Mobile Menu Agent',
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

async function loginAgent(page) {
  await page.goto(url('/agent'));
  await page.getByLabel('客服账号').fill(agentUsername);
  await page.getByLabel('登录密码').fill(agentPassword);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByText('我的会话')).toBeVisible();
}

test('mobile settings keeps its navigation context after child dialogs close', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedWorkspace(page);
  await loginAgent(page);

  await page.getByRole('button', { name: '打开功能菜单' }).click();
  const settingsPage = page.getByRole('region', { name: '功能菜单' });
  await expect(settingsPage).toBeVisible();
  await expect(settingsPage.getByText('设备与提醒')).toBeVisible();
  await expect(settingsPage.getByText('接待', { exact: true })).toBeVisible();
  await expect(settingsPage.getByText('账号', { exact: true })).toBeVisible();

  const settingsGeometry = await settingsPage.evaluate((element) => {
    const cards = [...element.querySelectorAll('.mobile-agent-settings-card')];
    const rect = element.getBoundingClientRect();
    const view = element.ownerDocument.defaultView;
    return {
      width: rect.width,
      height: rect.height,
      cardCount: cards.length,
      cardRadii: cards.map((card) =>
        Number.parseFloat(view?.getComputedStyle(card).borderRadius ?? '0'),
      ),
    };
  });
  expect(settingsGeometry.width).toBeLessThanOrEqual(390);
  expect(settingsGeometry.height).toBeLessThanOrEqual(844);
  expect(settingsGeometry.cardCount).toBe(2);
  expect(settingsGeometry.cardRadii.every((radius) => radius >= 16)).toBeTruthy();

  await settingsPage.getByRole('button', { name: /首次问候语/u }).click();
  const autoReplyDialog = page.getByRole('dialog', { name: '首次问候语' });
  await expect(autoReplyDialog).toBeVisible();
  await page
    .getByRole('button', { name: '关闭自动回复设置' })
    .click();
  await expect(autoReplyDialog).toBeHidden();
  await expect(settingsPage).toBeVisible();

  await settingsPage.getByRole('button', { name: /接待流量/u }).click();
  const statsDialog = page.getByRole('dialog', { name: /接待数据/u });
  await expect(statsDialog).toBeVisible();
  await page.getByRole('button', { name: '关闭接待流量' }).click();
  await expect(statsDialog).toBeHidden();
  await expect(settingsPage).toBeVisible();

  await settingsPage.getByRole('button', { name: '返回工作台' }).click();
  await expect(settingsPage).toBeHidden();
  await expect(page.getByText('我的会话')).toBeVisible();
});
