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

  await page.getByRole('button', { name: '打开名片设置' }).click();
  const dialog = page.getByRole('dialog', { name: '名片' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('正在读取名片…')).toBeHidden();

  const initialLayout = await dialog.evaluate((element) => {
    const body = element.querySelector('.agent-attachment-manager-body');
    const editor = element.querySelector('.agent-attachment-editor');
    if (!(body instanceof HTMLElement) || !(editor instanceof HTMLElement)) {
      return null;
    }
    const dialogRect = element.getBoundingClientRect();
    return {
      dialogBottom: dialogRect.bottom,
      dialogTop: dialogRect.top,
      bodyOverflowY: getComputedStyle(body).overflowY,
      editorWidth: editor.getBoundingClientRect().width,
      bodyWidth: body.getBoundingClientRect().width,
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
  await expect
    .poll(() =>
      dialog
        .locator('.agent-attachment-manager-body')
        .evaluate((element) => element.scrollTop),
    )
    .toBeLessThan(3);

  const savedCardLayout = await dialog.evaluate((element) => {
    const body = element.querySelector('.agent-attachment-manager-body');
    const list = element.querySelector('.agent-attachment-preset-list');
    const row = element.querySelector('.agent-attachment-preset-row');
    const editor = element.querySelector('.agent-attachment-editor');
    if (
      !(body instanceof HTMLElement) ||
      !(list instanceof HTMLElement) ||
      !(row instanceof HTMLElement) ||
      !(editor instanceof HTMLElement)
    ) {
      return null;
    }
    const bodyRect = body.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    return {
      listVerticalOverflow: list.scrollHeight - list.clientHeight,
      rowTop: rowRect.top,
      rowBottom: rowRect.bottom,
      editorTop: editorRect.top,
      bodyTop: bodyRect.top,
    };
  });
  expect(savedCardLayout).not.toBeNull();
  if (savedCardLayout) {
    expect(savedCardLayout.listVerticalOverflow).toBeLessThanOrEqual(1);
    expect(savedCardLayout.rowTop).toBeGreaterThanOrEqual(
      savedCardLayout.bodyTop,
    );
    expect(savedCardLayout.rowBottom).toBeLessThanOrEqual(
      savedCardLayout.editorTop,
    );
  }

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

  const horizontalList = await dialog
    .locator('.agent-attachment-preset-list')
    .evaluate((element) => ({
      itemCount: element.querySelectorAll('.agent-attachment-preset-row')
        .length,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      verticalOverflow: element.scrollHeight - element.clientHeight,
    }));
  expect(horizontalList.itemCount).toBe(2);
  expect(horizontalList.scrollWidth).toBeGreaterThan(
    horizontalList.clientWidth,
  );
  expect(horizontalList.verticalOverflow).toBeLessThanOrEqual(1);
});
