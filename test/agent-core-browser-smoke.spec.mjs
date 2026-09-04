import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';

test.setTimeout(90_000);

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

async function installSystemNotificationStubs(context) {
  await context.addInitScript(() => {
    const defineNoop = (target, name, value) => {
      try {
        Object.defineProperty(target, name, {
          configurable: true,
          value,
        });
      } catch {
        // Core browser smoke verifies business behavior, not OS notification APIs.
      }
    };

    defineNoop(Navigator.prototype, 'vibrate', () => false);
    defineNoop(Navigator.prototype, 'setAppBadge', async () => undefined);
    defineNoop(Navigator.prototype, 'clearAppBadge', async () => undefined);
    defineNoop(globalThis, 'AudioContext', undefined);
    defineNoop(globalThis, 'webkitAudioContext', undefined);

    if (typeof globalThis.ServiceWorker !== 'undefined') {
      defineNoop(
        globalThis.ServiceWorker.prototype,
        'postMessage',
        () => undefined,
      );
    }
  });
}

async function expectAgentWorkspace(page) {
  await expect(page.locator('.workspace-shell')).toBeVisible();
  await expect(page.locator('.conversation-pane')).toBeVisible();
  await expect(page.getByText('连接正常')).toBeVisible();
}

async function loginAgent(page, username, password) {
  await page.goto(url('/agent'));
  await page.getByLabel('客服账号').fill(username);
  await page.getByLabel('登录密码').fill(password);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expectAgentWorkspace(page);
}

test('core multi-device agent workflow remains usable', async ({
  browser,
  page: adminPage,
}) => {
  const runId = randomUUID().replaceAll('-', '');
  const username = `core-smoke-${runId.slice(0, 14)}`;
  const password = 'core-smoke-pass';
  const productId = `core-smoke-product-${runId}`;
  const visitorId = `COR${String(
    Number.parseInt(runId.slice(0, 6), 16) % 1000,
  ).padStart(3, '0')}`;

  const product = {
    id: productId,
    sectionId: 'core-smoke-section',
    sectionName: 'Core Smoke Section',
    categoryId: 'core-smoke-category',
    categoryName: 'Core Smoke Category',
    title: 'Core Smoke Product',
    href: 'https://example.com/core-smoke-product',
    coverUrl: null,
  };

  const sync = await adminPage.request.post(url('/integration/v1/verify'), {
    headers: { authorization: 'Bearer ui-smoke-integration-token' },
    data: { productCatalog: { products: [product] } },
  });
  expect(sync.ok()).toBeTruthy();

  const adminLogin = await adminPage.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(adminLogin.ok()).toBeTruthy();

  const createdAgent = await adminPage.request.post(url('/api/admin/agents'), {
    data: {
      name: 'Core Smoke Agent',
      username,
      password,
      routingScope: { type: 'product', productIds: [productId] },
      dailyConversationLimit: 0,
      trafficQuotaEnabled: false,
      trafficQuotaTopUp: 0,
      trafficQuotaRequestId: '',
      isEnabled: true,
    },
  });
  expect(createdAgent.ok()).toBeTruthy();

  const desktopContext = await browser.newContext();
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  await installSystemNotificationStubs(desktopContext);
  await installSystemNotificationStubs(phoneContext);

  const desktop = await desktopContext.newPage();
  const phone = await phoneContext.newPage();

  try {
    await loginAgent(desktop, username, password);
    await loginAgent(phone, username, password);

    await phone
      .locator('.availability-pill[title="点击切换为忙碌状态"]')
      .click();
    await expect(
      phone.locator('.availability-pill[title="点击切换为在线状态"]'),
    ).toBeVisible();
    await expect(
      desktop.locator('.availability-pill[title="点击切换为在线状态"]'),
    ).toBeVisible();

    await phone
      .locator('.availability-pill[title="点击切换为在线状态"]')
      .click();
    await expect(
      desktop.locator('.availability-pill[title="点击切换为忙碌状态"]'),
    ).toBeVisible();

    const createConversation = await adminPage.request.post(
      url('/client/v1/conversations'),
      {
        headers: { 'CF-Connecting-IP': '198.51.100.27' },
        data: {
          visitorId,
          sourceHandoffId: randomUUID(),
          clientMessageId: `core-smoke-initial-${runId}`,
          message: 'Hello from the core smoke visitor',
          product,
        },
      },
    );
    expect(createConversation.ok()).toBeTruthy();
    const created = await createConversation.json();
    const conversationId = created.conversation.id;

    for (const device of [desktop, phone]) {
      const conversation = device.getByRole('button', {
        name: /Core Smoke Product/u,
      });
      await expect(conversation).toBeVisible({ timeout: 15_000 });
      await conversation.click();
      await expect(device.getByPlaceholder('输入回复内容…')).toBeVisible();
    }

    await phone.getByPlaceholder('输入回复内容…').fill('Phone reply');
    await phone.getByRole('button', { name: '发送' }).click();
    await expect(
      desktop.getByRole('main').getByText('Phone reply'),
    ).toBeVisible();

    const visitorReply = await adminPage.request.post(
      url(`/client/v1/conversations/${conversationId}/messages`),
      {
        data: {
          visitorId,
          projectId: 'default',
          clientMessageId: `core-smoke-visitor-${runId}`,
          body: 'Visitor reply on both devices',
        },
      },
    );
    expect(visitorReply.ok()).toBeTruthy();
    await expect(
      desktop.getByRole('main').getByText('Visitor reply on both devices'),
    ).toBeVisible();
    await expect(
      phone.getByRole('main').getByText('Visitor reply on both devices'),
    ).toBeVisible();

    await phone.getByRole('button', { name: '返回会话列表' }).click();
    await expect(phone.getByText('我的会话')).toBeVisible();
    await phone.getByRole('button', { name: '打开功能菜单' }).click();
    await phone.getByRole('button', { name: /退出客服账号/u }).click();
    await expect(
      phone.getByRole('button', { name: '进入工作台' }),
    ).toBeVisible();

    await expectAgentWorkspace(desktop);
    await desktop
      .getByPlaceholder('输入回复内容…')
      .fill('Desktop still active');
    await desktop.getByRole('button', { name: '发送' }).click();
    await expect(
      desktop.getByRole('main').getByText('Desktop still active'),
    ).toBeVisible();

    await desktop.getByRole('button', { name: '退出客服账号' }).click();
    await expect(
      desktop.getByRole('button', { name: '进入工作台' }),
    ).toBeVisible();

    await expect
      .poll(async () => {
        const response = await adminPage.request.get(url('/api/admin/agents'));
        const payload = await response.json();
        return payload.agents.find((agent) => agent.username === username)
          ?.status;
      })
      .toBe('offline');
  } finally {
    await Promise.allSettled([phoneContext.close(), desktopContext.close()]);
  }
});