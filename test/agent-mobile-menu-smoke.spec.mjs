import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';
const agentUsername = `ui-mobile-menu-${randomUUID().slice(0, 8)}`;
const agentPassword = 'ui-mobile-menu-pass';

test('realtime notifications remain non-silent and deduplicate through device storage', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['notifications']);
  await page.goto(url('/agent'));
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/agent-sw.js', { scope: '/agent' });
    await navigator.serviceWorker.ready;
  });
  const worker = context
    .serviceWorkers()
    .find((item) => item.url().endsWith('/agent-sw.js'));
  expect(worker).toBeTruthy();
  await worker.evaluate(() => {
    globalThis.reminderRequests = [];
    globalThis.registration.showNotification = async (title, options) => {
      globalThis.reminderRequests.push({ title, ...options });
    };
  });
  const id = `browser-reminder-${Date.now()}`;
  const deliver = (messageId) =>
    page.evaluate(async (messageId) => {
      const registration = await navigator.serviceWorker.ready;
      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          channel.port1.close();
          resolve(event.data.delivered);
        };
        registration.active.postMessage(
          {
            type: 'agent.reminder.deliver',
            reminder: {
              type: 'CUSTOMER_REPLY',
              messageId,
              conversationId: 'browser-conversation',
            },
          },
          [channel.port2],
        );
      });
    }, messageId);
  expect(
    await Promise.all([deliver(id), deliver(id), deliver(`${id}-2`)]),
  ).toEqual([true, true, true]);
  // Clear volatile state to exercise the same durable lookup used after an SW restart.
  await worker.evaluate('deliveredMessages.clear()');
  expect(await deliver(id)).toBe(true);
  const shown = await worker.evaluate(() => globalThis.reminderRequests);
  expect(shown).toHaveLength(2);
  expect(shown.every((item) => item.silent === false)).toBe(true);
  expect(shown[0].vibrate).toEqual([220, 100, 220]);
});

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

async function seedAgent(page, username = agentUsername) {
  const adminLogin = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(adminLogin.ok()).toBeTruthy();

  const createAgent = await page.request.post(url('/api/admin/agents'), {
    data: {
      name: 'Mobile Menu Agent',
      username,
      password: agentPassword,
      routingScope: { type: 'none' },
      dailyConversationLimit: 0,
      trafficQuotaEnabled: false,
      trafficQuotaTopUp: 0,
      trafficQuotaRequestId: '',
      isEnabled: true,
    },
  });
  expect(createAgent.ok()).toBeTruthy();
}

async function loginAgent(page, username = agentUsername) {
  await page.goto(url('/agent'));
  await page.getByLabel('客服账号').fill(username);
  await page.getByLabel('登录密码').fill(agentPassword);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByText('我的会话')).toBeVisible();
}

