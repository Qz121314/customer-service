import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';
const smokeRunId = randomUUID().replaceAll('-', '');
const agentUsername = `ui-smoke-agent-${smokeRunId}`;
const agentPassword = 'ui-smoke-pass';
const productId = `ui-smoke-product-${smokeRunId}`;
const smokeVisitorDigits = String(
  Number.parseInt(smokeRunId.slice(0, 8), 16) % 1000,
).padStart(3, '0');
const primeVisitorId = `UIT${smokeVisitorDigits}`;
const visitorId = `UIV${smokeVisitorDigits}`;
const primeSourceHandoffId = randomUUID();
const sourceHandoffId = randomUUID();

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

function conversationData({ visitorId, sourceHandoffId, clientMessageId }) {
  return {
    visitorId,
    sourceHandoffId,
    clientMessageId,
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
  };
}

async function requestConversation(page, identifiers) {
  return page.request.post(url('/client/v1/conversations'), {
    data: conversationData(identifiers),
  });
}

async function seedAgent(page) {
  const noAgentResponse = await requestConversation(page, {
    visitorId: primeVisitorId,
    sourceHandoffId: primeSourceHandoffId,
    clientMessageId: `ui-smoke-prime-${smokeRunId}`,
  });
  expect([200, 503]).toContain(noAgentResponse.status());

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
      dailyConversationLimit: 0,
      trafficQuotaEnabled: false,
      trafficQuotaTopUp: 0,
      trafficQuotaRequestId: '',
      isEnabled: true,
    },
  });
  console.log(
    'SMOKE_CREATE_AGENT',
    createAgent.status(),
    await createAgent.text(),
  );
  expect(createAgent.ok()).toBeTruthy();
  await page.context().clearCookies();
}

async function createConversation(page) {
  const conversation = await requestConversation(page, {
    visitorId,
    sourceHandoffId,
    clientMessageId: 'ui-smoke-message-1',
  });
  expect(conversation.ok()).toBeTruthy();
}

async function loginAgent(page) {
  await page.goto(url('/agent'));
  await page.getByLabel('客服账号').fill(agentUsername);
  await page.getByLabel('登录密码').fill(agentPassword);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByText('我的会话')).toBeVisible();
  await createConversation(page);
  await page.reload();
  await expect(page.getByText('我的会话')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /UI Smoke Product/u }),
  ).toBeVisible();
}

async function expectCenteredDialog(page) {
  const dialog = page.getByRole('dialog', { name: '客服资料' });
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

async function expectMobileThreadGeometry(page) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  const primaryAction = page.locator('.thread-status-action');
  await expect(primaryAction).toBeVisible();
  const primaryActionBox = await primaryAction.boundingBox();
  expect(primaryActionBox?.height ?? 0).toBeGreaterThanOrEqual(38);

  const productContext = page.locator('.conversation-context-card');
  await expect(productContext).toBeVisible();
  const productContextBox = await productContext.boundingBox();
  expect(productContextBox).not.toBeNull();
  if (productContextBox && viewport) {
    expect(productContextBox.x).toBeGreaterThanOrEqual(0);
    expect(productContextBox.x + productContextBox.width).toBeLessThanOrEqual(
      viewport.width + 1,
    );
  }
}

async function mobileComposerGeometry(page) {
  return page.evaluate(() => {
    const browser = globalThis;
    const snapshot = (selector) => {
      const element = browser.document.querySelector(selector);
      if (!(element instanceof browser.HTMLElement)) return null;
      const rect = element.getBoundingClientRect();
      const style = browser.getComputedStyle(element);
      return {
        x: rect.x,
        width: rect.width,
        right: rect.right,
        minWidth: style.minWidth,
        maxWidth: style.maxWidth,
        overflowX: style.overflowX,
        position: style.position,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        transform: style.transform,
        gridTemplateColumns: style.gridTemplateColumns,
        gridColumnStart: style.gridColumnStart,
        gridColumnEnd: style.gridColumnEnd,
        gridRowStart: style.gridRowStart,
        gridRowEnd: style.gridRowEnd,
      };
    };
    return {
      innerWidth: browser.innerWidth,
      documentClientWidth: browser.document.documentElement.clientWidth,
      documentScrollWidth: browser.document.documentElement.scrollWidth,
      bodyClientWidth: browser.document.body.clientWidth,
      bodyScrollWidth: browser.document.body.scrollWidth,
      workspace: snapshot('.workspace-shell'),
      thread: snapshot('.thread-pane'),
      composer: snapshot('.composer'),
      tools: snapshot('.composer-tools'),
      textarea: snapshot('.composer textarea'),
      foot: snapshot('.composer-foot'),
      warning: snapshot('.composer-foot .media-upload-progress'),
      send: snapshot('.composer-foot .primary-button'),
    };
  });
}

