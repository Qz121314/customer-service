import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';
const agentUsername = 'ui-mobile-menu-agent';
const agentPassword = 'ui-mobile-menu-pass';

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

async function seedAgent(page) {
  const adminLogin = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(adminLogin.ok()).toBeTruthy();

  const createAgent = await page.request.post(url('/api/admin/agents'), {
    data: {
      name: 'Mobile Menu Agent',
      username: agentUsername,
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

async function loginAgent(page) {
  await page.goto(url('/agent'));
  await page.getByLabel('客服账号').fill(agentUsername);
  await page.getByLabel('登录密码').fill(agentPassword);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByText('我的会话')).toBeVisible();
}

async function swipeFromLeftEdge(page, endX) {
  return page.evaluate(
    ({ endX }) => {
      const browser = globalThis;
      const pointerId = 17;
      const clientY = 420;
      const dispatch = (type, clientX) => {
        browser.dispatchEvent(
          new browser.PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId,
            pointerType: 'touch',
            isPrimary: true,
            button: 0,
            clientX,
            clientY,
          }),
        );
      };

      dispatch('pointerdown', 4);
      dispatch('pointermove', endX);
      const surface = [
        ...browser.document.querySelectorAll(
          '[data-agent-swipe-back-surface="true"]',
        ),
      ].find(
        (element) =>
          element instanceof browser.HTMLElement &&
          element.style.transform.includes('translate3d'),
      );
      const transform =
        surface instanceof browser.HTMLElement ? surface.style.transform : '';
      const surfaceClass =
        surface instanceof browser.HTMLElement ? surface.className : '';
      const revealedElement = browser.document.elementFromPoint(16, clientY);
      const revealedConversation = Boolean(
        revealedElement?.closest('.conversation-pane'),
      );
      const revealedSettings = Boolean(
        revealedElement?.closest('.mobile-agent-settings-page'),
      );
      dispatch('pointerup', endX);
      return {
        transform,
        surfaceClass,
        revealedConversation,
        revealedSettings,
      };
    },
    { endX },
  );
}

test('mobile agent back gesture follows actual navigation hierarchy', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedAgent(page);
  await loginAgent(page);

  const avatarButton = page.getByRole('button', { name: '客服资料' });
  await avatarButton.click();
  const profileDialog = page.getByRole('dialog', { name: '客服资料' });
  await expect(profileDialog).toBeVisible();
  const profileSwipe = await swipeFromLeftEdge(page, 150);
  expect(profileSwipe.surfaceClass).toBe('');
  expect(profileSwipe.transform).toBe('');
  await expect(profileDialog).toBeVisible();
  await profileDialog.getByRole('button', { name: '关闭' }).click();
  await expect(profileDialog).toBeHidden();

  await page.getByRole('button', { name: '打开功能菜单' }).click();
  const settingsPage = page.getByRole('region', { name: '功能菜单' });
  await expect(settingsPage).toBeVisible();
  await expect(settingsPage).toHaveCSS(
    'animation-name',
    'agent-overlay-page-in',
  );
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
  expect(
    settingsGeometry.cardRadii.every((radius) => radius >= 16),
  ).toBeTruthy();

  const cancelledSwipe = await swipeFromLeftEdge(page, 64);
  expect(cancelledSwipe.surfaceClass).toContain('mobile-agent-settings-page');
  expect(cancelledSwipe.transform).toContain('translate3d');
  expect(cancelledSwipe.revealedConversation).toBeTruthy();
  await expect(settingsPage).toBeVisible();
  await expect
    .poll(() => settingsPage.evaluate((element) => element.style.transform))
    .toBe('');

  await settingsPage.getByRole('button', { name: /名片/u }).click();
  const cardSettingsDialog = page.getByRole('dialog', { name: '名片' });
  await expect(cardSettingsDialog).toBeVisible();
  await expect(cardSettingsDialog).toHaveCSS(
    'animation-name',
    'agent-overlay-sheet-in',
  );
  const cardSwipe = await swipeFromLeftEdge(page, 150);
  expect(cardSwipe.surfaceClass).toBe('');
  expect(cardSwipe.transform).toBe('');
  await expect(cardSettingsDialog).toBeVisible();
  await cardSettingsDialog
    .getByRole('button', { name: '关闭名片设置' })
    .click();
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
  const autoReplySwipe = await swipeFromLeftEdge(page, 150);
  expect(autoReplySwipe.surfaceClass).toBe('');
  expect(autoReplySwipe.transform).toBe('');
  await expect(autoReplyDialog).toBeVisible();
  await autoReplyDialog.getByRole('button', { name: '关闭' }).click();
  await expect(autoReplyDialog).toBeHidden();
  await expect(settingsPage).toBeVisible();

  await settingsPage.getByRole('button', { name: /接待流量/u }).click();
  const statsDialog = page.getByRole('dialog', { name: /接待数据/u });
  await expect(statsDialog).toBeVisible();
  const statsSwipe = await swipeFromLeftEdge(page, 150);
  expect(statsSwipe.surfaceClass).toContain('agent-statistics-backdrop');
  expect(statsSwipe.transform).toContain('translate3d');
  expect(statsSwipe.revealedSettings).toBeTruthy();
  await expect(statsDialog).toBeHidden();
  await expect(settingsPage).toBeVisible();

  const committedSwipe = await swipeFromLeftEdge(page, 150);
  expect(committedSwipe.surfaceClass).toContain('mobile-agent-settings-page');
  expect(committedSwipe.transform).toContain('translate3d');
  expect(committedSwipe.revealedConversation).toBeTruthy();
  await expect(settingsPage).toBeHidden();
  await expect(page.getByText('我的会话')).toBeVisible();
});
