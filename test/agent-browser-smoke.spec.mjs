import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';
const agentUsername = 'ui-smoke-agent';
const agentPassword = 'ui-smoke-pass';
const productId = 'ui-smoke-product';

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

async function seedConversationAndAgent(page) {
  const conversation = await page.request.post(
    url('/client/v1/conversations'),
    {
      data: {
        visitorId: 'UIT001',
        sourceHandoffId: '11111111-1111-4111-8111-111111111111',
        clientMessageId: 'ui-smoke-message-1',
        message: '你好，这是 UI smoke 会话',
        product: {
          id: productId,
          sectionId: 'ui-smoke-section',
          sectionName: 'Smoke Section',
          categoryId: 'ui-smoke-category',
          categoryName: 'Smoke Category',
          title: 'UI Smoke Product',
          href: 'https://example.com/ui-smoke-product',
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
      name: 'UI Smoke Agent',
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
  await expect(
    page.getByRole('button', { name: /UI Smoke Product/u }),
  ).toBeVisible();
}

async function expectCenteredDialog(page) {
  const dialog = page.getByRole('dialog', { name: '客服头像' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(48);
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThan(
    72,
  );
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test('agent desktop and mobile interaction surfaces remain usable', async ({
  page,
}) => {
  let quickReplyServerRequests = 0;
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname.startsWith('/api/agent/quick-replies')
    ) {
      quickReplyServerRequests += 1;
    }
  });

  await seedConversationAndAgent(page);
  await loginAgent(page);

  const avatarButton = page.getByRole('button', { name: '更换客服头像' });
  await expect(avatarButton).toBeVisible();
  await avatarButton.click();
  await expectCenteredDialog(page);
  await expect(
    page.getByText('图片只在本机压缩和预览，确认后才上传。'),
  ).toBeVisible();
  await page.getByRole('button', { name: '关闭' }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(avatarButton).toBeVisible();
  const mobileAvatarBox = await avatarButton.boundingBox();
  expect(mobileAvatarBox?.width ?? 0).toBeGreaterThanOrEqual(34);
  expect(mobileAvatarBox?.height ?? 0).toBeGreaterThanOrEqual(34);
  await avatarButton.click();
  await expectCenteredDialog(page);
  await page.getByRole('button', { name: '关闭' }).click();

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole('button', { name: /UI Smoke Product/u }).click();
  const composer = page.getByPlaceholder('输入回复内容…');
  await expect(composer).toBeVisible();
  await expect(page.getByLabel('会话状态')).toBeVisible();

  const quickReplyTrigger = page.locator('.quick-replies-trigger');
  await quickReplyTrigger.click();
  await page.getByPlaceholder('名称，例如：发货说明').fill('UI Smoke Reply');
  await page.getByPlaceholder('输入常用回复内容').fill('本地快捷回复内容');
  await page.getByRole('button', { name: '保存快捷回复' }).click();
  await expect(page.getByText('UI Smoke Reply')).toBeVisible();
  await page.getByText('UI Smoke Reply').click();
  await expect(composer).toHaveValue('本地快捷回复内容');
  expect(quickReplyServerRequests).toBe(0);

  await page.reload();
  await expect(page.getByText('我的会话')).toBeVisible();
  await page.getByRole('button', { name: /UI Smoke Product/u }).click();
  await page.locator('.quick-replies-trigger').click();
  await expect(page.getByText('UI Smoke Reply')).toBeVisible();
  expect(quickReplyServerRequests).toBe(0);

  await page.getByText('UI Smoke Reply').click();
  await page.setViewportSize({ width: 390, height: 700 });
  const mobileComposer = page.getByPlaceholder('输入回复内容…');
  await mobileComposer.focus();
  const composerBox = await mobileComposer.boundingBox();
  const viewport = page.viewportSize();
  expect(composerBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (composerBox && viewport) {
    expect(composerBox.x).toBeGreaterThanOrEqual(0);
    expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(
      viewport.width + 1,
    );
    expect(composerBox.y + composerBox.height).toBeLessThanOrEqual(
      viewport.height + 1,
    );
  }

  const backButton = page.getByRole('button', { name: '返回会话列表' });
  const backBox = await backButton.boundingBox();
  expect(backBox?.width ?? 0).toBeGreaterThanOrEqual(38);
  expect(backBox?.height ?? 0).toBeGreaterThanOrEqual(38);
  const quickReplyBox = await page
    .locator('.quick-replies-trigger')
    .boundingBox();
  expect(quickReplyBox?.width ?? 0).toBeGreaterThanOrEqual(38);
  expect(quickReplyBox?.height ?? 0).toBeGreaterThanOrEqual(38);
});