test('agent desktop and mobile interaction surfaces remain usable', async ({
  page,
}) => {
  await seedAgent(page);
  await loginAgent(page);

  const serviceWorker = await page.evaluate(async () => {
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) =>
        globalThis.setTimeout(() => resolve(null), 5_000),
      ),
    ]);
    if (!ready) return null;
    return {
      scope: ready.scope,
    };
  });
  expect(serviceWorker).not.toBeNull();
  expect(serviceWorker?.scope).toBe(url('/agent'));
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const ready = await navigator.serviceWorker.ready;
          return ready.active?.state ?? null;
        }),
      { timeout: 10_000 },
    )
    .toBe('activated');

  const desktopVisuals = await page.evaluate(() => {
    const browser = globalThis;
    const shell = browser.document.querySelector('.workspace-shell');
    const sidebar = browser.document.querySelector('.workspace-sidebar');
    const row = browser.document.querySelector('.conversation-row');
    if (
      !(shell instanceof browser.HTMLElement) ||
      !(sidebar instanceof browser.HTMLElement) ||
      !(row instanceof browser.HTMLElement)
    ) {
      return null;
    }
    return {
      shellRadius: Number.parseFloat(
        browser.getComputedStyle(shell).borderRadius,
      ),
      sidebarBackground: browser.getComputedStyle(sidebar).backgroundColor,
      rowRadius: Number.parseFloat(browser.getComputedStyle(row).borderRadius),
    };
  });
  expect(desktopVisuals).not.toBeNull();
  if (desktopVisuals) {
    expect(desktopVisuals.shellRadius).toBeGreaterThanOrEqual(20);
    expect(desktopVisuals.sidebarBackground).toBe('rgb(23, 25, 31)');
    expect(desktopVisuals.rowRadius).toBeGreaterThanOrEqual(10);
  }

  const autoReplyButton = page.getByRole('button', {
    name: '打开自动回复设置',
  });
  await expect(autoReplyButton).toBeVisible();
  await autoReplyButton.click();
  const autoReplyDialog = page.getByRole('dialog', { name: '首次问候语' });
  await expect(autoReplyDialog).toBeVisible();
  const autoReplyToggle = autoReplyDialog.getByRole('checkbox', {
    name: /自动发送首次问候/u,
  });
  await expect(autoReplyToggle).not.toBeChecked();
  await autoReplyToggle.check();
  await autoReplyDialog
    .getByLabel('问候内容')
    .fill('您好，我来为您服务，请问有什么可以帮您？');
  await autoReplyDialog.getByRole('button', { name: '保存设置' }).click();
  await expect(
    autoReplyDialog.getByRole('button', { name: '已保存' }),
  ).toBeVisible();
  await autoReplyDialog
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(autoReplyDialog).toBeHidden();

  const avatarButton = page.getByRole('button', { name: '客服资料' });
  await expect(avatarButton).toBeVisible();
  await avatarButton.click();
  await expectCenteredDialog(page);
  await expect(
    page.getByText('访客端只显示对外昵称和客服头像。'),
  ).toBeVisible();
  await expect(page.getByLabel('对外昵称')).toBeVisible();
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(avatarButton).toBeVisible();
  const mobileAvatarBox = await avatarButton.boundingBox();
  expect(mobileAvatarBox?.width ?? 0).toBeGreaterThanOrEqual(34);
  expect(mobileAvatarBox?.height ?? 0).toBeGreaterThanOrEqual(34);
  await avatarButton.click();
  await expectCenteredDialog(page);
  await page.getByRole('button', { name: '关闭', exact: true }).click();

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(url('/agent?notification=latest-unread'));
  const composer = page.getByPlaceholder('输入回复内容…');
  await expect(composer).toBeVisible();
  await expect(page).toHaveURL(url('/agent'));
  await expect(page.getByLabel('会话状态')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 700 });
  const mobileComposer = page.getByPlaceholder('输入回复内容…');
  await mobileComposer.focus();
  await expectMobileThreadGeometry(page);
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

  const sendButton = page.getByRole('button', { name: '发送' });
  const sendButtonBox = await sendButton.boundingBox();
  expect(sendButtonBox).not.toBeNull();
  if (sendButtonBox && viewport) {
    const geometry = await mobileComposerGeometry(page);
    expect(
      sendButtonBox.x + sendButtonBox.width,
      `Mobile composer geometry: ${JSON.stringify(geometry)}`,
    ).toBeLessThanOrEqual(viewport.width + 1);
  }

  const backButton = page.getByRole('button', { name: '返回会话列表' });
  const backBox = await backButton.boundingBox();
  expect(backBox?.width ?? 0).toBeGreaterThanOrEqual(38);
  expect(backBox?.height ?? 0).toBeGreaterThanOrEqual(38);

  const mobileNavigation = await page.evaluate(() => {
    const browser = globalThis;
    return {
      marker: browser.history.state?.__customerServiceAgentView ?? null,
      overscrollX: browser.getComputedStyle(browser.document.body)
        .overscrollBehaviorX,
    };
  });
  expect(mobileNavigation.marker?.view).toBe('thread');
  expect(typeof mobileNavigation.marker?.conversationId).toBe('string');
  expect(mobileNavigation.overscrollX).toBe('auto');

  await page.evaluate(() => globalThis.history.back());
  await expect(page.getByText('我的会话')).toBeVisible();
  await expect(backButton).toBeHidden();
  await expect(mobileComposer).toBeHidden();

  const settingsButton = page.getByRole('button', { name: '打开功能菜单' });
  await expect(settingsButton).toBeVisible();
  const settingsIcon = settingsButton.locator('svg.ui-icon');
  await expect(settingsIcon).toBeVisible();
  await expect(settingsIcon).toHaveAttribute('viewBox', '0 0 24 24');
  const settingsButtonBox = await settingsButton.boundingBox();
  const settingsIconBox = await settingsIcon.boundingBox();
  expect(settingsButtonBox?.width ?? 0).toBeGreaterThanOrEqual(40);
  expect(settingsButtonBox?.height ?? 0).toBeGreaterThanOrEqual(40);
  expect(settingsIconBox?.width ?? 0).toBeGreaterThanOrEqual(19);
  expect(settingsIconBox?.height ?? 0).toBeGreaterThanOrEqual(19);
  await settingsButton.click();
  const settingsPage = page.getByRole('region', { name: '功能菜单' });
  await expect(settingsPage).toBeVisible();
  await expect(
    settingsPage.getByRole('button', { name: '安装到手机' }),
  ).toBeVisible();
  await expect(settingsPage.getByText('首次问候语')).toBeVisible();
  await expect(settingsPage.getByText('接待流量')).toBeVisible();
  await expect(
    settingsPage.getByRole('button', { name: '退出客服账号' }),
  ).toBeVisible();
  await settingsPage.getByRole('button', { name: '返回工作台' }).click();
  await expect(settingsPage).toBeHidden();

  const inboxGeometry = await page.evaluate(() => {
    const browser = globalThis;
    const sidebar = browser.document.querySelector('.workspace-sidebar');
    const pane = browser.document.querySelector('.conversation-pane');
    if (
      !(sidebar instanceof browser.HTMLElement) ||
      !(pane instanceof browser.HTMLElement)
    ) {
      return null;
    }
    const sidebarRect = sidebar.getBoundingClientRect();
    const paneRect = pane.getBoundingClientRect();
    return {
      viewportHeight: browser.innerHeight,
      sidebarHeight: sidebarRect.height,
      paneHeight: paneRect.height,
      paneBottom: paneRect.bottom,
    };
  });
  expect(inboxGeometry).not.toBeNull();
  if (inboxGeometry) {
    expect(Math.abs(inboxGeometry.sidebarHeight - 52)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        inboxGeometry.paneHeight -
          (inboxGeometry.viewportHeight - inboxGeometry.sidebarHeight),
      ),
    ).toBeLessThanOrEqual(2);
    expect(inboxGeometry.paneBottom).toBeLessThanOrEqual(
      inboxGeometry.viewportHeight + 1,
    );
  }

  await page.evaluate(() => globalThis.history.forward());
  await expect(mobileComposer).toBeVisible();
  await expect(backButton).toBeVisible();

  await backButton.click();
  await expect(page.getByText('我的会话')).toBeVisible();
  await expect(mobileComposer).toBeHidden();
});