test('mobile settings keeps its navigation context after child dialogs close', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAgent(page);
  await loginAgent(page);

  await page.getByRole('button', { name: '打开功能菜单' }).click();
  const settingsPage = page.getByRole('region', { name: '功能菜单' });
  await expect(settingsPage).toBeVisible();
  await expect(settingsPage).toHaveCSS(
    'animation-name',
    'agent-overlay-page-in',
  );
  await expect(settingsPage.getByText('设备与提醒')).toBeVisible();
  await expect(settingsPage.getByText(/消息提醒：/u)).toBeVisible();
  await expect(settingsPage.getByText('实时连接')).toBeVisible();
  await expect(settingsPage.getByText('后台 Push')).toBeVisible();

  const soundRow = settingsPage
    .locator('.mobile-agent-settings-item')
    .filter({ hasText: '消息提示音' });
  await expect(soundRow).toBeVisible();
  const soundPresetSelect = soundRow.getByRole('combobox', {
    name: '选择消息提示音',
  });
  await expect(soundPresetSelect).toBeVisible();
  await expect(soundPresetSelect).toHaveValue('strong');
  await expect(soundPresetSelect.locator('option')).toHaveText([
    '强提醒',
    '经典双音',
    '清脆提示',
    '三连音',
    '柔和水滴',
  ]);
  await expect(
    soundRow.getByRole('button', {
      name: /关闭消息提示音|开启消息提示音/u,
    }),
  ).toHaveCount(0);
  await expect(
    soundRow.getByRole('button', { name: '测试提示音' }),
  ).toBeVisible();
  await expect(
    settingsPage.getByRole('button', { name: '测试提示音' }),
  ).toHaveCount(1);

  const healthSummary = settingsPage.locator('.agent-notification-health');
  await expect(healthSummary.locator('dd .ui-icon').first()).toBeVisible();
  const healthColors = await healthSummary
    .locator('dd > span')
    .evaluateAll((rows) =>
      rows.map(
        (row) =>
          row.ownerDocument.defaultView?.getComputedStyle(row).color ?? '',
      ),
    );
  expect(new Set(healthColors).size).toBeGreaterThan(1);

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
  expect(
    settingsGeometry.cardRadii.every((radius) => radius >= 16),
  ).toBeTruthy();

  await settingsPage.getByRole('button', { name: /名片/u }).click();
  const cardSettingsDialog = page.getByRole('dialog', { name: '名片' });
  await expect(cardSettingsDialog).toBeVisible();
  await expect(cardSettingsDialog).toHaveCSS(
    'animation-name',
    'agent-overlay-sheet-in',
  );
  await page.getByRole('button', { name: '关闭名片设置' }).click();
  await expect(cardSettingsDialog).toBeHidden();
  await expect(settingsPage).toBeVisible();

  await page.route('**/api/agent/settings/auto-reply', async (route) => {
    if (route.request().method() === 'GET') {
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    await route.continue();
  });
  await settingsPage.getByRole('button', { name: /首次问候语/u }).click();
  const autoReplyDialog = page.getByRole('dialog', { name: '首次问候语' });
  await expect(autoReplyDialog).toBeVisible();
  await expect(autoReplyDialog).toHaveCSS(
    'animation-name',
    'agent-overlay-sheet-in',
  );
  await page.waitForTimeout(220);
  await expect(autoReplyDialog.getByText('正在读取设置…')).toBeVisible();
  const autoReplyGeometryBeforeLoad = await autoReplyDialog.boundingBox();
  await expect(
    autoReplyDialog.getByRole('checkbox', { name: /自动发送首次问候/u }),
  ).toBeVisible();
  const autoReplyGeometryAfterLoad = await autoReplyDialog.boundingBox();
  expect(autoReplyGeometryBeforeLoad).not.toBeNull();
  expect(autoReplyGeometryAfterLoad).not.toBeNull();
  if (autoReplyGeometryBeforeLoad && autoReplyGeometryAfterLoad) {
    expect(
      Math.abs(
        autoReplyGeometryBeforeLoad.height - autoReplyGeometryAfterLoad.height,
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        autoReplyGeometryBeforeLoad.y +
          autoReplyGeometryBeforeLoad.height -
          (autoReplyGeometryAfterLoad.y + autoReplyGeometryAfterLoad.height),
      ),
    ).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: '关闭自动回复设置' }).click();
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

test('mobile inbox pull refresh handles threshold, cancellation, retries and navigation', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const username = `ui-pull-${randomUUID().slice(0, 8)}`;
  await seedAgent(page, username);
  await loginAgent(page, username);
  const inbox = await (
    await page.request.get(url('/api/agent/conversations'))
  ).json();
  let requests = 0;
  let release;
  let fail = false;
  await page.route('**/api/agent/conversations', async (route) => {
    requests += 1;
    await new Promise((resolve) => {
      release = resolve;
    });
    await route.fulfill({
      status: fail ? 503 : 200,
      json: fail ? { error: 'Unavailable' } : inbox,
    });
  });
  const list = page.locator('.conversation-list');
  const status = page.locator('.agent-pull-refresh');
  const gesture = async (dy, dx = 0, cancel = false) => {
    await list.evaluate(
      (element, { dy, dx, cancel }) => {
        const touch = (x, y) =>
          new globalThis.Touch({
            identifier: 1,
            target: element,
            clientX: x,
            clientY: y,
          });
        element.dispatchEvent(
          new globalThis.TouchEvent('touchstart', {
            bubbles: true,
            touches: [touch(100, 250)],
          }),
        );
        element.dispatchEvent(
          new globalThis.TouchEvent('touchmove', {
            bubbles: true,
            cancelable: true,
            touches: [touch(100 + dx, 250 + dy)],
          }),
        );
        element.dispatchEvent(
          new globalThis.TouchEvent(cancel ? 'touchcancel' : 'touchend', {
            bubbles: true,
            touches: [],
          }),
        );
      },
      { dy, dx, cancel },
    );
  };
  await gesture(60);
  await gesture(160, 200);
  await gesture(160, 0, true);
  expect(requests).toBe(0);

  // Real browser touch input must claim the downward gesture before native scrolling.
  const session = await context.newCDPSession(page);
  const box = await list.boundingBox();
  const x = box.x + 80;
  const y = box.y + 30;
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  for (const offset of [20, 60, 100, 160]) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + offset }],
    });
  }
  await expect(status).toHaveText('松开刷新');
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  await expect.poll(() => requests).toBe(1);
  await expect(status).toHaveText('正在刷新…');
  await gesture(160);
  expect(requests).toBe(1);
  // Completing a refresh under an overlay must not leave its spinner stuck.
  await page.getByRole('button', { name: '打开功能菜单' }).click();
  release();
  await expect(status).toHaveClass(/is-success/);
  await page.getByRole('button', { name: '返回工作台' }).click();
  await expect(status).toHaveText('已刷新');

  const search = page.locator('.inbox-search input');
  await search.fill('保留搜索');
  fail = true;
  await gesture(160);
  await expect.poll(() => requests).toBe(2);
  release();
  await expect(status).toHaveText('刷新失败，请下拉重试');
  fail = false;
  await gesture(160);
  await expect.poll(() => requests).toBe(3);
  release();
  await expect(status).toHaveText('已刷新');
  await expect(search).toHaveValue('保留搜索');

  await list.evaluate((element) => {
    const spacer = globalThis.document.createElement('div');
    spacer.style.height = '2000px';
    element.append(spacer);
    element.scrollTop = 100;
  });
  await gesture(160);
  expect(requests).toBe(3);
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await gesture(160);
  expect(requests).toBe(3);
  await expect(status).toBeHidden();
});
