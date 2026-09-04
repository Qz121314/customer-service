import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';

test.setTimeout(90_000);

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

async function expectAgentWorkspace(page) {
  await expect(page.locator('.workspace-shell')).toBeVisible();
  await expect(page.locator('.conversation-pane')).toBeVisible();
}

async function loginAgent(page, username, password) {
  await page.goto(url('/agent'));
  await page.getByLabel('客服账号').fill(username);
  await page.getByLabel('登录密码').fill(password);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expectAgentWorkspace(page);
  await expect(page.getByText('连接正常')).toBeVisible();
}

function attachBrowserDiagnostics(page, label) {
  page.on('pageerror', (error) => {
    console.error(`[${label}] pageerror ${error.stack ?? error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    console.error(`[${label}] console.error ${message.text()}`);
  });
  page.on('crash', () => {
    console.error(`[${label}] page-crash`);
  });
}

async function disableVibration(context) {
  await context.addInitScript(() => {
    try {
      Object.defineProperty(Navigator.prototype, 'vibrate', {
        configurable: true,
        value: () => false,
      });
    } catch {
      // Diagnostic only: leave the native capability untouched if immutable.
    }
  });
}

async function disableAudioContext(context) {
  await context.addInitScript(() => {
    try {
      Object.defineProperty(globalThis, 'AudioContext', {
        configurable: true,
        value: undefined,
      });
    } catch {
      // Diagnostic only: leave the native capability untouched if immutable.
    }
  });
}

async function logRenderedInbox(page, label) {
  try {
    const rendered = await page.evaluate(() => ({
      href: window.location.href,
      workspace: Boolean(document.querySelector('.workspace-shell')),
      conversationPane: Boolean(document.querySelector('.conversation-pane')),
      bodyText: document.body.innerText.slice(0, 1600),
      rows: Array.from(document.querySelectorAll('.conversation-row')).map(
        (row) => ({
          id: row.getAttribute('data-conversation-id'),
          text: row.textContent,
          ariaLabel: row.getAttribute('aria-label'),
        }),
      ),
    }));
    console.error(`[${label}] rendered-inbox ${JSON.stringify(rendered)}`);
  } catch (error) {
    console.error(
      `[${label}] rendered-inbox-error ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    );
  }
}

async function logAgentBootstrap(page, label) {
  try {
    const result = await page.evaluate(async () => {
      const response = await fetch('/api/agent/bootstrap', {
        credentials: 'same-origin',
      });
      const payload = await response.json();
      return {
        status: response.status,
        conversations: Array.isArray(payload?.conversations)
          ? payload.conversations.map((conversation) => ({
              id: conversation.id,
              productTitle: conversation.product_title,
              subject: conversation.subject,
              assignedAgent: conversation.assigned_agent,
              status: conversation.status,
            }))
          : null,
      };
    });
    console.error(`[${label}] bootstrap ${JSON.stringify(result)}`);
  } catch (error) {
    console.error(
      `[${label}] bootstrap-error ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    );
  }
}

test('desktop and phone share availability while logout remains device-local', async ({
  browser,
  page: adminPage,
}) => {
  const runId = randomUUID().replaceAll('-', '');
  const username = `multi-device-${runId.slice(0, 14)}`;
  const password = 'multi-device-pass';
  const productId = `multi-device-product-${runId}`;
  const visitorId = `MUL${String(Number.parseInt(runId.slice(0, 6), 16) % 1000).padStart(3, '0')}`;

  const product = {
    id: productId,
    sectionId: 'multi-device-section',
    sectionName: 'Multi-device Section',
    categoryId: 'multi-device-category',
    categoryName: 'Multi-device Category',
    title: 'Multi-device Product',
    href: 'https://example.com/multi-device-product',
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
      name: 'Multi-device Agent',
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
  await disableVibration(desktopContext);
  await disableVibration(phoneContext);
  await disableAudioContext(desktopContext);
  await disableAudioContext(phoneContext);
  const desktop = await desktopContext.newPage();
  const phone = await phoneContext.newPage();
  attachBrowserDiagnostics(desktop, 'desktop');
  attachBrowserDiagnostics(phone, 'phone');

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
          clientMessageId: `multi-device-initial-${runId}`,
          message: 'Hello from the multi-device visitor',
          product,
        },
      },
    );
    expect(createConversation.ok()).toBeTruthy();
    const created = await createConversation.json();
    const conversationId = created.conversation.id;

    await Promise.all([
      logAgentBootstrap(desktop, 'desktop'),
      logAgentBootstrap(phone, 'phone'),
      logRenderedInbox(desktop, 'desktop'),
      logRenderedInbox(phone, 'phone'),
    ]);

    for (const [label, device] of [
      ['desktop', desktop],
      ['phone', phone],
    ]) {
      const conversation = device.getByRole('button', {
        name: /Multi-device Product/u,
      });
      try {
        await expect(conversation).toBeVisible({ timeout: 10_000 });
      } catch (error) {
        await logAgentBootstrap(device, `${label}-after-wait`);
        await logRenderedInbox(device, `${label}-after-wait`);
        throw error;
      }
      await conversation.click();
      await expect(device.getByPlaceholder('输入回复内容…')).toBeVisible();
    }

    await phone.getByPlaceholder('输入回复内容…').fill('Phone reply');
    await phone.getByRole('button', { name: '发送' }).click();
    await expect(desktop.getByText('Phone reply')).toBeVisible();

    const visitorReply = await adminPage.request.post(
      url(`/client/v1/conversations/${conversationId}/messages`),
      {
        data: {
          visitorId,
          projectId: 'default',
          clientMessageId: `multi-device-visitor-${runId}`,
          body: 'Visitor reply on both devices',
        },
      },
    );
    expect(visitorReply.ok()).toBeTruthy();
    await expect(
      desktop.getByText('Visitor reply on both devices'),
    ).toBeVisible();
    await expect(
      phone.getByText('Visitor reply on both devices'),
    ).toBeVisible();

    await phone.getByRole('button', { name: '打开功能菜单' }).click();
    await phone.getByRole('button', { name: /退出客服账号/u }).click();
    await expect(
      phone.getByRole('button', { name: '进入工作台' }),
    ).toBeVisible();
    await expect(desktop.getByText('连接正常')).toBeVisible();
    await desktop
      .getByPlaceholder('输入回复内容…')
      .fill('Desktop still active');
    await desktop.getByRole('button', { name: '发送' }).click();
    await expect(desktop.getByText('Desktop still active')).toBeVisible();

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
