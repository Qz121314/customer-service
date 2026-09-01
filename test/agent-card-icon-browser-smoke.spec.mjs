import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

const baseUrl = process.env.UI_SMOKE_BASE_URL ?? 'http://127.0.0.1:8787';
const adminPassword =
  process.env.UI_SMOKE_ADMIN_PASSWORD ?? 'ui-smoke-admin-password';

function url(path) {
  return new URL(path, `${baseUrl}/`).toString();
}

test('agent can create an SMS contact card with a custom icon', async ({ page }) => {
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

  await dialog.getByLabel('名片图标').setInputFiles({
    name: 'sms-card.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await dialog.getByLabel('名称').fill('短信名片');
  await dialog.getByLabel('手机号').fill('+1 213 555 1234');
  await dialog.getByRole('button', { name: '添加' }).click();

  const row = dialog.locator('.agent-attachment-preset-row').filter({
    hasText: '短信名片',
  });
  await expect(row).toBeVisible();
  await expect(row.getByText('SMS', { exact: false })).toBeVisible();
  await expect(row.locator('.agent-contact-card-icon img')).toBeVisible();
});
