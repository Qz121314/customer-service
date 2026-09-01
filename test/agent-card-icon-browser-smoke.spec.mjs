import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

test('agent can configure channel cards, preset text and custom icon override', async ({
  page,
}) => {
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

  await page.getByRole('button', { name: '打开名片设置' }).click();
  const dialog = page.getByRole('dialog', { name: '名片' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('正在读取名片…')).toBeHidden();

  const typeSelect = dialog.getByRole('combobox', { name: '名片类型' });
  await expect(typeSelect).toContainText('SMS');
  await expect(typeSelect.locator('[data-brand="imessage"]')).toBeVisible();
  await typeSelect.click();
  const typeOptions = dialog.getByRole('listbox', {
    name: '名片类型选项',
  });
  await expect(
    typeOptions.getByRole('option', { name: /WhatsApp/u }),
  ).toBeVisible();
  await expect(
    typeOptions.getByRole('option', { name: /Telegram/u }),
  ).toBeVisible();
  await expect(
    typeOptions.getByRole('option', { name: /网站/u }),
  ).toBeVisible();
  await expect(
    typeOptions.locator(
      '[data-brand="whatsapp"] img[src="/icons/contact-card-whatsapp.svg"]',
    ),
  ).toBeVisible();
  await expect(
    typeOptions.locator(
      '[data-brand="telegram"] img[src="/icons/contact-card-telegram.svg"]',
    ),
  ).toBeVisible();
  await typeSelect.click();

  await dialog.getByLabel('名称').fill('短信名片');
  await dialog.getByLabel('短信号码').fill('+1 213 555 1234');
  await dialog
    .getByLabel('预设话术（可选）')
    .fill('Hello, I would like more information.');
  await dialog.getByRole('button', { name: '添加' }).click();

  const smsRow = dialog.locator('.agent-attachment-preset-row').filter({
    hasText: '短信名片',
  });
  await expect(smsRow).toBeVisible();
  await expect(smsRow.getByText('SMS', { exact: false })).toBeVisible();
  await expect(
    smsRow.locator(
      '.agent-contact-card-icon[data-channel="sms"] img[src="/icons/contact-card-imessage.svg"]',
    ),
  ).toBeVisible();
  await expect(smsRow.locator('.agent-contact-card-custom-icon')).toHaveCount(
    0,
  );

  await typeSelect.click();
  await dialog.getByRole('option', { name: /WhatsApp/u }).click();
  await expect(typeSelect).toContainText('WhatsApp');
  await expect(typeSelect.locator('[data-brand="whatsapp"]')).toBeVisible();
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
  await dialog.getByRole('button', { name: '添加' }).click();

  const whatsappRow = dialog.locator('.agent-attachment-preset-row').filter({
    hasText: 'WhatsApp 名片',
  });
  await expect(whatsappRow).toBeVisible();
  await expect(
    whatsappRow.locator('.agent-contact-card-custom-icon'),
  ).toBeVisible();
});
