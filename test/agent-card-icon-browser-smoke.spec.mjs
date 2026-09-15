import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

test('agent can configure cards inline with preset text and custom icon', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const runId = randomUUID().replaceAll('-', '');
  const username = `ui-card-${runId.slice(0, 16)}`;
  const password = 'ui-card-pass';

  const adminLogin = await page.request.post(url('/api/auth/login'), {
    data: { password: adminPassword },
  });
  expect(adminLogin.ok()).toBeTruthy();

  const createAgent = await page.request.post(url('/api/admin/agents'), {
    data: {
      name: 'Card Icon Agent',
      username,
      password,
      routingScope: { type: 'none' },
      dailyConversationLimit: 0,
      trafficQuotaEnabled: false,
      trafficQuotaTopUp: 0,
      trafficQuotaRequestId: '',
      isEnabled: true,
    },
  });
  expect(createAgent.ok()).toBeTruthy();
  await page.context().clearCookies();

  await page.goto(url('/agent'));
  await page.getByLabel('客服账号').fill(username);
  await page.getByLabel('登录密码').fill(password);
  await page.getByRole('button', { name: '进入工作台' }).click();
  await expect(page.getByText('我的会话')).toBeVisible();

  await page.getByRole('button', { name: '打开功能菜单' }).click();
  const settingsPage = page.getByRole('region', { name: '功能菜单' });
  await expect(settingsPage).toBeVisible();
  await settingsPage.getByRole('button', { name: /名片/u }).click();

  const dialog = page.getByRole('dialog', { name: '素材库' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('正在读取素材…')).toBeHidden();
  await dialog.getByRole('button', { name: /^名片/u }).click();
  await expect(
    dialog.locator('.agent-inline-card-editor').getByText('录入名片', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: '名片' })).toHaveCount(0);
  await expect(dialog.locator('.agent-card-workspace')).toBeVisible();
  await expect(dialog.locator('.agent-card-library-pane')).toBeVisible();
  await expect(dialog.locator('.agent-card-editor-pane')).toBeVisible();

  const initialLayout = await dialog.evaluate((element) => {
    const browser = element.ownerDocument.defaultView;
    const body = element.querySelector('.agent-materials-body');
    const editor = element.querySelector('.agent-inline-card-editor');
    if (
      !browser ||
      !(body instanceof browser.HTMLElement) ||
      !(editor instanceof browser.HTMLElement)
    ) {
      return null;
    }
    const dialogRect = element.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return {
      dialogBottom: dialogRect.bottom,
      dialogTop: dialogRect.top,
      bodyOverflowY: browser.getComputedStyle(body).overflowY,
      editorWidth: editor.getBoundingClientRect().width,
      bodyWidth: bodyRect.width,
    };
  });
  expect(initialLayout).not.toBeNull();
  if (initialLayout) {
    expect(initialLayout.dialogTop).toBeGreaterThanOrEqual(0);
    expect(initialLayout.dialogBottom).toBeLessThanOrEqual(844);
    expect(initialLayout.bodyOverflowY).toBe('auto');
    expect(initialLayout.editorWidth).toBeLessThanOrEqual(
      initialLayout.bodyWidth,
    );
  }

  const typeSelect = dialog.getByRole('combobox', { name: '名片类型' });
  await expect(typeSelect).toHaveValue('sms');
  await dialog.getByLabel('名称').fill('短信名片');
  await dialog.getByLabel('短信号码').fill('+1 213 555 1234');
  await dialog
    .getByLabel('预设话术（可选）')
    .fill('Hello, I would like more information.');
  const createSmsResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/agent/attachments/presets') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: '保存名片' }).click();
  const smsResponse = await createSmsResponse;
  expect(smsResponse.status()).toBe(201);
  await expect(smsResponse.json()).resolves.toMatchObject({
    preset: { kind: 'sms', label: '短信名片' },
  });

  const smsCard = dialog
    .locator('.agent-material-attachment-card')
    .filter({ hasText: '短信名片' });
  await expect(smsCard).toBeVisible();
  await expect(
    smsCard.evaluate((element) => getComputedStyle(element).display),
  ).resolves.toBe('grid');
  await expect(smsCard.getByText('SMS', { exact: false })).toBeVisible();
  await expect(
    smsCard.locator(
      '.agent-contact-card-icon[data-channel="sms"] img[src="/icons/contact-card-imessage.svg"]',
    ),
  ).toBeVisible();

  await typeSelect.selectOption('whatsapp');
  await expect(typeSelect).toHaveValue('whatsapp');
  await dialog.getByLabel('名称').fill('WhatsApp 名片');
  await dialog.getByLabel('WhatsApp 号码').fill('+1 213 555 9999');
  await dialog.getByLabel('预设话术（可选）').fill('Need more info');
  await dialog.getByLabel('名片图标').setInputFiles({
    name: 'whatsapp-card.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await dialog.getByRole('button', { name: '保存名片' }).click();

  const whatsappCard = dialog
    .locator('.agent-material-attachment-card')
    .filter({ hasText: 'WhatsApp 名片' });
  await expect(whatsappCard).toBeVisible();
  await expect(
    whatsappCard.locator('.agent-contact-card-custom-icon'),
  ).toBeVisible();
  await expect(dialog.locator('.agent-inline-card-editor')).toBeVisible();

  await whatsappCard
    .getByRole('button', { name: '编辑 WhatsApp 名片' })
    .click();
  await expect(
    dialog.locator('.agent-inline-card-editor').getByText('编辑名片', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByLabel('名称')).toHaveValue('WhatsApp 名片');
  await expect(dialog.getByLabel('WhatsApp 号码')).toHaveValue('+12135559999');

  await whatsappCard
    .getByRole('button', { name: '删除 WhatsApp 名片' })
    .click();
  await expect(whatsappCard).toHaveCount(0);
});
